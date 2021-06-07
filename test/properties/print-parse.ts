import { parseContents, printContents } from "../../src"
import { assertProperty, contentsArb } from "../properties"
import { logPrint } from "../utils/log"

assertProperty(
  contentsArb(5),
  contents => {
    const output = printContents(contents)
    return printContents(parseContents(output)) === output
  },
  contents => logPrint(contents),
)
