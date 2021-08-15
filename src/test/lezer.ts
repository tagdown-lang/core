import { Input, stringInput, SyntaxNode, Tree, TreeCursor } from "lezer-tree"

import { traverseTree, validatorTraversal } from "../lezer"

enum Color {
  Red = 31,
  Green = 32,
  Yellow = 33,
}

function colorize(value: any, color: number): string {
  return "\u001b[" + color + "m" + String(value) + "\u001b[39m"
}

type PrintTreeOptions = { from?: number; to?: number; start?: number; includeParents?: boolean }

export function printTree(
  cursor: TreeCursor | Tree | SyntaxNode,
  inputOrString: Input | string,
  { from, to, start = 0, includeParents }: PrintTreeOptions = {},
): string {
  const input = typeof inputOrString === "string" ? stringInput(inputOrString) : inputOrString
  const state = {
    output: "",
    prefixes: [] as string[],
    hasNextSibling: false,
  }
  const validator = validatorTraversal(input)
  traverseTree(cursor, input, {
    from,
    to,
    includeParents,
    beforeEnter(cursor) {
      state.hasNextSibling = cursor.nextSibling() && cursor.prevSibling()
    },
    onEnter(node) {
      validator.traversal.onEnter(node)
      const isTop = state.output === ""
      const hasPrefix = !isTop || node.from > 0
      if (hasPrefix) {
        state.output += (!isTop ? "\n" : "") + state.prefixes.join("")
        if (state.hasNextSibling) {
          state.output += " ├─ "
          state.prefixes.push(" │  ")
        } else {
          state.output += " └─ "
          state.prefixes.push("    ")
        }
      }
      const hasRange = node.from !== node.to
      state.output +=
        (node.type.isError || !validator.state.valid ? colorize(node.type.name, Color.Red) : node.type.name) +
        " " +
        (hasRange
          ? "[" +
            colorize(start + node.from, Color.Yellow) +
            ".." +
            colorize(start + node.to, Color.Yellow) +
            "]"
          : colorize(start + node.from, Color.Yellow))
      if (hasRange && node.isLeaf) {
        state.output += ": " + colorize(JSON.stringify(input.read(node.from, node.to)), Color.Green)
      }
    },
    onLeave(node) {
      validator.traversal.onLeave!(node)
      state.prefixes.pop()
    },
  })
  return state.output
}

export function logTree(
  tree: TreeCursor | Tree | SyntaxNode,
  input: Input | string,
  options?: PrintTreeOptions,
): void {
  console.log(printTree(tree, input, options))
}
