import { prettyprint, printContents } from "../../src"
import { logItem } from "../../src/test/log"
import { assertProperty, contentsArb } from "../../src/test/property"

assertProperty(
  contentsArb(5),
  contents => {
    const output = printContents(contents)
    return prettyprint(output) === output
  },
  contents => {
    const output = printContents(contents)
    logItem(output, "output")
    logItem(prettyprint(output), "prettyprint(output)")
  },
)
