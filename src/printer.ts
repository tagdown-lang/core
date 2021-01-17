import { Content, ContentsLayout, isTagContent, isTextContent, Tag } from "./types"
import { assert } from "./utils"

// Types

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

function isEndTag(tag: PrintTag): boolean {
  return tag.contentsLayout === ContentsLayout.End
}

function isInlineTag(tag: PrintTag): boolean {
  return isAtomTag(tag) || isBraceTag(tag)
}

function isLinesTag(tag: PrintTag): boolean {
  return isIndentTag(tag) || isEndTag(tag)
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
  return contents.map(content => (isTextContent(content) ? content : prepareTag(content)))
}

// Layout

function layoutTag(tag: PrintTag): void {
  for (const attr of tag.attributes) layoutTag(attr)
  if (tag.attributes.length > 2) {
    tag.contentsLayout = ContentsLayout.Indent
  } else if (!isLinesTag(tag)) {
    for (const attr of tag.attributes) {
      if (!isInlineTag(attr)) {
        tag.contentsLayout = ContentsLayout.Indent
        break
      }
    }
  }
  layoutContents(tag.contents, tag)
  if (isLinesTag(tag)) {
    for (const attr of tag.attributes) {
      if (isBraceTag(attr)) {
        attr.contentsLayout = ContentsLayout.Line
      }
    }
  }
}

function layoutContents(contents: PrintContent[], tag?: PrintTag): void {
  if (contents.length === 0) return
  for (const content of contents) if (isTagContent(content)) layoutTag(content)
  const lastContent = contents[contents.length - 1]
  if (isTagContent(lastContent) && isIndentTag(lastContent)) {
    lastContent.contentsLayout = ContentsLayout.End
  }
  if (!tag || isLinesTag(tag)) return
  let isPrevLineTag = false
  for (const content of contents) {
    if (isPrevLineTag || (isTagContent(content) ? isLinesTag(content) : /\r?\n/.test(content))) {
      tag.contentsLayout = ContentsLayout.Indent
      return
    }
    if (isTagContent(content) && isLineTag(content)) {
      isPrevLineTag = true
    }
  }
  if (tag.isLiteral && isBraceTag(tag)) {
    let unbalancedLeft = 0
    let unbalancedRight = 0
    for (const c of contents[0] as string) {
      if (c === "{") {
        ++unbalancedLeft
      } else if (c === "}") {
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

function assertTag(tag: PrintTag): void {
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
      "indent or end tags must have either attributes or contents",
    )
  }
  assert(
    tag.attributes.every(attr => attr.isAttribute),
    "attributes must be marked as such",
  )
  tag.attributes.forEach(assertTag)
  if (tag.isLiteral) {
    assert(!isAtomTag(tag), "literals must not be atom tags")
    assert(
      tag.contents.length === 1 && isTextContent(tag.contents[0]),
      "literals must have a single text as contents",
    )
  }
  assertContents(tag.contents)
}

function assertContents(contents: PrintContent[]): void {
  let isPrevText = false
  for (const content of contents) {
    if (isTextContent(content)) {
      assert(!isPrevText, "contents must have no consecutive texts")
    } else {
      assertTag(content)
    }
    isPrevText = isTextContent(content)
  }
}

// Escape

function escapeEmptyLines(text: string, indentLevel: number, isLastContent: boolean, tag?: PrintTag): string {
  let newText = ""
  const substrings = text.split(/(\r?\n)/)
  const textEndsWithNewLine = substrings.length % 2 === 0
  const contentsEndWithNewLine = (!tag || !isInlineTag(tag)) && isLastContent
  for (let i = 0; i < substrings.length; ++i) {
    if (i % 2 === 1) {
      newText += "\n"
    } else {
      let line = substrings[i]
      const isLastLine = i >= substrings.length - 2
      if (!isLastLine || textEndsWithNewLine || contentsEndWithNewLine) {
        if (line.trimEnd() !== line || (line === "" && isLastLine && indentLevel > 0)) {
          line += "$"
        } else {
          line = line.replace(/\$$/, "\\$")
        }
      }
      newText += line
    }
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

function escapeTag(tag: PrintTag, indentLevel: number): void {
  tag.name = escapeTagName(tag)
  for (const attr of tag.attributes) escapeTag(attr, indentLevel)
  escapeContents(tag.contents, tag, isIndentTag(tag) ? indentLevel + 1 : indentLevel)
}

function escapeContents(contents: PrintContent[], tag?: PrintTag, indentLevel = 0): void {
  if (tag && tag.isLiteral) {
    contents[0] = escapeEmptyLines(contents[0] as string, indentLevel, true, tag)
  } else {
    let prevTag: PrintTag | undefined
    for (let i = 0; i < contents.length; ++i) {
      let content = contents[i]
      if (isTextContent(content)) {
        content = content.replace(/([\\{}])/g, "\\$1")
        if (
          prevTag &&
          prevTag.contents.length === 0 &&
          ((isIndentTag(prevTag) && content[0] === ":") ||
            (isEndTag(prevTag) && content.substring(0, 2) === "--"))
        ) {
          content = "\\" + content
        }
        contents[i] = escapeEmptyLines(content, indentLevel, i + 1 === contents.length, tag)
      } else {
        escapeTag(content, indentLevel)
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
  if (!isLinesTag(tag)) {
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
  } else if (isLinesTag(tag)) {
    const newLineIndent = "\n" + "  ".repeat(indentLevel)
    output += attrOutputs.map(output => newLineIndent + "  " + output).join("")
    if (tag.contents.length > 0) {
      output +=
        newLineIndent +
        (isIndentTag(tag) ? ": " : "--" + newLineIndent) +
        outputContents(tag.contents, tag, isIndentTag(tag) ? indentLevel + 1 : indentLevel)
    }
  }
  return output
}

function outputContents(contents: PrintContent[], tag?: PrintTag, indentLevel = 0): string {
  let output = ""
  for (let i = 0; i < contents.length; ++i) {
    const content = contents[i]
    if (isTextContent(content)) {
      output +=
        tag && isLinesTag(tag) ? content.replace(/(\r?\n)/g, "$1" + "  ".repeat(indentLevel)) : content
    } else {
      output += outputTag(content, indentLevel)
      if (!isInlineTag(content) && (i + 1 < contents.length || (tag && isBraceTag(tag)))) {
        output += "\n"
        if (tag && isLinesTag(tag)) {
          output += "  ".repeat(indentLevel)
        }
      }
    }
  }
  return output
}

// Print

export function printContents(contents: Content[]): string {
  const preparedContents = prepareContents(contents)
  layoutContents(preparedContents)
  assertContents(preparedContents)
  escapeContents(preparedContents)
  return outputContents(preparedContents)
}

export function printTag(tag: Tag): string {
  const preparedTag = prepareTag(tag)
  layoutTag(preparedTag)
  assertTag(preparedTag)
  escapeTag(preparedTag, 0)
  return outputTag(preparedTag, 0)
}
