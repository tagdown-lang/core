import * as fc from "fast-check"
import { parseContents } from "./parser"
import { printContents, testPrinter } from "./printer"
import { Content, Tag } from "./types"

function joinTexts(contents: Content[]): Content[] {
  return contents.reduceRight((contents, content) => {
    if (typeof content === "string" && typeof contents[0] === "string") {
      contents[0] = content + contents[0]
    } else {
      contents.unshift(content)
    }
    return contents
  }, [] as Content[])
}

function AlphabetArbitrary(alphabet: string) {
  return fc.integer(0, alphabet.length - 1).map(i => alphabet[i])
}

function oneOutOf(n: number) {
  return fc.integer(1, n).map(i => i === n)
}

const visibleAsciiArb = AlphabetArbitrary(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
)

const textArb = fc.stringOf(
  fc.frequency(
    { arbitrary: fc.constant("\\"), weight: 1 },
    { arbitrary: fc.constant("{"), weight: 3 },
    { arbitrary: fc.constant("}"), weight: 3 },
    { arbitrary: fc.constant(":"), weight: 2 },
    { arbitrary: fc.constant("\n"), weight: 1 },
    { arbitrary: visibleAsciiArb, weight: 12 },
  ),
)

const tagArb: fc.Memo<Tag> = fc.memo(n =>
  fc
    .record({
      isQuoted: oneOutOf(10),
      isAttribute: oneOutOf(3),
      name: fc.stringOf(visibleAsciiArb, { minLength: 1 }),
      attributes:
        n > 1
          ? fc.array(
              tagArb().map(tag => {
                tag.isAttribute = true
                return tag
              }),
            )
          : fc.constant([]),
      isLiteral: oneOutOf(4),
      contents: n > 1 ? contentsArb() : fc.array(textArb, { maxLength: 1 }),
    })
    .map(tag => {
      tag.isLiteral = tag.isLiteral && tag.contents.length === 1 && typeof tag.contents[0] === "string"
      return tag
    }),
)

const contentsArb = fc.memo(n => fc.array(fc.oneof(textArb, tagArb(n))).map(joinTexts))

fc.assert(
  fc.property(contentsArb(5), contents => {
    const output = printContents(contents)
    return printContents(parseContents(output)) === output
  }),
  {
    reporter(out) {
      if (out.failed) {
        console.log(`Failed after ${out.numRuns} tests and ${out.numShrinks} shrinks with seed ${out.seed}.`)
        if (out.counterexample !== null && out.counterexample.length > 0) {
          testPrinter(out.counterexample[0])
        }
      }
    },
  },
)
