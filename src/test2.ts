import * as fc from "fast-check"

import { Content, logPrint, parseContents, printContents, Tag } from "."
import { log } from "./utils"

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

const tagArb = (attributes: Tag[], contents: Content[], isAttribute?: boolean) =>
  fc
    .record({
      isQuoted: oneOutOf(10),
      isAttribute: isAttribute !== undefined ? fc.constant(isAttribute) : oneOutOf(3),
      name: fc.stringOf(visibleAsciiArb, { minLength: 1 }),
      isLiteral: oneOutOf(4),
    })
    .map(tag => ({
      ...tag,
      attributes,
      isLiteral: tag.isLiteral && contents.length === 1 && typeof contents[0] === "string",
      contents,
    }))

const attributesArb: fc.Memo<Tag[]> = fc.memo(n =>
  n > 1
    ? fc
        .array(
          attributesArb(n - 1).chain(attributes =>
            fc
              .boolean()
              .chain(b =>
                b
                  ? contentsArb(n - 1).chain(contents => tagArb(attributes, contents, true).map(tag => [tag]))
                  : fc.constant(attributes),
              ),
          ),
        )
        .map(attributes => attributes.flat())
    : fc.constant([]),
)

const contentsArb: fc.Memo<Content[]> = fc.memo(n =>
  fc
    .array(
      fc.oneof(
        textArb,
        (n > 1 ? contentsArb(n - 1) : fc.array(textArb, { maxLength: 1 })).chain(contents =>
          fc
            .boolean()
            .chain(b =>
              b
                ? attributesArb(n).chain(attributes =>
                    fc
                      .boolean()
                      .chain(b =>
                        b || attributes.length === 0
                          ? tagArb(attributes, contents).map(tag => [tag])
                          : fc.constant(attributes),
                      ),
                  )
                : fc.constant(contents),
            ),
        ),
      ),
    )
    .map(contents => contents.flat())
    .map(joinTexts),
)

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
          log(out.counterexample[0])
          logPrint(out.counterexample[0])
        }
      }
    },
  },
)
