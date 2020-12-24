const util = require("util")

class AssertionError extends Error {}

export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message)
  }
}

export function inspect(arg) {
  return util.inspect(arg, {
    depth: null,
    colors: true,
  })
}

export function log(...args) {
  console.log(...args.map(inspect))
}
