import * as util from "util"

export type Modify<A, B> = Omit<A, keyof B> & B

export function isObject(arg: any): arg is Object {
  return typeof arg === "object" && arg !== null && Object.getPrototypeOf(arg) === Object.prototype
}

class AssertionError extends Error {}

export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message)
  }
}

export function inspect(arg: any): string {
  return util.inspect(arg, {
    depth: null,
    colors: true,
  })
}

export function log(...args: any[]): void {
  console.log(...args.map(inspect))
}
