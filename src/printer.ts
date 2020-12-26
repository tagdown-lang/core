import { Tag, Content } from "./types"
import { assert, log } from "./utils"
import { parseContents, parseEscapeContents, ParseTag, ContentsLayout } from "./parser"

class PrintTag implements Tag {
  isQuoted: boolean
  isAttribute: boolean
  name: string
  isLiteral: boolean

  attributes: PrintTag[]
  contents: PrintContent[]

  contentsLayout: ContentsLayout

  constructor(tag: Tag) {
    assert(
      !tag.isLiteral || (tag.contents.length === 1 && typeof tag.contents[0] === "string"),
      "expected literal to have a single text as contents",
    )
    // tag.attributes.forEach(tag => assert(tag.isAttribute, "expected attribute to be marked as such"))
    tag.attributes.forEach(tag => (tag.isAttribute = true))
    this.isQuoted = tag.isQuoted
    this.isAttribute = tag.isAttribute
    this.name = tag.name
    this.isLiteral = tag.isLiteral
    this.attributes = tag.attributes.map(attr => new PrintTag(attr))
    this.contents = tag.contents.map(content =>
      typeof content === "string" ? content : new PrintTag(content),
    )
    this.contentsLayout = tag.contents.length === 0 ? ContentsLayout.Atom : ContentsLayout.Brace
  }

  get isInline() {
    return this.contentsLayout === ContentsLayout.Atom || this.contentsLayout === ContentsLayout.Brace
  }

  get isLineBased() {
    return this.contentsLayout === ContentsLayout.Line || this.contentsLayout === ContentsLayout.Indent
  }
}

type PrintContent = string | PrintTag

function layoutTag(tag: PrintTag, parentTag?: PrintTag): void {
  tag.attributes.forEach(attr => layoutTag(attr, tag))
  layoutContents(tag.contents, tag)
  if (tag.attributes.length > 2) tag.contentsLayout = ContentsLayout.Indent
  else if (tag.contentsLayout !== ContentsLayout.Indent) {
    let hasLineTag = false
    for (const attr of tag.attributes) {
      if (hasLineTag || !attr.isInline) {
        tag.contentsLayout = ContentsLayout.Indent
        break
      }
      if (attr.contentsLayout === ContentsLayout.Line) hasLineTag = true
    }
  }
  if (tag.contentsLayout === ContentsLayout.Indent) {
    for (const attr of tag.attributes) {
      if (attr.contentsLayout === ContentsLayout.Brace) attr.contentsLayout = ContentsLayout.Line
    }
  }
  if (!(parentTag !== undefined)) return
  if (
    parentTag.contentsLayout === ContentsLayout.Brace &&
    (tag.contentsLayout === ContentsLayout.Line || tag.contentsLayout === ContentsLayout.Indent)
  ) {
    parentTag.contentsLayout = ContentsLayout.Line
  }
}

function layoutContents(contents: PrintContent[], tag?: PrintTag): void {
  for (const content of contents) {
    if (typeof content !== "string") layoutTag(content, tag)
  }
  if (!(tag !== undefined)) return
  if (tag.contentsLayout === ContentsLayout.Indent) return
  let hasLineTag = false
  for (const content of contents) {
    if (
      hasLineTag ||
      (typeof content === "string" && /(?:\r?\n|\r)/.test(content)) ||
      (typeof content !== "string" && content.contentsLayout === ContentsLayout.Indent)
    ) {
      tag.contentsLayout = ContentsLayout.Indent
      return
    }
    if (typeof content !== "string" && content.contentsLayout === ContentsLayout.Line) {
      hasLineTag = true
    }
  }
  if (tag?.isLiteral) {
    let unbalancedLeft = 0
    let unbalancedRight = 0
    for (const chr of contents[0] as string) {
      if (chr === "{") unbalancedLeft++
      else if (chr === "}") {
        if (unbalancedLeft > 0) unbalancedLeft--
        else unbalancedRight++
      }
    }
    if (unbalancedLeft > 0 || unbalancedRight > 0) tag.contentsLayout = ContentsLayout.Line
  }
}

