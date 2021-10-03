import { NodePropSource, NodeSet, NodeType, Tree } from "@lezer/common"

// Needs to be exported, otherwise when using `Tree`, `NodeType` can only be inspected with `name`,
// making it string typed. Exporting the enum makes it more type safe and easier to refactor.
export enum Type {
  // Special
  None,
  TopContents,
  TagError,

  // Tags
  IndentTag, // least requirements
  EndTag,
  LineTag,
  BraceTag,
  AtomTag,

  // Tag
  TagMarker,
  IsQuoted,
  IsAttribute,
  Name,
  InlineAttributes,
  IsLine,
  IsMultiline,
  IsLiteral,
  MultilineAttributes,
  ContentsMarker,
  Contents,

  // Text
  StopMarker,
  Escape,
  Other,
}

export function isTagType(type: number): boolean {
  return [Type.IndentTag, Type.EndTag, Type.LineTag, Type.BraceTag, Type.AtomTag].includes(type)
}

export function isBlockTagType(type: number): boolean {
  return [Type.IndentTag, Type.EndTag, Type.LineTag].includes(type)
}

export function isInlineTagType(type: number): boolean {
  return [Type.BraceTag, Type.AtomTag].includes(type)
}

export function isMultilineTagType(type: number): boolean {
  return [Type.IndentTag, Type.EndTag].includes(type)
}

export function isTextType(type: number): boolean {
  return [Type.StopMarker, Type.Escape, Type.Other].includes(type)
}

const nodeTypes = [
  NodeType.none,
  NodeType.define({ id: 1, name: Type[1], top: true }),
  NodeType.define({ id: 2, name: Type[2], error: true }),
]
for (let i = 3, name: string; (name = Type[i]); i++) {
  nodeTypes[i] = NodeType.define({
    id: i,
    name,
  })
}

// Tried to be made compatible, in so far possible, with:
// https://lezer.codemirror.net/docs/ref/#lezer.Parser
export class TagdownParser {
  constructor(readonly nodeSet: NodeSet) {}

  parse(input: string, indentLevel = 0): Tree {
    let parse = new Parse(this, input, indentLevel)
    return parse.finish()
  }

  configure(config: { props?: readonly NodePropSource[] }): TagdownParser {
    return new TagdownParser(config.props ? this.nodeSet.extend(...config.props) : this.nodeSet)
  }

  getName(term: number): string | undefined {
    return Type[term]
  }

  readonly hasNested = false
}

export const parser = new TagdownParser(new NodeSet(nodeTypes))

class TreeLeaf {
  static createRange(type: number, from: number, to: number): TreeLeaf {
    return new TreeLeaf(type, from, to)
  }

  static createFrom(type: number, from: number, length: number): TreeLeaf {
    return new TreeLeaf(type, from, from + length)
  }

  static createTo(type: number, to: number, length: number): TreeLeaf {
    return new TreeLeaf(type, to - length, to)
  }

  private constructor(readonly type: number, readonly from: number, readonly to: number) {}

  get length(): number {
    return this.to - this.from
  }
}

class TreeBuilder {
  readonly children: Tree[] = []
  readonly positions: number[] = []

  constructor(readonly nodeSet: NodeSet, readonly from: number, public type: number = Type.None) {}

  get to(): number {
    return this.from + this.length
  }

  get length(): number {
    const lastIndex = this.positions.length - 1
    return lastIndex >= 0 ? this.positions[lastIndex] + this.children[lastIndex].length : 0
  }

  isEmpty(): boolean {
    return this.children.length === 0
  }

  nonEmptyOrNull(): TreeBuilder | null {
    return !this.isEmpty() ? this : null
  }

  // Return a boolean for convenience: builder.add(...) || ...
  add(child: TreeBuilder | Tree | TreeLeaf | null, from?: number): boolean {
    // Convenience to allow: const result = ...; if (result !== null) builder.add(result)
    // to become: builder.add(...)
    if (child === null) return false
    if (child instanceof TreeBuilder) {
      const offset = child.from - this.from
      this.children.push(...child.children)
      this.positions.push(...child.positions.map((position) => position + offset))
    } else if (child instanceof TreeLeaf) {
      const { type, to, from } = child
      this.children.push(new Tree(this.nodeSet.types[type], [], [], to - from))
      this.positions.push(from - this.from)
    } else {
      this.children.push(child)
      this.positions.push(from !== undefined ? from - this.from : this.length)
    }
    return true
  }

