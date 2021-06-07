import { Input, stringInput, Tree, TreeCursor } from "lezer-tree"

import { parseTree } from "./parse"
import { isInlineTagType, isMultilineTagType, isTagType, isTextType, Type } from "./parser"
import { isMarkerType, sliceType } from "./lezer"

function outputAttributes(cursor: TreeCursor, input: Input, indentLevel: number): string[] {
  const outputs: string[] = []
  cursor.firstChild()
  while (isTagType(cursor.type.id)) {
    outputs.push(outputTag(cursor, input, indentLevel + 1, true))
    if (!cursor.nextSibling()) break
  }
  cursor.parent()
  cursor.nextSibling()
  return outputs
}

function outputTag(cursor: TreeCursor, input: Input, indentLevel: number, isAttribute = false): string {
  const tagType = cursor.type.id
  cursor.firstChild()
  cursor.nextSibling()
  let output = "{"
  if (isMarkerType(cursor, Type.IsQuoted)) output += "'"
  if (isMarkerType(cursor, Type.IsAttribute) || isAttribute) output += "@"
  output += sliceType(cursor, input, Type.Name)!
  if (cursor.type.id === Type.InlineAttributes) {
    output += outputAttributes(cursor, input, indentLevel).join("")
  }
  if (isMarkerType(cursor, Type.IsBlock) || tagType === Type.BraceTag) {
    if (tagType === Type.BraceTag) cursor.nextSibling()
    output += tagType === Type.BraceTag ? ":" : "="
    if (isMarkerType(cursor, Type.IsLiteral)) output += "'"
    if (tagType === Type.BraceTag) output += " " + outputContents(cursor, input, tagType)
    else cursor.nextSibling()
  }
  output += "}"
  if (tagType === Type.LineTag) {
    output += " " + outputContents(cursor, input, tagType, indentLevel)
  } else if (isMultilineTagType(tagType)) {
    const newLineIndent = "\n" + "  ".repeat(indentLevel)
    if (cursor.type.id === Type.BlockAttributes) {
      output += outputAttributes(cursor, input, indentLevel)
        .map(output => newLineIndent + "  " + output)
        .join("")
    }
    if (cursor.type.id === Type.ContentsMarker) {
      cursor.nextSibling()
      output +=
        newLineIndent +
        (tagType === Type.IndentTag ? ": " : "--" + newLineIndent) +
        outputContents(cursor, input, tagType, tagType === Type.IndentTag ? indentLevel + 1 : indentLevel)
    }
  }
  cursor.parent()
  return output
}

function outputContents(cursor: TreeCursor, input: Input, tagType: number, indentLevel = 0): string {
  if (!cursor.firstChild()) return ""
  let output = ""
  let hasNext = true
  while (hasNext) {
    const { from, to } = cursor
    const type = cursor.type.id
    if (isTextType(type)) {
      const text = input.read(from, to)
      output += isMultilineTagType(tagType) ? text.replace(/(\r?\n)/g, "$1" + "  ".repeat(indentLevel)) : text
    } else if (type === Type.TagError) {
      output += input.read(from, to)
    } else {
      output += outputTag(cursor, input, indentLevel)
    }
    hasNext = cursor.nextSibling()
    if (isTagType(type) && !isInlineTagType(type) && (hasNext || tagType === Type.BraceTag)) {
      output += "\n"
      if (isMultilineTagType(tagType)) {
        output += "  ".repeat(indentLevel)
      }
    }
  }
  cursor.parent()
  return output
}

export function prettyprintTree(tree: Tree, input: Input | string): string {
  if (typeof input === "string") input = stringInput(input)
  const cursor = tree.cursor()
  return outputContents(cursor, input, Type.None)
}

export function prettyprint(input: string) {
  return prettyprintTree(parseTree(input), input)
}
