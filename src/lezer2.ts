import {
  NodeProp,
  NodePropSource,
  NodeSet,
  NodeType,
  ParseContext,
  PartialParse,
  Tree,
  TreeBuffer,
  TreeCursor,
} from "lezer-tree"
import { log } from "./utils/log"

import { Content, Tag } from "./types"
import { assert } from "./utils"

// TODO: Reuse tree fragments for the reuse kind of incremental parsing.
// TODO: We can now let the printer keep the layout as is, as this information is now available in the CST.
// TODO: Empty lines.
// TODO: Interaction between brace and indent layouts.

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
const _a = 97
const _z = 122
const _A = 65
const _Z = 90
const _0 = 48
const _9 = 57

enum Type {
  None,
  TopContents,
  TagError,
  IndentTag,
  EndTag,
  LineTag,
  BraceTag,
  AtomTag,
  Name,
  TagMarker,
  ContentsMarker,
  Flags,
  StopMarker,
  Escape,
  Other,
}

const nodeTypes = [NodeType.none]
for (let i = 1, name: string; (name = Type[i]); i++) {
  nodeTypes[i] = NodeType.define({
    id: i,
    name,
    props: name.endsWith("Tag") ? [[NodeProp.group, ["Tag"]]] : [],
    top: i === Type.TopContents,
    error: i === Type.TagError,
  })
}

export class TagdownParser {
  constructor(readonly nodeSet: NodeSet) {}

  parse(input: string, startPos = 0, parseContext: ParseContext = {}): Tree {
    let parse = parser.startParse(input, startPos, parseContext)
    let result: Tree | null
    while (!(result = parse.advance())) {}
    return result
  }

