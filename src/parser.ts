import { Tag, Content } from "./types"
import { assert, log } from "./utils"

// The top-level contents can be considered to be both within brace and indent contents,
// so they are defined as bit flags to allow for unions.
export enum ContentsLayout {
  Atom = 1 << 0, // {name}
  Brace = 1 << 1, // {name: text}
  Line = 1 << 2, // {name=} text
  Indent = 1 << 3, // {name=}\n: text
}

export type ParseRange = {
  start: number
  end: number
}

export type ParseTag = Tag & {
  range?: ParseRange
  contentsRange?: ParseRange
}

export type ParseContent = string | ParseTag

type EmptyState = {
  startPos: number
  newLines: string
}

enum ParseTagScope {
  InlineAttr,
  BlockAttr,
  Content,
}

let input: string
let p: number
let c: string | undefined

let dedentLevel: number | null
let dedents: number

let indentLevel: number
let contentIndentLevels: number[]
let unbraced: number
let skipNewLine: boolean

let isEscapeParse: boolean
let checkIndentContentsEscape: boolean
let contentsRange: ParseRange | null

// Primitives

function next(): void {
  p++
  c = input[p]
}

function backtrack(pos: number): void {
  p = pos
  c = input[p]
}

function hasNext(count = 1): boolean {
  return p + count <= input.length
}

function hasEnded(offset = 0): boolean {
  return p + offset === input.length
}

function peek(offset: number): string | undefined {
  return input[p + offset]
}

function slice(startPos: number, endPos = p): string {
  return input.substring(startPos, endPos)
}

// Getters

function pos(): number {
  return p
}

function chr(): string {
  return c
}

// Generic

function isStr(s: string, offset = 0): boolean {
  if (!hasNext(offset + s.length)) return false
  for (let i = 0; i < s.length; i++) if (s[i] !== peek(offset + i)) return false
  return true
}

function isOneOf(search: string, offset = 0): boolean {
  return hasNext(offset) && search.includes(peek(offset)!)
}

function escapedOneOf(search: string): boolean {
  if (!hasNext(1)) return false
  const c1 = peek(1)!
  return chr() === "\\" && (c1 === "\\" || search.includes(c1))
}

// Checkers

function isNewline(offset = 0): boolean {
  return peek(offset) === "\n" || isStr("\r\n", offset)
}

function isLineEnd(offset = 0): boolean {
  return hasEnded(offset) || isNewline(offset)
}

function isSpaceOrLineEnd(offset = 0): boolean {
  return peek(offset) === " " || isLineEnd(offset)
}

// Consumers

function consumeWhitespace(): void {
  while (hasNext() && !isNewline() && c!.trim() === "") next()
}

// Helpers

function sliceLineEnd(startPos: number): string {
  if (isEscapeParse) return slice(startPos)
  const text = slice(startPos).trimEnd()
  if (text.endsWith("\\$")) {
    return text.substring(0, text.length - "\\$".length) + "$"
  } else if (text.endsWith("$")) {
    return text.substring(0, text.length - "$".length)
  }
  return text
}

function parseIndent(maxLevel: number): number {
  let level = 0
  while (level < maxLevel && isStr("  ")) {
    level++
    next()
    next()
  }
  return level
}

// Matchers

function matchChr(c: string): boolean {
  const cond = c === chr()
  if (cond) next()
  return cond
}

function matchNewLine(): boolean {
  if (chr() === "\n") {
    next()
  } else if (isStr("\r\n")) {
    next()
    next()
  } else return false
  return true
}

function matchLineEnd(): boolean {
  return hasEnded() || matchNewLine()
}

function matchEmptyLine(): boolean {
  const startPos = pos()
  consumeWhitespace()
  if (hasEnded()) return true
  const newLinePos = pos()
  const cond = matchNewLine()
  if (cond) backtrack(newLinePos)
  else backtrack(startPos)
  return cond
}

