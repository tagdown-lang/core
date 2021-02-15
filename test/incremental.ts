import { Tree, TreeCursor } from "lezer-tree"
import { parser, TagdownState } from "../src/lezer"
import { printTree } from "../src/tree"

function nextMD(cursor: TreeCursor) {
  for (;;) {
    if (!cursor.next()) return false
    if (cursor.type == parser.nodeSet.types[cursor.type.id]) return true
  }
}

export function compareTree(a: Tree, b: Tree) {
  let curA = a.cursor(),
    curB = b.cursor()
  for (;;) {
    let mismatch: string | null = null,
      next = false
    if (curA.type != curB.type) mismatch = `Node type mismatch (${curA.name} vs ${curB.name})`
    else if (curA.from != curB.from)
      mismatch = `Start pos mismatch for ${curA.name}: ${curA.from} vs ${curB.from}`
    else if (curA.to != curB.to) mismatch = `End pos mismatch for ${curA.name}: ${curA.to} vs ${curB.to}`
    else if ((next = nextMD(curA)) != nextMD(curB)) mismatch = `Tree size mismatch`
    if (mismatch) throw new Error(`${mismatch}\n  ${a}\n  ${b}`)
    if (!next) break
  }
}

// const input = `{a: {b}}`
// const update = { from: 4, to: 5, insert: "" }
const input = `{a: {x}}`
const update = { from: 1, to: 2, insert: "abc" }

const tree = parser.parse(input)
console.log(printTree(tree, input))

const state1 = TagdownState.start(input)
const state2 = state1.update([update])
const tree2 = parser.parse(state2.input)
console.log(printTree(tree2, state2.input))
console.log(printTree(state2.tree, state2.input))
