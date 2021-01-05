import { printContents } from "."
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
import { assertTag, escapeTag, layoutTag, outputTag, prepareTag } from "./printer"
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
  if (!matchStr("---")) return null
  return blockAttributes
}

export function parseNode(): Tag {
  const attributes: Tag[] = []
  let hasContents = true
  if (isStr("\\---")) {
    next() // delete "\\"
  } else {
    const blockAttributes = tryParseBlockAttributes()
    if (blockAttributes && isLineEnd()) {
      hasContents = matchNewLine()
      attributes.push(...blockAttributes)
    } else backtrack(0)
  }
  return {
    isQuoted: false,
    isAttribute: false,
    name: "node",
    attributes,
    isLiteral: false,
    contents: hasContents ? parseContents() : [],
  }
}

export function printNode(tag: Tag) {
  assert(tag.name === "node", "node tags should be named as such")
  assert(
    !tag.isQuoted && !tag.isAttribute && !tag.isLiteral,
    "node tags should not be quoted, an attribute, or a literal",
  )
  let output = ""
  if (tag.attributes.length > 0) {
    output = "---\n"
    for (const attr of tag.attributes) {
      const preparedAttr = prepareTag(attr)
      layoutTag(preparedAttr)
      assertTag(preparedAttr)
      escapeTag(preparedAttr)
      output += outputTag(preparedAttr, 0) + "\n"
    }
    output += "---"
    if (tag.contents.length > 0) output += "\n"
  }
  output += printContents(tag.contents)
  return output
}
