import {
  Input,
  NodePropSource,
  NodeSet,
  NodeType,
  stringInput,
  Tree,
  TreeBuffer,
  TreeCursor,
} from "lezer-tree"

import { Content, isTagContent, Tag } from "./types"

// Needs to be exported, otherwise when using `Tree`, `NodeType` can only be inspected with `name`,
// making it string typed. Exporting the enum makes it more type safe and easier to refactor.
export enum Type {
  // Special
  None,
  TopContents,
  TagError,

  // Tags
  IndentTag,
  EndTag,
  LineTag,
  BraceTag,
  AtomTag,

  // Tag
  TagMarker,
  Flags,
  Name,
  InlineAttributes,
  BlockAttributes,
  ContentsMarker,
  Contents,

  // Text
  StopMarker,
  Escape,
  Other,
}

type NodeTypeLike = number | NodeType | Tree | TreeBuffer | TreeCursor

function toNodeTypeId(arg: NodeTypeLike): number {
  return typeof arg === "number" ? arg : (arg instanceof NodeType ? arg : arg.type).id
}

export function isMultilineTagNode(arg: NodeTypeLike): boolean {
  return [Type.IndentTag, Type.EndTag].includes(toNodeTypeId(arg))
}

export function isTagNode(arg: NodeTypeLike): boolean {
  const id = toNodeTypeId(arg)
  return id in Type && Type[id].endsWith("Tag")
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

  parse(input: Input | string, startPos = 0): Tree {
    if (typeof input === "string") input = stringInput(input)
    let parse = new Parse(this, input, startPos)
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
  readonly children: (Tree | TreeBuffer)[] = []
  readonly positions: number[] = []

  constructor(readonly nodeSet: NodeSet, readonly from: number, public type: number = Type.None) {}

  private get rangeLength(): number {
    const lastIndex = this.positions.length - 1
    return lastIndex >= 0 ? this.positions[lastIndex] + this.children[lastIndex].length : 0
  }

  get to(): number {
    return this.from + this.rangeLength
  }

  get length(): number {
    return this.children.length
  }

  // Return a boolean for convenience: builder.add(...) || ...
  add(child: TreeBuilder | Tree | TreeBuffer | TreeLeaf | null, from?: number): boolean {
    // Convenience to allow: const result = ...; if (result !== null) builder.add(result)
    // to become: builder.add(...)
    if (child === null) return false
    if (child instanceof TreeBuilder) {
      const offset = child.from - this.from
      this.children.push(...child.children)
      this.positions.push(...child.positions.map(position => position + offset))
    } else if (child instanceof TreeLeaf) {
      const { type, to, from } = child
      this.children.push(new Tree(this.nodeSet.types[type], [], [], to - from))
      this.positions.push(from - this.from)
    } else {
      this.children.push(child)
      this.positions.push(from !== undefined ? from - this.from : this.rangeLength)
    }
    return true
  }

  toTree(length?: number): Tree {
    return new Tree(
      this.nodeSet.types[this.type],
      this.children,
      this.positions,
      length !== undefined ? length : this.rangeLength,
    )
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
      buffer,
      nodeSet: this.nodeSet,
      reused: this.children,
    })
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
  BlockAttribute,
  Content,
}

enum ParseTagResult {
  None,
  Fail,
  Finish,
}

class Parse {
  readonly nodeSet: NodeSet
  pos: number
  indents: number[]
  skipNewline = false

  constructor(parser: TagdownParser, readonly input: Input, start: number) {
    this.nodeSet = parser.nodeSet
    this.pos = start
    this.indents = [0]
  }

  private createTreeBuilder(type: Type): TreeBuilder {
    return new TreeBuilder(this.nodeSet, this.pos, type)
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
    return this.input.get(this.pos + offset)
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
    return builder.length ? builder : null
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
    return builder.length ? builder : null
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
    return builder.length ? builder : null
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
    return builder.length ? builder : null
  }

  private parseLineLiteralText(): TextBuilder | null {
    const start = this.pos
    while (!this.isLineEnd()) this.next()
    return this.sliceLineEnd(start)
  }

  private parseTagEnd(tagBuilder: TreeBuilder): boolean {
    const cond = this.isChr(RB)
    if (cond) {
      tagBuilder.add(TreeLeaf.createFrom(Type.TagMarker, this.pos, 1))
      this.next()
    }
    return cond
  }

  private addTagInnerBuilder(tagBuilder: TreeBuilder, innerBuilder: TreeBuilder): void {
    if (innerBuilder.length || innerBuilder.type === Type.Contents) {
      tagBuilder.add(innerBuilder.toTree(), innerBuilder.from)
    }
  }

  private finishTag(
    tag: TreeBuilder,
    parentScope: TagScope,
    parentBuilder: TreeBuilder,
    parentTag?: TreeBuilder,
  ): ParseTagResult.Finish {
    parentBuilder.add(tag.toTree(this.pos - tag.from), tag.from)
    if (tag.type <= Type.LineTag && parentScope === TagScope.Content) {
      if (parentTag && parentTag.type === Type.BraceTag) this.next(this.matchNewline())
      else this.skipNewline = true
    }
    return ParseTagResult.Finish
  }