function matchIndent(level: number): boolean {
  const startPos = pos()
  const cond = parseIndent(level) === level
  if (!cond) backtrack(startPos)
  return cond
}

// Asserts

function assertNewLine(): void {
  assert(matchNewLine(), "expected new line")
}

// Parsers

function parseBraceText(): string {
  let text = ""
  let startPos = pos()
  while (hasNext() && !isOneOf("{}")) {
    if (isNewline()) {
      text += sliceLineEnd(startPos)
      startPos = pos()
      assertNewLine()
      continue
    }
    if (escapedOneOf("{}")) {
      if (isEscapeParse) {
        next() // skip "\\"
      } else {
        text += slice(startPos)
        next() // delete "\\"
        startPos = pos()
      }
    }
    next()
  }
  text += slice(startPos)
  return text
}

function parseBraceLiteralText(): string {
  let text = ""
  let startPos = pos()
  let unbalanced = 0
  while (hasNext() && !(chr() === "}" && unbalanced === 0)) {
    if (isNewline()) {
      text += sliceLineEnd(startPos)
      startPos = pos()
      assertNewLine()
      continue
    }
    if (chr() === "{") unbalanced++
    else if (chr() === "}") unbalanced--
    next()
  }
  text += slice(startPos)
  return text
}

function parseLineText(): string {
  if (checkIndentContentsEscape && isStr("\\:")) {
    if (!isEscapeParse) next() // delete "\\"
  }
  let text = ""
  let startPos = pos()
  while (hasNext() && !(isOneOf("{}") || isNewline())) {
    if (escapedOneOf("{}")) {
      if (isEscapeParse) {
        next() // skip "\\"
      } else {
        text += slice(startPos)
        next() // delete "\\"
        startPos = pos()
      }
    }
    next()
  }
  text += isLineEnd() ? sliceLineEnd(startPos) : slice(startPos)
  return text
}

function parseLineLiteralText(): string {
  const startPos = pos()
  while (!isLineEnd()) next()
  return sliceLineEnd(startPos)
}

function parseIndentLiteralText(): string {
  let text = ""
  let emptyState: EmptyState | null = null
  while (hasNext()) {
    let content = parseLineLiteralText()
    if (content === "") {
      if (hasEnded()) break
      const newLinePos = pos()
      assertNewLine()
      const newLine = slice(newLinePos)
      if (matchIndent(indentLevel)) {
        content = newLine
      } else if (matchEmptyLine()) {
        if (emptyState !== null) emptyState.newLines += newLine
        else {
          emptyState = {
            startPos: newLinePos,
            newLines: newLine,
          }
        }
        continue
      } else {
        backtrack(newLinePos)
        break
      }
    }
    // There were empty lines in between the last and the current content.
    if (emptyState !== null) {
      text += emptyState.newLines
      emptyState = null
    }
    text += content
  }
  // The last empty lines did not occur in between indented contents,
  // so they are not considered part of the contents.
  if (emptyState !== null) {
    backtrack(emptyState.startPos)
  }
  return text
}

// In the case of brace tags, these will be the braces that are not part of a tag,
// or did not form a valid tag.
function parseBraceDelims(): string | null {
  if (!isOneOf("{}")) return null
  if (chr() === "{") {
    next()
    return "{"
  }
  if (unbraced === 0) {
    const startPos = pos()
    next() // skip "}"
    while (hasNext() && chr() === "}") next()
    return slice(startPos)
  }
  return null
}