  startParse(input: string, startPos = 0, parseContext: ParseContext = {}): PartialParse {
    return new Parse(this, input, startPos, parseContext)
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

// class ContentsContext {
//   constructor(
//     readonly from: number,
//     readonly end: number,
//     readonly children: (Tree | TreeBuffer)[],
//     readonly positions: number[],
//   ) {}

//   toTree(nodeSet: NodeSet, end = this.end) {
//     let last = this.children.length - 1
//     if (last >= 0) end = Math.max(end, this.positions[last] + this.children[last].length + this.from)
//     return new Tree(nodeSet.types[Type.Contents], this.children, this.positions, end - this.from).balance(
//       2048,
//     )
//   }

//   copy() {
//     return new ContentsContext(this.from, this.end, this.children.slice(), this.positions.slice())
//   }
// }

// class FragmentCursor {
//   constructor(readonly fragments: readonly TreeFragment[], readonly input: Input) {}
// }

// class State {
//   constructor(readonly input: string, readonly tree: Tree, readonly fragments: readonly TreeFragment[]) {}

//   static start(input: string) {
//     const tree = parser.parse(input)
//     return new State(input, tree, TreeFragment.addTree(tree))
//   }

//   update(changes: { from: number; to?: number; insert?: string }[]) {
//     const changed: ChangedRange[] = []
//     let input = this.input
//     let off = 0
//     for (const { from, to = from, insert = "" } of changes) {
//       input = input.slice(0, from) + insert + input.slice(to)
//       changed.push({ fromA: from - off, toA: to - off, fromB: from, toB: from + insert.length })
//       off += insert.length - (to - from)
//     }
//     const fragments = TreeFragment.applyChanges(this.fragments, changed, 2)
//     const tree = parser.parse(input, 0, { fragments })
//     return new State(input, tree, TreeFragment.addTree(tree))
//   }
// }

class Leaf {
  constructor(readonly type: number, readonly from: number, readonly to: number) {
    if (to <= from) {
      this.from = from - to
      this.to = from
    }
  }

  get length(): number {
    return this.to - this.from
  }
}

class TreeBuilder {
  readonly children: (Leaf | Tree | TreeBuffer)[] = []
  readonly positions: number[] = []

  constructor(readonly from: number, public type = 0) {}

  isEmpty(): boolean {
    return this.children.length === 0
  }

  private get length(): number {
    const lastIndex = this.positions.length - 1
    return lastIndex >= 0 ? this.positions[lastIndex] + this.children[lastIndex].length : 0
  }

  add(child: Leaf | Tree | TreeBuffer | TreeBuilder | null, from?: number): void {
    if (child === null) return
    if (child instanceof TreeBuilder) {
      const offset = child.from - this.from
      this.children.push(...child.children)
      this.positions.push(...child.positions.map(pos => pos + offset))
    } else {
      let position: number
      if (child instanceof Leaf) {
        position = child.from - this.from
      } else {
        position = from !== undefined ? from - this.from : this.length
      }
      this.children.push(child)
      this.positions.push(position)
    }
  }

  toTree(nodeSet: NodeSet, length?: number) {
    const children = this.children.map(child => {
      if (child instanceof Leaf) {
        const { type, from, to } = child
        return new Tree(nodeSet.types[type], [], [], to - from)
      }
      return child
    })
    return new Tree(nodeSet.types[this.type], children, this.positions, length || this.length)
  }
}

enum Scope {
  Start,
  InlineAttr,
  BlockAttr,
  Content,
}

class TagBuilder extends TreeBuilder {
  next = Scope.Start

  isLiteral: boolean = false

  constructor(readonly from: number, readonly scope: Scope) {
    super(from, Type.AtomTag)
  }

  toTree(nodeSet: NodeSet, to?: number): Tree {
    return to !== undefined ? super.toTree(nodeSet, to - this.from) : super.toTree(nodeSet)
  }

  getName(input: string): string {
    const i = this.children.findIndex(child =>
      child instanceof Leaf ? child.type === Type.Name : child.type.id === Type.Name,
    )!
    const child = this.children[i]
    if (child instanceof Leaf) {
      return input.slice(child.from, child.to)
    } else {
      const position = this.positions[i]
      return input.slice(this.from + position, this.from + position + child.length)
    }
  }
}

class Parse implements PartialParse {
  readonly nodeSet: NodeSet
  pos: number
  topContents: TagBuilder
  tags: TagBuilder[]

  indentLevel: number

  constructor(
    parser: TagdownParser,
    readonly input: string,
    startPos: number,
    readonly parseContext: ParseContext,
  ) {
    this.nodeSet = parser.nodeSet
    this.pos = startPos
    this.topContents = new TagBuilder(0, Scope.Content)
    this.topContents.type = Type.TopContents
    this.topContents.isLiteral = false
    this.tags = []

    this.indentLevel = 0
    // this.fragments = parseContext.fragments ? new FragmentCursor(parseContext.fragments, input) : null
  }

  private next(count = 1): void {
    this.pos += count
  }

  private backtrack(pos: number): void {
    this.pos = pos
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

  private isStr(s: number[], offset = 0): boolean {
    if (!this.hasNext(offset + s.length)) return false
    for (let i = 0; i < s.length; i++) if (s[i] !== this.peek(offset + i)) return false
    return true
  }

  private isOneOf(chrs: number[], offset = 0): boolean {
    return this.hasNext(offset) && chrs.includes(this.peek(offset))
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

  private isWhitespace(offset = 0): boolean {
    return this.isOneOf([SP, HT, LF, CR], offset)
  }

  private isNewline(offset = 0): boolean {
    return this.peek(offset) === LF || this.isStr([CR, LF], offset)
  }

  private isSpacesNewline(offset = 0): boolean {
    let i = offset
    while (this.isSpaces(i)) i++
    return this.isNewline(i)
  }

  private isLineEnd(offset = 0): boolean {
    return this.hasEnded(offset) || this.isNewline(offset)
  }

  private esacpedOneOf(chrs: number[], offset = 0): boolean {
    return this.isChr(BS, offset) && (this.isChr(BS, offset + 1) || this.isOneOf(chrs, offset + 1))
  }

  private consumeWhitespace(): void {
    while (this.isWhitespace()) this.next()
  }

  private matchChr(c: number): boolean {
    const cond = this.isChr(c)
    if (cond) this.next()
    return cond
  }

  private matchStr(s: number[]): boolean {
    const cond = this.isStr(s)
    if (cond) this.next(s.length)
    return cond
  }

  private matchNewline(): boolean {
    return this.matchChr(LF) || this.matchStr([CR, LF])
  }

  private matchIndent(level: number): boolean {
    const start = this.pos
    const cond = this.parseIndent(level) === level
    if (!cond) this.backtrack(start)
    return cond
  }

  private matchNewlineIndent(level: number): boolean {
    const start = this.pos
    const cond = this.matchNewline() && this.parseIndent(level) === level
    if (!cond) this.backtrack(start)
    return cond
  }

  private slice(from: number, length = this.pos - from): Leaf | null {
    return length > 0 ? new Leaf(Type.Other, from, from + length) : null
  }

  private sliceLineEnd(start: number): TreeBuilder | null {
    const builder = new TreeBuilder(this.pos)
    const end = this.pos
    this.pos = start
    let length = end - start
    while (length > 0 && this.isSpaces(length - 1)) length--
    if (length >= 2 && this.isStr([BS, DO], length - 2)) {
      builder.add(new Leaf(Type.Escape, this.pos + length, 2))
      length -= 2
    } else if (length >= 1 && this.isChr(DO, length - 1)) {
      builder.add(new Leaf(Type.StopMarker, this.pos + length, 1))
      length -= 1
    }
    this.pos = end
    builder.add(this.slice(start, length))
    return !builder.isEmpty() ? builder : null
  }

  private parseIndent(maxLevel: number): number {
    let level = 0
    while (level < maxLevel && (this.matchStr([SP, SP]) || this.matchChr(HT))) level++
    return level
  }

  private matchTagEnd(tag): boolean {
    const cond = this.matchChr(RB)
    if (cond) tag.add(new Leaf(Type.TagMarker, this.pos, 1))
    return cond
  }

  private parseBraceText(): TreeBuilder | null {
    const builder = new TreeBuilder(this.pos)
    let start = this.pos
    while (this.hasNext() && !this.isOneOf([LB, RB])) {
      if (this.isNewline()) {
        builder.add(this.sliceLineEnd(start))
        start = this.pos
        this.matchNewline()
        continue
      }
      if (this.esacpedOneOf([LB, RB])) {
        builder.add(this.slice(start))
        builder.add(new Leaf(Type.Escape, this.pos, this.pos + 2))
        this.next(2)
        start = this.pos
      } else {
        this.next()
      }
    }
    if (this.pos !== start) {
      builder.add(this.slice(start))
    }
    return !builder.isEmpty() ? builder : null
  }

  private parseBraceLiteralText(): TreeBuilder | null {
    const builder = new TreeBuilder(this.pos)
    let start = this.pos
    let unbalanced = 0
    while (this.hasNext() && !(this.isChr(RB) && unbalanced === 0)) {
      if (this.isNewline()) {
        builder.add(this.sliceLineEnd(start))
        start = this.pos
        this.matchNewline()
        continue
      }
      if (this.isChr(LB)) unbalanced++
      else if (this.isChr(RB)) unbalanced--
      this.next()
    }
    if (this.pos !== start) {
      builder.add(this.slice(start))
    }
    return !builder.isEmpty() ? builder : null
  }

  private parseLineText(): TreeBuilder | null {
    const builder = new TreeBuilder(this.pos)
    let start = this.pos
    while (this.hasNext() && !(this.isChr(LB) || this.isNewline())) {
      if (this.esacpedOneOf([LB, RB])) {
        builder.add(this.slice(start))
        builder.add(new Leaf(Type.Escape, this.pos, this.pos + 2))
        this.next(2)
        start = this.pos
      } else {
        this.next()
      }
    }
    if (this.pos !== start) {
      builder.add(this.isLineEnd() ? this.sliceLineEnd(start) : this.slice(start))
    }
    return !builder.isEmpty() ? builder : null
  }

  private parseLineLiteralText(): TreeBuilder | null {
    const start = this.pos
    while (!this.isLineEnd()) this.next()
    return this.sliceLineEnd(start)
  }

  private parseTagStart(scope: Scope): TagBuilder | null {
    if (!this.matchChr(LB)) return null
    const tag = new TagBuilder(this.pos - 1, scope)
    tag.add(new Leaf(Type.TagMarker, this.pos, 1))
    this.consumeWhitespace()
    let start = this.pos
    this.matchChr(SQ)
    this.matchChr(AT)
    if (this.pos !== start) {
      tag.add(new Leaf(Type.Flags, start, this.pos))
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
    if (this.pos !== start) {
      tag.add(new Leaf(Type.Name, start, this.pos))
      this.consumeWhitespace()
      tag.next = Scope.InlineAttr
    }
    return tag
  }

  private failTag(): void {
    const tag = this.tags.shift()!
    const tagTree = tag.toTree(this.nodeSet, this.pos)
    this.getBuilder().add(new Tree(this.nodeSet.types[Type.TagError], [tagTree], [0], tagTree.length))
    // FIXME
    // const builder = this.getBuilder()
    // builder.add(tag.fail())
    // if ((scope === Scope.InlineAttr || scope === Scope.BlockAttr) && builder instanceof TagBuilder) {
    //   this.failTag()
    // }
  }

  private endBlockAttrScope(tag: TagBuilder): void {
    this.indentLevel--
    const start = this.pos
    if (this.matchNewlineIndent(this.indentLevel)) {
      const contentsMarkerPos = this.pos
      if (this.isStr([HY, HY]) && this.isLineEnd(2)) {
        this.next(2)
        tag.add(new Leaf(Type.ContentsMarker, contentsMarkerPos, this.pos))
        this.hasEnded() || this.matchNewlineIndent(this.indentLevel) || this.matchNewline()
      } else if (this.isChr(CO) && (this.isChr(SP, 1) || this.isLineEnd(1))) {
        tag.type = Type.IndentTag
        this.next()
        tag.add(new Leaf(Type.ContentsMarker, contentsMarkerPos, this.pos))
        this.matchChr(SP)
      } else this.backtrack(start)
      if (this.pos !== start) {
        if (tag.type === Type.IndentTag) this.indentLevel++
        tag.next = Scope.Content
      }
    }
  }

  private endTag(): void {
    const tag = this.tags.shift()!
    const builder = this.getBuilder()
    builder.add(tag.toTree(this.nodeSet, this.pos), tag.from)
    if (tag.next === Scope.BlockAttr) {
      this.endBlockAttrScope(tag)
    }
  }

  private finishTag(viaDedent: boolean = false): void {
    const tag = this.tags.shift()!
    const builder = this.getBuilder()
    builder.add(tag.toTree(this.nodeSet, this.pos), tag.from)
    // FIXME: This is a bug, matchNewline should only be called once for multiple dedents at the same time.
    // log(
    //   "finish tag called",
    //   tag.getName(this.input),
    //   this.input.slice(this.pos),
    //   viaDedent,
    //   Type[tag.type],
    //   Scope[tag.scope],
    // )
    if (!viaDedent) {
      if (tag.scope === Scope.Content && tag.type <= Type.LineTag && this.matchNewline()) {
        const indentLevel = this.parseIndent(this.indentLevel)
        // log("finish tag", this.indentLevel, indentLevel, this.input.slice(this.pos))
        while (this.indentLevel > indentLevel) {
          log("finish loop", this.indentLevel, indentLevel)
          // if (this.tags.length > 0 && this.tags[0].scope !== Scope.Content) break
          this.endTag()
          this.indentLevel--
        }
      }
      // if (tag.scope === Scope.Content && tag.type <= Type.LineTag && this.matchNewline()) {
      //   const indentLevel = this.parseIndent(this.indentLevel)
      //   // log("finish tag", this.indentLevel, indentLevel, this.input.slice(this.pos))
      //   while (this.indentLevel > indentLevel) {
      //     log("finish loop", this.indentLevel, indentLevel)
      //     // if (this.tags.length > 0 && this.tags[0].scope !== Scope.Content) break
      //     this.finishTag(true)
      //     this.indentLevel--
      //   }
      // } else
      // if (tag.scope === Scope.BlockAttr && tag.type === Type.IndentTag) {
      // const prevIndentLevel = this.indentLevel
      if (tag.type === Type.IndentTag) {
        this.indentLevel--
        // const newlinePos = this.pos
        // if (tag.type <= Type.LineTag && this.matchNewline()) {
        //   const indentLevel = this.parseIndent(this.indentLevel)
        //   // log(this.indentLevel - indentLevel)
        //   if (this.indentLevel !== indentLevel) this.backtrack(newlinePos)
        // }
      }
      // log(this.indentLevel)
    }
  }

  private advanceText(contents: TreeBuilder, text: Leaf | TreeBuilder | null): boolean {
    if (text) {
      contents.add(text)
    }
    return text !== null
  }

  private advanceTag(scope: Scope): boolean {
    const tag = this.parseTagStart(scope)
    if (!tag) return false
    this.tags.unshift(tag)
    if (tag.next === Scope.Start) {
      this.failTag()
    }
    return true
  }

  private advanceContents(contents: TagBuilder): boolean {
    if (contents.type === Type.BraceTag || contents.type === Type.LineTag) {
      return (
        this.advanceText(
          contents,
          contents.type === Type.BraceTag
            ? contents.isLiteral
              ? this.parseBraceLiteralText()
              : this.parseBraceText()
            : contents.isLiteral
            ? this.parseLineLiteralText()
            : this.parseLineText(),
        ) || this.advanceTag(Scope.Content)
      )
    } else if (
      contents.type === Type.EndTag ||
      contents.type === Type.IndentTag ||
      contents.type === Type.TopContents
    ) {
      if (
        !this.advanceText(
          contents,
          contents.isLiteral ? this.parseLineLiteralText() : this.parseLineText(),
        ) &&
        !this.advanceTag(Scope.Content)
      ) {
        // log(this.pos, this.input.slice(this.pos))
        const newlinePos = this.pos
        if (this.matchNewline()) {
          const newline = new Leaf(Type.Other, newlinePos, this.pos)
          const indentLevel = this.parseIndent(this.indentLevel)
          // log("line delim", this.indentLevel, indentLevel, this.input.slice(this.pos))
          if (this.indentLevel === indentLevel) {
            contents.add(newline)
          } else {
            // FIXME
            // if (this.indentLevel - indentLevel > 1) this.backtrack(newlinePos)
            // log(this.indentLevel - indentLevel)
            this.backtrack(newlinePos)
            return false
          }
          return true
        }
        return false
      }
      return true
    }
    return false
  }

  private getBuilder(): TagBuilder {
    return this.tags.length > 0 ? this.tags[0] : this.topContents
  }

  advance(): Tree | null {
    if (this.tags.length > 0) {
      const tag = this.tags[0]
      if (tag.next === Scope.InlineAttr) {
        if (!this.advanceTag(Scope.InlineAttr)) {
          this.consumeWhitespace()
          if (this.matchTagEnd(tag)) {
            this.finishTag()
          } else if (this.matchChr(CO)) {
            tag.type = Type.BraceTag
            tag.add(new Leaf(Type.ContentsMarker, this.pos, 1))
            if (this.matchChr(SQ)) {
              tag.isLiteral = true
              tag.add(new Leaf(Type.Flags, this.pos, 1))
            }
            this.matchChr(SP)
            tag.next = Scope.Content
          } else if (this.matchChr(EQ) && (tag.scope === Scope.Content || tag.scope === Scope.BlockAttr)) {
            if (this.matchChr(SQ)) {
              tag.isLiteral = true
              tag.add(new Leaf(Type.Flags, this.pos, 1))
            }
            this.consumeWhitespace()
            if (this.matchTagEnd(tag)) {
              if (this.isSpacesNewline()) {
                tag.type = Type.EndTag
                tag.next = Scope.BlockAttr
                this.indentLevel++
              } else {
                this.matchChr(SP)
                tag.type = Type.LineTag
                tag.next = Scope.Content
              }
            } else this.failTag()
          } else this.failTag()
        }
      } else if (tag.next === Scope.BlockAttr) {
        if (!(this.matchNewlineIndent(this.indentLevel) && this.advanceTag(Scope.BlockAttr))) {
          // log("end block attr", Type[tag.type], this.pos, this.input.slice(this.pos), this.indentLevel)
          this.endBlockAttrScope(tag)
          // @ts-ignore
          if (tag.next !== Scope.Content) this.finishTag()
        }
      } else if (tag.next === Scope.Content) {
        if (!this.advanceContents(tag)) {
          // log(Type[tag.type])
          if (tag.type === Type.BraceTag) {
            if (this.matchTagEnd(tag)) this.finishTag()
            else this.failTag()
          } else {
            // if (tag.type === Type.LineTag && this.isNewline() && tag.scope === Scope.Content) {
            //   const builder = this.getBuilder()
            //   // if (builder.type <= Type.LineTag) {
            //   //   this.matchNewlineIndent(this.indentLevel)
            //   // }
            //   if (builder.type === Type.BraceTag) {
            //     // FIXME: skip new line
            //     this.matchNewline()
            //   }
            // }
            this.finishTag()
          }
        }
      }
    } else if (!this.advanceContents(this.topContents)) {
      // log(this.pos, this.input.slice(this.pos))
      // assert(this.hasEnded(), "expected end of input")
      if (!this.hasEnded()) {
        log("ERROR expected end of input", this.input.slice(this.pos))
      }
      return this.topContents.toTree(this.nodeSet)
    }
    return null
  }

  // private reuseFragment(startPos: number): boolean {
  //   if (!this.fragments) return false
  // }

  forceFinish(): Tree {
    while (this.tags.length > 0) {
      this.failTag()
    }
    return this.topContents.toTree(this.nodeSet)
  }
}

function sliceType(cursor: TreeCursor, input: string, type: number): string | null {
  if (cursor.type.id === type) {
    const s = input.slice(cursor.from, cursor.to)
    cursor.nextSibling()
    return s
  }
  return null
}

function sliceFlags(cursor: TreeCursor, input: string): number[] {
  const s = sliceType(cursor, input, Type.Flags)
  return s !== null ? s.split("").map(c => c.charCodeAt(0)) : []
}

function traverseTag(cursor: TreeCursor, input: string): Tag {
  const tagTypeId = cursor.type.id
  cursor.firstChild()
  cursor.nextSibling()
  const tagFlags = sliceFlags(cursor, input)
  const isQuoted = tagFlags.includes(SQ)
  const isAttribute = tagFlags.includes(AT)
  const name = sliceType(cursor, input, Type.Name)!
  const attributes: Tag[] = []
  while (cursor.type.is("Tag")) {
    attributes.push(traverseTag(cursor, input))
    if (!cursor.nextSibling()) break
  }
  let isLiteral = false
  let hasContents = false
  if (tagTypeId === Type.EndTag || tagTypeId === Type.IndentTag || tagTypeId === Type.LineTag) {
    const contentFlags = sliceFlags(cursor, input)
    if (contentFlags.includes(SQ)) isLiteral = true
    cursor.nextSibling()
  }
  if (tagTypeId === Type.EndTag || tagTypeId === Type.IndentTag) {
    while (cursor.type.is("Tag")) {
      attributes.push(traverseTag(cursor, input))
      if (!cursor.nextSibling()) break
    }
    if (cursor.type.id === Type.ContentsMarker) {
      hasContents = true
      cursor.nextSibling()
    }
  } else if (tagTypeId === Type.LineTag) hasContents = true
  else if (tagTypeId === Type.BraceTag) {
    cursor.nextSibling()
    const contentFlags = sliceFlags(cursor, input)
    if (contentFlags.includes(SQ)) isLiteral = true
    hasContents = true
  }
  let contents: Content[]
  if (hasContents) {
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

function traverseContents(cursor: TreeCursor, input: string): Content[] {
  const contents: Content[] = []
  let text: string | null = null
  do {
    const { type, from, to } = cursor
    if (type.id === Type.Other || type.id === Type.TagError) {
      text = (text || "") + input.slice(from, to)
    } else if (type.id === Type.Escape) {
      text = (text || "") + input.slice(from + +(input.charCodeAt(from) === BS), to)
    } else if (type.id === Type.StopMarker) {
      text = text || ""
    } else if (type.is("Tag")) {
      if (text !== null) {
        contents.push(text)
        text = null
      }
      contents.push(traverseTag(cursor, input))
    }
  } while (cursor.nextSibling())
  if (text !== null) contents.push(text)
  return contents
}

export function treeToContents(tree: Tree, input: string): Content[] {
  const cursor = tree.cursor()
  return cursor.firstChild() ? traverseContents(cursor, input) : []
}

export function parseContents(input: string): Content[] {
  return treeToContents(parser.parse(input), input)
}
