import {
  Input,
  NodeProp,
  NodePropSource,
  NodeSet,
  NodeType,
  ParseContext,
  PartialParse,
  stringInput,
  Tree,
  TreeBuffer,
  TreeCursor,
} from "lezer-tree"
import { log } from "../test/log"
import { Content, isTextContent, Tag } from "./types"
import { assert } from "./utils"

// TODO: On fail the consumed whitespace should not be lost.
// FIXME: On fail attribute, it should cascade.
// TODO: Reuse tree fragments for the reuse kind of incremental parsing.
// TODO: Use TreeBuffer were beneficial, maybe even turn the whole thing into one TreeBuffer if possible.
// TODO: Keep track of state with a WeakMap (maybe use WeakRef).
// TODO: We can now let the printer keep the layout as is, as this information is now available in the CST.

const AT = 64
const BS = 92
const CO = 58
const CR = 13
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
  TopContents = 1,
  AtomTag,
  BraceTag,
  LineTag,
  IndentTag,
  EndTag,
  Name,
  Marker,
  Flags,
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
  })
}

export enum Scope {
  InlineAttr,
  BlockAttr,
  Content,
}

export class TagdownParser {
  constructor(readonly nodeSet: NodeSet) {}

  parse(input: Input | string, startPos = 0, parseContext: ParseContext = {}): Tree {
    let parse = parser.startParse(input, startPos, parseContext)
    let result: Tree | null
    while (!(result = parse.advance())) {}
    return result
  }

  startParse(input: Input | string, startPos = 0, parseContext: ParseContext = {}): PartialParse {
    return new Parse(this, typeof input === "string" ? stringInput(input) : input, startPos, parseContext)
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
  constructor(readonly type: number, readonly from: number, readonly to: number) {}
}

class TreeBuilder {
  private readonly children: (Tree | TreeBuffer)[] = []
  private readonly positions: number[] = []

  constructor(readonly nodeSet: NodeSet, readonly from: number) {}

  isEmpty(): boolean {
    return this.children.length === 0
  }

  private get length(): number {
    const lastIndex = this.positions.length - 1
    return lastIndex >= 0 ? this.positions[lastIndex] + this.children[lastIndex].length : 0
  }

  add(node: Leaf | null): void
  add(child: Tree | TreeBuffer, from?: number): void
  add(child: TreeBuilder)
  add(child: Leaf | Tree | TreeBuffer | TreeBuilder | null, from?: number): void {
    if (child === null) return
    if (child instanceof TreeBuilder) {
      const offset = this.length
      this.children.push(...child.children)
      this.positions.push(...child.positions.map(pos => pos + offset))
    } else {
      let position: number
      if (child instanceof Leaf) {
        const { type, from, to } = child
        child = new Tree(this.nodeSet.types[type], [], [], to - from)
        position = from - this.from
      } else {
        position = from !== undefined ? from - this.from : this.length
      }
      this.children.push(child)
      this.positions.push(position)
    }
  }

  toTree(type: number, length?: number) {
    return new Tree(this.nodeSet.types[type], this.children, this.positions, length || this.length)
  }
}

class TagBuilder {
  tagFlags: Leaf | undefined
  name: Leaf | undefined
  inlineAttributes: TreeBuilder | undefined
  contentFlags: Leaf | undefined
  blockAttributes: TreeBuilder | undefined
  contentMarker: Leaf | undefined
  contents: TreeBuilder | undefined
  type: number | undefined

  constructor(readonly nodeSet: NodeSet, readonly from: number, readonly scope: Scope) {}

  private build(builder: TreeBuilder): void {
    if (this.tagFlags) builder.add(this.tagFlags)
    if (this.name) builder.add(this.name)
    if (this.inlineAttributes) builder.add(this.inlineAttributes)
    if (this.contentFlags) builder.add(this.contentFlags)
    if (this.blockAttributes) builder.add(this.blockAttributes)
    if (this.contentMarker) builder.add(this.contentMarker)
    if (this.contents) builder.add(this.contents)
  }

