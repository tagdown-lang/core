// Escape parse

let oldContents: PrintContent[]
let newContents: PrintContent[]
let input: string
let areBraceTexts: boolean
let oldText: string
let newText: string
let pos: number
let candidates: number[]
let escapes: number[]
let alwaysEscapes: number[]

function addNewText(): void {
  let text = ""
  let startPos = 0
  log(0, newText)
  const allEscapes = [...new Set([...escapes, ...alwaysEscapes])]
  allEscapes.sort((a, b) => a - b)
  log("escapes", allEscapes)
  for (const escapePos of allEscapes) {
    text += newText.substring(startPos, escapePos) + "\\"
    log(1, newText.substring(startPos, escapePos) + "\\")
    startPos = escapePos
  }
  text += newText.substring(startPos)
  log(2, newText.substring(startPos))
  newContents.push(text)
  newText = ""
  pos = 0
  candidates = []
  escapes = []
  alwaysEscapes = []
}

function escapeParseString(text: string, alwaysEscapeChrs: string): void {
  alwaysEscapeChrs = "\\" + alwaysEscapeChrs
  log("escapeParseString", text, alwaysEscapeChrs)
  for (let p = 0; p < text.length; p++) {
    const c = text[p]
    if (alwaysEscapeChrs.includes(c)) {
      alwaysEscapes.push(pos + p)
    }
    if (c === "{") {
      candidates.push(pos + p)
    } else if (c === "}") {
      candidates.pop()
    } else if (c === ":" && candidates.length > 0) {
      if (pos + p - 1 !== escapes[escapes.length - 1]) {
        escapes.push(...candidates)
      }
      candidates = []
    } else if (c === "\n") {
      candidates = []
    }
  }
  pos += text.length
  newText += text
}

function escapeParseText(text: string, alwaysEscapeChrs: string): void {
  while (text !== "") {
    if (oldText === "") {
      let found = false
      while (oldContents.length > 0) {
        const content = oldContents.shift()!
        if (typeof content === "string") {
          oldText = content
          found = true
          break
        } else {
          newContents.push(content)
        }
      }
      assert(found, "not enough old contents")
    }
    if (text.length >= oldText.length) {
      escapeParseString(text.substring(0, oldText.length), alwaysEscapeChrs)
      addNewText()
      text = text.substring(oldText.length)
      oldText = ""
    } else {
      escapeParseString(text, alwaysEscapeChrs)
      oldText = oldText.substring(text.length)
      text = ""
    }
  }
}

function escapeParseLayout(layout: string): void {
  escapeParseText(layout, areBraceTexts ? "{}" : "{")
}

function escapeParseTag(tag: ParseTag): void {
  let startPos = tag.range.start
  for (const attr of tag.attributes) {
    escapeParseLayout(input.substring(startPos, attr.range.start))
    escapeParseTag(attr)
    startPos = attr.range.end
  }
  if (tag.contentsRange) {
    escapeParseLayout(input.substring(startPos, tag.contentsRange.start))
    escapeParseContents(tag.contents)
    startPos = tag.contentsRange.end
  }
  escapeParseLayout(input.substring(startPos, tag.range.end))
}

function escapeParseContents(contents: ParseContent[]): void {
  for (const content of contents) {
    if (typeof content === "string") {
      escapeParseText(content, areBraceTexts ? "{}" : "")
    } else {
      escapeParseTag(content)
    }
  }
}

function escapeParseTexts(contents: PrintContent[], tag?: PrintTag): void {
  const texts = contents.filter(content => typeof content === "string")
  if (!(texts.length > 0)) return
  oldContents = [...contents]
  newContents = []
  input = texts.join("")
  areBraceTexts = tag !== undefined && isBraceTag(tag)
  newText = ""
  oldText = ""
  pos = 0
  candidates = []
  escapes = []
  alwaysEscapes = []
  const parsedContents = parseEscapeContents(input)
  log(parsedContents)
  escapeParseContents(parsedContents)
  if (newText !== "") {
    addNewText()
  }
  newContents.push(...oldContents)
  let prevTag: PrintTag | undefined
  for (let i = 0; i < contents.length; i++) {
    let content = newContents[i]
    if (typeof content === "string") {
      if (content[0] === ":" && prevTag && isIndentTag(prevTag) && prevTag.contents.length === 0) {
        content = "\\" + content
      }
      contents[i] = escapeEmptyLines(content, i + 1 === contents.length, tag, prevTag)
    } else {
      prevTag = content
    }
  }
}
