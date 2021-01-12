import { Content, ContentsLayout, Tag } from "./types"
import { assert } from "./utils"

// Types

export enum ParseTagScope {
  InlineAttr,
  BlockAttr,
  Content,
}

type EmptyState = {
  startPos: number
  newLines: string
}

// State

let input: string
let p: number
let c: string | undefined

let dedentLevel: number | null
let dedents: number
let checkIndentContentsEscape: boolean

let indentLevel: number
let contentIndentLevels: number[]
let unbraced: number
let skipNewLine: boolean

// Getters

export function pos(): number {
  return p
}

export function chr(): string | undefined {
  return c
}

// Primitives

export function next(count = 1): void {
  p += count
  c = input[p]
}

export function backtrack(pos: number): void {
  p = pos
  c = input[p]
}

export function hasNext(count = 1): boolean {
  return p + count <= input.length
}

export function hasEnded(offset = 0): boolean {
  return p + offset === input.length
}

export function peek(offset: number): string | undefined {
  return input[p + offset]
}

export function slice(startPos: number, endPos = p): string {
  return input.substring(startPos, endPos)
}

// Generic

export function isStr(s: string, offset = 0): boolean {
  if (!hasNext(offset + s.length)) return false
  for (let i = 0; i < s.length; ++i) if (s[i] !== peek(offset + i)) return false
  return true
}

export function isOneOf(chrs: string, offset = 0): boolean {
  return hasNext(offset) && chrs.includes(peek(offset)!)
}

export function escapedOneOf(chrs: string): boolean {
  if (!hasNext(1)) return false
  const c1 = peek(1)!
  return chr() === "\\" && (c1 === "\\" || chrs.includes(c1))
}

// Checkers

export function isNewLine(offset = 0): boolean {
  return peek(offset) === "\n" || isStr("\r\n", offset)
}

export function isLineEnd(offset = 0): boolean {
  return hasEnded(offset) || isNewLine(offset)
}

export function isSpaceOrLineEnd(offset = 0): boolean {
  return peek(offset) === " " || isLineEnd(offset)
}

// Consumers

export function consumeWhitespace(): void {
  while (hasNext() && !isNewLine() && !c!.trim()) next()
}

// Helpers

export function sliceLineEnd(startPos: number): string | null {
  const text = slice(startPos).trimEnd()
  if (text.endsWith("\\$")) {
    return text.substring(0, text.length - "\\$".length) + "$"
  } else if (text.endsWith("$")) {
    return text.substring(0, text.length - "$".length)
  }
  return text || null
}

function updateEmptyState(emptyState: EmptyState | null, newLinePos: number, newLine: string): EmptyState {
  if (emptyState !== null) {
    emptyState.newLines += newLine
  } else {
    emptyState = {
      startPos: newLinePos,
      newLines: newLine,
    }
  }
  return emptyState
}

// Matchers

export function matchChr(c: string): boolean {
  const cond = c === chr()
  if (cond) next()
  return cond
}

export function matchStr(s: string): boolean {
  const cond = isStr(s)
  if (cond) next(s.length)
  return cond
}

export function matchNewLine(): boolean {
  return matchChr("\n") || matchStr("\r\n")
}

export function matchLineEnd(): boolean {
  return hasEnded() || matchNewLine()
}

