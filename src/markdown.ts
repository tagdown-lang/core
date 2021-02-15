import {
  Tree,
  TreeBuffer,
  NodeType,
  NodeProp,
  NodePropSource,
  TreeFragment,
  NodeSet,
  TreeCursor,
  Input,
  PartialParse,
  stringInput,
  ParseContext,
} from "lezer-tree"

class BlockContext {
  static create(type: number, value: number, from: number, parentHash: number, end: number) {
    let hash = (parentHash + (parentHash << 8) + type + (value << 4)) | 0
    return new BlockContext(type, value, from, hash, end, [], [])
  }

  constructor(
    readonly type: number,
    // Used for indentation in list items, markup character in lists
    readonly value: number,
    readonly from: number,
    readonly hash: number,
    public end: number,
    readonly children: (Tree | TreeBuffer)[],
    readonly positions: number[],
  ) {}

  toTree(nodeSet: NodeSet, end = this.end) {
    let last = this.children.length - 1
    if (last >= 0) end = Math.max(end, this.positions[last] + this.children[last].length + this.from)
    let tree = new Tree(nodeSet.types[this.type], this.children, this.positions, end - this.from).balance(
      2048,
    )
    stampContext(tree.children, this.hash)
    return tree
  }

  copy() {
    return new BlockContext(
      this.type,
      this.value,
      this.from,
      this.hash,
      this.end,
      this.children.slice(),
      this.positions.slice(),
    )
  }
}

enum Type {
  Document = 1,

  CodeBlock,
  FencedCode,
  Blockquote,
  HorizontalRule,
  BulletList,
  OrderedList,
  ListItem,
  ATXHeading,
  SetextHeading,
  HTMLBlock,
  LinkReference,
  Paragraph,
  CommentBlock,
  ProcessingInstructionBlock,

  // Inline
  Escape,
  Entity,
  HardBreak,
  Emphasis,
  StrongEmphasis,
  Link,
  Image,
  InlineCode,
  HTMLTag,
  Comment,
  ProcessingInstruction,
  URL,

  // Smaller tokens
  HeaderMark,
  QuoteMark,
  ListMark,
  LinkMark,
  EmphasisMark,
  CodeMark,
  CodeInfo,
  LinkTitle,
  LinkLabel,
}

class Line {
  // The line's text
  text = ""
  // The next non-whitespace character
  start = 0
  // The column of the next non-whitespace character
  indent = 0
  // The base indent provided by the contexts (handled so far)
  baseIndent = 0
  // The position corresponding to the base indent
  basePos = 0
  // The number of contexts handled
  depth = 0
  // Any markers (i.e. block quote markers) parsed for the contexts.
  markers: Element[] = []
  // The character code of the character after this.start
  next = -1

  moveStart(pos: number) {
    this.start = skipSpace(this.text, pos)
    this.indent = countIndent(this.text, this.start)
    this.next = this.start == this.text.length ? -1 : this.text.charCodeAt(this.start)
  }

  reset(text: string) {
    this.text = text
    this.moveStart(0)
    this.indent = countIndent(text, this.start)
    this.baseIndent = this.basePos = 0
    this.depth = 1
    while (this.markers.length) this.markers.pop()
  }
}

function skipForList(cx: BlockContext, p: Parse, line: Line) {
  if (
    line.start == line.text.length ||
    (cx != p.context && line.indent >= p.contextStack[line.depth + 1].value + line.baseIndent)
  )
    return true
  if (line.indent >= line.baseIndent + 4) return false
  let size = (cx.type == Type.OrderedList ? isOrderedList : isBulletList)(line, p, false)
  return (
    size > 0 &&
    (cx.type != Type.BulletList || isHorizontalRule(line) < 0) &&
    line.text.charCodeAt(line.start + size - 1) == cx.value
  )
}

const SkipMarkup: { [type: number]: (cx: BlockContext, p: Parse, line: Line) => boolean } = {
  [Type.Blockquote](cx, p, line) {
    if (line.next != 62 /* '>' */) return false
    line.markers.push(elt(Type.QuoteMark, p._pos + line.start, p._pos + line.start + 1))
    line.basePos = line.start + 2
    line.baseIndent = line.indent + 2
    line.moveStart(line.start + 1)
    cx.end = p._pos + line.text.length
    return true
  },
  [Type.ListItem](cx, _p, line) {
    if (line.indent < line.baseIndent + cx.value && line.next > -1) return false
    line.baseIndent += cx.value
    line.basePos += cx.value
    return true
  },
  [Type.OrderedList]: skipForList,
  [Type.BulletList]: skipForList,
  [Type.Document]() {
    return true
  },
}

let nodeTypes = [NodeType.none]
for (let i = 1, name; (name = Type[i]); i++) {
  nodeTypes[i] = NodeType.define({
    id: i,
    name,
    props:
      i >= Type.Escape
        ? []
        : [[NodeProp.group, i in SkipMarkup ? ["Block", "BlockContext"] : ["Block", "LeafBlock"]]],
  })
}

function space(ch: number) {
  return ch == 32 || ch == 9 || ch == 10 || ch == 13
}

// FIXME more incremental
function countIndent(line: string, to: number) {
  let indent = 0
  for (let i = 0; i < to; i++) indent += line.charCodeAt(i) == 9 ? 4 - (indent % 4) : 1
  return indent
}

function findIndent(line: string, goal: number) {
  let i = 0
  for (let indent = 0; i < line.length && indent < goal; i++)
    indent += line.charCodeAt(i) == 9 ? 4 - (indent % 4) : 1
  return i
}

function skipSpace(line: string, i = 0) {
  while (i < line.length && space(line.charCodeAt(i))) i++
  return i
}

function skipSpaceBack(line: string, i: number, to: number) {
  while (i > to && space(line.charCodeAt(i - 1))) i--
  return i
}