function parseName(): string | null {
  let name = ""
  let startPos = pos()
  // At the start of a tag can occur indicators,
  // however from the first indicator that is escaped going forwards,
  // all indicators will be considered part of the name.
  if (escapedOneOf("'@")) {
    next() // skip "\\"
    if (!isEscapeParse) startPos = pos() // delete "\\"
    next() // skip escaped (potentially "\\", hence its necessary to skip)
  }
  // A tag name ends when a brace occurs, signifying the start of an attribute,
  // or the end of the tag, or when a colon occurs, signifying the start of the contents.
  let linePos: number | null = null
  while (hasNext() && !isOneOf("{}:")) {
    if (isNewline()) return null
    if (escapedOneOf("{}:")) {
      if (isEscapeParse) {
        next() // skip "\\"
      } else {
        name += slice(startPos)
        next() // delete "\\"
        startPos = pos()
      }
    } else if (chr() === "=" || escapedOneOf("=")) {
      linePos = pos()
      if (chr() === "\\") next()
    }
    next()
  }
  if (chr() === "}" && linePos !== null) {
    const endPos = pos()
    backtrack(linePos)
    const isEscaped = matchChr("\\")
    assert(matchChr("="), "expected equals sign")
    matchChr("'")
    if (pos() < endPos) backtrack(endPos)
    else if (!isEscaped || isEscapeParse) backtrack(linePos)
    else {
      name += slice(startPos, linePos)
      startPos = linePos + 1 // delete "\\"
    }
  }
  name += slice(startPos)
  if (!(name !== "")) return null
  return name
}

function parseContentsRange(parseContents: () => Content[]): Content[] {
  const startPos = pos()
  const contents = parseContents()
  if (isEscapeParse && contents.length > 0) {
    contentsRange = {
      start: startPos,
      end: pos(),
    }
  }
  return contents
}

function tryParseContentTag(scope: ParseTagScope, contentsLayout?: ContentsLayout): ParseTag | null {
  if (!matchChr("{")) return null
  const isQuoted = matchChr("'")
  const isAttribute = matchChr("@")
  if (!isAttribute && (scope === ParseTagScope.InlineAttr || scope === ParseTagScope.BlockAttr)) return null
  const name = parseName()
  if (!(name !== null)) return null
  const attributes: Tag[] = []
  while (chr() === "{") {
    const attr = parseContentTag(ParseTagScope.InlineAttr)
    if (!(attr !== null)) return null
    attributes.push(attr)
  }
  let isLiteral = false
  let variant: number
  let contents: Content[] | undefined
  if (matchChr("}")) {
    variant = ContentsLayout.Atom
    contents = []
  } else {
    if (matchChr(":")) {
      variant = ContentsLayout.Brace
    } else if (matchChr("=")) {
      variant = ContentsLayout.Line
    } else {
      return null
    }
    isLiteral = matchChr("'")
    if (variant === ContentsLayout.Brace) {
      if (chr() === " ") next()
      unbraced++
      contents = parseContentsRange(() => (isLiteral ? [parseBraceLiteralText()] : parseBraceContents()))
      unbraced--
      if (!matchChr("}")) return null
    } else {
      if (!(scope === ParseTagScope.BlockAttr || scope === ParseTagScope.Content)) return null
      if (!matchChr("}")) return null
      if (chr() === " ") next()
      contents = parseContentsRange(() => (isLiteral ? [parseLineLiteralText()] : parseLineContents()))
      const newLinePos = pos()
      if (contents[0] === "" && matchNewLine()) {
        indentLevel++
        const blockAttributes: Tag[] = []
        ;(() => {
          let attrNewLinePos: number | undefined
          while (matchIndent(indentLevel)) {
            const attr = parseContentTag(ParseTagScope.BlockAttr)
            if (attr === null) return
            consumeWhitespace()
            attrNewLinePos = pos()
            if (!matchLineEnd()) return
            blockAttributes.push(attr)
          }
          if (matchIndent(indentLevel - 1) && chr() === ":" && isSpaceOrLineEnd(1)) {
            next()
            if (chr() === " ") next()
            dedentLevel = null
            dedents = 0
            contents = parseContentsRange(() =>
              isLiteral ? [parseIndentLiteralText()] : parseIndentContents(),
            )
          } else if (blockAttributes.length > 0) {
            contents = []
            assert(attrNewLinePos !== undefined, "expected attribute new line position to be defined")
            backtrack(attrNewLinePos) // After the contents should be a newline.
          } else return
          variant = ContentsLayout.Indent
          attributes.push(...blockAttributes)
        })()
        indentLevel--
        if (variant === ContentsLayout.Line) backtrack(newLinePos)
      }
      if (variant === ContentsLayout.Line) {
        if (matchNewLine()) {
          // The new line after a line tag should be skipped by default,
          // however that same new line could also be significant for indent contents,
          // so it should only be skipped only when it is safe to do so.
          if (scope === ParseTagScope.Content) {
            assert(contentsLayout !== undefined, "expected variant to be defined for content tag")
            if (!(contentsLayout & ContentsLayout.Brace)) {
              if (matchIndent(indentLevel)) skipNewLine = true
              backtrack(newLinePos)
            }
          } else backtrack(newLinePos)
        } else assert(hasEnded(), "expected new line or end of input")
      } else if (scope === ParseTagScope.Content) {
        if (hasEnded()) {
          dedentLevel = null
          dedents = 0
        } else if (dedents > 0) {
          dedents--
        } else {
          const newLinePos = pos()
          assertNewLine()
          dedentLevel = parseIndent(Number.MAX_SAFE_INTEGER)
          backtrack(newLinePos)
          assert(dedentLevel <= indentLevel, "expected dedentation")
          if (contentIndentLevels.includes(dedentLevel)) {
            dedents = indentLevel - dedentLevel
          } else {
            dedentLevel = null
            dedents = 0
          }
        }
      }
    }
  }
  checkIndentContentsEscape =
    variant === ContentsLayout.Indent && scope === ParseTagScope.Content && contents.length === 0
  return {
    isQuoted,
    isAttribute,
    name,
    attributes,
    isLiteral,
    contents,
  }
}