  toTree(length = this.length): Tree {
    return new Tree(this.nodeSet.types[this.type], this.children, this.positions, length)
  }
}

class TextBuilder extends TreeBuilder {
  toTree(): Tree {
    const buffer: number[] = []
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i]
      const position = this.positions[i]
      buffer.push(child.type.id, position, position + child.length, 4)
    }
    return Tree.build({
      topID: Type.None,
      buffer,
      nodeSet: this.nodeSet,
      reused: this.children,
    })
  }
}

class TagBuilder extends TreeBuilder {
  addContainer(container: TreeBuilder): void {
    // Contents is a special case because we have to differentiate between no contents and empty contents.
    // You determine this via the contents marker, but having it even if empty makes it easier to work with,
    // especially if you want the start position of the contents.
    if (!container.isEmpty() || container.type === Type.Contents) {
      this.add(container.toTree(), container.from)
    }
  }
}

// Character codes
// Abbreviated by first two letters if one word, or first letters if two words.
const AT = 64
const BS = 92
const CO = 58
const CR = 13
const DO = 36
const EQ = 61
const HA = 35
const HT = 9
const HY = 45
const LB = 123
const LF = 10
const RB = 125
const SP = 32
const SQ = 39
const _0 = 48
const _9 = 57
const _A = 65
const _Z = 90
const _a = 97
const _z = 122

enum TagScope {
  InlineAttribute,
  MultilineAttribute,
  Content,
}

enum ParseTagResult {
  None,
  Fail,
  Finish,
}

class Parse {
  readonly nodeSet: NodeSet
  pos = 0
  readonly indents: number[]
  skipNewline = false

  constructor(parser: TagdownParser, readonly input: string, indentLevel: number) {
    this.nodeSet = parser.nodeSet
    this.indents = [indentLevel]
  }

  private next(count = 1): void {
    this.pos += count
  }

  private hasNext(count = 1): boolean {
    return this.pos + count <= this.input.length
  }

  private hasEnded(offset = 0): boolean {
    return this.pos + offset === this.input.length
  }

  private peek(offset: number): number {
    return this.input.charCodeAt(this.pos + offset)
  }

  private isChr(c: number, offset = 0): boolean {
    return this.peek(offset) === c
  }

  private isOneOf(chrs: number[], offset = 0): boolean {
    return this.hasNext(offset) && chrs.includes(this.peek(offset))
  }

  private esacpedOneOf(chrs: number[], offset = 0): boolean {
    return this.isChr(BS, offset) && (this.isChr(BS, offset + 1) || this.isOneOf(chrs, offset + 1))
  }

  private isAlpha(offset = 0): boolean {
    const c = this.peek(offset)
    return (c >= _a && c <= _z) || (c >= _A && c <= _Z)
  }

  private isAlphanumeric(offset = 0): boolean {
    const c = this.peek(offset)
    return (c >= _a && c <= _z) || (c >= _A && c <= _Z) || (c >= _0 && c <= _9)
  }

  private isSpaces(offset = 0): boolean {
    return this.isOneOf([SP, HT], offset)
  }

  private isLineEnd(offset = 0): boolean {
    return this.hasEnded(offset) || !!this.matchNewline(offset)
  }

  private matchChr(c: number, offset = 0): number {
    return +this.isChr(c, offset)
  }

  private matchStr(s: number[], offset = 0): number {
    if (!this.hasNext(offset + s.length)) return 0
    for (let i = 0; i < s.length; i++) if (s[i] !== this.peek(offset + i)) return 0
    return s.length
  }

  private matchNewline(offset = 0): number {
    return this.matchChr(LF, offset) || this.matchStr([CR, LF], offset)
  }

  private matchSpaces(offset = 0): number {
    let length = 0
    while (this.isSpaces(offset + length)) length++
    return length
  }

  private countIndents(offset = 0): { count: number; length: number } {
    let count = 0
    let length = 0
    for (
      let n = 0;
      count < this.indents[0] &&
      (n = this.matchStr([SP, SP], offset + length) || this.matchChr(HT, offset + length));
      count++, length += n
    ) {}
    return { count, length }
  }

