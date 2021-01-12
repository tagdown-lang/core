import {
  backtrack,
  chr,
  consumeWhitespace,
  isLineEnd,
  isStr,
  matchNewLine,
  matchStr,
  next,
  parseContents,
  parseTag,
  ParseTagScope,
} from "./parser"
import { printContents, printTag } from "./printer"
import { Tag } from "./types"
import { assert } from "./utils"

function tryParseBlockAttributes(): Tag[] | null {
  if (!(matchStr("---") && matchNewLine())) return null
  const blockAttributes: Tag[] = []
  while (chr() === "{") {
    const attr = parseTag(ParseTagScope.BlockAttr)
    if (!attr) return null
    consumeWhitespace()
    if (!matchNewLine()) return null
    blockAttributes.push(attr)
  }
  if (!(matchStr("---") && isLineEnd())) return null
  return blockAttributes
}

export function parseTagdown(name: string): Tag {
  const attributes: Tag[] = []
  let hasContents = true
  if (isStr("\\---")) {
    next() // delete "\\"
  } else {
    const blockAttributes = tryParseBlockAttributes()
    if (blockAttributes) {
      hasContents = matchNewLine()
      attributes.push(...blockAttributes)
    } else backtrack(0)
  }
  return {
    isQuoted: false,
    isAttribute: false,
    name,
    attributes,
    isLiteral: false,
    contents: hasContents ? parseContents() : [],
  }
}

export function printTagdown(name: string, tag: Tag) {
  assert(tag.name === name, `tagdown tag should be named '${name}'`)
  assert(
    !tag.isQuoted && !tag.isAttribute && !tag.isLiteral,
    "tagdown tags should not be quoted, an attribute, or a literal",
  )
  let output = ""
  if (tag.attributes.length > 0) {
    output = "---\n"
    for (const attr of tag.attributes) {
      output += printTag(attr) + "\n"
    }
    output += "---"
    if (tag.contents.length > 0) output += "\n"
  }
  output += printContents(tag.contents)
  return output
}