function isFencedCode(line: Line) {
  if (line.next != 96 && line.next != 126 /* '`~' */) return -1
  let pos = line.start + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) == line.next) pos++
  if (pos < line.start + 3) return -1
  if (line.next == 96)
    for (let i = pos; i < line.text.length; i++) if (line.text.charCodeAt(i) == 96) return -1
  return pos
}

function isBlockquote(line: Line) {
  return line.next != 62 /* '>' */ ? -1 : line.text.charCodeAt(line.start + 1) == 32 ? 2 : 1
}

function isHorizontalRule(line: Line) {
  if (line.next != 42 && line.next != 45 && line.next != 95 /* '-_*' */) return -1
  let count = 1
  for (let pos = line.start + 1; pos < line.text.length; pos++) {
    let ch = line.text.charCodeAt(pos)
    if (ch == line.next) count++
    else if (!space(ch)) return -1
  }
  return count < 3 ? -1 : 1
}

function inList(p: Parse, type: Type) {
  return (
    p.context.type == type ||
    (p.contextStack.length > 1 && p.contextStack[p.contextStack.length - 2].type == type)
  )
}

function isBulletList(line: Line, p: Parse, breaking: boolean) {
  return (line.next == 45 || line.next == 43 || line.next == 42) /* '-+*' */ &&
    (line.start == line.text.length - 1 || space(line.text.charCodeAt(line.start + 1))) &&
    (!breaking || inList(p, Type.BulletList) || skipSpace(line.text, line.start + 2) < line.text.length)
    ? 1
    : -1
}

function isOrderedList(line: Line, p: Parse, breaking: boolean) {
  let pos = line.start,
    next = line.next
  for (;;) {
    if (next >= 48 && next <= 57 /* '0-9' */) pos++
    else break
    if (pos == line.text.length) return -1
    next = line.text.charCodeAt(pos)
  }
  if (
    pos == line.start ||
    pos > line.start + 9 ||
    (next != 46 && next != 41) /* '.)' */ ||
    (pos < line.text.length - 1 && !space(line.text.charCodeAt(pos + 1))) ||
    (breaking &&
      !inList(p, Type.OrderedList) &&
      (skipSpace(line.text, pos + 1) == line.text.length ||
        pos > line.start + 1 ||
        line.next != 49)) /* '1' */
  )
    return -1
  return pos + 1 - line.start
}

function isAtxHeading(line: Line) {
  if (line.next != 35 /* '#' */) return -1
  let pos = line.start + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) == 35) pos++
  if (pos < line.text.length && line.text.charCodeAt(pos) != 32) return -1
  let size = pos - line.start
  return size > 6 ? -1 : size + 1
}

const EmptyLine = /^[ \t]*$/,
  CommentEnd = /-->/,
  ProcessingEnd = /\?>/
const HTMLBlockStyle = [
  [/^<(?:script|pre|style)(?:\s|>|$)/i, /<\/(?:script|pre|style)>/i],
  [/^\s*<!--/, CommentEnd],
  [/^\s*<\?/, ProcessingEnd],
  [/^\s*<![A-Z]/, />/],
  [/^\s*<!\[CDATA\[/, /\]\]>/],
  [
    /^\s*<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i,
    EmptyLine,
  ],
  [
    /^\s*(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(\s+[a-z:_][\w-.]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)\s*$/i,
    EmptyLine,
  ],
]

function isHTMLBlock(line: Line, _p: Parse, breaking: boolean) {
  if (line.next != 60 /* '<' */) return -1
  let rest = line.text.slice(line.start)
  for (let i = 0, e = HTMLBlockStyle.length - (breaking ? 1 : 0); i < e; i++)
    if (HTMLBlockStyle[i][0].test(rest)) return i
  return -1
}

function isSetextUnderline(line: Line) {
  if (line.next != 45 && line.next != 61 /* '-=' */) return -1
  let pos = line.start + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) == line.next) pos++
  while (pos < line.text.length && space(line.text.charCodeAt(pos))) pos++
  return pos == line.text.length ? 1 : -1
}

const BreakParagraph: ((line: Line, p: Parse, breaking: boolean) => number)[] = [
  isAtxHeading,
  isFencedCode,
  isBlockquote,
  isBulletList,
  isOrderedList,
  isHorizontalRule,
  isHTMLBlock,
]

function getListIndent(text: string, start: number) {
  let indentAfter = countIndent(text, start) + 1
  let indented = countIndent(text, skipSpace(text, start))
  return indented >= indentAfter + 4 ? indentAfter : indented
}

const enum ParseBlock {
  No,
  Done,
  Continue,
}