export function matchEmptyLine(): boolean {
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

function matchNewLineIndent(level: number): boolean {
  const startPos = pos()
  const cond = matchNewLine() && parseIndent(level) === level
  if (!cond) backtrack(startPos)
  return cond
}

// Asserts

export function assertNewLine(): void {
  assert(matchNewLine(), "expected new line")
}

// Parsers

function parseIndent(maxLevel: number): number {
  let level = 0
  while (level < maxLevel && matchStr("  ")) ++level
  return level
}

function parseBraceText(): string | null {
  let text = ""
  let startPos = pos()
  while (hasNext() && !isOneOf("{}")) {
    if (isNewLine()) {
      text += sliceLineEnd(startPos) || ""
      startPos = pos()
      assertNewLine()
      continue
    }
    if (escapedOneOf("{}")) {
      text += slice(startPos)
      next() // delete "\\"
      startPos = pos()
    }
    next()
  }
  text += slice(startPos)
  return text || null
}

function parseBraceLiteralText(): string | null {
  let text = ""
  let startPos = pos()
  let unbalanced = 0
  while (hasNext() && !(chr() === "}" && unbalanced === 0)) {
    if (isNewLine()) {
      text += sliceLineEnd(startPos) || ""
      startPos = pos()
      assertNewLine()
      continue
    }
    if (chr() === "{") ++unbalanced
    else if (chr() === "}") --unbalanced
    next()
  }
  text += slice(startPos)
  return text || null
}

function parseLineText(): string | null {
  let text = ""
  if (checkIndentContentsEscape && isStr("\\:")) next() // delete "\\"
  let startPos = pos()
  while (hasNext() && !(isOneOf("{}") || isNewLine())) {
    if (escapedOneOf("{}")) {
      text += slice(startPos)
      next() // delete "\\"
      startPos = pos()
    }
    next()
  }
  const endText = isLineEnd() ? sliceLineEnd(startPos) : slice(startPos) || null
  if (endText === "") return text
  return text + (endText || "") || null
}

function parseLineLiteralText(): string | null {
  const startPos = pos()
  while (!isLineEnd()) next()
  return sliceLineEnd(startPos)
}

function parseIndentLiteralText(): string | null {
  let text = ""
  let emptyState: EmptyState | null = null
  while (hasNext()) {
    let content = parseLineLiteralText()
    if (content === null) {
      if (hasEnded()) break
      const newLinePos = pos()
      assertNewLine()
      const newLine = slice(newLinePos)
      if (matchIndent(indentLevel)) {
        content = newLine
      } else if (matchEmptyLine()) {
        emptyState = updateEmptyState(emptyState, newLinePos, newLine)
        continue
      } else {
        backtrack(newLinePos)
        break
      }
    }
    // There were empty lines in between the last and the current content.
    if (emptyState) {
      text += emptyState.newLines
      emptyState = null
    }
    text += content
  }
  // The last empty lines did not occur in between indented contents,
  // so they are not considered part of the contents.
  if (emptyState) backtrack(emptyState.startPos)
  return text || null
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

function parseTagName(): string | null {
  let name = ""
  let startPos = pos()
  // At the start of a tag can occur indicators,
  // however from the first indicator that is escaped going forwards,
  // all indicators will be considered part of the name.
  if (escapedOneOf("'@")) {
    next() // delete "\\"
    startPos = pos()
    next() // skip escaped (potentially "\\", hence its necessary to skip)
  }
  // A tag name ends when a brace occurs, signifying the start of an attribute,
  // or the end of the tag, or when a colon occurs, signifying the start of the contents.
  let linePos: number | null = null
  while (hasNext() && !isOneOf("{}:")) {
    if (isNewLine()) return null
    if (escapedOneOf("{}:")) {
      name += slice(startPos)
      next() // delete "\\"
      startPos = pos()
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
    if (pos() === endPos) {
      if (isEscaped) {
        name += slice(startPos, linePos)
        startPos = linePos + 1 // delete "\\"
      } else backtrack(linePos)
    } else backtrack(endPos)
  }
  name += slice(startPos)
  return name || null
}

function parseBlockAttributes(): Tag[] {
  const blockAttributes: Tag[] = []
  let startPos = pos()
  while (matchNewLineIndent(indentLevel)) {
    const attr = parseTag(ParseTagScope.BlockAttr)
    if (!attr) break
    consumeWhitespace()
    if (!isLineEnd()) break
    blockAttributes.push(attr)
    startPos = pos()
  }
  backtrack(startPos)
  return blockAttributes
}

function tryParseTag(scope: ParseTagScope, contentsLayout?: ContentsLayout): Tag | null {
  if (!matchChr("{")) return null
  const isQuoted = matchChr("'")
  const isAttribute = matchChr("@")
  if (!isAttribute && (scope === ParseTagScope.InlineAttr || scope === ParseTagScope.BlockAttr)) return null
  const name = parseTagName()
  if (!name) return null
  const attributes: Tag[] = []
  while (chr() === "{") {
    const attr = parseTag(ParseTagScope.InlineAttr)
    if (!attr) return null
    attributes.push(attr)
  }
  let variant: number
  let isLiteral = false
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
      ++unbraced
      contents = isLiteral ? [parseBraceLiteralText() || ""] : parseBraceContents()
      --unbraced
      if (!matchChr("}")) return null
    } else {
      if (!(scope === ParseTagScope.BlockAttr || scope === ParseTagScope.Content)) return null
      if (!matchChr("}")) return null
      if (chr() === " ") next()
      contents = isLiteral ? [parseLineLiteralText() || ""] : parseLineContents()
      const newLinePos = pos()
      if (contents[0] === "" && isNewLine()) {
        ++indentLevel
        const blockAttributes = parseBlockAttributes()
        const lineEndPos = pos()
        const hasIndentContents = matchNewLineIndent(indentLevel - 1) && chr() === ":" && isSpaceOrLineEnd(1)
        if (hasIndentContents || blockAttributes.length > 0) {
          if (hasIndentContents) {
            next()
            if (chr() === " ") next()
            dedentLevel = null
            dedents = 0
          } else backtrack(lineEndPos)
          attributes.push(...blockAttributes)
          variant = ContentsLayout.Indent
          contents = hasIndentContents
            ? isLiteral
              ? [parseIndentLiteralText() || ""]
              : parseIndentContents()
            : []
        } else backtrack(newLinePos)
        --indentLevel
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
          --dedents
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
    scope === ParseTagScope.Content && variant === ContentsLayout.Indent && contents.length === 0
  return {
    isQuoted,
    isAttribute,
    name,
    attributes,
    isLiteral,
    contents,
  }
}

export function parseTag(scope: ParseTagScope, contentsLayout?: ContentsLayout): Tag | null {
  const startPos = pos()
  const tag = tryParseTag(scope, contentsLayout)
  if (!tag) backtrack(startPos)
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
      if (contentsLayout & ContentsLayout.Indent) appendText(contents, "")
    }
  }
}

const genericContentsParser = (parseText: () => string | null, parseDelims: () => string | null) => (
  contentsLayout: ContentsLayout,
): Content[] => {
  const contents: Content[] = []
  while (!hasEnded()) {
    let content: Content | null = parseText()
    if (content === null) {
      content = parseTag(ParseTagScope.Content, contentsLayout)
      if (!content) {
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
    if (content === null) {
      content = parseTag(ParseTagScope.Content, contentsLayout)
      if (!content) {
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
              emptyState = updateEmptyState(emptyState, newLinePos, newLine)
              continue
            }
          } else backtrack(newLinePos)
        }
      }
    }
    if (content === null) break
    // There were empty lines in between the last and the current content.
    if (emptyState) {
      appendText(contents, emptyState.newLines)
      emptyState = null
    }
    appendContent(contentsLayout, contents, content)
  }
  // The last empty lines did not occur in between indented contents,
  // so they are not considered part of the contents.
  if (emptyState) backtrack(emptyState.startPos)
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
export const parseContents = wrapContentsParser(
  ContentsLayout.Brace | ContentsLayout.Line | ContentsLayout.Indent,
  indentContentsParser(),
)

export const wrapTopLevelParser = <T>(parse: () => T) => (s: string): T => {
  input = s
  p = 0
  c = input[p]

  dedentLevel = null
  dedents = 0
  checkIndentContentsEscape = false

  indentLevel = 0
  contentIndentLevels = []
  unbraced = 0
  skipNewLine = false

  const result = parse()
  assert(hasEnded(), "expected end of input")
  return result
}