function escapeTagName(tag: PrintTag): string {
  const s = tag.name
  let name = ""
  let p = 0
  if ("\\'@".includes(s[p])) {
    name += "\\"
    p++
  }
  let startPos = 0
  for (; p < s.length; p++) {
    if ("\\{}:".includes(s[p])) {
      // log("cant")
      name += s.substring(startPos, p) + "\\"
      startPos = p
    }
  }
  name += s.substring(startPos, p)
  if (tag.contentsLayout === ContentsLayout.Atom && tag.attributes.length === 0) {
    // if (tag.contentsLayout === ContentsLayout.Atom || tag.contentsLayout === ContentsLayout.Brace) {
    // if (true) {
    const m = name.match(/='?$/)
    if (m !== null) {
      name = name.substring(0, name.length - m[0].length) + "\\" + m[0]
    }
  }
  return name
}

function escapeTag(tag: PrintTag): void {
  tag.name = escapeTagName(tag)
  for (const attr of tag.attributes) {
    escapeTag(attr)
  }
  escapeContents(tag.contents, tag)
}

function escapeEmptyLines(text: string, isLastContent: boolean, tag?: PrintTag, prevTag?: PrintTag): string {
  const lines = text.split(/(\r?\n|\r)/)
  text = ""
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (
      i % 2 === 0 &&
      (i + 1 !== lines.length || (isLastContent && (tag === undefined || tag.isLineBased)))
    ) {
      if (line.endsWith("$")) {
        line = line.substring(0, line.length - "$".length) + "\\$"
      } else if (
        (line === "" && (lines.length > 1 || (prevTag !== undefined && prevTag.isLineBased))) ||
        line.trimEnd() !== line
      ) {
        line += "$"
      }
    }
    text += line
  }
  return text
}

function escapeTexts(contents: PrintContent[], tag?: PrintTag): void {
  // FIXME
  // const escapeClosingBrace = tag?.contentsLayout === ContentsLayout.Brace
  const escapeClosingBrace = true
  const oldContents: PrintContent[] = [...contents]
  const newContents: PrintContent[] = []
  let raw = ""
  let input = ""
  const texts: string[] = []
  for (const content of contents) {
    if (typeof content === "string") {
      texts.push(content)
    }
  }
  // log("escapeTexts", texts)
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    raw += text
    // log(
    //   text,
    //   text.replace(/\\/g, "\\\\"),
    //   escapeEmptyLines(text.replace(/\\/g, "\\\\"), i + 1 === texts.length),
    // )
    // input += escapeEmptyLines(text, i + 1 === texts.length)
    input += text
  }
  function escapeLayout(text: string): void {
    // log("escapeLayout", text)
    escapeTexts2(text, escapeClosingBrace ? "{}" : "{")
  }
  let oldText = ""
  let newText = ""
  function escapeText(text: string, chrs: string): void {
    chrs = "\\" + chrs
    let startPos = 0
    let p: number
    let candidates: number[] = []
    let escapes: number[] = []
    for (p = 0; p < text.length; p++) {
      if (text[p] === "{") {
        candidates.push(p)
      } else if (text[p] === "}") {
        candidates.pop()
      } else if ("\n\r".includes(text[p])) {
        candidates = []
      } else if (text[p] === ":" && candidates.length > 0) {
        if (p - 1 === escapes[escapes.length - 1]) {
          candidates = []
        } else {
          escapes.push(...candidates)
        }
      }
    }
    for (p = 0; p < text.length; p++) {
      if (p === escapes[0] || chrs.includes(text[p])) {
        if (p === escapes[0]) escapes.shift()
        newText += text.substring(startPos, p) + "\\"
        startPos = p
      }
    }
    newText += text.substring(startPos, p)
    // log("escapeText", text, newText)
  }
  function escapeTexts2(text: string, chrs: string): void {
    // log("escapeTexts2", text, oldText, oldContents)
    while (text !== "") {
      if (oldText === "") {
        while (oldContents.length > 0) {
          if (typeof oldContents[0] === "string") {
            oldText = oldContents.shift() as string
            break
          } else {
            newContents.push(oldContents.shift()!)
          }
        }
        assert(oldContents.length > 0 || oldText !== "", "expected more old contents")
      }
      if (text.length >= oldText.length) {
        // log("if", text, oldText, text.substring(oldText.length), text.substring(0, oldText.length))
        escapeText(text.substring(0, oldText.length), chrs)
        newContents.push(newText)
        newText = ""
        text = text.substring(oldText.length)
        oldText = ""
      } else {
        // log("else", text)
        escapeText(text, chrs)
        oldText = oldText.substring(text.length)
        text = ""
      }
    }
  }
  function escapeTag(tag: ParseTag) {
    // log("escapeTag")
    let startPos = tag.range!.start
    let attr
    for (attr of tag.attributes) {
      // log("before1")
      escapeLayout(raw.substring(startPos, attr.range!.start))
      escapeTag(attr)
      startPos = attr.range!.end
    }
    if (tag.contents.length > 0) {
      // log("before2")
      escapeLayout(raw.substring(startPos, tag.contentsRange!.start))
      escapeContents(tag.contents)
      startPos = tag.contentsRange!.end
    }
    // log("before3")
    escapeLayout(raw.substring(startPos, tag.range!.end))
  }
  function escapeContents(contents: Content[]) {
    for (const content of contents) {
      if (typeof content === "string") {
        // log("escapeContents", content)
        escapeTexts2(content, escapeClosingBrace ? "{}" : "")
      } else {
        escapeTag(content)
      }
    }
  }
  // log("parseTexts", input, parseEscapeContents(input.replace(/\\/g, "\\\\")))
  escapeContents(parseEscapeContents(input))
  if (newText !== "") {
    newContents.push(newText)
  }
  while (oldContents.length > 0) {
    newContents.push(oldContents.shift()!)
  }
  let prevTag: PrintTag | undefined
  for (let i = 0; i < contents.length; i++) {
    let content = newContents[i]
    if (typeof content === "string") {
      if (
        i > 0 &&
        typeof contents[i - 1] !== "string" &&
        (contents[i - 1] as PrintTag).contentsLayout === ContentsLayout.Indent &&
        (contents[i - 1] as PrintTag).contents.length === 0 &&
        content[0] === ":"
      ) {
        content = "\\" + content
      }
      contents[i] = escapeEmptyLines(content, i + 1 === contents.length, tag, prevTag)
    } else {
      prevTag = content
    }
  }
}

