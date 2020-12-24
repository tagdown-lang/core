import { Tag, Content } from "./types"
import { assert, log } from "./utils"
import { match } from "assert"
import { isString } from "util"

// The different ways a tag can be layout within the syntax.
// The top-level contents can be considered to be both within brace and indent contents,
// so they are defined as bit flags to allow for unions.
export enum ContentsLayout {
  Atom = 1 << 0, // {foo}
  Brace = 1 << 1, // {foo: test}
  Line = 1 << 2, // {foo=} test
  Indent = 1 << 3, // {foo=}\n: test
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

class ParserState {
  public input: string

  // The current position within the input.
  public pos: number

  // The indentation level that has been dedented to.
  public dedentLevel: number | null

  // How many dedents still need to be made to correct the indentation level to its new level.
  public dedents: number

  public escapes: number

  public brace: {
    // The indentation level in the current brace contents.
    indentLevel: number

    // What indentation levels contain contents rather than attributes.
    contentIndentLevels: number[]
  }

  public line: {
    // How many brace tags are still left unclosed.
    unbraced: number
  }

  public indent: {
    // The indentation levels of line tags that ended with new lines.
    skipNewLine: boolean
  }

  init(input: string) {
    this.input = input
    this.pos = 0
    this.dedentLevel = null
    this.dedents = 0
    this.escapes = 0
    this.brace = {
      indentLevel: 0,
      contentIndentLevels: [],
    }
    this.line = {
      unbraced: 0,
    }
    this.indent = {
      skipNewLine: false,
    }
  }
}

// The scope wherein a tag is parsed.
enum TagScope {
  InlineAttr,
  BlockAttr,
  Content,
}

let checkContentDelim = false

export const { parseTag, parseContents, parseEscapeContents, parseNode } = (state => {
  let trackRange = false
  let chr: string | undefined

  function hasNext(count = 1) {
    return state.pos + count <= state.input.length
  }

  function hasEnded(offset = 0): boolean {
    return state.pos + offset === state.input.length
  }

  function pos(): number {
    return state.pos
  }

  function next(): void {
    state.pos++
    chr = state.input[state.pos]
  }

  function backtrack(pos: number) {
    state.pos = pos
    chr = state.input[state.pos]
  }

  function peek(offset: number): string | undefined {
    return state.input[state.pos + offset]
  }

  function peekStr(s: string): boolean {
    if (!hasNext(s.length)) return false
    for (let i = 0; i < s.length; i++) if (s[i] !== peek(i)) return false
    return true
  }

  function slice(startPos: number, endPos = state.pos): string {
    return state.input.substring(startPos, endPos)
  }

  function isOneOf(candidates: string, offset = 0): boolean {
    return hasNext(offset) && candidates.includes(peek(offset)!)
  }

  function escapedOneOf(escaped: string): boolean {
    if (!hasNext(1)) return false
    const c0 = peek(0)!
    const c1 = peek(1)!
    return c0 === "\\" && (c1 === "\\" || escaped.includes(c1))
  }

  function isNewline(offset = 0): boolean {
    return isOneOf("\r\n", offset)
  }

  function isSpaceOrLineEnd(offset: number): boolean {
    return hasEnded(offset) || peek(offset) === " " || isNewline(offset)
  }

  // See whether the next character matches with the given indicator character.
  function matchChr(c: string): boolean {
    const cond = c === chr
    if (cond) next()
    return cond
  }

  function consumeWhitespace(): void {
    while (hasNext() && !isNewline() && chr!.trim() === "") next()
  }

  // See whether the next input characters represent a new line.
  function matchNewLine(): boolean {
    const cond = isNewline()
    if (cond) {
      if (peekStr("\r\n")) next()
      next()
    }
    return cond
  }

  function assertNewLine(): void {
    assert(matchNewLine(), "expected new line")
  }

  function matchLineEnd(): boolean {
    return hasEnded() || matchNewLine()
  }

  function sliceLineEnd(startPos: number): string {
    if (trackRange) return slice(startPos)
    const text = slice(startPos).trimEnd()
    if (text.endsWith("\\$")) {
      // state.escapes++
      return text.substring(0, text.length - "\\$".length) + "$"
    } else if (text.endsWith("$")) {
      // state.escapes++
      return text.substring(0, text.length - "$".length)
    }
    return text
  }

  // Parse the indent level up to the given maximum indent level.
  function parseIndent(maxLevel: number): number {
    let level = 0
    while (level < maxLevel && (peekStr("  ") || chr === "\t")) {
      level++
      next()
      if (chr === " ") next()
    }
    return level
  }

  // See whether the next input characters represent an indentation of the given level.
  function matchIndent(level: number): boolean {
    const startPos = pos()
    const cond = parseIndent(level) === level
    if (!cond) backtrack(startPos)
    return cond
  }

  // See whether the next input characters represent an empty line.
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
        if (trackRange) next()
        else {
          text += slice(startPos)
          next() // Skip the backslash (i.e. escape) character.
          if (chr === "\\") state.escapes++
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
    while (hasNext() && !(chr === "}" && unbalanced === 0)) {
      if (isNewline()) {
        text += sliceLineEnd(startPos)
        startPos = pos()
        assertNewLine()
        continue
      }
      if (chr === "{") unbalanced++
      else if (chr === "}") unbalanced--
      next()
    }
    text += slice(startPos)
    return text
  }

  function parseLineText(): string {
    let text = ""
    // FIXME: Only when first text of indent tag.
    if (checkContentDelim && peekStr("\\:")) {
      next() // Skip the backslash (i.e. escape) character.
    }
    checkContentDelim = false
    let startPos = pos()
    while (hasNext() && !(isOneOf("{}") || isNewline())) {
      if (escapedOneOf("{}")) {
        if (trackRange) next()
        else {
          text += slice(startPos)
          next() // Skip the backslash (i.e. escape) character.
          if (chr === "\\") state.escapes++
          startPos = pos()
        }
      }
      next()
    }
    text += hasEnded() || isNewline() ? sliceLineEnd(startPos) : slice(startPos)
    return text
  }

  function parseLineLiteralText(): string {
    const startPos = pos()
    while (hasNext() && !isNewline()) next()
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
        if (matchIndent(state.brace.indentLevel)) {
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

  // Parse the delimiters within a brace tag contents.
  // In the case of brace tags, these will be the braces that are not part of tag,
  // or did not form a valid tag.
  function parseBraceDelims(): string | null {
    if (!isOneOf("{}")) return null
    if (chr === "{") {
      next()
      return "{"
    }
    if (state.line.unbraced === 0) {
      const startPos = pos()
      next() // We know it is "}".
      while (hasNext() && chr === "}") next()
      return slice(startPos)
    }
    return null
  }

  // Parse the name of a tag.
  // The name can be anything, as long as the indicators used within tags are properly escaped.
  function parseName(): string | null {
    let name = ""
    let startPos = pos()
    // At the start of a tag can occur indicators,
    // however from the first indicator that is escaped going forwards,
    // all indicators will be considered part of the name.
    if (escapedOneOf("'@")) {
      next() // Skip the backslash (i.e. escape) character.
      if (!trackRange) {
        if (chr === "\\") state.escapes++
        startPos = pos()
      }
      // Optimization, the escaped character will always be part of the name.
      next()
    }
    // A tag name ends when a brace occurs, signifying the start of an attribute,
    // or the end of the tag, or when a colon occurs, signifying the start of the contents.
    let linePos: number | null = null
    while (hasNext() && !isOneOf("{}:")) {
      if (isNewline()) return null
      if (escapedOneOf("{}:")) {
        if (trackRange) next()
        else {
          name += slice(startPos)
          next() // Skip the backslash (i.e. escape) character.
          startPos = pos()
          if (chr === "\\") state.escapes++
        }
      } else if (chr === "=" || escapedOneOf("=")) {
        linePos = pos()
        if (chr === "\\") next()
      }
      next()
    }
    // FIXME: Needs to be embedded in parseTag, such that {=} and {=: } is allowed.
    if (chr === "}" && linePos !== null) {
      const endPos = pos()
      backtrack(linePos)
      const isEscaped = matchChr("\\")
      assert(matchChr("="), "expected equals sign")
      matchChr("'")
      if (pos() === endPos) {
        if (isEscaped) {
          name += slice(startPos, linePos)
          startPos = linePos + 1 // Skip the backslash (i.e. escape) character.
        } else {
          backtrack(linePos)
        }
      } else {
        backtrack(endPos)
      }
    }
    name += slice(startPos)
    if (!(name !== "")) return null
    return name
  }

  function parseTag(scope: TagScope, contentsLayout?: ContentsLayout): Tag | null {
    checkContentDelim = false
    const startPos = pos()
    let contentsRange: ParseRange | undefined
    function parseContentsRange(parseContents): Content[] {
      const startPos = pos() - state.escapes
      const contents = parseContents()
      if (trackRange && contents.length > 0) {
        // log("contentsRange", state.escapes, trackRange)
        contentsRange = {
          start: startPos,
          end: pos() - state.escapes,
        }
      }
      return contents
    }
    const rangeStart = pos() - state.escapes
    const tag: ParseTag | null = (() => {
      if (!matchChr("{")) return null
      const isQuoted = matchChr("'")
      const isAttribute = matchChr("@")
      if (!isAttribute && (scope === TagScope.InlineAttr || scope === TagScope.BlockAttr)) {
        return null
      }
      const name = parseName()
      if (!(name !== null)) return null
      const attributes: Tag[] = []
      while (chr === "{") {
        const attr = parseTag(TagScope.InlineAttr)
        if (!(attr !== null)) return null
        attributes.push(attr)
      }
      let isLiteral = false
      let contents: Content[] | undefined
      if (matchChr("}")) {
        contents = []
      } else {
        let variant: number
        if (matchChr(":")) {
          variant = ContentsLayout.Brace
        } else if (matchChr("=")) {
          variant = ContentsLayout.Line
        } else {
          return null
        }
        isLiteral = matchChr("'")
        if (variant === ContentsLayout.Brace) {
          if (chr === " ") next()
          state.line.unbraced++
          contents = parseContentsRange(() => (isLiteral ? [parseBraceLiteralText()] : parseBraceContents()))
          state.line.unbraced--
          if (!matchChr("}")) return null
        } else {
          if (!(scope === TagScope.BlockAttr || scope === TagScope.Content)) return null
          if (!matchChr("}")) return null
          if (chr === " ") next()
          contents = parseContentsRange(() => (isLiteral ? [parseLineLiteralText()] : parseLineContents()))
          const newLinePos = pos()
          if (contents[0] === "" && matchNewLine()) {
            state.brace.indentLevel++
            const blockAttributes: Tag[] = []
            indent_contents: for (;;) {
              let attrNewLinePos: number | undefined
              while (matchIndent(state.brace.indentLevel)) {
                const attr = parseTag(TagScope.BlockAttr)
                if (attr === null) break indent_contents
                consumeWhitespace()
                attrNewLinePos = pos()
                if (!matchLineEnd()) break indent_contents
                blockAttributes.push(attr)
              }
              if (matchIndent(state.brace.indentLevel - 1) && chr === ":" && isSpaceOrLineEnd(1)) {
                next()
                // @ts-ignore
                if (chr === " ") next()
                state.dedentLevel = null
                state.dedents = 0
                contents = parseContentsRange(() =>
                  isLiteral ? [parseIndentLiteralText()] : parseIndentContents(),
                )
              } else if (blockAttributes.length > 0) {
                contents = []
                assert(attrNewLinePos !== undefined, "expected attribute new line position to be defined")
                backtrack(attrNewLinePos) // After the contents should be a newline.
              } else break
              variant = ContentsLayout.Indent
              attributes.push(...blockAttributes)
              break
            }
            state.brace.indentLevel--
            if (variant === ContentsLayout.Line) {
              backtrack(newLinePos)
            }
          }
          if (variant === ContentsLayout.Line) {
            if (matchNewLine()) {
              // The new line after a line tag should be skipped by default,
              // however that same new line could also be significant for indent contents,
              // so it should only be skipped only when it is safe to do so.
              if (scope === TagScope.Content) {
                assert(contentsLayout !== undefined, "expected variant to be defined for content tag")
                if (!(contentsLayout & ContentsLayout.Brace)) {
                  if (matchIndent(state.brace.indentLevel)) {
                    state.indent.skipNewLine = true
                  }
                  backtrack(newLinePos)
                }
              } else {
                backtrack(newLinePos)
              }
            } else {
              assert(hasEnded(), "expected new line or end of input")
            }
          } else if (scope === TagScope.Content) {
            if (hasEnded()) {
              state.dedentLevel = null
              state.dedents = 0
            } else if (state.dedents > 0) {
              state.dedents--
            } else {
              const newLinePos = pos()
              assertNewLine()
              state.dedentLevel = parseIndent(Number.MAX_SAFE_INTEGER)
              backtrack(newLinePos)
              assert(state.dedentLevel <= state.brace.indentLevel, "expected dedentation")
              if (state.brace.contentIndentLevels.includes(state.dedentLevel)) {
                state.dedents = state.brace.indentLevel - state.dedentLevel
              } else {
                state.dedentLevel = null
                state.dedents = 0
              }
            }
            checkContentDelim = contents.length === 0
          }
        }
      }
      return {
        isQuoted,
        isAttribute,
        name,
        attributes,
        isLiteral,
        contents,
      }
    })()
    if (tag === null) {
      backtrack(startPos)
      return null
    }
    if (trackRange) {
      tag.range = {
        start: rangeStart,
        end: pos() - state.escapes,
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
      if (state.brace.indentLevel === state.dedentLevel) {
        state.dedentLevel = null
        state.dedents = 0
        state.indent.skipNewLine = false
        assertNewLine()
        assert(matchIndent(state.brace.indentLevel), "expected indentation")
        if (chr === "\\" && isSpaceOrLineEnd(1)) {
          next()
          // @ts-ignore
          if (chr === " ") next()
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
        content = parseTag(TagScope.Content, contentsLayout)
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
        content = parseTag(TagScope.Content, contentsLayout)
        if (content === null) {
          content = parseBraceDelims()
          const newLinePos = pos()
          if (matchNewLine()) {
            const newLine = slice(newLinePos)
            const hasIndent = matchIndent(state.brace.indentLevel)
            if (hasIndent || matchEmptyLine()) {
              if (hasIndent && content === null) content = ""
              if (state.indent.skipNewLine) state.indent.skipNewLine = false
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
    if (emptyState !== null) {
      backtrack(emptyState.startPos)
    }
    return contents
  }

  const wrapContentsParser = (
    contentsLayout: ContentsLayout,
    parseContents: (contentsLayout: ContentsLayout) => Content[],
  ) => () => {
    let oldBraceState, oldLineState, oldIndentState
    if (contentsLayout & ContentsLayout.Brace) {
      oldBraceState = state.brace
      state.brace = {
        indentLevel: 0,
        contentIndentLevels: [0],
      }
    }
    if (contentsLayout & ContentsLayout.Line) {
      oldLineState = state.line
      state.line = {
        unbraced: 0,
      }
    }
    if (contentsLayout & ContentsLayout.Indent) {
      state.brace.contentIndentLevels.unshift(state.brace.indentLevel)
      oldIndentState = state.indent
      state.indent = {
        skipNewLine: false,
      }
    }
    const contents = parseContents(contentsLayout)
    if (contentsLayout & ContentsLayout.Indent) {
      state.indent = oldIndentState
      state.brace.contentIndentLevels.shift()
    }
    if (contentsLayout & ContentsLayout.Line) state.line = oldLineState
    if (contentsLayout & ContentsLayout.Brace) state.brace = oldBraceState
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

  function parseBlockAttributes(): Tag[] | null {
    const attributes: Tag[] = []
    while (chr === "{") {
      const attr = parseTag(TagScope.BlockAttr)
      if (attr === null) return null
      consumeWhitespace()
      if (!matchLineEnd()) return null
      attributes.push(attr)
    }
    if (!peekStr("--")) return null
    next()
    next()
    return attributes
  }

  function parseNode(): Tag {
    let attributes = parseBlockAttributes()
    let hasContents = true
    if (attributes !== null) {
      hasContents = hasNext()
      if (!matchLineEnd()) attributes = null
    }
    if (attributes === null) {
      backtrack(0)
      attributes = []
    }
    if (attributes.length === 0) {
      if (peekStr("\\--")) {
        next()
      }
    }
    const contents = hasContents ? parseTopLevelContents() : []
    return {
      isQuoted: false,
      isAttribute: false,
      name: "node",
      attributes,
      isLiteral: false,
      contents,
    }
  }

  const wrapTopLevelParser = <T>(parse: () => T, track: boolean) => (input: string): T => {
    trackRange = track
    state.init(input)
    chr = state.input[state.pos]
    const result = parse()
    assert(hasEnded(), "expected end of input")
    return result
  }

  return {
    parseTag: wrapTopLevelParser(() => parseTag(TagScope.Content), false),
    parseContents: wrapTopLevelParser(parseTopLevelContents, false),
    parseEscapeContents: wrapTopLevelParser(parseTopLevelContents, true) as (input: string) => ParseContent[],
    parseNode: wrapTopLevelParser(parseNode, false),
  }
})(new ParserState())

export function logParse(input: string): void {
  log(input)
  console.log(input)
  log(parseContents(input))
}

// logParse("\\\\\\")
// logParse("{p: \\\\\\\\\\\\}")
// logParse("{U: \\{\\\\\\\\\\{A\\}}")
// logParse("{\\}=}\n  {@]='} {\n: |{G}\\\\:")
// logParse("{d=}\n  {@\\={@u}=} $\n  {@k=}\n  : $\n    $")
// {\}=}
//   {@]='} {
// : |{G}\\:
