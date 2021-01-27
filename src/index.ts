import * as parser from "./parser"

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
// export const parseContents = parser.wrapTopLevelParser(parser.parseContents)
export { parseContents } from "./lezer"

// Printer

export { printTag, printContents } from "./printer"