function parseContentTag(scope: ParseTagScope, contentsLayout?: ContentsLayout): Tag | null {
  contentsRange = null
  const startPos = pos()
  const tag = tryParseContentTag(scope, contentsLayout)
  if (tag === null) {
    backtrack(startPos)
    return null
  }
  if (isEscapeParse) {
    tag.range = {
      start: startPos,
      end: pos(),
    }
    tag.contentsRange = contentsRange
  }
  return tag
}

function appendText(contents: Content[], text: string): void {
  const lastIndex = contents.length - 1
  if (typeof contents[lastIndex] === "string") {
    contents[lastIndex] += text
  } else {
    contents.push(text)
  }
}

function appendContent(contentsLayout: ContentsLayout, contents: Content[], content: Content): void {
  if (contents[contents.length - 1] === "") contents.pop()
  if (typeof content === "string") {
    appendText(contents, content)
  } else {
    contents.push(content)
    if (indentLevel === dedentLevel) {
      dedentLevel = null
      dedents = 0
      skipNewLine = false
      assertNewLine()
      assert(matchIndent(indentLevel), "expected indentation")
      if (chr() === "\\" && isSpaceOrLineEnd(1)) {
        next()
        if (chr() === " ") next()
        contents.push("  ")
      }
      if (contentsLayout & ContentsLayout.Indent) appendText(contents, "")
    }
  }
}

const genericContentsParser = (parseText: () => string, parseDelims: () => string | null) => (
  contentsLayout: ContentsLayout,
): Content[] => {
  const contents: Content[] = []
  while (!hasEnded()) {
    let content: Content | null = parseText()
    if (content === "") {
      content = parseContentTag(ParseTagScope.Content, contentsLayout)
      if (content === null) {
        content = parseDelims()
      }
    }
    if (content === null) break
    appendContent(contentsLayout, contents, content)
  }
  return contents
}

