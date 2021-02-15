import { printContents } from "../src"
import { parser, parseTreeToContents } from "../src/lezer"
import { parseContents, wrapTopLevelParser } from "../src/parser"
import { shakeContents } from "../src/shake"
import { printTree } from "../src/tree"
import { log, logPrint } from "./log"

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
const inputs = {
  0: "{a}",
  1: "{a: x\\}y\\{z\\}lala}",
  2: "{a{b}}",
  3: "{a{b: x}}",
  4: "{a}{b}",
  5: "{a=} x",
  6: "{a=} \n",
  7: "{a=}x\n{b=} y",
  8: "{a=}\n: x",
  9: "{a=}\n: x\n  y",
  10: "{a=}\n  {b}",
  11: "{a=}\n  {@b}\n{c}",
  12: "{a=}\n  {@b=}\n    {@c=}\n      {@d=} \n    : 5]4\\{:",
  13: "{a='} }",
  14: "{a=}\n  {@a=}\n  : {a=}\n    --\n    \n    $\n  {@a=}\n  : \n    $",
  15: "{a=}\n  {@a}\n  {@a}\n  {@a}\n\\:",
  16: "{a=}\n  {@b=} :\\$\n--\nx",
  17: "{a=}\n: \n  $\n",
  18: "{a=}\n: \n  $\n\n\n",
  19: "{   a   {a  b",
  20: "{a{b}:x",
  21: "{a=}\n  {text",
  22: "{a: {a='} {\n}",
  23: "{a=}\n  {@a=}\n  : {a=}\n      {@a}\n      {@a}\n      {@a}\n\n",
  24: "{a=}\n  {@a=}\n    {@a}\n    {@a}\n    {@a}\n  : {a}\n\\:",
  25: "{a=}\n--\n{a=}\n  {@a='} x3x({:6/\n\\: \\\\\\\\*cZh68:\\}D",
  26: "{a=}\n  {b=}\n    {c=}\n      {d}\n\\: x",
  27: "{o=}\n  {@z=} {O='} }\n--\n\n",
  28: "{F=}\n--\n{G=}\n  {@X}\n  {@x}\n  {@A}\n\\:",
}

// FIXME: 22 has a bug with Text reporting range 11 and not the supposed 10..11

// const input = `{a=}
// --
// {b=}
//   {c=} x
// : {d: {e}}
//   {f=} y
// z`
const input = inputs[28]
// const input = `{a{@a: {a}}}`
// const input = `{0}`
// const input = "{a=}\n  {@a=}\n  : {a=}\n      {@a}\n      {@a}\n      {@a}\n    {a}"
// const input = "{a=}\n  {@a=}\n  : \n    $\n  {@a}"
// const input = "{a=}\n  {@b=}\n  : {c=}\n      {@x}\n      {@x}\n      {@x}\n    --\n    {y}\n\n"
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
log(shakeContents(parseTreeToContents(tree, input)))
log(shakeContents(tree2))
// console.log(
//   logPrint([
//     { isQuoted: false, isAttribute: false, name: "a", attributes: [], isLiteral: false, contents: [] },
//     "",
//     { isQuoted: false, isAttribute: false, name: "b", attributes: [], isLiteral: false, contents: [] },
//   ]),
// )
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
