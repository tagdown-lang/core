import { parseContents, printContents } from "../../src"
import { logPrint } from "../../src/test/log"
import { assertProperty, contentsArb } from "../../src/test/property"

assertProperty(
  contentsArb(5),
  contents => {
    const output = printContents(contents)
    return printContents(parseContents(output)) === output
  },
  contents => logPrint(contents),
)