function escapeContents(contents: PrintContent[], tag?: PrintTag): void {
  if (tag?.isLiteral) {
    contents[0] = escapeEmptyLines(contents[0] as string, true, tag)
  } else {
    for (const content of contents) {
      if (typeof content !== "string") {
        escapeTag(content)
      }
    }
    // log("escapeContents", contents)
    escapeTexts(contents, tag)
  }
}

function printTag(tag: PrintTag, indentLevel: number): string {
  let output = "{"
  if (tag.isQuoted) output += "'"
  if (tag.isAttribute) output += "@"
  output += tag.name
  const printedAttrs = tag.attributes.map(tag => printTag(tag, indentLevel + 1))
  if (tag.contentsLayout !== ContentsLayout.Indent) {
    output += printedAttrs.join("")
  }
  if (tag.contentsLayout !== ContentsLayout.Atom) {
    if (tag.contentsLayout === ContentsLayout.Indent) {
      assert(
        tag.attributes.length > 0 || tag.contents.length > 0,
        "expected indent tag to have either attributes or contents",
      )
      output += "="
    } else if (tag.contentsLayout === ContentsLayout.Line) {
      assert(tag.contents.length > 0, "expected line tag to have contents")
      output += "="
    } else {
      assert(tag.contents.length > 0, "expected brace tag to have contents")
      // log("here?")
      output += ":"
    }
    if (tag.isLiteral) output += "'"
    if (tag.contentsLayout === ContentsLayout.Brace) {
      output += " " + printTagContents(tag.contents, 0, tag)
    }
  }
  output += "}"
  if (tag.contentsLayout === ContentsLayout.Line) {
    output += " " + printTagContents(tag.contents, indentLevel, tag)
  } else if (tag.contentsLayout === ContentsLayout.Indent) {
    const newLineIndent = "\n" + "  ".repeat(indentLevel)
    output += printedAttrs.map(str => newLineIndent + "  " + str).join("")
    if (tag.contents.length > 0)
      output += newLineIndent + ": " + printTagContents(tag.contents, indentLevel + 1, tag)
  }
  return output
}

