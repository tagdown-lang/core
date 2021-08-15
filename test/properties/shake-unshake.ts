import { isEqualTag, shakeTag, unshakeTag } from "../../src"
import { assertProperty, tagArb } from "../properties"
import { logPrint } from "../utils/log"

assertProperty(
  tagArb(5),
  tag => {
    return isEqualTag(unshakeTag(shakeTag(tag)), tag)
  },
  tag => logPrint(tag),
)
