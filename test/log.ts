import * as _inspect from "browser-util-inspect"

import { Content, parseContents, printContents, Tag } from "../src"
import { shakeContents } from "../src/shake"

export function inspect(arg: any): string {
  return _inspect(arg, {
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
