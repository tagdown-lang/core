import { parseContents } from "../src"
import { parser, treeToContents } from "../src/lezer"
import { printTree } from "../src/tree"
import { log } from "./log"

const input = "{foo  t\\{x{tag{a}:es}}t{y}"
console.time()
const tree = parser.parse(input)
console.timeEnd()
console.time()
const tree2 = parseContents(input)
console.timeEnd()
// log(tree)
console.log(printTree(tree, input))
log(treeToContents(tree, input))

// const input = "fooxbary"
// const tree = new Tree(
//   nodeTypes[Type.TopContents],
//   [
//     new Tree(nodeTypes[Type.Text], [], [], 4),
//     new Tree(nodeTypes[Type.Contents], [new Tree(nodeTypes[Type.Text], [], [], 4)], [0], 4),
//   ],
//   [0, 4],
//   8,
// )
// console.log(printTree(tree, input))

// const input = `{note=}
//   {@uid=} 1wCfAKL
//   {@created=} 2020-08-20T17:35:45.379+02:00
//   {@modified=} 2021-01-15T23:25:11.534+01:00
// --
// {h1=} Test
// {a=}
//   {@a=}
//     {@a=} foo
//   : bar
// baz`
