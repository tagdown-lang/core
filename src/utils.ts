type Primitive = bigint | boolean | null | number | string | symbol | undefined

type JSONValue = Primitive | JSONObject | JSONArray

interface JSONObject {
  [key: string]: JSONValue
}

interface JSONArray extends Array<JSONValue> {}

export function isJSONObject(arg: any): arg is JSONObject {
  return typeof arg === "object" && arg !== null && Object.getPrototypeOf(arg) === Object.prototype
}

class AssertionError extends Error {}

export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message)
  }
}