// Rules for parsing blocks. A return value of false means the rule
// doesn't apply here, true means it does. When true is returned and
// `p.line` has been updated, the rule is assumed to have consumed a
// leaf block. Otherwise, it is assumed to have opened a context.
const Blocks: ((p: Parse, line: Line) => ParseBlock)[] = [
  function indentedCode(p, line) {
    let base = line.baseIndent + 4
    if (line.indent < base) return ParseBlock.No
    let start = findIndent(line.text, base)
    let from = p._pos + start,
      end = p._pos + line.text.length
    let marks: Element[] = [],
      pendingMarks: Element[] = []
    for (; p.nextLine(); ) {
      if (line.depth < p.contextStack.length) break
      if (line.start == line.text.length) {
        // Empty
        for (let m of line.markers) pendingMarks.push(m)
      } else if (line.indent < base) {
        break
      } else {
        if (pendingMarks.length) {
          for (let m of pendingMarks) marks.push(m)
          pendingMarks = []
        }
        for (let m of line.markers) marks.push(m)
        end = p._pos + line.text.length
      }
    }
    if (pendingMarks.length) line.markers = pendingMarks.concat(line.markers)

    let nest = !marks.length && p.parser.codeParser && p.parser.codeParser("")
    if (nest)
      p.startNested(
        new NestedParse(
          from,
          nest.startParse(p.input.clip(end), from, p.parseContext),
          tree => new Tree(p.parser.nodeSet.types[Type.CodeBlock], [tree], [0], end - from),
        ),
      )
    else p.addNode(new Buffer(p).writeElements(marks, -from).finish(Type.CodeBlock, end - from), from)
    return ParseBlock.Done
  },

  function fencedCode(p, line) {
    let fenceEnd = isFencedCode(line)
    if (fenceEnd < 0) return ParseBlock.No
    let from = p._pos + line.start,
      ch = line.next,
      len = fenceEnd - line.start
    let infoFrom = skipSpace(line.text, fenceEnd),
      infoTo = skipSpaceBack(line.text, line.text.length, infoFrom)
    let marks: (Element | TreeElement)[] = [elt(Type.CodeMark, from, from + len)],
      info = ""
    if (infoFrom < infoTo) {
      marks.push(elt(Type.CodeInfo, p._pos + infoFrom, p._pos + infoTo))
      info = line.text.slice(infoFrom, infoTo)
    }
    let ownMarks = marks.length,
      startMarks = ownMarks
    let codeStart = p._pos + line.text.length + 1,
      codeEnd = -1

    for (; p.nextLine(); ) {
      if (line.depth < p.contextStack.length) break
      for (let m of line.markers) marks.push(m)
      let i = line.start
      if (line.indent - line.baseIndent < 4) while (i < line.text.length && line.text.charCodeAt(i) == ch) i++
      if (i - line.start >= len && skipSpace(line.text, i) == line.text.length) {
        marks.push(elt(Type.CodeMark, p._pos + line.start, p._pos + i))
        ownMarks++
        codeEnd = p._pos - 1
        p.nextLine()
        break
      }
    }
    let to = p.prevLineEnd()
    if (codeEnd < 0) codeEnd = to
    // (Don't try to nest if there are blockquote marks in the region.)
    let nest = marks.length == ownMarks && p.parser.codeParser && p.parser.codeParser(info)
    if (nest) {
      p.startNested(
        new NestedParse(from, nest.startParse(p.input.clip(codeEnd), codeStart, p.parseContext), tree => {
          marks.splice(startMarks, 0, new TreeElement(tree, codeStart))
          return elt(Type.FencedCode, from, to, marks).toTree(p.parser.nodeSet, -from)
        }),
      )
    } else {
      p.addNode(
        new Buffer(p).writeElements(marks, -from).finish(Type.FencedCode, p.prevLineEnd() - from),
        from,
      )
    }
    return ParseBlock.Done
  },

  function blockquote(p, line) {
    let size = isBlockquote(line)
    if (size < 0) return ParseBlock.No
    p.startContext(Type.Blockquote, line.start)
    p.addNode(Type.QuoteMark, p._pos + line.start, p._pos + line.start + 1)
    line.basePos = line.start + size
    line.baseIndent = line.indent + size
    line.moveStart(line.start + size)
    return ParseBlock.Continue
  },

  function horizontalRule(p, line) {
    if (isHorizontalRule(line) < 0) return ParseBlock.No
    let from = p._pos + line.start
    p.nextLine()
    p.addNode(Type.HorizontalRule, from)
    return ParseBlock.Done
  },

  function bulletList(p, line) {
    let size = isBulletList(line, p, false)
    if (size < 0) return ParseBlock.No
    let cxStart = findIndent(line.text, line.baseIndent)
    if (p.context.type != Type.BulletList) p.startContext(Type.BulletList, cxStart, line.next)
    let newBase = getListIndent(line.text, line.start + 1)
    p.startContext(Type.ListItem, cxStart, newBase - line.baseIndent)
    p.addNode(Type.ListMark, p._pos + line.start, p._pos + line.start + size)
    line.baseIndent = newBase
    line.basePos = findIndent(line.text, newBase)
    line.moveStart(Math.min(line.text.length, line.start + 2))
    return ParseBlock.Continue
  },

  function orderedList(p, line) {
    let size = isOrderedList(line, p, false)
    if (size < 0) return ParseBlock.No
    let cxStart = findIndent(line.text, line.baseIndent)
    if (p.context.type != Type.OrderedList)
      p.startContext(Type.OrderedList, cxStart, line.text.charCodeAt(line.start + size - 1))
    let newBase = getListIndent(line.text, line.start + size)
    p.startContext(Type.ListItem, cxStart, newBase - line.baseIndent)
    p.addNode(Type.ListMark, p._pos + line.start, p._pos + line.start + size)
    line.baseIndent = newBase
    line.basePos = findIndent(line.text, newBase)
    line.moveStart(Math.min(line.text.length, line.start + size + 1))
    return ParseBlock.Continue
  },

  function atxHeading(p, line) {
    let size = isAtxHeading(line)
    if (size < 0) return ParseBlock.No
    let off = line.start,
      from = p._pos + off
    let endOfSpace = skipSpaceBack(line.text, line.text.length, off),
      after = endOfSpace
    while (after > off && line.text.charCodeAt(after - 1) == line.next) after--
    if (after == endOfSpace || after == off || !space(line.text.charCodeAt(after - 1)))
      after = line.text.length
    let buf = new Buffer(p)
      .write(Type.HeaderMark, 0, size - 1)
      .writeElements(parseInline(p, line.text.slice(off + size, after)), size)
    if (after < line.text.length) buf.write(Type.HeaderMark, after - off, endOfSpace - off)
    let node = buf.finish(Type.ATXHeading, line.text.length - off)
    p.nextLine()
    p.addNode(node, from)
    return ParseBlock.Done
  },

  function htmlBlock(p, line) {
    let type = isHTMLBlock(line, p, false)
    if (type < 0) return ParseBlock.No
    let from = p._pos + line.start,
      end = HTMLBlockStyle[type][1]
    let marks: Element[] = [],
      trailing = end != EmptyLine
    while (!end.test(line.text) && p.nextLine()) {
      if (line.depth < p.contextStack.length) {
        trailing = false
        break
      }
      for (let m of line.markers) marks.push(m)
    }
    if (trailing) p.nextLine()
    let nodeType =
      end == CommentEnd
        ? Type.CommentBlock
        : end == ProcessingEnd
        ? Type.ProcessingInstructionBlock
        : Type.HTMLBlock
    let to = p.prevLineEnd()
    if (!marks.length && nodeType == Type.HTMLBlock && p.parser.htmlParser) {
      p.startNested(
        new NestedParse(
          from,
          p.parser.htmlParser.startParse(p.input.clip(to), from, p.parseContext),
          tree => new Tree(p.parser.nodeSet.types[nodeType], [tree], [0], to - from),
        ),
      )
      return ParseBlock.Done
    }
    p.addNode(new Buffer(p).writeElements(marks, -from).finish(nodeType, to - from), from)
    return ParseBlock.Done
  },

  function paragraph(p, line) {
    let from = p._pos + line.start,
      content = line.text.slice(line.start),
      marks: Element[] = []
    let heading = false
    lines: for (; p.nextLine(); ) {
      if (line.start == line.text.length) break
      if (line.indent < line.baseIndent + 4) {
        if (isSetextUnderline(line) > -1 && line.depth == p.contextStack.length) {
          for (let m of line.markers) marks.push(m)
          heading = true
          break
        }
        for (let check of BreakParagraph) if (check(line, p, true) >= 0) break lines
      }
      for (let m of line.markers) marks.push(m)
      content += "\n"
      content += line.text
    }

    content = clearMarks(content, marks, from)
    for (;;) {
      let ref = parseLinkReference(p, content)
      if (!ref) break
      p.addNode(ref, from)
      if (content.length <= ref.length + 1 && !heading) return ParseBlock.Done
      content = content.slice(ref.length + 1)
      from += ref.length + 1
      // FIXME these are dropped, but should be added to the ref (awkward!)
      while (marks.length && marks[0].to <= from) marks.shift()
    }

    let inline = injectMarks(parseInline(p, content), marks, from)
    if (heading) {
      let node = new Buffer(p)
        .writeElements(inline)
        .write(Type.HeaderMark, p._pos - from, p._pos + line.text.length - from)
        .finish(Type.SetextHeading, p._pos + line.text.length - from)
      p.nextLine()
      p.addNode(node, from)
    } else {
      p.addNode(new Buffer(p).writeElements(inline).finish(Type.Paragraph, content.length), from)
    }
    return ParseBlock.Done
  },
]

