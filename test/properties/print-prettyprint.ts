import { prettyprint, printContents } from "../../src"
import { assertProperty, contentsArb } from "../properties"
import { log, logItem } from "../utils/log"

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
