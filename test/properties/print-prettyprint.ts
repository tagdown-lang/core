import { prettyprint, printContents } from "../../src"
import { logExpr } from "../../src/test/log"
import { assertProperty, contentsArb } from "../../src/test/property"

assertProperty(
  contentsArb(5),
  (contents) => {
    const output = printContents(contents)
    return prettyprint(output) === output
  },
  (contents) => {
    const output = printContents(contents)
    logExpr(`output`, output)
    logExpr(`prettyprint(output)`, prettyprint(output))
  },
)
