import { isEqualTag, shakeTag, unshakeTag } from "../../src"
import { logPrint } from "../../src/test/log"
import { assertProperty, tagArb } from "../../src/test/property"

assertProperty(
  tagArb(5),
  tag => {
    return isEqualTag(unshakeTag(shakeTag(tag)), tag)
  },
  tag => logPrint(tag),
)