const indentContentsParser = () => (contentsLayout: ContentsLayout): Content[] => {
  const contents: Content[] = []
  let emptyState: EmptyState | null = null
  while (!hasEnded()) {
    let content: Content | null = parseLineText()
    if (content === "") {
      content = parseContentTag(ParseTagScope.Content, contentsLayout)
      if (content === null) {
        content = parseBraceDelims()
        const newLinePos = pos()
        if (matchNewLine()) {
          const newLine = slice(newLinePos)
          const hasIndent = matchIndent(indentLevel)
          if (hasIndent || matchEmptyLine()) {
            if (hasIndent && content === null) content = ""
            if (skipNewLine) skipNewLine = false
            else if (hasIndent) content += newLine
            else {
              if (emptyState !== null) emptyState.newLines += newLine
              else {
                emptyState = {
                  startPos: newLinePos,
                  newLines: newLine,
                }
              }
              continue
            }
          } else backtrack(newLinePos)
        }
      }
    }
    if (content === null) {
      break
    }
    // There were empty lines in between the last and the current content.
    if (emptyState !== null) {
      appendText(contents, emptyState.newLines)
      emptyState = null
    }
    appendContent(contentsLayout, contents, content)
  }
  // The last empty lines did not occur in between indented contents,
  // so they are not considered part of the contents.
  if (emptyState !== null) backtrack(emptyState.startPos)
  return contents
}

const wrapContentsParser = (
  contentsLayout: ContentsLayout,
  parseContents: (contentsLayout: ContentsLayout) => Content[],
) => () => {
  let oldIndentLevel, oldContentIndentLevels, oldUnbraced, oldSkipNewLine
  if (contentsLayout & ContentsLayout.Brace) {
    oldIndentLevel = indentLevel
    indentLevel = 0
    oldContentIndentLevels = contentIndentLevels
    contentIndentLevels = [0]
  }
  if (contentsLayout & ContentsLayout.Line) {
    oldUnbraced = unbraced
    unbraced = 0
  }
  if (contentsLayout & ContentsLayout.Indent) {
    contentIndentLevels.unshift(indentLevel)
    oldSkipNewLine = skipNewLine
    skipNewLine = false
  }
  const contents = parseContents(contentsLayout)
  if (contentsLayout & ContentsLayout.Indent) {
    skipNewLine = oldSkipNewLine
    contentIndentLevels.shift()
  }
  if (contentsLayout & ContentsLayout.Line) {
    unbraced = oldUnbraced
  }
  if (contentsLayout & ContentsLayout.Brace) {
    indentLevel = oldIndentLevel
    contentIndentLevels = oldContentIndentLevels
  }
  if (contents.length === 0) contents.push("")
  return contents
}

const parseBraceContents = wrapContentsParser(
  ContentsLayout.Brace,
  genericContentsParser(parseBraceText, parseBraceDelims),
)
const parseLineContents = wrapContentsParser(
  ContentsLayout.Line,
  genericContentsParser(parseLineText, parseBraceDelims),
)
const parseIndentContents = wrapContentsParser(
  ContentsLayout.Line | ContentsLayout.Indent,
  indentContentsParser(),
)
const parseTopLevelContents = wrapContentsParser(
  ContentsLayout.Brace | ContentsLayout.Line | ContentsLayout.Indent,
  indentContentsParser(),
)

const wrapTopLevelParser = <T>(parse: () => T, b: boolean) => (s: string): T => {
  input = s
  p = 0
  c = input[p]

  dedentLevel = null
  dedents = 0

  indentLevel = 0
  contentIndentLevels = []
  unbraced = 0
  skipNewLine = false

  isEscapeParse = b
  checkIndentContentsEscape = false

  const result = parse()
  assert(hasEnded(), "expected end of input")
  return result
}

export const parseTag = wrapTopLevelParser(() => parseContentTag(ParseTagScope.Content), false)
export const parseContents = wrapTopLevelParser(parseTopLevelContents, false)
export const parseEscapeContents = wrapTopLevelParser(parseTopLevelContents, true) as (
  input: string,
) => ParseContent[]

function logParse(input: string): void {
  log(input)
  console.log(input)
  log(parseContents(input))
}
