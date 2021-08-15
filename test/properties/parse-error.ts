import * as fc from "fast-check"

import { parseTree, prettyprint, printContents, validateTree } from "../../src"
import { logItem } from "../../src/test/log"
import { assertProperty, contentsArb } from "../../src/test/property"

// Checks whether we are lossless when dealing with invalid input.
assertProperty(
  contentsArb(5).chain(contents => {
    const input = printContents(contents)
    const indexes: number[] = []
    for (let i = 0; i < input.length; i++) if (["{", "}"].includes(input[i])) indexes.push(i)
    return fc.subarray(indexes).map(indexes => {
      let output = ""
      let start = 0
      for (const end of indexes) {
        output += input.slice(start, end)
        start = end + 1
      }
      output += input.slice(start)
      return output
    })
  }),
  input => {
    return validateTree(parseTree(input), input)
  },
  input => {
    logItem(input, "input")
    logItem(prettyprint(input), "prettyprint(input)")
  },
)