  fail(): TreeBuilder {
    const builder = new TreeBuilder(this.nodeSet, this.from)
    builder.add(new Leaf(Type.Marker, this.from, this.from + 1))
    this.build(builder)
    return builder
  }

  toTree(to: number): Tree {
    const builder = new TreeBuilder(this.nodeSet, this.from)
    this.build(builder)
    return builder.toTree(this.type!, to - this.from)
  }
}

class Parse implements PartialParse {
  readonly nodeSet: NodeSet
  pos: number
  topContents: TreeBuilder
  tags: TagBuilder[]

  constructor(
    parser: TagdownParser,
    readonly input: Input,
    startPos: number,
    readonly parseContext: ParseContext,
  ) {
    this.nodeSet = parser.nodeSet
    this.pos = startPos
    this.topContents = new TreeBuilder(this.nodeSet, 0)
    this.tags = []
    // this.fragments = parseContext.fragments ? new FragmentCursor(parseContext.fragments, input) : null
  }

  get chr(): number {
    return this.input.get(this.pos)
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
    return this.input.get(this.pos + offset)
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

  private isWhitespace(offset = 0): boolean {
    return this.isOneOf([SP, HT, LF, CR])
  }

  private isNewline(offset = 0): boolean {
    return this.peek(offset) === LF || this.isStr([CR, LF], offset)
  }

  private isAlpha(offset = 0): boolean {
    const c = this.peek(offset)
    return (c >= _a && c <= _z) || (c >= _A && c <= _Z)
  }

  private isAlphanumeric(offset = 0): boolean {
    const c = this.peek(offset)
    return (c >= _a && c <= _z) || (c >= _A && c <= _Z) || (c >= _0 && c <= _9)
  }

  private esacpedOneOf(chrs: number[], offset = 0): boolean {
    return this.isChr(BS) && (this.isChr(BS, 1) || this.isOneOf(chrs, 1))
  }

  private consumeWhitespace(): void {
    while (this.isWhitespace()) this.next()
  }

  private matchChr(c: number): boolean {
    const cond = c === this.chr
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

  private slice(from: number, length = this.pos - from): Leaf | null {
    return length > 0 ? new Leaf(Type.Other, from, from + length) : null
  }

  private sliceLineEnd(start: number): Leaf | null {
    const endPos = this.pos
    let length = endPos - start
    while (length >= 0 && this.isWhitespace(length)) length--
    return this.slice(start, length)
  }

  private parseText(specialChrs: number[]): TreeBuilder | null {
    const builder = new TreeBuilder(this.nodeSet, this.pos)
    let start = this.pos
    while (this.hasNext() && !this.isOneOf(specialChrs)) {
      const newlinePos = this.pos
      if (this.matchNewline()) {
        builder.add(this.sliceLineEnd(start))
        start = newlinePos
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

  private parseTagStart(scope: Scope): TagBuilder | null {
    if (!this.matchChr(LB)) return null
    const tag = new TagBuilder(this.nodeSet, this.pos - 1, scope)
    this.consumeWhitespace()
    let start = this.pos
    this.matchChr(SQ)
    this.matchChr(AT)
    if (this.pos !== start) {
      tag.tagFlags = new Leaf(Type.Flags, start, this.pos)
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
      tag.name = new Leaf(Type.Name, start, this.pos)
      this.consumeWhitespace()
    }
    return tag
  }

  private advanceContents(contents: TreeBuilder): boolean {
    const text = this.parseText(contents === this.topContents ? [LB] : [LB, RB])
    if (text) {
      contents.add(text)
    } else {
      const tag = this.parseTagStart(Scope.Content)
      if (tag) {
        this.tags.unshift(tag)
      } else return false
    }
    return true
  }

  private getBuilder(): TreeBuilder {
    if (this.tags.length > 0) {
      const tag = this.tags[0]
      return tag.contentMarker ? tag.contents! : tag.inlineAttributes!
    } else return this.topContents
  }

  advance(): Tree | null {
    if (this.tags.length > 0) {
      const tag = this.tags[0]
      let fail = false
      if (!tag.contentFlags && !tag.contentMarker) {
        let start = this.pos
        const attr = this.parseTagStart(Scope.InlineAttr)
        if (attr) {
          if (!tag.inlineAttributes) {
            tag.inlineAttributes = new TreeBuilder(this.nodeSet, start)
          }
          this.tags.unshift(attr)
        } else {
          this.consumeWhitespace()
          if (this.matchChr(RB)) {
            tag.type = Type.AtomTag
            this.tags.shift()
            this.getBuilder().add(tag.toTree(this.pos), tag.from)
          } else if (this.matchChr(CO)) {
            tag.type = Type.BraceTag
            tag.contentMarker = new Leaf(Type.Marker, this.pos - 1, this.pos)
            if (this.matchChr(SQ)) tag.contentFlags = new Leaf(Type.Flags, this.pos - 1, this.pos)
            this.matchChr(SP)
            tag.contents = new TreeBuilder(this.nodeSet, this.pos)
          } else if (this.matchChr(EQ) && (tag.scope === Scope.Content || tag.scope === Scope.BlockAttr)) {
            start = this.pos - 1
            this.matchChr(SQ)
            tag.contentFlags = new Leaf(Type.Flags, start, this.pos)
            this.consumeWhitespace()
            if (this.matchChr(RB)) {
              this.matchChr(SP)
              tag.contents = new TreeBuilder(this.nodeSet, this.pos)
            } else fail = true
          } else fail = true
        }
      } else if (tag.blockAttributes && !tag.contentMarker) {
      } else if (!this.advanceContents(tag.contents!)) {
        if (tag.type === Type.BraceTag) {
          if (this.matchChr(RB)) {
            this.tags.shift()
            this.getBuilder().add(tag.toTree(this.pos), tag.from)
          } else fail = true
        } else {
          if (tag.contents!.isEmpty() && this.isNewline()) {
            tag.blockAttributes = new TreeBuilder(this.nodeSet, this.pos)
          } else {
          }
        }
      }
      if (fail) {
        this.tags.shift()
        this.getBuilder().add(tag.fail())
      }
    } else if (!this.advanceContents(this.topContents)) {
      assert(this.hasEnded(), "expected end of input")
      return this.topContents.toTree(Type.TopContents)
    }
    return null
  }

  // private reuseFragment(startPos: number): boolean {
  //   if (!this.fragments) return false
  // }

  forceFinish(): Tree {
    while (this.tags.length > 0) {
      this.getBuilder().add(this.tags.shift()!.fail())
    }
    return this.topContents.toTree(Type.TopContents)
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
  cursor.firstChild()
  const tagFlags = sliceFlags(cursor, input)
  const isQuoted = tagFlags.includes(SQ)
  const isAttribute = tagFlags.includes(AT)
  const name = sliceType(cursor, input, Type.Name)!
  const attributes: Tag[] = []
  while (cursor.type.is("Tag")) {
    attributes.push(traverseTag(cursor, input))
    if (!cursor.nextSibling()) break
  }
  let contentFlags = sliceFlags(cursor, input)
  const isLiteral = contentFlags.includes(SQ)
  let contents: Content[]
  if (cursor.type.id === Type.Marker) {
    contents = cursor.nextSibling() ? traverseContents(cursor, input) : [""]
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
  let text = ""
  do {
    const { type, from, to } = cursor
    if (
      type.id === Type.Other ||
      type.id === Type.Flags ||
      type.id === Type.Marker ||
      type.id === Type.Name
    ) {
      text += input.substring(from, to)
    } else if (type.id === Type.Escape) {
      text += input.substring(from + 1, to)
    } else if (type.is("Tag")) {
      if (text.length > 0) {
        contents.push(text)
        text = ""
      }
      contents.push(traverseTag(cursor, input))
    }
  } while (cursor.nextSibling())
  if (text.length > 0) contents.push(text)
  return contents
}

export function treeToContents(tree: Tree, input: string): Content[] {
  const cursor = tree.cursor()
  return cursor.firstChild() ? traverseContents(cursor, input) : []
}
