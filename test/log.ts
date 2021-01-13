import * as util from "util-inspect"

import { Content, parseContents, printContents, Tag } from "../src"

export function inspect(arg: any): string {
  return util.inspect(arg, {
    depth: null,
    colors: true,
  })
}

export function log(...args: any[]): void {
  console.log(...args.map(inspect))
}

export function logParse(input: string): Content[] {
  log(input)
  console.log(input)
  const contents = parseContents(input)
  log(contents)
  return contents
}

export function logPrint(input: Content[] | Tag): string {
  let contents = Array.isArray(input) ? input : [input]
  log(contents)
  const output = printContents(contents)
  logParse(output)
  return output
}
