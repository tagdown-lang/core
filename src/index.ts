import * as parser from "./parser"
import { printContents } from "./printer"
import { Content, Tag } from "./types"
import { log } from "./utils"

// Types

export {
  Content,
  ContentsLayout,
  isContent,
  isContents,
  isTag,
  isTagContent,
  isText,
  isTextContent,
  Tag,
} from "./types"

// Parser

export const parseTag = parser.wrapTopLevelParser(() => parser.parseTag(parser.ParseTagScope.Content))
export const parseContents = parser.wrapTopLevelParser(parser.parseContents)

export function logParse(input: string): Content[] {
  log(input)
  console.log(input)
  const contents = parseContents(input)
  log(contents)
  return contents
}

// Printer

export { printTag, printContents } from "./printer"

export function logPrint(input: Content[] | Tag): string {
  let contents = Array.isArray(input) ? input : [input]
  log(contents)
  const output = printContents(contents)
  logParse(output)
  return output
}
