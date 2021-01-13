export function isObject(arg: any): arg is Object {
  return typeof arg === "object" && arg !== null && Object.getPrototypeOf(arg) === Object.prototype
}

class AssertionError extends Error {}

export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message)
  }
}
