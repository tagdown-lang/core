import { Content, ContentsLayout, Tag } from "./types"
import { assert } from "./utils"

// Types

export interface PrintTag extends Tag {
  attributes: PrintTag[]
  contents: PrintContent[]
  contentsLayout: ContentsLayout
}

export type PrintContent = string | PrintTag

// Check

export function isAtomTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Atom
}

export function isBraceTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Brace
}

export function isLineTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Line
}

export function isIndentTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.Indent
}

export function isInlineTag(tag: PrintTag): boolean {
  return isAtomTag(tag) || isBraceTag(tag)
}

// Prepare

export function prepareTag(tag: Tag): PrintTag {
  return {
    ...tag,
    attributes: tag.attributes.map(prepareTag),
    contents: prepareContents(tag.contents),
    contentsLayout: tag.contents.length > 0 ? ContentsLayout.Brace : ContentsLayout.Atom,
  }
}

export function prepareContents(contents: Content[]): PrintContent[] {
  return contents.map(content => (typeof content === "string" ? content : prepareTag(content)))
}

// Layout

export function layoutTag(tag: PrintTag, parentTag?: PrintTag): void {
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

export function layoutContents(contents: PrintContent[], tag?: PrintTag): void {
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
        ++unbalancedLeft
      } else if (chr === "}") {
        if (unbalancedLeft > 0) {
          --unbalancedLeft
        } else {
          ++unbalancedRight
        }
      }
    }
    if (unbalancedLeft > 0 || unbalancedRight > 0) {
      tag.contentsLayout = ContentsLayout.Line
    }
  }
}

// Assert

export function assertTag(tag: PrintTag) {
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

export function assertContents(contents: PrintContent[]): void {
  let isPrevText = false
  for (const content of contents) {
    if (typeof content === "string") {
      assert(!isPrevText, "contents must have no consecutive texts")
    } else {
      assertTag(content)
    }
    isPrevText = typeof content === "string"
  }
}

// Escape

function escapeEmptyLines(text: string, isLastContent: boolean, tag?: PrintTag, prevTag?: PrintTag): string {
  let newText = ""
  const substrings = text.split(/(\r?\n)/)
  for (let i = 0; i < substrings.length; ++i) {
    let substring = substrings[i]
    if (i % 2 === 0 && (i + 1 !== substrings.length || (isLastContent && (!tag || !isInlineTag(tag))))) {
      if (
        substring.trimEnd() !== substring ||
        (substring === "" && (substrings.length > 1 || (prevTag && !isInlineTag(prevTag))))
      ) {
        substring += "$"
      } else {
        substring = substring.replace(/\$$/, "\\$")
      }
    }
    newText += substring
  }
  return newText
}

function escapeTagName(tag: PrintTag): string {
  let name = tag.name.replace(/^(['@])/, "\\$1").replace(/([\\{}:])/g, "\\$1")
  if (isAtomTag(tag) && tag.attributes.length === 0) {
    name = name.replace(/(='?)$/, "\\$1")
  }
  return name
}

export function escapeTag(tag: PrintTag): void {
  tag.name = escapeTagName(tag)
  for (const attr of tag.attributes) escapeTag(attr)
  escapeContents(tag.contents, tag)
}

export function escapeContents(contents: PrintContent[], tag?: PrintTag): void {
  if (tag && tag.isLiteral) {
    contents[0] = escapeEmptyLines(contents[0] as string, true, tag)
  } else {
    let prevTag: PrintTag | undefined
    for (let i = 0; i < contents.length; ++i) {
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

export function outputTag(tag: PrintTag, indentLevel: number): string {
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

export function outputContents(contents: PrintContent[], tag?: PrintTag, indentLevel = 0): string {
  let output = ""
  for (let i = 0; i < contents.length; ++i) {
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