  private failTag(tagBuilder: TreeBuilder, parentBuilder: TreeBuilder): ParseTagResult.Fail {
    const tagTree = tagBuilder.toTree(this.pos - tagBuilder.from)
    parentBuilder.add(
      new Tree(this.nodeSet.types[Type.TagError], [tagTree], [0], tagTree.length),
      tagBuilder.from,
    )
    return ParseTagResult.Fail
  }

  private parseTag(
    parentScope: TagScope,
    parentBuilder: TreeBuilder,
    parentTag?: TreeBuilder,
  ): ParseTagResult {
    if (!this.isChr(LB)) return ParseTagResult.None
    const tag = this.createTreeBuilder(Type.AtomTag)
    tag.add(TreeLeaf.createFrom(Type.TagMarker, this.pos, 1))
    this.next()
    this.next(this.matchSpaces())
    let start = this.pos
    this.parseChr(SQ)
    this.parseChr(AT)
    if (this.pos > start) {
      tag.add(TreeLeaf.createRange(Type.Flags, start, this.pos))
    }
    start = this.pos
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
    if (this.pos === start) return ParseTagResult.None
    tag.add(TreeLeaf.createRange(Type.Name, start, this.pos))
    this.next(this.matchSpaces())
    const inlineAttributes = this.createTreeBuilder(Type.InlineAttributes)
    let failed = false
    for (;;) {
      const result = this.parseTag(TagScope.InlineAttribute, inlineAttributes, tag)
      if (!result) break
      if (result === ParseTagResult.Finish) continue
      failed = true
      break
    }
    this.addTagInnerBuilder(tag, inlineAttributes)
    if (failed) return this.failTag(tag, parentBuilder)
    let isLiteral = false
    if (this.parseTagEnd(tag)) return this.finishTag(tag, parentScope, parentBuilder, parentTag)
    const contents = this.createTreeBuilder(Type.Contents)
    if (this.parseChr(CO)) {
      tag.type = Type.BraceTag
      tag.add(TreeLeaf.createTo(Type.ContentsMarker, this.pos, 1))
      if (this.parseChr(SQ)) {
        isLiteral = true
        tag.add(TreeLeaf.createTo(Type.Flags, this.pos, 1))
      }
      this.parseChr(SP)
      this.indents.unshift(0)
      if (isLiteral) contents.add(this.parseBraceLiteralText())
      else while (contents.add(this.parseBraceText()) || this.parseTag(TagScope.Content, contents, tag)) {}
      this.addTagInnerBuilder(tag, contents)
      this.indents.shift()
      if (this.parseTagEnd(tag)) return this.finishTag(tag, parentScope, parentBuilder, parentTag)
      else return this.failTag(tag, parentBuilder)
    } else if (
      this.parseChr(EQ) &&
      (parentScope === TagScope.Content || parentScope === TagScope.BlockAttribute)
    ) {
      const start = this.pos - 1
      if (this.parseChr(SQ)) isLiteral = true
      tag.add(TreeLeaf.createRange(Type.Flags, start, this.pos))
      this.next(this.matchSpaces())
      if (this.parseTagEnd(tag)) {
        const spaces = this.matchSpaces()
        if (this.matchNewline(spaces)) {
          tag.type = Type.EndTag
          this.indents[0]++
          const blockAttributes = this.createTreeBuilder(Type.BlockAttributes)
          for (;;) {
            const indents = this.countNewlineIndents()
            if (indents.count === this.indents[0]) {
              const start = this.pos
              this.next(indents.length)
              const result = this.parseTag(TagScope.BlockAttribute, blockAttributes, tag)
              if (!result) {
                this.pos = start
                break
              }
              if (result === ParseTagResult.Finish) {
                this.skipNewline = false
                continue
              }
              failed = true
            }
            break
          }
          this.addTagInnerBuilder(tag, blockAttributes)
          if (failed) return this.failTag(tag, parentBuilder)
          let isMultiline = !!blockAttributes.length
          this.indents[0]--
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
              isMultiline = true
              if (tag.type === Type.IndentTag) this.indents[0]++
              if (isLiteral) {
                while (contents.add(this.parseLineLiteralText()) || this.parseMultilineDelimiter(contents)) {}
              } else this.parseMultilineContents(contents, tag)
              this.addTagInnerBuilder(tag, contents)
              if (tag.type === Type.IndentTag) {
                this.indents[0]--
              }
              return this.finishTag(tag, parentScope, parentBuilder, parentTag)
            }
          }
          if (isMultiline) {
            const result = this.finishTag(tag, parentScope, parentBuilder, parentTag)
            const indents = this.countNewlineIndents()
            if (indents.count === this.indents[0]) {
              const escape =
                this.matchStr([BS, CO], indents.length) || this.matchStr([BS, HY, HY], indents.length)
              if (escape) {
                this.next(indents.length + escape)
                const text = new TextBuilder(this.nodeSet, this.pos)
                text.add(TreeLeaf.createTo(Type.Escape, this.pos, escape))
                parentBuilder.add(text)
                this.skipNewline = false
              }
            }
            return result
          }
          tag.type = Type.LineTag
          this.parseChr(SP)
          this.addTagInnerBuilder(tag, new TreeBuilder(this.nodeSet, this.pos, Type.Contents))
          this.next(this.matchSpaces())
          return this.finishTag(tag, parentScope, parentBuilder, parentTag)
        } else {
          this.parseChr(SP)
          tag.type = Type.LineTag
          if (isLiteral) contents.add(this.parseLineLiteralText())
          else while (contents.add(this.parseLineText()) || this.parseTag(TagScope.Content, contents, tag)) {}
          this.addTagInnerBuilder(tag, contents)
          return this.finishTag(tag, parentScope, parentBuilder, parentTag)
        }
      }
    }
    return this.failTag(tag, parentBuilder)
  }

  private parseMultilineContents(contents: TreeBuilder, tag?: TreeBuilder): void {
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

  public finish(): Tree {
    const topContents = new TreeBuilder(this.nodeSet, 0, Type.TopContents)
    this.parseMultilineContents(topContents)
    return topContents.toTree()
  }
}