class NestedParse {
  constructor(
    readonly from: number,
    readonly parser: PartialParse,
    readonly finish: (tree: Tree) => Tree | TreeBuffer,
  ) {}
}

class Parse implements PartialParse {
  context: BlockContext
  contextStack: BlockContext[]
  line = new Line()
  private atEnd = false
  private fragments: FragmentCursor | null
  private nested: NestedParse | null = null

  _pos: number

  constructor(
    readonly parser: MarkdownParser,
    readonly input: Input,
    startPos: number,
    readonly parseContext: ParseContext,
  ) {
    this._pos = startPos
    this.context = BlockContext.create(Type.Document, 0, this._pos, 0, 0)
    this.contextStack = [this.context]
    this.fragments = parseContext.fragments ? new FragmentCursor(parseContext.fragments, input) : null
    this.updateLine(input.lineAfter(this._pos))
  }

  get pos() {
    return this.nested ? this.nested.parser.pos : this._pos
  }

  advance() {
    if (this.nested) {
      let done = this.nested.parser.advance()
      if (done) {
        this.addNode(this.nested.finish(done), this.nested.from)
        this.nested = null
      }
      return null
    }

    let { line } = this
    for (;;) {
      while (line.depth < this.contextStack.length) this.finishContext()
      for (let mark of line.markers) this.addNode(mark.type, mark.from, mark.to)
      if (line.start < line.text.length) break
      // Empty line
      if (!this.nextLine()) return this.finish()
    }

    if (this.fragments && this.reuseFragment(line.basePos)) return null
    for (;;) {
      for (let type of Blocks) {
        let result = type(this, line)
        if (result != ParseBlock.No) {
          if (result == ParseBlock.Done) return null
          break
        }
      }
    }
  }

  private reuseFragment(start: number) {
    if (!this.fragments!.moveTo(this._pos + start, this._pos) || !this.fragments!.matches(this.context.hash))
      return false
    let taken = this.fragments!.takeNodes(this)
    if (!taken) return false
    this._pos += taken
    if (this._pos < this.input.length) {
      this._pos++
      this.updateLine(this.input.lineAfter(this._pos))
    } else {
      this.atEnd = true
      this.updateLine("")
    }
    return true
  }

  nextLine() {
    this._pos += this.line.text.length
    if (this._pos >= this.input.length) {
      this.atEnd = true
      this.updateLine("")
      return false
    } else {
      this._pos++
      this.updateLine(this.input.lineAfter(this._pos))
      return true
    }
  }

  updateLine(text: string) {
    let { line } = this
    line.reset(text)
    for (; line.depth < this.contextStack.length; line.depth++) {
      let cx = this.contextStack[line.depth],
        handler = SkipMarkup[cx.type]
      if (!handler) throw new Error("Unhandled block context " + Type[cx.type])
      if (!handler(cx, this, line)) break
    }
  }

