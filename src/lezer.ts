import {
  ChangedRange,
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
  TreeFragment,
} from "lezer-tree"

import { log } from "../test/log"
import { printTree } from "./tree"
import { Content, Tag } from "./types"

enum Type {
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
  Name,
  Flags,
  ContentsMarker,
  TagMarker,

  // Text
  Text,
  StopMarker,
  Escape,
  Other,
}

/*
Text
  - StopMarker
  - Escape
  - Other

TagStart
  - TagMarker {
  - Flags? '@
  - Name

InlineAttrsEnd
  - ContentMarker? :
  - Flags? ='

TagEnd
  TagMarker }

Content
  - Text
  - Tag
*/

const nodeTypes = [
  NodeType.none,
  NodeType.define({ id: 1, name: Type[1], top: true }),
  NodeType.define({ id: 2, name: Type[2], error: true }),
]
for (let i = 3, name: string; (name = Type[i]); i++) {
  nodeTypes[i] = NodeType.define({
    id: i,
    name,
    props: name.endsWith("Tag") ? [[NodeProp.group, ["Tag"]]] : [],
  })
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
    if (typeof input === "string") input = stringInput(input)
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
  // We postpone converting TreaLeaf to Tree, for we would need access to NodeSet.
  readonly children: (Tree | TreeBuffer)[] = []
  readonly positions: number[] = []

  constructor(readonly nodeSet: NodeSet, readonly from: number, public type: number = Type.None) {}

  private get rangeLength(): number {
    const lastIndex = this.positions.length - 1
    return lastIndex >= 0 ? this.positions[lastIndex] + this.children[lastIndex].length : 0
  }

  get length(): number {
    return this.children.length
  }

  // Return a boolean for convenience: builder.add(...) || ...
  add(child: Tree | TreeBuffer | TreeBuilder | TreeLeaf | null, from?: number): boolean {
    // Convenience to allow: const result = ...; if (result !== null) builder.add(result)
    // to become: builder.add(...)
    if (child === null) return false
    if (child instanceof TextBuilder && !(this instanceof TextBuilder)) {
      child = child.toTree()
      log(child)
    }
    if (child instanceof TreeBuilder) {
      const offset = child.from - this.from
      this.children.push(...child.children)
      this.positions.push(...child.positions.map(position => position + offset))
    } else {
      let position: number
      if (child instanceof TreeLeaf) {
        const { type, to, from } = child
        child = new Tree(this.nodeSet.types[type], [], [], to - from)
        position = from - this.from
      } else {
        position = from !== undefined ? from - this.from : this.rangeLength
      }
      // log(child.type)
      this.children.push(child)
      this.positions.push(position)
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
      topID: Type.Text,
      buffer,
      nodeSet: this.nodeSet,
      reused: this.children,
    })
  }
}

enum Scope {
  Start,
  InlineAttr,
  BlockAttr,
  Content,
  ContentEnd,
}

class TagContext {
  readonly builder: TreeBuilder

  // On every `advance` we lose all lexical context, so we need to keep track of it here.
  scope = Scope.Start
  isMultiline = false
  isLiteral = false

  constructor(nodeSet: NodeSet, from: number, readonly parentScope: Scope) {
    this.builder = new TreeBuilder(nodeSet, from, Type.AtomTag)
  }

  get type() {
    return this.builder.type
  }

  set type(type: number) {
    this.builder.type = type
  }

