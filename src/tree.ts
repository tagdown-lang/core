import * as _inspect from "browser-util-inspect"
import { Input, stringInput, Tree } from "lezer-tree"
import { log } from "../test/log"

import { parser } from "./tagdown"

const input = "t{a:es}t"
// const input2 = `{a=}
// : {a=}
//     {@a=} text
//     {@a}
//   text
// {a}`
// const input = "test"
// const input = "{a{a}}"
// console.time()
// function parse(d: string, fragments?: readonly TreeFragment[]) {
//   let parse = parser.startParse(stringInput(d), 0, { fragments }),
//     result: Tree | null
//   while (!(result = parse.advance())) {}
//   return result
// }
// const tree = parse("# test")
const tree = parser.parse(input) as Tree
// console.timeEnd()
// console.time()
// const contents = parseContents(input)
// console.timeEnd()
// log(contents)
// import * as _inspect from "browser-util-inspect"
// import { Input, stringInput, Tree } from "lezer-tree"
function inspect(arg: any): string {
  return _inspect(arg, {
    depth: null,
    colors: true,
  })
}
export function printTree(
  tree: Tree,
  input: Input | string,
  opts: { from?: number; to?: number; offset?: number } = {},
): string {
  if (typeof input === "string") input = stringInput(input)
  const { from = 0, to = input.length, offset = 0 } = opts
  let out = ""
  const c = tree.cursor()
  const childPrefixes: string[] = []
  for (;;) {
    const isTop = out === ""
    const { type } = c
    const cfrom = c.from
    const cto = c.to
    let leave = false
    if (cfrom <= to && cto >= from) {
      if (!type.isAnonymous) {
        leave = true
        if (!isTop) {
          out += "\n" + childPrefixes.join("")
          if (c.nextSibling() && c.prevSibling()) {
            out += " ├─ "
            childPrefixes.push(" │  ")
          } else {
            out += " └─ "
            childPrefixes.push("    ")
          }
        }
        out += type.name
      }
      const isLeaf = !c.firstChild()
      if (!type.isAnonymous) {
        const hasRange = cfrom !== cto
        out += ` ${
          hasRange ? `[${inspect(cfrom + offset)}..${inspect(cto + offset)}]` : inspect(cfrom + offset)
        }`
        if (isLeaf && hasRange) {
          out += `: ${inspect(input.read(cfrom, cto))}`
        }
      }
      if (!isLeaf || isTop) continue
    }
    for (;;) {
      if (leave) childPrefixes.pop()
      leave = c.type.isAnonymous
      if (c.nextSibling()) break
      if (!c.parent()) return out
      leave = true
    }
  }
}
// log(tree)
// console.log(printTree(tree, input, 4, 6))

// let out = ""
// const childPrefixes: string[] = []
// let lastFrom = -1
// const parentTos: number[] = []
// tree.iterate({
//   enter: (type, from, to) => {
//     if (!type.isTop) {
//       out += "\n" + childPrefixes.join("")
//       const isLastChild = to === parentTos[0]
//       if (!isLastChild) {
//         out += " ├─ "
//         childPrefixes.push(" │  ")
//       } else {
//         out += " └─ "
//         childPrefixes.push("    ")
//       }
//     }
//     out += type.name
//     lastFrom = from
//     parentTos.unshift(to)
//   },
//   leave: (type, from, to) => {
//     const lastTo = parentTos.shift()
//     const isLeaf = from === lastFrom && to === lastTo && !type.isError
//     if (isLeaf) {
//       out +=
//         ": " +
//         inspect(input.substring(from, to), {
//           depth: null,
//           colors: true,
//         })
//     }
//     lastFrom = -1
//     childPrefixes.pop()
//   },
// })
// console.log(out)