  prevLineEnd() {
    return this.atEnd ? this._pos : this._pos - 1
  }

  startContext(type: Type, start: number, value = 0) {
    this.context = BlockContext.create(
      type,
      value,
      this._pos + start,
      this.context.hash,
      this._pos + this.line.text.length,
    )
    this.contextStack.push(this.context)
  }

  addNode(block: Type | Tree | TreeBuffer, from: number, to?: number) {
    if (typeof block == "number")
      block = new Tree(
        this.parser.nodeSet.types[block],
        none,
        none,
        (to != null ? to : this.prevLineEnd()) - from,
      )
    this.context.children.push(block)
    this.context.positions.push(from - this.context.from)
  }

  startNested(parse: NestedParse) {
    this.nested = parse
  }

  finishContext() {
    this.context = finishContext(this.contextStack, this.parser.nodeSet)
  }

  private finish() {
    while (this.contextStack.length > 1) this.finishContext()
    return this.context.toTree(this.parser.nodeSet, this._pos)
  }

  forceFinish() {
    let cx = this.contextStack.map(cx => cx.copy())
    if (this.nested) {
      let inner = cx[cx.length - 1]
      inner.children.push(this.nested.parser.forceFinish())
      inner.positions.push(this.nested.from - inner.from)
    }
    while (cx.length > 1) finishContext(cx, this.parser.nodeSet)
    return cx[0].toTree(this.parser.nodeSet, this._pos)
  }
}

/// The type that nested parsers should conform to.
export type InnerParser = {
  startParse(input: Input, startPos: number, context: ParseContext): PartialParse
}

export class MarkdownParser {
  /// @internal
  constructor(
    readonly nodeSet: NodeSet,
    readonly codeParser: null | ((info: string) => null | InnerParser),
    readonly htmlParser: null | InnerParser,
  ) {}

  /// Start a parse on the given input.
  startParse(input: Input, startPos = 0, parseContext: ParseContext = {}): PartialParse {
    return new Parse(this, input, startPos, parseContext)
  }

  /// Reconfigure the parser.
  configure(config: {
    /// Node props to add to the parser's node set.
    props?: readonly NodePropSource[]
    /// When provided, this will be used to parse the content of code
    /// blocks. `info` is the string after the opening ` ``` ` marker,
    /// or the empty string if there is no such info or this is an
    /// indented code block. If there is a parser available for the
    /// code, it should return a function that can construct the
    /// [partse](#lezer.PartialParse).
    codeParser?: (info: string) => null | InnerParser
    /// The parser used to parse HTML tags (both block and inline).
    htmlParser?: InnerParser
  }) {
    return new MarkdownParser(
      config.props ? this.nodeSet.extend(...config.props) : this.nodeSet,
      config.codeParser || this.codeParser,
      config.htmlParser || this.htmlParser,
    )
  }
}

export const parser = new MarkdownParser(new NodeSet(nodeTypes), null, null)

function finishContext(stack: BlockContext[], nodeSet: NodeSet): BlockContext {
  let cx = stack.pop()!
  let top = stack[stack.length - 1]
  top.children.push(cx.toTree(nodeSet))
  top.positions.push(cx.from - top.from)
  return top
}

const none: readonly any[] = []

class Buffer {
  content: number[] = []
  nodeSet: NodeSet
  nodes: (Tree | TreeBuffer)[] = []
  constructor(p: Parse) {
    this.nodeSet = p.parser.nodeSet
  }

  write(type: Type, from: number, to: number, children = 0) {
    this.content.push(type, from, to, 4 + children * 4)
    return this
  }

  writeElements(elts: readonly (Element | TreeElement)[], offset = 0) {
    for (let e of elts) e.writeTo(this, offset)
    return this
  }

  finish(type: Type, length: number) {
    return Tree.build({
      buffer: this.content,
      nodeSet: this.nodeSet,
      reused: this.nodes,
      topID: type,
      length,
    })
  }
}

class Element {
  constructor(
    readonly type: Type,
    readonly from: number,
    readonly to: number,
    readonly children: readonly (Element | TreeElement)[] | null = null,
  ) {}

  writeTo(buf: Buffer, offset: number) {
    let startOff = buf.content.length
    if (this.children) buf.writeElements(this.children, offset)
    buf.content.push(this.type, this.from + offset, this.to + offset, buf.content.length + 4 - startOff)
  }

  toTree(nodeSet: NodeSet, offset: number): Tree | TreeBuffer {
    return new Tree(
      nodeSet.types[this.type],
      this.children ? this.children.map(ch => ch.toTree(nodeSet, this.from)) : [],
      this.children ? this.children.map(ch => ch.from + offset) : [],
      this.to - this.from,
    )
  }
}

class TreeElement {
  constructor(readonly tree: Tree | TreeBuffer, readonly from: number) {}

  get to() {
    return this.from + this.tree.length
  }

  writeTo(buf: Buffer, offset: number) {
    buf.nodes.push(this.tree)
    buf.content.push(buf.nodes.length - 1, this.from + offset, this.to + offset, -1)
  }

  toTree(): Tree | TreeBuffer {
    return this.tree
  }
}

function elt(type: Type, from: number, to: number, children?: readonly (Element | TreeElement)[]) {
  return new Element(type, from, to, children)
}

const enum Mark {
  Open = 1,
  Close = 2,
}

class InlineMarker {
  constructor(readonly type: Type, readonly from: number, readonly to: number, public value: number) {}
}

const Escapable = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

let Punctuation = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1\u2010-\u2027]/
try {
  Punctuation = /[\p{Pc}|\p{Pd}|\p{Pe}|\p{Pf}|\p{Pi}|\p{Po}|\p{Ps}]/u
} catch (_) {}

