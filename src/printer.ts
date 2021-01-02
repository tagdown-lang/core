import { ContentsLayout, ParseContent, parseContents, parseEscapeContents, ParseTag } from "./parser"
import { Tag, Content } from "./types"
import { assert, log } from "./utils"

interface PrintTag extends Tag {
  attributes: PrintTag[]
  contents: PrintContent[]
  contentsLayout: ContentsLayout
}

type PrintContent = string | PrintTag

// Check

function isAtomTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Atom
}

function isBraceTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Brace
}

function isLineTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Line
}

function isIndentTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Indent
}

function isInlineTag(tag: PrintTag): boolean {
  return isAtomTag(tag) || isBraceTag(tag)
}

// Prepare

function prepareTag(tag: Tag): PrintTag {
  return {
    ...tag,
    attributes: tag.attributes.map(prepareTag),
    contents: prepareContents(tag.contents),
    contentsLayout: tag.contents.length > 0 ? ContentsLayout.Brace : ContentsLayout.Atom,
  }
}

function prepareContents(contents: Content[]): PrintContent[] {
  return contents.map(content => (typeof content !== "string" ? prepareTag(content) : content))
}

// Layout

function layoutTag(tag: PrintTag, parentTag?: PrintTag): void {
  for (const attr of tag.attributes) layoutTag(attr, tag)
  layoutContents(tag.contents, tag)
  if (tag.attributes.length > 2) {
    tag.contentsLayout = ContentsLayout.Indent
  } else if (!isIndentTag(tag)) {
    for (const attr of tag.attributes) {
      if (!isInlineTag(attr)) {
        tag.contentsLayout = ContentsLayout.Indent
        break
      }
    }
  }
  if (isIndentTag(tag)) {
    for (const attr of tag.attributes) {
      if (isBraceTag(attr)) {
        attr.contentsLayout = ContentsLayout.Line
      }
    }
  }
  if (parentTag && isBraceTag(parentTag) && !isInlineTag(tag)) {
    parentTag.contentsLayout = ContentsLayout.Indent
  }
}

function layoutContents(contents: PrintContent[], tag?: PrintTag): void {
  for (const content of contents) if (typeof content !== "string") layoutTag(content)
  if (!tag || isIndentTag(tag)) return
  let hasLineTag = false
  for (const content of contents) {
    if (hasLineTag || (typeof content !== "string" ? isIndentTag(content) : /\r?\n/.test(content))) {
      tag.contentsLayout = ContentsLayout.Indent
      return
    }
    if (typeof content !== "string" && isLineTag(content)) {
      hasLineTag = true
    }
  }
  if (tag.isLiteral) {
    let unbalancedLeft = 0
    let unbalancedRight = 0
    for (const chr of contents[0] as string) {
      if (chr === "{") {
        unbalancedLeft++
      } else if (chr === "}") {
        if (unbalancedLeft > 0) {
          unbalancedLeft--
        } else {
          unbalancedRight++
        }
      }
    }
    if (unbalancedLeft > 0 || unbalancedRight > 0) {
      tag.contentsLayout = ContentsLayout.Line
    }
  }
}

// Assert

function assertTag(tag: PrintTag) {
  assert(!/\r?\n/.test(tag.name), "newlines are disallowed in tag names")
  if (isAtomTag(tag)) {
    assert(tag.contents.length === 0, "atom tags must have no contents")
  } else if (isBraceTag(tag)) {
    assert(tag.contents.length > 0, "brace tags must have contents")
  } else if (isLineTag(tag)) {
    assert(tag.contents.length > 0, "line tags must have contents")
  } else {
    assert(
      tag.attributes.length > 0 || tag.contents.length > 0,
      "indent tags must have either attributes or contents",
    )
  }
  if (tag.isLiteral) {
    assert(!isAtomTag(tag), "literals must not be atom tags")
    assert(
      tag.contents.length === 1 && typeof tag.contents[0] === "string",
      "literals must have a single text as contents",
    )
  }
}

function assertContents(contents: PrintContent[]): void {
  let isPrevText = false
  for (const content of contents) {
    if (typeof content === "string") {
      assert(!isPrevText, "contents must have no consecutive texts")
      isPrevText = true
    } else {
      assertTag(content)
      isPrevText = false
    }
  }
}

// Escape

function escapeEmptyLines(lines: string, isLastContent: boolean, tag?: PrintTag, prevTag?: PrintTag): string {
  const parts = lines.split(/(\r?\n)/)
  let text = ""
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i]
    if (i % 2 === 0 && (i + 1 !== parts.length || (isLastContent && (!tag || !isInlineTag(tag))))) {
      if (
        part.trimEnd() !== part ||
        (part === "" && (parts.length > 1 || (prevTag && !isInlineTag(prevTag))))
      ) {
        part += "$"
      } else {
        part = part.replace(/\$$/, "\\$")
      }
    }
    text += part
  }
  return text
}