  private countNewlineIndents(offset = 0): { count: number; length: number } {
    const newline = this.matchNewline(offset)
    const indents = newline ? this.countIndents(offset + newline) : { count: 0, length: 0 }
    indents.length += newline
    return indents
  }

  private parseChr(c: number, offset = 0): boolean {
    const cond = this.isChr(c, offset)
    if (cond) this.next()
    return cond
  }

  private slice(from: number, length = this.pos - from): TreeLeaf | null {
    return length > 0 ? TreeLeaf.createFrom(Type.Other, from, length) : null
  }

  private sliceLineEnd(start: number): TextBuilder | null {
    const builder = new TextBuilder(this.nodeSet, start)
    const length = this.pos - start
    let newLength = length
    while (newLength >= 1 && this.isSpaces(newLength - length - 1)) newLength--
    let ending: TreeLeaf | undefined
    if (newLength >= 2 && this.matchStr([BS, DO], newLength - length - 2)) {
      ending = TreeLeaf.createTo(Type.Escape, this.pos - length + newLength, 2)
    } else if (newLength >= 1 && this.isChr(DO, newLength - length - 1)) {
      ending = TreeLeaf.createTo(Type.StopMarker, this.pos - length + newLength, 1)
    }
    if (ending) newLength -= ending.length
    builder.add(this.slice(start, newLength))
    if (ending) builder.add(ending)
    return builder.nonEmptyOrNull()
  }

  private parseBraceText(): TextBuilder | null {
    const builder = new TextBuilder(this.nodeSet, this.pos)
    let start = this.pos
    while (this.hasNext() && !this.isOneOf([LB, RB])) {
      const newline = this.matchNewline()
      if (newline) {
        builder.add(this.sliceLineEnd(start))
        start = this.pos
        this.next(newline)
      } else if (this.esacpedOneOf([LB, RB])) {
        builder.add(this.slice(start))
        builder.add(TreeLeaf.createFrom(Type.Escape, this.pos, 2))
        this.next(2)
        start = this.pos
      } else {
        this.next()
      }
    }
    if (this.pos > start) {
      builder.add(this.slice(start))
    }
    return builder.nonEmptyOrNull()
  }

  private parseBraceLiteralText(): TextBuilder | null {
    const builder = new TextBuilder(this.nodeSet, this.pos)
    let start = this.pos
    for (let unbalanced = 0; this.hasNext() && !(this.isChr(RB) && !unbalanced); ) {
      const newline = this.matchNewline()
      if (newline) {
        builder.add(this.sliceLineEnd(start))
        start = this.pos
        this.next(newline)
      } else {
        if (this.isChr(LB)) unbalanced++
        else if (this.isChr(RB)) unbalanced--
        this.next()
      }
    }
    if (this.pos > start) {
      builder.add(this.slice(start))
    }
    return builder.nonEmptyOrNull()
  }

  private parseLineText(): TextBuilder | null {
    const builder = new TextBuilder(this.nodeSet, this.pos)
    let start = this.pos
    while (this.hasNext() && !(this.isChr(LB) || this.matchNewline())) {
      if (this.esacpedOneOf([LB, RB])) {
        builder.add(this.slice(start))
        builder.add(TreeLeaf.createFrom(Type.Escape, this.pos, 2))
        this.next(2)
        start = this.pos
      } else {
        this.next()
      }
    }
    if (this.pos > start) {
      builder.add(this.isLineEnd() ? this.sliceLineEnd(start) : this.slice(start))
    }
    return builder.nonEmptyOrNull()
  }

  private parseLineLiteralText(): TextBuilder | null {
    const start = this.pos
    while (!this.isLineEnd()) this.next()
    return this.sliceLineEnd(start)
  }

  private parseMarker(container: TreeBuilder, chr: number, type: Type): boolean {
    const cond = this.parseChr(chr)
    if (cond) container.add(TreeLeaf.createTo(type, this.pos, 1))
    return cond
  }

  private parseTagEnd(tag: TreeBuilder): boolean {
    return this.parseMarker(tag, RB, Type.TagMarker)
  }

