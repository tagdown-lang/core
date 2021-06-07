import { Input, stringInput, Tree, TreeCursor } from "lezer-tree"

import { isMultilineTagType, isTagType, parser, Type } from "./parser"
import { isMarkerType, sliceType } from "./lezer"
import { Content, isTagContent, Tag } from "./types"

function convertAttributes(cursor: TreeCursor, input: Input): Tag[] {
  const attributes: Tag[] = []
  cursor.firstChild()
  while (isTagType(cursor.type.id)) {
    attributes.push(convertTag(cursor, input, true))
    if (!cursor.nextSibling()) break
  }
  cursor.parent()
  cursor.nextSibling()
  return attributes
}

function convertTag(cursor: TreeCursor, input: Input, isAttribute = false): Tag {
  const tagType = cursor.type.id
  cursor.firstChild()
  cursor.nextSibling()
  const isQuoted = isMarkerType(cursor, Type.IsQuoted)
  isAttribute = isMarkerType(cursor, Type.IsAttribute) || isAttribute
  const name = sliceType(cursor, input, Type.Name)!
  const attributes: Tag[] = []
  if (cursor.type.id === Type.InlineAttributes) attributes.push(...convertAttributes(cursor, input))
  let isLiteral = false
  if (isMarkerType(cursor, Type.IsBlock)) {
    isLiteral = isMarkerType(cursor, Type.IsLiteral)
    cursor.nextSibling()
  }
  if (isMultilineTagType(tagType)) {
    if (cursor.type.id === Type.BlockAttributes) attributes.push(...convertAttributes(cursor, input))
    if (cursor.type.id === Type.ContentsMarker) cursor.nextSibling()
  } else if (tagType === Type.BraceTag) {
    cursor.nextSibling()
    isLiteral = isMarkerType(cursor, Type.IsLiteral)
  }
  let contents: Content[]
  if (cursor.type.id === Type.Contents) {
    contents = convertContents(cursor, input)
    if (contents.length === 0) contents.push("")
  } else {
    contents = []
  }
  cursor.parent()
  return {
    isQuoted,
    isAttribute,
    name,
    attributes,
    isLiteral,
    contents,
  }
}

function convertContents(cursor: TreeCursor, input: Input): Content[] {
  if (!cursor.firstChild()) return []
  const contents: Content[] = []
  let text: string | null = null
  do {
    const { from, to } = cursor
    const type = cursor.type.id
    if ([Type.Other, Type.TagError].includes(type)) {
      text = (text || "") + input.read(from, to)
    } else if (type === Type.Escape) {
      text = (text || "") + input.read(from + "\\".length, to)
    } else if (type === Type.StopMarker) {
      text = text || ""
    } else if (isTagType(type)) {
      if (text !== null) {
        contents.push(text)
        text = null
      }
      contents.push(convertTag(cursor, input))
    }
  } while (cursor.nextSibling())
  if (text !== null) contents.push(text)
  cursor.parent()
  return contents
}

export function parseTree(input: string, indentLevel?: number): Tree {
  return parser.parse(input, indentLevel)
}

export function convertTreeToContents(tree: Tree, input: Input | string): Content[] {
  if (typeof input === "string") input = stringInput(input)
  const cursor = tree.cursor()
  return convertContents(cursor, input)
}

export function parseContents(input: string, indentLevel?: number): Content[] {
  return convertTreeToContents(parseTree(input, indentLevel), input)
}

export function parseTag(input: string): Tag | null {
  const contents = parseContents(input)
  if (contents.length === 1 && isTagContent(contents[0])) return contents[0]
  return null
}