  toTree(to: number): Tree {
    return this.builder.toTree(to - this.builder.from)
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

class Parse implements PartialParse {
  readonly nodeSet: NodeSet
  readonly topContents: TreeBuilder
  readonly tagStack: TagContext[] = []
  readonly fragments: FragmentCursor | null
  pos: number
  indents: number
  skipNewline = false

  constructor(parser: TagdownParser, readonly input: Input, start: number, parseContext: ParseContext) {
    this.nodeSet = parser.nodeSet
    this.topContents = new TreeBuilder(this.nodeSet, 0, Type.TopContents)
    this.fragments = parseContext.fragments ? new FragmentCursor(parseContext.fragments, input) : null
    this.pos = start
    this.indents = 0
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
      count < this.indents &&
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
    const builder = new TextBuilder(this.nodeSet, this.pos)
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

  private parseTagStart(scope: Scope): TagContext | null {
    if (!this.isChr(LB)) return null
    const tag = new TagContext(this.nodeSet, this.pos, scope)
    tag.builder.add(TreeLeaf.createFrom(Type.TagMarker, this.pos, 1))
    this.next()
    this.next(this.matchSpaces())
    let start = this.pos
    this.parseChr(SQ)
    this.parseChr(AT)
    if (this.pos > start) {
      tag.builder.add(TreeLeaf.createRange(Type.Flags, start, this.pos))
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
    if (this.pos > start) {
      tag.builder.add(TreeLeaf.createRange(Type.Name, start, this.pos))
      this.next(this.matchSpaces())
      tag.scope = Scope.InlineAttr
    }
    return tag
  }

  private parseTagEnd(tag: TagContext): boolean {
    const cond = this.isChr(RB)
    if (cond) {
      tag.builder.add(TreeLeaf.createFrom(Type.TagMarker, this.pos, 1))
      this.next()
    }
    return cond
  }

  private getBuilder(): TreeBuilder {
    return this.tagStack.length ? this.tagStack[0].builder : this.topContents
  }

  private getParentBuilder(): TreeBuilder {
    return this.tagStack.length >= 2 ? this.tagStack[1].builder : this.topContents
  }

  private continueNewTag(): boolean {
    const parentScope = this.tagStack.length ? this.tagStack[0].scope : Scope.Content
    const tag = this.parseTagStart(parentScope)
    if (!tag) return false
    this.tagStack.unshift(tag)
    if (tag.scope === Scope.Start) this.failTag()
    return true
  }

  private continueContents(subject: TagContext | TreeBuilder): boolean {
    const builder = subject instanceof TagContext ? subject.builder : subject
    if (subject instanceof TreeBuilder || subject.type === Type.EndTag || subject.type === Type.IndentTag) {
      if (
        !(subject instanceof TagContext && subject.isLiteral
          ? builder.add(this.parseLineLiteralText())
          : builder.add(this.parseLineText()) || this.continueNewTag())
      ) {
        const newline = this.matchNewline()
        if (newline) {
          const indents = this.countIndents(newline)
          if (indents.count === this.indents) {
            if (!this.skipNewline) builder.add(TreeLeaf.createFrom(Type.Other, this.pos, newline))
            else {
              const spaces = this.matchSpaces()
              const offset = newline + indents.length + spaces
              const newline2 = this.matchNewline(offset)
              if (this.hasEnded(offset) || newline2) {
                builder.add(TreeLeaf.createFrom(Type.Other, this.pos + newline + indents.length, 0))
              }
              this.skipNewline = false
            }
            this.next(newline + indents.length)
            return true
          }
        }
      } else return true
    } else if (subject.type === Type.BraceTag || subject.type === Type.LineTag) {
      if (subject.isLiteral) {
        builder.add(
          subject.type === Type.BraceTag ? this.parseBraceLiteralText() : this.parseLineLiteralText(),
        )
        subject.scope = Scope.ContentEnd
        return true
      } else
        return (
          builder.add(subject.type === Type.BraceTag ? this.parseBraceText() : this.parseLineText()) ||
          this.continueNewTag()
        )
    }
    return false
  }

  private finishTag(): void {
    const tag = this.tagStack.shift()!
    this.getBuilder().add(tag.toTree(this.pos), tag.builder.from)
    if (tag.type === Type.IndentTag) this.indents--
    if (tag.type <= Type.LineTag && tag.parentScope === Scope.Content) this.skipNewline = true
  }

  private failTag(): void {
    const tag = this.tagStack.shift()!
    const tagTree = tag.toTree(this.pos)
    this.getBuilder().add(
      new Tree(this.nodeSet.types[Type.TagError], [tagTree], [0], tagTree.length),
      tag.builder.from,
    )
    if (tag.parentScope === Scope.InlineAttr || tag.parentScope === Scope.BlockAttr) {
      this.failTag()
    }
  }

  private endInlineAttrScope(tag: TagContext): void {
    if (this.parseTagEnd(tag)) {
      this.finishTag()
    } else if (this.parseChr(CO)) {
      tag.type = Type.BraceTag
      tag.builder.add(TreeLeaf.createTo(Type.ContentsMarker, this.pos, 1))
      if (this.parseChr(SQ)) {
        tag.isLiteral = true
        tag.builder.add(TreeLeaf.createTo(Type.Flags, this.pos, 1))
      }
      this.parseChr(SP)
      tag.scope = Scope.Content
    } else if (
      this.parseChr(EQ) &&
      (tag.parentScope === Scope.Content || tag.parentScope === Scope.BlockAttr)
    ) {
      const start = this.pos - 1
      if (this.parseChr(SQ)) tag.isLiteral = true
      tag.builder.add(TreeLeaf.createRange(Type.Flags, start, this.pos))
      this.next(this.matchSpaces())
      if (this.parseTagEnd(tag)) {
        const spaces = this.matchSpaces()
        if (this.matchNewline(spaces)) {
          tag.type = Type.EndTag
          tag.scope = Scope.BlockAttr
          this.indents++
        } else {
          this.parseChr(SP)
          tag.type = Type.LineTag
          tag.scope = Scope.Content
        }
      } else this.failTag()
    } else this.failTag()
  }

  private endBlockAttrScope(tag: TagContext): void {
    this.indents--
    const start = this.pos
    let indents = this.countNewlineIndents()
    const { length } = indents
    // log("end block attr scope", sliceInput(this), indents, this.indents)
    if (indents.count === this.indents) {
      if (
        this.matchStr([HY, HY], length) &&
        ((indents = this.countNewlineIndents(length + 2)) || this.hasEnded(length + 2))
      ) {
        tag.builder.add(TreeLeaf.createFrom(Type.ContentsMarker, this.pos + length, 2))
        this.next(length + 2 + indents.length)
      } else if (this.isChr(CO, length) && (this.isChr(SP, length + 1) || this.isLineEnd(length + 1))) {
        tag.type = Type.IndentTag
        tag.builder.add(TreeLeaf.createFrom(Type.ContentsMarker, this.pos + length, 1))
        this.next(length + 1)
        this.parseChr(SP)
      }
      if (this.pos > start) {
        if (tag.type === Type.IndentTag) this.indents++
        tag.scope = Scope.Content
        tag.isMultiline = true
      }
    }
    if (tag.scope !== Scope.Content) {
      if (!tag.isMultiline) {
        this.parseChr(SP)
        tag.type = Type.LineTag
        this.next(this.matchSpaces())
        this.finishTag()
      } else {
        this.finishTag()
        const indents = this.countNewlineIndents()
        if (indents.count === this.indents) {
          const escape =
            this.matchStr([BS, CO], indents.length) || this.matchStr([BS, HY, HY], indents.length)
          if (escape) {
            this.next(indents.length + escape)
            this.getParentBuilder().add(TreeLeaf.createTo(Type.Escape, this.pos, escape))
            this.skipNewline = false
          }
        }
      }
    }
  }

  private endContentScope(tag: TagContext): void {
    if (tag.type === Type.BraceTag) {
      if (this.parseTagEnd(tag)) this.finishTag()
      else this.failTag()
    } else {
      this.finishTag()
    }
  }

  private parse(): Tree | null {
    if (this.tagStack.length) {
      const tag = this.tagStack[0]
      if (tag.scope === Scope.InlineAttr) {
        if (this.continueNewTag()) this.next(this.matchSpaces())
        else this.endInlineAttrScope(tag)
      } else if (tag.scope === Scope.BlockAttr) {
        const indents = this.countNewlineIndents()
        if (indents.count === this.indents) {
          this.next(indents.length)
          if (this.continueNewTag()) {
            tag.isMultiline = true
            this.skipNewline = false
          } else this.endBlockAttrScope(tag)
        } else this.endBlockAttrScope(tag)
      } else if (tag.scope === Scope.Content) {
        if (!this.continueContents(tag)) this.endContentScope(tag)
      } else if (tag.scope === Scope.ContentEnd) {
        this.endContentScope(tag)
      } else this.failTag()
    } else if (!this.continueContents(this.topContents)) {
      return this.finish()
    }
    return null
  }

  private reuseFragment(): boolean {
    if (!(this.fragments && this.fragments.moveTo(this.pos))) {
      log(this.pos, "could not move to")
      return false
    }
    const cursor = this.fragments.cursor!
    const offset = this.fragments.fragment!.offset
    log(this.pos, this.input.read(cursor.from - offset, cursor.to - offset), cursor.tree!)
    // const start = this.pos
    // let end = start
    // let prevEnd = end
    // do {
    //   if (cursor.to - offset >= this.fragments.fragmentEnd) {
    //     if (cursor.type.isAnonymous && cursor.firstChild()) continue
    //     break
    //   }
    //   // builder.add(cursor.tree!, cursor.from - offset)
    //   console.log(cursor.tree!)
    //   console.log(printTree(cursor.tree!, this.input.read(cursor.from - offset, this.input.length)))
    // } while (cursor.nextSibling())
    return false
  }

  advance(): Tree | null {
    return this.reuseFragment() ? null : this.parse()
  }

  forceFinish(): Tree {
    while (this.tagStack.length) {
      this.failTag()
    }
    return this.finish()
  }

  finish(): Tree {
    return this.topContents.toTree()
  }
}

// Changes

export class TagdownState {
  constructor(readonly input: string, readonly tree: Tree, readonly fragments: readonly TreeFragment[]) {}

  static start(input: string) {
    const tree = parser.parse(input)
    return new TagdownState(input, tree, TreeFragment.addTree(tree))
  }

  update(changes: { from: number; to?: number; insert?: string }[]) {
    const changed: ChangedRange[] = []
    let input = this.input
    let off = 0
    for (const { from, to = from, insert = "" } of changes) {
      input = input.slice(0, from) + insert + input.slice(to)
      changed.push({ fromA: from - off, toA: to - off, fromB: from, toB: from + insert.length })
      off += insert.length - (to - from)
    }
    const fragments = TreeFragment.applyChanges(this.fragments, changed, 2)
    const tree = parser.parse(input, 0, { fragments })
    return new TagdownState(input, tree, TreeFragment.addTree(tree, fragments))
  }
}

class FragmentCursor {
  i = 0
  fragment: TreeFragment | null
  fragmentEnd: number
  cursor: TreeCursor | null

  constructor(readonly fragments: readonly TreeFragment[], readonly input: Input) {
    this.nextFragment()
  }

  nextFragment() {
    this.fragment = this.i < this.fragments.length ? this.fragments[this.i++] : null
    this.fragmentEnd = -1
    this.cursor = null
  }

  moveTo(docPos: number): boolean {
    while (this.fragment && this.fragment.to <= docPos) this.nextFragment()
    if (!this.fragment || this.fragment.from > (docPos ? docPos - 1 : 0)) return false
    if (this.fragmentEnd < 0) {
      let end = this.fragment.to
      this.fragmentEnd = end ? end - 1 : 0
    }
    if (!this.cursor) {
      this.cursor = this.fragment.tree.cursor()
      this.cursor.firstChild()
    }
    const treePos = docPos + this.fragment.offset
    while (this.cursor.to <= treePos) if (!this.cursor.parent()) return false
    for (;;) {
      if (this.cursor.from >= treePos) return true
      if (!this.cursor.childAfter(treePos)) return false
    }
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

function traverseTag(cursor: TreeCursor, input: Input): Tag {
  const tagType = cursor.type.id
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
  if (tagType === Type.EndTag || tagType === Type.IndentTag || tagType === Type.LineTag) {
    const contentFlags = sliceFlags(cursor, input)
    if (contentFlags.includes(SQ)) isLiteral = true
    cursor.nextSibling()
  }
  if (tagType === Type.EndTag || tagType === Type.IndentTag) {
    while (cursor.type.is("Tag")) {
      attributes.push(traverseTag(cursor, input))
      if (!cursor.nextSibling()) break
    }
    if (cursor.type.id === Type.ContentsMarker) {
      hasContents = true
      cursor.nextSibling()
    }
  } else if (tagType === Type.LineTag) hasContents = true
  else if (tagType === Type.BraceTag) {
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

function traverseContents(cursor: TreeCursor, input: Input): Content[] {
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

export function parseTreeToContents(tree: Tree, input: Input | string): Content[] {
  if (typeof input === "string") input = stringInput(input)
  const cursor = tree.cursor()
  return cursor.firstChild() ? traverseContents(cursor, input) : []
}

export function parseContents(input: string): Content[] {
  return parseTreeToContents(parser.parse(input), input)
}

// Debugging

function sliceInput(parse: Parse): string {
  return parse.input.read(parse.pos, parse.input.length)
}

function tagName(parse: Parse, tag: TagContext): string {
  const input = parse.input
  const builder = tag.builder
  const i = builder.children.findIndex(child =>
    child instanceof TreeLeaf ? child.type === Type.Name : child.type.id === Type.Name,
  )!
  const child = builder.children[i]
  if (child instanceof TreeLeaf) {
    return input.read(child.from, child.to)
  } else {
    const position = builder.positions[i]
    return input.read(builder.from + position, builder.from + position + child.length)
  }
}