// AST

function sliceType(cursor: TreeCursor, input: Input, type: number): string | null {
  if (cursor.type.id === type) {
    const s = input.read(cursor.from, cursor.to)
    cursor.nextSibling()
    return s
  }
  return null
}

function sliceFlags(cursor: TreeCursor, input: Input): number[] {
  const s = sliceType(cursor, input, Type.Flags)
  return s !== null ? s.split("").map(c => c.charCodeAt(0)) : []
}

function traverseTag(cursor: TreeCursor, input: Input, isAttribute = false): Tag {
  const tagType = cursor.type.id
  cursor.firstChild()
  cursor.nextSibling()
  const tagFlags = sliceFlags(cursor, input)
  const isQuoted = tagFlags.includes(SQ)
  isAttribute = isAttribute || tagFlags.includes(AT)
  const name = sliceType(cursor, input, Type.Name)!
  const attributes: Tag[] = []
  if (cursor.type.id === Type.InlineAttributes) {
    attributes.push(...traverseAttributes(cursor, input))
  }
  let isLiteral = false
  if (tagType === Type.EndTag || tagType === Type.IndentTag || tagType === Type.LineTag) {
    const contentFlags = sliceFlags(cursor, input)
    if (contentFlags.includes(SQ)) isLiteral = true
    cursor.nextSibling()
  }
  if (tagType === Type.EndTag || tagType === Type.IndentTag) {
    if (cursor.type.id === Type.BlockAttributes) {
      attributes.push(...traverseAttributes(cursor, input))
    }
    if (cursor.type.id === Type.ContentsMarker) {
      cursor.nextSibling()
    }
  } else if (tagType === Type.BraceTag) {
    cursor.nextSibling()
    const contentFlags = sliceFlags(cursor, input)
    if (contentFlags.includes(SQ)) isLiteral = true
  }
  let contents: Content[]
  if (cursor.type.id === Type.Contents) {
    contents = traverseContents(cursor, input)
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

function traverseAttributes(cursor: TreeCursor, input: Input): Tag[] {
  const attributes: Tag[] = []
  cursor.firstChild()
  while (isTagNode(cursor)) {
    attributes.push(traverseTag(cursor, input, true))
    if (!cursor.nextSibling()) break
  }
  cursor.parent()
  cursor.nextSibling()
  return attributes
}

function traverseContents(cursor: TreeCursor, input: Input): Content[] {
  if (!cursor.firstChild()) return []
  const contents: Content[] = []
  let text: string | null = null
  do {
    const { type, from, to } = cursor
    if (type.id === Type.Other || type.id === Type.TagError) {
      text = (text || "") + input.read(from, to)
    } else if (type.id === Type.Escape) {
      text = (text || "") + input.read(from + +(input.get(from) === BS), to)
    } else if (type.id === Type.StopMarker) {
      text = text || ""
    } else if (isTagNode(type)) {
      if (text !== null) {
        contents.push(text)
        text = null
      }
      contents.push(traverseTag(cursor, input))
    }
  } while (cursor.nextSibling())
  if (text !== null) contents.push(text)
  cursor.parent()
  return contents
}

export function parseTreeToContents(tree: Tree, input: Input | string): Content[] {
  if (typeof input === "string") input = stringInput(input)
  const cursor = tree.cursor()
  return traverseContents(cursor, input)
}

export function parseContents(input: string): Content[] {
  return parseTreeToContents(parser.parse(input), input)
}

export function parseTag(input: string): Tag | undefined {
  const contents = parseContents(input)
  if (contents.length === 1 && isTagContent(contents[0])) return contents[0]
  return
}
