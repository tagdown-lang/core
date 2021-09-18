import { inspect } from "util"

import { parseContents } from "../parse"
import { printContents } from "../print"
import { shakeContents } from "../shake"
import { Content, Tag } from "../types"

export function prettyprint(arg: any): string {
  return inspect(arg, {
    depth: null,
    colors: true,
    breakLength: 110,
  })
}

export function log(...args: any[]): void {
  console.log(...args.map(prettyprint))
}

export function logExpr(exprAsString: string, expr: any): void {
  const args = [exprAsString, "=>", prettyprint(expr)]
  if (typeof expr === "string" && expr.includes("\n")) args.push(expr)
  console.log(...args)
}

export function logParse(input: string): Content[] {
  log(input)
  console.log(input)
  const contents = parseContents(input)
  log(shakeContents(contents))
  return contents
}

export function logPrint(input: Content[] | Tag): string {
  let contents = Array.isArray(input) ? input : [input]
  log(shakeContents(contents))
  const output = printContents(contents)
  logParse(output)
  return output
}