const InlineTokens: ((cx: InlineContext, next: number, pos: number) => number)[] = [
  function escape(cx, next, start) {
    if (next != 92 /* '\\' */ || start == cx.text.length - 1) return -1
    let escaped = cx.text.charCodeAt(start + 1)
    for (let i = 0; i < Escapable.length; i++)
      if (Escapable.charCodeAt(i) == escaped) return cx.append(elt(Type.Escape, start, start + 2))
    return -1
  },

  function entity(cx, next, start) {
    if (next != 38 /* '&' */) return -1
    let m = /^(?:#\d+|#x[a-f\d]+|\w+);/i.exec(cx.text.slice(start + 1, start + 31))
    return m ? cx.append(elt(Type.Entity, start, start + 1 + m[0].length)) : -1
  },

  function code(cx, next, start) {
    if (next != 96 /* '`' */ || (start && cx.text.charCodeAt(start - 1) == 96)) return -1
    let pos = start + 1
    while (pos < cx.text.length && cx.text.charCodeAt(pos) == 96) pos++
    let size = pos - start,
      curSize = 0
    for (; pos < cx.text.length; pos++) {
      if (cx.text.charCodeAt(pos) == 96) {
        curSize++
        if (curSize == size && cx.text.charCodeAt(pos + 1) != 96)
          return cx.append(
            elt(Type.InlineCode, start, pos + 1, [
              elt(Type.CodeMark, start, start + size),
              elt(Type.CodeMark, pos + 1 - size, pos + 1),
            ]),
          )
      } else {
        curSize = 0
      }
    }
    return -1
  },

  function htmlTagOrURL(cx, next, start) {
    if (next != 60 /* '<' */ || start == cx.text.length - 1) return -1
    let after = cx.text.slice(start + 1)
    let url = /^(?:[a-z][-\w+.]+:[^\s>]+|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*)>/i.exec(
      after,
    )
    if (url) return cx.append(elt(Type.URL, start, start + 1 + url[0].length))
    let comment = /^!--[^>](?:-[^-]|[^-])*?-->/i.exec(after)
    if (comment) return cx.append(elt(Type.Comment, start, start + 1 + comment[0].length))
    let procInst = /^\?[^]*?\?>/.exec(after)
    if (procInst) return cx.append(elt(Type.ProcessingInstruction, start, start + 1 + procInst[0].length))
    let m = /^(?:![A-Z][^]*?>|!\[CDATA\[[^]*?\]\]>|\/\s*[a-zA-Z][\w-]*\s*>|\s*[a-zA-Z][\w-]*(\s+[a-zA-Z:_][\w-.:]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*(\/\s*)?>)/.exec(
      after,
    )
    if (!m) return -1
    let children: TreeElement[] = []
    if (cx.parser.htmlParser) {
      let p = cx.parser.htmlParser.startParse(
          stringInput(cx.text.slice(start, start + 1 + m[0].length)),
          0,
          {},
        ),
        tree: Tree | null
      while (!(tree = p.advance())) {}
      children = tree.children.map((ch, i) => new TreeElement(ch, start + tree!.positions[i]))
    }
    return cx.append(elt(Type.HTMLTag, start, start + 1 + m[0].length, children))
  },

  function emphasis(cx, next, start) {
    if (next != 95 && next != 42) return -1
    let pos = start + 1
    while (pos < cx.text.length && cx.text.charCodeAt(pos) == next) pos++
    let before = cx.text.charAt(start - 1),
      after = cx.text.charAt(pos)
    let pBefore = Punctuation.test(before),
      pAfter = Punctuation.test(after)
    let sBefore = /\s|^$/.test(before),
      sAfter = /\s|^$/.test(after)
    let leftFlanking = !sAfter && (!pAfter || sBefore || pBefore)
    let rightFlanking = !sBefore && (!pBefore || sAfter || pAfter)
    let canOpen = leftFlanking && (next == 42 || !rightFlanking || pBefore)
    let canClose = rightFlanking && (next == 42 || !leftFlanking || pAfter)
    return cx.append(
      new InlineMarker(Type.Emphasis, start, pos, (canOpen ? Mark.Open : 0) | (canClose ? Mark.Close : 0)),
    )
  },

  function hardBreak(cx, next, start) {
    if (next == 92 /* '\\' */ && cx.text.charCodeAt(start + 1) == 10 /* '\n' */)
      return cx.append(elt(Type.HardBreak, start, start + 2))
    if (next == 32) {
      let pos = start + 1
      while (pos < cx.text.length && cx.text.charCodeAt(pos) == 32) pos++
      if (cx.text.charCodeAt(pos) == 10 && pos >= start + 2)
        return cx.append(elt(Type.HardBreak, start, pos + 1))
    }
    return -1
  },

  function linkOpen(cx, next, start) {
    return next == 91 /* '[' */ ? cx.append(new InlineMarker(Type.Link, start, start + 1, 1)) : -1
  },

  function imageOpen(cx, next, start) {
    return next == 33 /* '!' */ && start < cx.text.length - 1 && cx.text.charCodeAt(start + 1) == 91 /* '[' */
      ? cx.append(new InlineMarker(Type.Image, start, start + 2, 1))
      : -1
  },

  function linkEnd(cx, next, start) {
    if (next != 93 /* ']' */) return -1
    for (let i = cx.parts.length - 1; i >= 0; i--) {
      let part = cx.parts[i]
      if (part instanceof InlineMarker && (part.type == Type.Link || part.type == Type.Image)) {
        if (!part.value) {
          cx.parts[i] = null
          return -1
        }
        if (skipSpace(cx.text, part.to) == start && !/[(\[]/.test(cx.text[start + 1])) return -1
        let content = cx.resolveMarkers(i + 1)
        cx.parts.length = i
        let link = (cx.parts[i] = finishLink(cx.text, content, part.type, part.from, start + 1))
        for (let j = 0; j < i; j++) {
          let p = cx.parts[j]
          if (part.type == Type.Link && p instanceof InlineMarker && p.type == Type.Link) p.value = 0
        }
        return link.to
      }
    }
    return -1
  },
]

function finishLink(text: string, content: Element[], type: Type, start: number, startPos: number) {
  let next = startPos < text.length ? text.charCodeAt(startPos) : -1,
    endPos = startPos
  content.unshift(elt(Type.LinkMark, start, start + (type == Type.Image ? 2 : 1)))
  content.push(elt(Type.LinkMark, startPos - 1, startPos))
  if (next == 40 /* '(' */) {
    let pos = skipSpace(text, startPos + 1)
    let dest = parseURL(text, pos),
      title
    if (dest) {
      pos = skipSpace(text, dest.to)
      title = parseLinkTitle(text, pos)
      if (title) pos = skipSpace(text, title.to)
    }
    if (text.charCodeAt(pos) == 41 /* ')' */) {
      content.push(elt(Type.LinkMark, startPos, startPos + 1))
      endPos = pos + 1
      if (dest) content.push(dest)
      if (title) content.push(title)
      content.push(elt(Type.LinkMark, pos, endPos))
    }
  } else if (next == 91 /* '[' */) {
    let label = parseLinkLabel(text, startPos, false)
    if (label) {
      content.push(label)
      endPos = label.to
    }
  }
  return elt(type, start, endPos, content)
}

function parseURL(text: string, start: number) {
  let next = text.charCodeAt(start)
  if (next == 60 /* '<' */) {
    for (let pos = start + 1; pos < text.length; pos++) {
      let ch = text.charCodeAt(pos)
      if (ch == 62 /* '>' */) return elt(Type.URL, start, pos + 1)
      if (ch == 60 || ch == 10 /* '<\n' */) break
    }
    return null
  } else {
    let depth = 0,
      pos = start
    for (let escaped = false; pos < text.length; pos++) {
      let ch = text.charCodeAt(pos)
      if (space(ch)) {
        break
      } else if (escaped) {
        escaped = false
      } else if (ch == 40 /* '(' */) {
        depth++
      } else if (ch == 41 /* ')' */) {
        if (!depth) break
        depth--
      } else if (ch == 92 /* '\\' */) {
        escaped = true
      }
    }
    return pos > start ? elt(Type.URL, start, pos) : null
  }
}

function parseLinkTitle(text: string, start: number) {
  let next = text.charCodeAt(start)
  if (next != 39 && next != 34 && next != 40 /* '"\'(' */) return null
  let end = next == 40 ? 41 : next
  for (let pos = start + 1, escaped = false; pos < text.length; pos++) {
    let ch = text.charCodeAt(pos)
    if (escaped) escaped = false
    else if (ch == end) return elt(Type.LinkTitle, start, pos + 1)
    else if (ch == 92 /* '\\' */) escaped = true
  }
  return null
}

function parseLinkLabel(text: string, start: number, requireNonWS: boolean) {
  for (let escaped = false, pos = start + 1, end = Math.min(text.length, pos + 999); pos < end; pos++) {
    let ch = text.charCodeAt(pos)
    if (escaped) escaped = false
    else if (ch == 93 /* ']' */) return requireNonWS ? null : elt(Type.LinkLabel, start, pos + 1)
    else {
      if (requireNonWS && !space(ch)) requireNonWS = false
      if (ch == 91 /* '[' */) break
      else if (ch == 92 /* '\\' */) escaped = true
    }
  }
  return null
}

function lineEnd(text: string, pos: number) {
  for (; pos < text.length; pos++) {
    let next = text.charCodeAt(pos)
    if (next == 10) break
    if (!space(next)) return -1
  }
  return pos
}

function parseLinkReference(p: Parse, text: string) {
  if (text.charCodeAt(0) != 91 /* '[' */) return null
  let ref = parseLinkLabel(text, 0, true)
  if (!ref || text.charCodeAt(ref.to) != 58 /* ':' */) return null
  let elts = [ref, elt(Type.LinkMark, ref.to, ref.to + 1)]
  let url = parseURL(text, skipSpace(text, ref.to + 1))
  if (!url) return null
  elts.push(url)
  let pos = skipSpace(text, url.to),
    title,
    end = 0
  if (pos > url.to && (title = parseLinkTitle(text, pos))) {
    let afterURL = lineEnd(text, title.to)
    if (afterURL > 0) {
      elts.push(title)
      end = afterURL
    }
  }
  if (end == 0) end = lineEnd(text, url.to)
  return end < 0 ? null : new Buffer(p).writeElements(elts).finish(Type.LinkReference, end)
}

class InlineContext {
  parts: (Element | InlineMarker | null)[] = []

  constructor(readonly parser: MarkdownParser, readonly text: string) {}

  append(elt: Element | InlineMarker) {
    this.parts.push(elt)
    return elt.to
  }

  resolveMarkers(from: number) {
    for (let i = from; i < this.parts.length; i++) {
      let close = this.parts[i]
      if (!(close instanceof InlineMarker && close.type == Type.Emphasis && close.value & Mark.Close))
        continue

      let type = this.text.charCodeAt(close.from),
        closeSize = close.to - close.from
      let open: InlineMarker | undefined,
        openSize = 0,
        j = i - 1
      for (; j >= from; j--) {
        let part = this.parts[j] as InlineMarker
        if (
          !(part instanceof InlineMarker && part.value & Mark.Open && this.text.charCodeAt(part.from) == type)
        )
          continue
        openSize = part.to - part.from
        if (
          !(close.value & Mark.Open || part.value & Mark.Close) ||
          (openSize + closeSize) % 3 ||
          (openSize % 3 == 0 && closeSize % 3 == 0)
        ) {
          open = part
          break
        }
      }
      if (!open) continue

      let size = Math.min(2, openSize, closeSize)
      let start = open.to - size,
        end: number = close.from + size,
        content = [elt(Type.EmphasisMark, start, open.to)]
      for (let k = j + 1; k < i; k++) {
        if (this.parts[k] instanceof Element) content.push(this.parts[k] as Element)
        this.parts[k] = null
      }
      content.push(elt(Type.EmphasisMark, close.from, end))
      let element = elt(
        size == 1 ? Type.Emphasis : Type.StrongEmphasis,
        open.to - size,
        close.from + size,
        content,
      )
      this.parts[j] = open.from == start ? null : new InlineMarker(open.type, open.from, start, open.value)
      let keep = (this.parts[i] =
        close.to == end ? null : new InlineMarker(close.type, end, close.to, close.value))
      if (keep) this.parts.splice(i, 0, element)
      else this.parts[i] = element
    }

    let result: Element[] = []
    for (let i = from; i < this.parts.length; i++) {
      let part = this.parts[i]
      if (part instanceof Element) result.push(part)
    }
    return result
  }
}

function parseInline(p: Parse, text: string) {
  let cx = new InlineContext(p.parser, text)
  outer: for (let pos = 0; pos < text.length; ) {
    let next = text.charCodeAt(pos)
    for (let token of InlineTokens) {
      let result = token(cx, next, pos)
      if (result >= 0) {
        pos = result
        continue outer
      }
    }
    pos++
  }
  return cx.resolveMarkers(0)
}

function clearMarks(content: string, marks: Element[], offset: number) {
  if (!marks.length) return content
  let result = "",
    pos = 0
  for (let m of marks) {
    let from = m.from - offset,
      to = m.to - offset
    result += content.slice(pos, from)
    for (let i = from; i < to; i++) result += " "
    pos = to
  }
  result += content.slice(pos)
  return result
}

function injectMarks(elts: (Element | TreeElement)[], marks: Element[], offset: number) {
  let eI = 0
  for (let mark of marks) {
    let m = elt(mark.type, mark.from - offset, mark.to - offset)
    while (eI < elts.length && elts[eI].to < m.to) eI++
    if (eI < elts.length && elts[eI].from < m.from) {
      let e = elts[eI]
      if (e instanceof Element)
        elts[eI] = new Element(
          e.type,
          e.from,
          e.to,
          e.children ? injectMarks(e.children.slice(), [m], 0) : [m],
        )
    } else {
      elts.splice(eI++, 0, m)
    }
  }
  return elts
}

const ContextHash = new WeakMap<Tree | TreeBuffer, number>()

function stampContext(nodes: readonly (Tree | TreeBuffer)[], hash: number) {
  for (let n of nodes) {
    ContextHash.set(n, hash)
    if (n instanceof Tree && n.type.isAnonymous) stampContext(n.children, hash)
  }
}

// These are blocks that can span blank lines, and should thus only be
// reused if their next sibling is also being reused.
const NotLast = [Type.CodeBlock, Type.ListItem, Type.OrderedList, Type.BulletList]

class FragmentCursor {
  // Index into fragment array
  i = 0
  // Active fragment
  fragment: TreeFragment | null = null
  fragmentEnd = -1
  // Cursor into the current fragment, if any. When `moveTo` returns
  // true, this points at the first block after `pos`.
  cursor: TreeCursor | null = null

  constructor(readonly fragments: readonly TreeFragment[], readonly input: Input) {
    if (fragments.length) this.fragment = fragments[this.i++]
  }

  nextFragment() {
    this.fragment = this.i < this.fragments.length ? this.fragments[this.i++] : null
    this.cursor = null
    this.fragmentEnd = -1
  }

  moveTo(pos: number, lineStart: number) {
    while (this.fragment && this.fragment.to <= pos) this.nextFragment()
    if (!this.fragment || this.fragment.from > (pos ? pos - 1 : 0)) return false
    if (this.fragmentEnd < 0) {
      let end = this.fragment.to
      while (end > 0 && this.input.get(end - 1) != 10) end--
      this.fragmentEnd = end ? end - 1 : 0
    }

    let c = this.cursor
    if (!c) {
      c = this.cursor = this.fragment.tree.cursor()
      c.firstChild()
    }

    let rPos = pos + this.fragment.offset
    while (c.to <= rPos) if (!c.parent()) return false
    for (;;) {
      if (c.from >= rPos) return this.fragment.from <= lineStart
      if (!c.childAfter(rPos)) return false
    }
  }

  matches(hash: number) {
    let tree = this.cursor!.tree
    return tree && ContextHash.get(tree) == hash
  }

  takeNodes(p: Parse) {
    let cur = this.cursor!,
      off = this.fragment!.offset
    let start = p._pos,
      end = start,
      blockI = p.context.children.length
    let prevEnd = end,
      prevI = blockI
    for (;;) {
      if (cur.to - off >= this.fragmentEnd) {
        if (cur.type.isAnonymous && cur.firstChild()) continue
        break
      }
      p.addNode(cur.tree!, cur.from - off)
      // Taken content must always end in a block, because incremental
      // parsing happens on block boundaries. Never stop directly
      // after an indented code block, since those can continue after
      // any number of blank lines.
      if (cur.type.is("Block")) {
        if (NotLast.indexOf(cur.type.id) < 0) {
          end = cur.to - off
          blockI = p.context.children.length
        } else {
          end = prevEnd
          blockI = prevI
          prevEnd = cur.to - off
          prevI = p.context.children.length
        }
      }
      if (!cur.nextSibling()) break
    }
    while (p.context.children.length > blockI) {
      p.context.children.pop()
      p.context.positions.pop()
    }
    return end - start
  }
}