function printTagContent(contents: PrintContent[], i: number, indentLevel: number, tag?: PrintTag) {
  const content = contents[i]
  let output = ""
  if (typeof content === "string") {
    if (tag !== undefined && tag.contentsLayout === ContentsLayout.Indent) {
      output += content.replace(/(\r?\n|\r)/g, "$1" + "  ".repeat(indentLevel))
    } else output += content
    return output
  }
  output += printTag(content, indentLevel)
  if (
    (content.contentsLayout === ContentsLayout.Line || content.contentsLayout === ContentsLayout.Indent) &&
    (i + 1 < contents.length || (tag !== undefined && tag.contentsLayout === ContentsLayout.Brace))
  ) {
    output += "\n"
    if (tag !== undefined && tag.contentsLayout === ContentsLayout.Indent) output += "  ".repeat(indentLevel)
  }
  return output
}

function printTagContents(contents: PrintContent[], indentLevel: number, tag?: PrintTag): string {
  let output = ""
  for (let i = 0; i < contents.length; i++) {
    output += printTagContent(contents, i, indentLevel, tag)
  }
  return output
}

export function printContents(contents: Content[]): string {
  // log("printContents", contents)
  const preparedContents = contents.map(content =>
    typeof content === "string" ? content : new PrintTag(content),
  )
  layoutContents(preparedContents)
  escapeContents(preparedContents)
  return printTagContents(preparedContents, 0)
}

export function logPrint(input: string | Content[] | Tag): void {
  let contents
  if (typeof input === "string") {
    log(input)
    console.log(input)
    contents = parseContents(input)
  } else if (Array.isArray(input)) {
    contents = input
  } else {
    contents = [input]
  }
  log(contents)
  const output = printContents(contents)
  log(output)
  console.log(output)
  log(parseContents(output))
}

let hasOneTestFailed = false
export function testPrinter(input: string | Tag | Content[]): void {
  if (hasOneTestFailed) return
  let contents: Content[] | undefined
  let printedContents: string | undefined
  let parsedContents: Content[] | undefined
  let reprintedContents: string | undefined
  for (;;) {
    if (typeof input === "string") {
      try {
        contents = parseContents(input)
      } catch (e) {
        console.log(e)
        console.log("Failed to parse input contents.")
        break
      }
    } else if (Array.isArray(input)) {
      contents = input
    } else {
      contents = [input]
    }
    try {
      printedContents = printContents(contents)
    } catch (e) {
      console.log(e)
      console.log("Failed to print the contents.")
      break
    }
    try {
      parsedContents = parseContents(printedContents)
      if (typeof input === "object" && JSON.stringify(contents) === JSON.stringify(parsedContents)) {
        return
      }
    } catch (e) {
      console.log(e)
      console.log("Failed to parse the contents.")
      break
    }
    // try {
    //   reprintedContents = printContents(parsedContents)
    //   if (typeof input === "string" && printedContents === reprintedContents) return
    // } catch (e) {
    //   console.log(e)
    //   console.log("Failed to reprint the contents.")
    //   break
    // }
    break
  }
  hasOneTestFailed = true
  if (typeof input === "string") {
    log(input)
    console.log(input)
  }
  if (contents === undefined) return
  log(contents)
  if (printedContents === undefined) return
  log(printedContents)
  console.log(printedContents)
  if (parsedContents === undefined) return
  log(parsedContents)
  // if (reprintedContents === undefined) return
  // log(reprintedContents)
  // console.log(reprintedContents)
}

// logPrint([])
// logPrint([""])
// // testPrinter([""])

// testPrinter([
//   {
//     isQuoted: false,
//     isAttribute: false,
//     name: ".",
//     attributes: [
//       {
//         isQuoted: false,
//         isAttribute: true,
//         name: "Q",
//         attributes: [],
//         isLiteral: true,
//         contents: ["}"],
//       },
//     ],
//     isLiteral: false,
//     contents: [],
//   },
// ])

// testPrinter([
//   {
//     isQuoted: false,
//     isAttribute: false,
//     name: "a",
//     attributes: [],
//     isLiteral: false,
//     contents: ["{g:}"],
//   },
// ])

// testPrinter([
//   {
//     isQuoted: false,
//     isAttribute: false,
//     name: "7",
//     attributes: [
//       {
//         isQuoted: false,
//         isAttribute: true,
//         name: "i",
//         attributes: [],
//         isLiteral: true,
//         contents: ["{"],
//       },
//     ],
//     isLiteral: true,
//     contents: [""],
//   },
// ])

// FIXME: Parsing what whe want to print, is different from normal parse input, as it is already parsed text that we again parse.
