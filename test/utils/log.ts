import * as inspect from "browser-util-inspect"

import { Content, parseContents, printContents, shakeContents, Tag } from "../../src"

function pretty(arg: any): string {
  return inspect(arg, {
    depth: null,
    colors: true,
  })
}

export function log(...args: any[]): void {
  console.log(...args.map(pretty))
}

export function logItem(arg: any, footer: string): void {
  console.log(pretty(arg))
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
