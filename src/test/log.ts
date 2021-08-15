import * as inspect from "browser-util-inspect"

import { parseContents } from "../parse"
import { printContents } from "../print"
import { shakeContents } from "../shake"
import { Content, Tag } from "../types"

function prettyprint(arg: any): string {
  return inspect(arg, {
    depth: null,
    colors: true,
  })
}

export function log(...args: any[]): void {
  console.log(...args.map(prettyprint))
}

export function logItem(arg: any, footer: string): void {
  console.log(prettyprint(arg))
  console.log(arg)
  console.log("---------- ^ " + footer)
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