  private finishTag(
    scope: TagScope,
    container: TreeBuilder,
    tag: TagBuilder,
    parentTag?: TagBuilder,
  ): ParseTagResult.Finish {
    container.add(tag.toTree(this.pos - tag.from), tag.from)
    if (tag.type <= Type.LineTag && scope === TagScope.Content) {
      if (parentTag && parentTag.type === Type.BraceTag) this.next(this.matchNewline())
      else this.skipNewline = true
    }
    return ParseTagResult.Finish
  }

  private failTag(tag: TagBuilder, container: TreeBuilder): ParseTagResult.Fail {
    const tagTree = tag.toTree(this.pos - tag.from)
    container.add(new Tree(this.nodeSet.types[Type.TagError], [tagTree], [0], tagTree.length), tag.from)
    return ParseTagResult.Fail
  }

  private parseTag(scope: TagScope, container: TreeBuilder, parentTag?: TagBuilder): ParseTagResult {
    if (!this.isChr(LB)) return ParseTagResult.None
    const tag = new TagBuilder(this.nodeSet, this.pos, Type.AtomTag)
    tag.add(TreeLeaf.createFrom(Type.TagMarker, this.pos, 1))
    this.next()
    this.next(this.matchSpaces())
    this.parseMarker(tag, SQ, Type.IsQuoted)
    this.parseMarker(tag, AT, Type.IsAttribute)
    const start = this.pos
    if (this.isAlpha()) {
      do {
        this.next()
      } while (this.isAlphanumeric())
      while (this.isChr(SP) && this.isAlphanumeric(1)) {
        this.next()
        do {
          this.next()
        } while (this.isAlphanumeric())
      }
    }
    if (this.pos === start) return this.failTag(tag, container)
    tag.add(TreeLeaf.createRange(Type.Name, start, this.pos))
    this.next(this.matchSpaces())
    const inlineAttributes = new TreeBuilder(this.nodeSet, this.pos, Type.InlineAttributes)
    let failed = false
    for (;;) {
      const result = this.parseTag(TagScope.InlineAttribute, inlineAttributes, tag)
      if (!result) break
      if (result === ParseTagResult.Finish) continue
      failed = true
      break
    }
    tag.addContainer(inlineAttributes)
    if (failed) return this.failTag(tag, container)
    let isLiteral = false
    if (this.parseTagEnd(tag)) return this.finishTag(scope, container, tag, parentTag)
    if (this.parseMarker(tag, CO, Type.ContentsMarker)) {
      tag.type = Type.BraceTag
      isLiteral = this.parseMarker(tag, SQ, Type.IsLiteral)
      this.parseChr(SP)
      this.indents.unshift(0)
      const contents = new TreeBuilder(this.nodeSet, this.pos, Type.Contents)
      if (isLiteral) contents.add(this.parseBraceLiteralText())
      else while (contents.add(this.parseBraceText()) || this.parseTag(TagScope.Content, contents, tag)) {}
      tag.addContainer(contents)
      this.indents.shift()
      if (this.parseTagEnd(tag)) return this.finishTag(scope, container, tag, parentTag)
      else return this.failTag(tag, container)
    } else if (scope === TagScope.Content || scope === TagScope.MultilineAttribute) {
      if (this.parseMarker(tag, EQ, Type.IsLine)) {
        tag.type = Type.LineTag
        isLiteral = this.parseMarker(tag, SQ, Type.IsLiteral)
        this.next(this.matchSpaces())
        if (this.parseTagEnd(tag)) {
          this.parseChr(SP)
          const contents = new TreeBuilder(this.nodeSet, this.pos, Type.Contents)
          if (isLiteral) contents.add(this.parseLineLiteralText())
          else while (contents.add(this.parseLineText()) || this.parseTag(TagScope.Content, contents, tag)) {}
          tag.addContainer(contents)
          return this.finishTag(scope, container, tag, parentTag)
        }
      } else if (this.parseMarker(tag, HA, Type.IsMultiline)) {
        tag.type = Type.EndTag
        isLiteral = this.parseMarker(tag, SQ, Type.IsLiteral)
        this.next(this.matchSpaces())
        if (this.parseTagEnd(tag) && this.matchNewline(this.matchSpaces())) {
          this.indents[0]++
          const multilineAttributes = new TreeBuilder(this.nodeSet, this.pos, Type.MultilineAttributes)
          for (;;) {
            const indents = this.countNewlineIndents()
            if (indents.count !== this.indents[0]) break
            const start = this.pos
            this.next(indents.length)
            const result = this.parseTag(TagScope.MultilineAttribute, multilineAttributes, tag)
            if (!result) {
              this.pos = start
              break
            }
            if (result === ParseTagResult.Fail) {
              failed = true
              break
            }
            this.skipNewline = false
          }
          tag.addContainer(multilineAttributes)
          this.indents[0]--
          if (failed) return this.failTag(tag, container)
          const start = this.pos
          let indents = this.countNewlineIndents()
          const { length } = indents
          if (indents.count === this.indents[0]) {
            if (
              this.matchStr([HY, HY], length) &&
              ((indents = this.countNewlineIndents(length + 2)) || this.hasEnded(length + 2))
            ) {
              tag.add(TreeLeaf.createFrom(Type.ContentsMarker, this.pos + length, 2))
              this.next(length + 2 + indents.length)
            } else if (this.isChr(CO, length) && (this.isChr(SP, length + 1) || this.isLineEnd(length + 1))) {
              tag.type = Type.IndentTag
              tag.add(TreeLeaf.createFrom(Type.ContentsMarker, this.pos + length, 1))
              this.next(length + 1)
              this.parseChr(SP)
            }
            if (this.pos > start) {
              if (tag.type === Type.IndentTag) this.indents[0]++
              const contents = new TreeBuilder(this.nodeSet, this.pos, Type.Contents)
              if (isLiteral) {
                while (contents.add(this.parseLineLiteralText()) || this.parseMultilineDelimiter(contents)) {}
              } else {
                this.parseMultilineContents(contents, tag)
              }
              tag.addContainer(contents)
              if (tag.type === Type.IndentTag) this.indents[0]--
              return this.finishTag(scope, container, tag, parentTag)
            }
          }
          const result = this.finishTag(scope, container, tag, parentTag)
          indents = this.countNewlineIndents()
          if (indents.count !== this.indents[0]) return result
          const escape =
            this.matchStr([BS, CO], indents.length) || this.matchStr([BS, HY, HY], indents.length)
          if (escape) {
            this.next(indents.length + escape)
            const text = new TextBuilder(this.nodeSet, this.pos)
            text.add(TreeLeaf.createTo(Type.Escape, this.pos, escape))
            container.add(text)
            this.skipNewline = false
          }
          return result
        }
      }
    }
    return this.failTag(tag, container)
  }

