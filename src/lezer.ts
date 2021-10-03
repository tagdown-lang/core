import { NodeType, SyntaxNode, Tree, TreeCursor } from "@lezer/common"

export function sliceType(cursor: TreeCursor, input: string, type: number): string | null {
  if (cursor.type.id === type) {
    const s = input.slice(cursor.from, cursor.to)
    cursor.nextSibling()
    return s
  }
  return null
}

export function isType(cursor: TreeCursor, type: number): boolean {
  const cond = cursor.type.id === type
  if (cond) cursor.nextSibling()
  return cond
}

export type CursorNode = { type: NodeType; from: number; to: number; isLeaf: boolean }

function cursorNode({ type, from, to }: TreeCursor, isLeaf = false): CursorNode {
  return { type, from, to, isLeaf }
}

export type TreeTraversal = {
  beforeEnter?: (cursor: TreeCursor) => void
  onEnter: (node: CursorNode) => false | void
  onLeave?: (node: CursorNode) => false | void
}

type TreeTraversalOptions = {
  from?: number
  to?: number
  includeParents?: boolean
} & TreeTraversal

export function traverseTree(
  cursor: TreeCursor | Tree | SyntaxNode,
  {
    from = -Infinity,
    to = Infinity,
    includeParents = false,
    beforeEnter,
    onEnter,
    onLeave,
  }: TreeTraversalOptions,
): void {
  if (!(cursor instanceof TreeCursor)) cursor = cursor instanceof Tree ? cursor.cursor() : cursor.cursor
  for (;;) {
    let node = cursorNode(cursor)
    let leave = false
    if (node.from <= to && node.to >= from) {
      const enter = !node.type.isAnonymous && (includeParents || (node.from >= from && node.to <= to))
      if (enter && beforeEnter) beforeEnter(cursor)
      node.isLeaf = !cursor.firstChild()
      if (enter) {
        leave = true
        if (onEnter(node) === false) return
      }
      if (!node.isLeaf) continue
    }
    for (;;) {
      node = cursorNode(cursor, node.isLeaf)
      if (leave && onLeave) if (onLeave(node) === false) return
      leave = cursor.type.isAnonymous
      node.isLeaf = false
      if (cursor.nextSibling()) break
      if (!cursor.parent()) return
      leave = true
    }
  }
}

function isChildOf(child: CursorNode, parent: CursorNode): boolean {
  return (
    child.from >= parent.from && child.from <= parent.to && child.to <= parent.to && child.to >= parent.from
  )
}

export function validatorTraversal(input: string, { fullMatch = true }: { fullMatch?: boolean } = {}) {
  const state = {
    valid: true,
    parentNodes: [] as CursorNode[],
    lastLeafTo: 0,
  }
  return {
    state,
    traversal: {
      onEnter(node) {
        state.valid = true
        if (!node.isLeaf) state.parentNodes.unshift(node)
        if (node.from > node.to || node.from < state.lastLeafTo) {
          state.valid = false
        } else if (node.isLeaf) {
          if (state.parentNodes.length && !isChildOf(node, state.parentNodes[0])) state.valid = false
          state.lastLeafTo = node.to
        } else {
          if (state.parentNodes.length) {
            if (!isChildOf(node, state.parentNodes[0])) state.valid = false
          } else if (fullMatch && (node.from !== 0 || node.to !== input.length)) {
            state.valid = false
          }
        }
      },
      onLeave(node) {
        if (!node.isLeaf) state.parentNodes.shift()
      },
    } as TreeTraversal,
  }
}

export function validateTree(
  tree: TreeCursor | Tree | SyntaxNode,
  input: string,
  options?: { fullMatch?: boolean },
): boolean {
  const { state, traversal } = validatorTraversal(input, options)
  traverseTree(tree, traversal)
  return state.valid
}
