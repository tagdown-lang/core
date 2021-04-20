import { parser, TagdownState } from "../src/parser"
import { printTree } from "../src/utils/print-lezer-tree"

// const input = `{a: {b}}`
// const update = { from: 4, to: 5, insert: "" }
// const input = `{a: {x}}`
// const update = { from: 1, to: 2, insert: "abc" }
// const input = `{a=}
// : {b=}
//   : x
//     y
//     z`
// const update = { from: 18, to: 23, insert: "" }

const input =
  "note=}\n  {@uid=} 1wCfAKL\n  {@created=} 2020-08-20T17:35:45.379+02:00\n  {@modified=} 2021-01-15T23:25:11.534+01:00\n--\n{a=}\n--\n{b=}\n  {c=} x\n: {d: {e}}\n  {f=} y\nz"
const update = { from: 0, to: 1, insert: "" }

// const tree = parser.parse(input)
// console.log(printTree(tree, input))

const state1 = TagdownState.start(input)
const state2 = state1.update([update])
// const tree2 = parser.parse(state2.input)
// console.log(printTree(tree2, state2.input))
console.log(printTree(state2.tree, state2.input))
