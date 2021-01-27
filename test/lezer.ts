import { parser, treeToContents } from "../src/lezer"
import { parseContents, wrapTopLevelParser } from "../src/parser"
import { shakeContents } from "../src/shake"
import { printTree } from "../src/tree"
import { log } from "./log"

// FIXME: Fails to print properly, I think
// [ { name: 'a',
//     attributes: [ { name: 'a' }, { name: 'a' }, { name: 'a' } ],
//     contents: [ '' ] },
//   '' ]

// const input = "{foo  t\\{x{tag{a}:es}}t{y}"
// const input = "{a:text}"
// const input = `{a=} text
// {a=} text`
// const input = `{a=}
// : {b=}
//   : {c=}
//     : x
//       y
// z`
// const input = `{a}`
// const input = `{a{@a: {a}}}`
// const input = `{0}`
// const input = "{a=}\n  {@a=}\n  : {a=}\n      {@a}\n      {@a}\n      {@a}\n    {a}"
// const input = "{a=}\n  {@a=}\n  : \n    $\n  {@a}"
const input = "{a=}\n  {@b=}\n  : {c=}\n      {@x}\n      {@x}\n      {@x}\n    --\n    {y}\n\n"
// const input =
//   "{a=}\n  {@b=}\n  : {c=}\n      {@x}\n      {@x}\n      {@x}\n    --\n    \\\\:\\}:j\\{en1\\}*IB\\}:\n: $\n"
// const input = "{a='} {"
console.time()
const tree = parser.parse(input)
console.timeEnd()
console.time()
const tree2 = wrapTopLevelParser(parseContents)(input)
console.timeEnd()
console.log(input)
// log(tree)
console.log(printTree(tree, input))
log(shakeContents(treeToContents(tree, input)))
log(shakeContents(tree2))
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

// you either have to backtrack until the newline+indent token is succesfully parsed,
// but when it levels, it should not be significant.
// or we need to force finish all nested things, but then we need to extract the handling code for block attrs.