function escapeTagName(tag: PrintTag): string {
  let name = tag.name.replace(/^(['@])/, "\\$1").replace(/([\\{}:])/g, "\\$1")
  if (isAtomTag(tag) && tag.attributes.length === 0) {
    name = name.replace(/(='?)$/, "\\$1")
  }
  return name
}

function escapeTag(tag: PrintTag): void {
  tag.name = escapeTagName(tag)
  for (const attr of tag.attributes) escapeTag(attr)
  escapeContents(tag.contents, tag)
}

function escapeContents(contents: PrintContent[], tag?: PrintTag): void {
  if (tag && tag.isLiteral) {
    contents[0] = escapeEmptyLines(contents[0] as string, true, tag)
  } else {
    let prevTag: PrintTag | undefined
    for (let i = 0; i < contents.length; i++) {
      let content = contents[i]
      if (typeof content === "string") {
        content = content.replace(/([\\{}])/g, "\\$1")
        if (content[0] === ":" && prevTag && isIndentTag(prevTag) && prevTag.contents.length === 0) {
          content = "\\" + content
        }
        contents[i] = escapeEmptyLines(content, i + 1 === contents.length, tag, prevTag)
      } else {
        escapeTag(content)
        prevTag = content
      }
    }
  }
}

// Output

function outputTag(tag: PrintTag, indentLevel: number): string {
  let output = "{"
  if (tag.isQuoted) output += "'"
  if (tag.isAttribute) output += "@"
  output += tag.name
  const attrOutputs = tag.attributes.map(attr => outputTag(attr, indentLevel + 1))
  if (!isIndentTag(tag)) {
    output += attrOutputs.join("")
  }
  if (!isAtomTag(tag)) {
    output += isInlineTag(tag) ? ":" : "="
    if (tag.isLiteral) output += "'"
    if (isBraceTag(tag)) {
      output += " " + outputContents(tag.contents, tag)
    }
  }
  output += "}"
  if (isLineTag(tag)) {
    output += " " + outputContents(tag.contents, tag, indentLevel)
  } else if (isIndentTag(tag)) {
    const newLineIndent = "\n" + "  ".repeat(indentLevel)
    output += attrOutputs.map(output => newLineIndent + "  " + output).join("")
    if (tag.contents.length > 0) {
      output += newLineIndent + ": " + outputContents(tag.contents, tag, indentLevel + 1)
    }
  }
  return output
}

function outputContents(contents: PrintContent[], tag?: PrintTag, indentLevel = 0): string {
  let output = ""
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i]
    if (typeof content === "string") {
      output +=
        tag && isIndentTag(tag) ? content.replace(/(\r?\n)/g, "$1" + "  ".repeat(indentLevel)) : content
    } else {
      output += outputTag(content, indentLevel)
      if (!isInlineTag(content) && (i + 1 < contents.length || (tag && isBraceTag(tag)))) {
        output += "\n"
        if (tag && isIndentTag(tag)) {
          output += "  ".repeat(indentLevel)
        }
      }
    }
  }
  return output
}

// Exports

export function printContents(contents: Content[]): string {
  const preparedContents = prepareContents(contents)
  layoutContents(preparedContents)
  assertContents(preparedContents)
  escapeContents(preparedContents)
  return outputContents(preparedContents)
}

export function logPrint(input: string | Content[] | Tag): void {
  let contents
  if (typeof input === "string") {
    log(input)
    console.log(input)
    contents = parseContents(input)
  } else if (Array.isArray(input)) {
    contents = input
  } else {
    contents = [input]
  }
  log(contents)
  const output = printContents(contents)
  log(output)
  console.log(output)
  log(parseContents(output))
}

let hasOneTestFailed = false
export function testPrinter(input: string | Tag | Content[]): void {
  if (hasOneTestFailed) return
  let contents: Content[] | undefined
  let printedContents: string | undefined
  let parsedContents: Content[] | undefined
  for (;;) {
    if (typeof input === "string") {
      try {
        contents = parseContents(input)
      } catch (e) {
        console.log(e)
        console.log("Failed to parse input contents.")
        break
      }
    } else if (Array.isArray(input)) {
      contents = input
    } else {
      contents = [input]
    }
    try {
      printedContents = printContents(contents)
    } catch (e) {
      console.log(e)
      console.log("Failed to print the contents.")
      break
    }
    try {
      parsedContents = parseContents(printedContents)
      if (typeof input === "object" && JSON.stringify(contents) === JSON.stringify(parsedContents)) {
        return
      }
    } catch (e) {
      console.log(e)
      console.log("Failed to parse the contents.")
      break
    }
    break
  }
  hasOneTestFailed = true
  if (typeof input === "string") {
    log(input)
    console.log(input)
  }
  if (!contents) return
  log(contents)
  if (!printedContents) return
  log(printedContents)
  console.log(printedContents)
  if (!parsedContents) return
  log(parsedContents)
}
