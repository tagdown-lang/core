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

import { Content, isTagContent, Tag } from "./types"
import { log } from "./utils/log"
import { printTree } from "./utils/print-lezer-tree"

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
  Contents,
  InlineAttributes,
  BlockAttributes,
  Name,
  Flags,
  ContentsMarker,
  TagMarker,

  // Text
  StopMarker,
  Escape,
  Other,
}

// export const multilineNodeProp = NodeProp.flag()

const nodeTypes = [
  NodeType.none,
  NodeType.define({ id: 1, name: Type[1], top: true }),
  NodeType.define({ id: 2, name: Type[2], error: true }),
]
for (let i = 3, name: string; (name = Type[i]); i++) {
  const props: [NodeProp<any>, any][] = []
  if (name.endsWith("Tag")) {
    props.push([NodeProp.group, ["Tag"]])
  }
  // if (["IndentTag", "EndTag"].includes(name)) {
  //   props.push([multilineNodeProp, true])
  // }
  nodeTypes[i] = NodeType.define({
    id: i,
    name,
    props,
  })
}

export class TagdownParser {
  constructor(readonly nodeSet: NodeSet) {}

  parse(input: Input | string, startPos = 0, parseContext: ParseContext = {}): Tree {
    if (
      parseContext.fragments &&
      parseContext.fragments.length === 1 &&
      parseContext.fragments[0].from === 0 &&
      parseContext.fragments[0].to === input.length
    ) {
      return parseContext.fragments[0].tree
    }
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

  get to(): number {
    return this.from + this.rangeLength
  }

  get length(): number {
    return this.children.length
  }

  // Return a boolean for convenience: builder.add(...) || ...
  add(child: TreeBuilder | ReuseTree | Tree | TreeBuffer | TreeLeaf | null, from?: number): boolean {
    // Convenience to allow: const result = ...; if (result !== null) builder.add(result)
    // to become: builder.add(...)
    if (child === null) return false
    // if (child instanceof TextBuilder && !(this instanceof TextBuilder)) {
    //   this.children.push(child.toTree())
    //   this.positions.push(child.from - this.from)
    // } else
    if (child instanceof TreeBuilder) {
      const offset = child.from - this.from
      this.children.push(...child.children)
      this.positions.push(...child.positions.map(position => position + offset))
    } else if (child instanceof ReuseTree) {
      this.children.push(child.tree)
      this.positions.push(child.pos)
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
      // topID: Type.Text,
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
  End,
}

function isInnerScope(scope: Scope): boolean {
  return scope === Scope.InlineAttr || scope === Scope.BlockAttr || scope === Scope.Content
}

const scopeTypes = {
  [Scope.InlineAttr]: Type.InlineAttributes,
  [Scope.BlockAttr]: Type.BlockAttributes,
  [Scope.Content]: Type.Contents,
}

class TagContext {
  readonly builder: TreeBuilder
  innerBuilder: TreeBuilder | null = null

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

  getBuilder(): TreeBuilder {
    return this.innerBuilder && isInnerScope(this.scope) ? this.innerBuilder! : this.builder
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
  indents: number[]
  skipNewline = false

  constructor(parser: TagdownParser, readonly input: Input, start: number, parseContext: ParseContext) {
    this.nodeSet = parser.nodeSet
    this.topContents = new TreeBuilder(this.nodeSet, 0, Type.TopContents)
    this.fragments = parseContext.fragments ? new FragmentCursor(parseContext.fragments, input) : null
    // this.fragments = null
    this.pos = start
    this.indents = [0]
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

  private parseTagStart(scope: Scope): TagContext | null {
    if (!this.isChr(LB)) return null
    const tag = new TagContext(this.nodeSet, this.pos, scope)
    this.tagAdd(tag, TreeLeaf.createFrom(Type.TagMarker, this.pos, 1))
    this.next()
    this.next(this.matchSpaces())
    let start = this.pos
    this.parseChr(SQ)
    this.parseChr(AT)
    if (this.pos > start) {
      this.tagAdd(tag, TreeLeaf.createRange(Type.Flags, start, this.pos))
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
      this.tagAdd(tag, TreeLeaf.createRange(Type.Name, start, this.pos))
      this.next(this.matchSpaces())
      this.setScope(tag, Scope.InlineAttr)
    }
    return tag
  }

  private addInnerBuilder(tag: TagContext): void {
    if (tag.innerBuilder) {
      if (tag.innerBuilder.length || tag.innerBuilder.type === Type.Contents) {
        tag.builder.add(tag.innerBuilder.toTree(), tag.innerBuilder.from)
      }
      tag.innerBuilder = null
    }
  }

  private tagAdd(
    tag: TagContext,
    child: TreeBuilder | ReuseTree | Tree | TreeBuffer | TreeLeaf | null,
    from?: number,
  ): boolean {
    this.addInnerBuilder(tag)
    return tag.builder.add(child, from)
  }

  private parseTagEnd(tag: TagContext): boolean {
    const cond = this.isChr(RB)
    if (cond) {
      this.tagAdd(tag, TreeLeaf.createFrom(Type.TagMarker, this.pos, 1))
      this.next()
    }
    return cond
  }

  private getBuilder(): TreeBuilder {
    return this.tagStack.length ? this.tagStack[0].getBuilder() : this.topContents
  }

  private moveFragment(): boolean {
    // return false
    // log("move fragment", this.pos)
    return !!this.fragments && this.fragments.moveTo(this.pos)
  }

  private isFragmentEnd(): boolean {
    return !(
      this.fragments!.from >= this.fragments!.fragment.from &&
      (!this.fragments!.fragment.openEnd || this.fragments!.to < this.fragments!.fragment.to)
    )
  }

  private reuseTextContent(): boolean {
    // log(this.fragments!.cursor.type.name)
    const cond =
      [Type.Other, Type.Escape, Type.StopMarker].includes(this.fragments!.type) &&
      this.fragments!.cursor.parent() &&
      !this.isFragmentEnd()
    // log(this.fragments!.cursor.type.name, this.isFragmentEnd())
    if (cond) this.addReuseTree()
    // const text = new TextBuilder(this.nodeSet, this.pos)
    // for (const leaf of this.fragments!.reuseRepeat([Type.Other, Type.Escape, Type.StopMarker])) {
    //   text.add(leaf)
    // }
    // const cond = text.children.length > 0 && !this.isFragmentEnd()
    // if (cond) {
    //   this.getBuilder().add(text)
    //   this.pos = this.fragments!.to
    // }
    // log("reuse text content", cond, this.pos)
    return cond
  }

  private addReuseTree(): void {
    const { tree, from, to } = this.fragments!
    // log(tree, from, to)
    // log(this.getBuilder())
    // log("reuse", from, to, tree)
    this.getBuilder().add(tree, from)
    this.pos = to
  }

  private reuseTagContent(): boolean {
    // return false
    // log(
    //   this.fragments!.cursor.name,
    //   this.fragments!.cursor.from,
    //   this.fragments!.from,
    //   String.fromCharCode(this.input.get(this.fragments!.from)),
    // )
    const cond =
      this.fragments!.type === Type.TagMarker && this.fragments!.cursor.parent() && !this.isFragmentEnd()
    if (cond) this.addReuseTree()
    // log(
    //   "reuse tag content",
    //   cond,
    //   this.pos,
    //   this.fragments!.from,
    //   this.fragments!.fragment.from,
    //   this.fragments!.to,
    //   this.fragments!.fragment.to,
    //   this.fragments!.fragment.openEnd,
    // )
    return cond
  }

  private reuseTag(): boolean {
    // return false
    if (!this.moveFragment()) return false
    const cond = this.reuseTagContent()
    // log(this.fragments!.cursor.name, cond)
    return cond
    // return this.reuseTagContent()
  }

  parseTag(): boolean {
    const parentScope = this.tagStack.length ? this.tagStack[0].scope : Scope.Content
    const tag = this.parseTagStart(parentScope)
    if (!tag) return false
    this.tagStack.unshift(tag)
    if (tag.scope === Scope.Start) this.failTag()
    return true
  }

  private setScope(tag: TagContext, scope: Scope): void {
    tag.scope = scope
    this.addInnerBuilder(tag)
    if (isInnerScope(scope)) {
      tag.innerBuilder = new TreeBuilder(this.nodeSet, this.pos, scopeTypes[scope])
    }
  }

  private continueContents(subject: TagContext | TreeBuilder): boolean {
    const cond = this.continueContents2(subject)
    this.skipNewline = false
    return cond
  }

  private continueContents2(subject: TagContext | TreeBuilder): boolean {
    if (this.moveFragment() && (this.reuseTextContent() || this.reuseTagContent())) return true
    const builder = subject instanceof TagContext ? subject.innerBuilder! : subject
    if (subject instanceof TreeBuilder || subject.type === Type.EndTag || subject.type === Type.IndentTag) {
      if (
        !(subject instanceof TagContext && subject.isLiteral
          ? builder.add(this.parseLineLiteralText())
          : builder.add(this.parseLineText()) || this.parseTag())
      ) {
        const newline = this.matchNewline()
        if (newline) {
          const indents = this.countIndents(newline)
          if (indents.count === this.indents[0]) {
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
        }
      } else return true
    } else if (subject.type === Type.BraceTag || subject.type === Type.LineTag) {
      let cond = true
      if (subject.isLiteral) {
        builder.add(
          subject.type === Type.BraceTag ? this.parseBraceLiteralText() : this.parseLineLiteralText(),
        )
        this.setScope(subject, Scope.ContentEnd)
      } else {
        cond =
          builder.add(subject.type === Type.BraceTag ? this.parseBraceText() : this.parseLineText()) ||
          this.parseTag()
      }
      // if (cond && this.skipNewline) {
      //   log(this.pos, sliceInput(this), this.matchNewline())
      //   this.next(this.matchNewline())
      // }
      return cond
    }
    return false
  }

  private endTag(tag: TagContext): void {
    if (tag.type === Type.BraceTag) this.indents.shift()
    this.setScope(tag, Scope.End)
  }

  private finishTag(): void {
    const tag = this.tagStack.shift()!
    this.getBuilder().add(tag.toTree(this.pos), tag.builder.from)
    if (tag.type === Type.IndentTag) this.indents[0]--
    if (tag.type <= Type.LineTag && tag.parentScope === Scope.Content) {
      if (this.tagStack.length && this.tagStack[0].type === Type.BraceTag) this.next(this.matchNewline())
      else this.skipNewline = true
    }
    this.endTag(tag)
  }

  private failTag(): void {
    const tag = this.tagStack.shift()!
    this.endTag(tag)
    const tagTree = tag.toTree(this.pos)
    this.getBuilder().add(
      new Tree(this.nodeSet.types[Type.TagError], [tagTree], [0], tagTree.length),
      tag.builder.from,
    )
    if (tag.parentScope === Scope.InlineAttr || tag.parentScope === Scope.BlockAttr) {
      this.failTag()
    }
  }

  reuseAfterInlineAttrs(tag: TagContext): boolean {
    return false
    // if (!this.moveFragment()) return false
    // const typeId = this.fragments!.type.id
    // if (![Type.TagMarker, Type.ContentsMarker, Type.Flags].includes(typeId)) return false
    // const reused = this.fragments!.reuseTree
    // let flags: ReuseTree | undefined
    // if (typeId === Type.ContentsMarker && this.fragments!.nextSibling(Type.Flags)) {
    //   flags = this.fragments!.reuseTree
    // } else if (typeId === Type.Flags) {
    //   flags = reused
    // }
    // if (!(typeId === Type.TagMarker || (flags && flags.tree.length === 2)) && this.isFragmentEnd())
    //   return false
    // if (flags) tag.isLiteral = this.input.get(flags.pos + flags.tree.length - 1) === SQ
    // return true
  }

  afterInlineAttrs(tag: TagContext): void {
    if (this.reuseAfterInlineAttrs(tag)) return
    if (this.parseTagEnd(tag)) {
      this.finishTag()
    } else if (this.parseChr(CO)) {
      tag.type = Type.BraceTag
      this.tagAdd(tag, TreeLeaf.createTo(Type.ContentsMarker, this.pos, 1))
      if (this.parseChr(SQ)) {
        tag.isLiteral = true
        this.tagAdd(tag, TreeLeaf.createTo(Type.Flags, this.pos, 1))
      }
      this.parseChr(SP)
      this.setScope(tag, Scope.Content)
      this.indents.unshift(0)
    } else if (
      this.parseChr(EQ) &&
      (tag.parentScope === Scope.Content || tag.parentScope === Scope.BlockAttr)
    ) {
      const start = this.pos - 1
      if (this.parseChr(SQ)) tag.isLiteral = true
      this.tagAdd(tag, TreeLeaf.createRange(Type.Flags, start, this.pos))
      this.next(this.matchSpaces())
      if (this.parseTagEnd(tag)) {
        const spaces = this.matchSpaces()
        if (this.matchNewline(spaces)) {
          tag.type = Type.EndTag
          this.setScope(tag, Scope.BlockAttr)
          this.indents[0]++
        } else {
          this.parseChr(SP)
          tag.type = Type.LineTag
          this.setScope(tag, Scope.Content)
        }
      } else this.failTag()
    } else this.failTag()
  }

  reuseAfterBlockAttrs(tag: TagContext): boolean {
    return false
    // this.fragments.type.id === Type.ContentsMarker
    // check for escape
    // if not end of tag, check fragment end
  }

  afterBlockAttrs(tag: TagContext): void {
    // contents marker or end of tag
    if (this.reuseAfterBlockAttrs(tag)) return
    this.indents[0]--
    const start = this.pos
    let indents = this.countNewlineIndents()
    const { length } = indents
    // log("end block attr scope", sliceInput(this), indents, this.indents)
    if (indents.count === this.indents[0]) {
      if (
        this.matchStr([HY, HY], length) &&
        ((indents = this.countNewlineIndents(length + 2)) || this.hasEnded(length + 2))
      ) {
        this.tagAdd(tag, TreeLeaf.createFrom(Type.ContentsMarker, this.pos + length, 2))
        this.next(length + 2 + indents.length)
      } else if (this.isChr(CO, length) && (this.isChr(SP, length + 1) || this.isLineEnd(length + 1))) {
        tag.type = Type.IndentTag
        this.tagAdd(tag, TreeLeaf.createFrom(Type.ContentsMarker, this.pos + length, 1))
        this.next(length + 1)
        this.parseChr(SP)
      }
      if (this.pos > start) {
        if (tag.type === Type.IndentTag) this.indents[0]++
        this.setScope(tag, Scope.Content)
        tag.isMultiline = true
      }
    }
    if (tag.scope !== Scope.Content) {
      if (!tag.isMultiline) {
        tag.type = Type.LineTag
        this.parseChr(SP)
        tag.innerBuilder = new TreeBuilder(this.nodeSet, this.pos, Type.Contents)
        this.next(this.matchSpaces())
        this.finishTag()
      } else {
        this.finishTag()
        const indents = this.countNewlineIndents()
        if (indents.count === this.indents[0]) {
          const escape =
            this.matchStr([BS, CO], indents.length) || this.matchStr([BS, HY, HY], indents.length)
          if (escape) {
            // logTree(this, tag.builder)
            // logTree(this, this.getBuilder())
            // logTree(this, this.getParentBuilder())
            this.next(indents.length + escape)
            const text = new TextBuilder(this.nodeSet, this.pos)
            text.add(TreeLeaf.createTo(Type.Escape, this.pos, escape))
            // log(Type[this.getBuilder().type], Type[this.getParentBuilder().type])
            this.getBuilder().add(text)
            this.skipNewline = false
          }
        }
      }
    }
  }

  afterContents(tag: TagContext): void {
    // tag marker or end of tag
    // if (this.fragments && this.fragments.moveTo(this.pos)) {
    //   this.fragments.type.id === Type.TagMarker
    // } else {
    if (tag.type === Type.BraceTag) {
      if (this.parseTagEnd(tag)) this.finishTag()
      else this.failTag()
    } else {
      this.finishTag()
    }
    // }
  }

  // It is all about where the reused/parsed stuff needs to got.
  // No need to mark where they came into being like a AfterInlineAttrs, as we already know it has been unchanged,
  // so we can just base it on this.pos, only reason we still need to go through the control flow is that
  // we have to know where to add the reuse, e.g. which contents.
  advance(): Tree | null {
    if (this.tagStack.length) {
      const tag = this.tagStack[0]
      if (tag.scope === Scope.InlineAttr) {
        if (!this.reuseTag()) {
          if (this.parseTag()) this.next(this.matchSpaces())
          else this.afterInlineAttrs(tag)
        }
      } else if (tag.scope === Scope.BlockAttr) {
        const oldPos = this.pos
        // log("reuse block attr", this.pos)
        if (!this.reuseTag()) {
          const indents = this.countNewlineIndents()
          if (indents.count === this.indents[0]) {
            this.next(indents.length)
            if (!this.parseTag()) this.pos = oldPos
          }
        }
        if (this.pos > oldPos) {
          tag.isMultiline = true
          this.skipNewline = false
        } else this.afterBlockAttrs(tag)
      } else if (tag.scope === Scope.Content) {
        if (!this.continueContents(tag)) this.afterContents(tag)
      } else if (tag.scope === Scope.ContentEnd) {
        this.afterContents(tag)
      }
    } else if (!this.continueContents(this.topContents)) {
      return this.finish()
    }
    return null
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

class ReuseTree {
  constructor(readonly tree: Tree, readonly pos: number) {}
}

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
    const fragments = TreeFragment.applyChanges(this.fragments, changed, 0)
    const tree = parser.parse(input, 0, { fragments })
    return new TagdownState(input, tree, TreeFragment.addTree(tree, fragments))
  }
}

class FragmentCursor {
  i = 0
  fragment: TreeFragment
  cursor: TreeCursor

  constructor(readonly fragments: readonly TreeFragment[], readonly input: Input) {
    for (const fragment of fragments) {
      const { from, to, offset, openStart, openEnd } = fragment
      // log({ from, to, offset, openStart, openEnd })
    }
    this.nextFragment()
  }

  get type() {
    return this.cursor.type.id
  }

  get tree() {
    return this.cursor.tree!
  }

  get reuseTree() {
    return {
      tree: this.tree,
      pos: this.from,
    }
  }

  get from() {
    return this.cursor.from - this.fragment.offset
  }

  get to() {
    return this.cursor.to - this.fragment.offset
  }

  private nextFragment(): boolean {
    if (this.i === this.fragments.length) return false
    this.fragment = this.fragments[this.i++]
    this.cursor = this.fragment.tree.cursor()
    return true
  }

  // private fragmentAt(pos: number): TreeFragment | null {
  //   for (const fragment of this.fragments) if (pos >= fragment.from && pos < fragment.to) return fragment
  //   return null
  // }

  // moveTo2(pos: number): boolean {
  //   const fragment = this.fragmentAt(pos)
  //   if (!fragment) return false
  //   this.fragment = fragment
  //   const cursor = this.fragment.tree.cursor()
  //   this.cursor = cursor
  //   const treePos = pos + this.fragment.offset

  //   while (this.cursor.to <= treePos) if (!this.cursor.parent()) return false
  //   for (;;) {
  //     if (this.cursor.from >= treePos) return true
  //     if (!this.cursor.childAfter(treePos)) return false
  //   }
  // }

  moveTo(pos: number): boolean {
    const cond = this.moveTo2(pos)
    // log(cond, this.cursor.tree)
    // throw new Error("debug")
    // log("move to", cond)
    return cond
  }

  moveTo2(pos: number): boolean {
    if (this.i === this.fragments.length) return false
    // log(pos, this.fragment.from, this.fragment.to)
    while (!(pos >= this.fragment.from && pos < this.fragment.to)) if (!this.nextFragment()) return false
    // log("found fragment", pos, this.fragment.from, this.fragment.to)
    const treePos = pos + this.fragment.offset
    while (treePos >= this.cursor.to) if (!this.cursor.parent()) return false
    // log("after parent")
    while (this.cursor.childAfter(treePos)) {}
    // log(this.cursor.tree, treePos, this.cursor.from, this.cursor.to)
    return this.cursor.from < this.fragment.to + this.fragment.offset && treePos < this.cursor.to
  }

  nextSibling(type: number): boolean {
    return this.cursor.nextSibling() && this.cursor.type.id === type && this.cursor.to >= this.fragment.to
  }

  reuseRepeat(ids: number[]): ReuseTree[] {
    const trees: ReuseTree[] = []
    while (ids.includes(this.cursor.type.id)) {
      trees.push(this.reuseTree)
      if (!this.cursor.nextSibling()) break
    }
    return trees
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
  while (cursor.type.is("Tag")) {
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
    } else if (type.is("Tag")) {
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

function logTree(parse: Parse, tree: Tree | TreeBuilder): void {
  let input: string | Input = parse.input
  let start = 0
  if (tree instanceof TreeBuilder) {
    input = input.read(tree.from, parse.input.length)
    start = tree.from
    tree = tree.toTree()
  }
  console.log(printTree(tree, input, { start }))
}
