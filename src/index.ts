import * as parser from "./parser"
import { assertContents, escapeContents, layoutContents, outputContents, prepareContents } from "./printer"
import { Content, Tag } from "./types"
import { log } from "./utils"

export { Content, ContentsLayout, Tag } from "./types"

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

export function printContents(contents: Content[]): string {
  const preparedContents = prepareContents(contents)
  layoutContents(preparedContents)
  assertContents(preparedContents)
  escapeContents(preparedContents)
  return outputContents(preparedContents)
}

export function logPrint(input: string | Content[] | Tag): string {
  let contents: Content[]
  if (typeof input === "string") {
    contents = logParse(input)
  } else {
    if (Array.isArray(input)) {
      contents = input
    } else {
      contents = [input]
    }
    log(contents)
  }
  const output = printContents(contents)
  logParse(output)
  return output
}