  private parseMultilineDelimiter(builder: TreeBuilder): boolean {
    const newline = this.matchNewline()
    if (!newline) return false
    const indents = this.countIndents(newline)
    if (indents.count !== this.indents[0]) return false
    if (!this.skipNewline) {
      const text = new TextBuilder(this.nodeSet, this.pos)
      text.add(TreeLeaf.createFrom(Type.Other, this.pos, newline))
      builder.add(text)
    } else {
      const spaces = this.matchSpaces()
      const offset = newline + indents.length + spaces
      const newline2 = this.matchNewline(offset)
      if (this.hasEnded(offset) || newline2) {
        builder.add(TreeLeaf.createFrom(Type.Other, this.pos + newline + indents.length, 0))
      }
    }
    this.next(newline + indents.length)
    return true
  }

  private parseMultilineContents(contents: TreeBuilder, tag?: TagBuilder): void {
    // The order used to be:
    // 1. Contents loop parses a tag.
    // 2. At the end of a loop iteration set skipNewline to false.
    // 3. After parsing a tag, check if skipNewline should be set to true.
    // Now 3 is part of 1, thus skipNewline would always be false.
    let oldSkipNewline = this.skipNewline
    while (
      contents.add(this.parseLineText()) ||
      this.parseTag(TagScope.Content, contents, tag) ||
      this.parseMultilineDelimiter(contents)
    ) {
      if (this.skipNewline && oldSkipNewline) this.skipNewline = false
      oldSkipNewline = this.skipNewline
    }
    this.skipNewline = false
  }

  public finish(): Tree {
    const topContents = new TreeBuilder(this.nodeSet, this.pos, Type.TopContents)
    this.parseMultilineContents(topContents)
    return topContents.toTree()
  }
}
