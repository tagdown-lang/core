import * as fc from "fast-check"

import { Content, isTagContent, parseContents, printContents, Tag } from "../src"
import { logPrint } from "../src/utils/log"

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

const alphaArb = AlphabetArbitrary("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
const alphanumericArb = AlphabetArbitrary("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

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

const nameArb = fc
  .tuple(fc.stringOf(alphaArb, { minLength: 1 }), fc.array(fc.stringOf(alphanumericArb, { minLength: 1 })))
  .map(([s1, ss]) => [s1].concat(ss).join(" "))

const tagArb: fc.Memo<Tag> = fc.memo(n =>
  fc
    .record({
      isQuoted: oneOutOf(10),
      isAttribute: oneOutOf(3),
      name: nameArb,
      attributes:
        n > 1 ? fc.array(tagArb(n - 1).map(tag => ({ ...tag, isAttribute: true }))) : fc.constant([]),
      isLiteral: oneOutOf(4),
      contents: contentsArb(n - 1),
    })
    .map(tag => ({
      ...tag,
      isLiteral: tag.isLiteral && tag.contents.length === 1 && typeof tag.contents[0] === "string",
    })),
)

const contentsArb: fc.Memo<Content[]> = fc.memo(n =>
  n > 1 ? fc.array(fc.oneof(textArb, tagArb(n - 1))).map(joinTexts) : fc.array(textArb, { maxLength: 1 }),
)

function shrinkArray<T>(shrinkElement: (element: T) => fc.Stream<T>, array: T[]): fc.Stream<T[]> {
  if (array.length === 0) return fc.Stream.nil()
  const x = array[0]
  const xs = array.slice(1)
  return fc.Stream.of(xs)
    .join(shrinkElement(x).map(y => [y].concat(xs)))
    .join(shrinkArray(shrinkElement, xs))
}

function shrinkTag(tag: Tag): fc.Stream<Tag> {
  let stream = fc.Stream.nil<Tag>()
  if (tag.contents.length > 0) {
    stream = stream.join(
      tag.contents
        .filter(isTagContent)
        .map(ctag => ({ ...ctag, isQuoted: tag.isQuoted, isAttribute: tag.isAttribute }))
        .values(),
    )
  }
  if (tag.attributes.length > 0) {
    stream = stream.join(tag.attributes.values())
  }
  if (tag.contents.length > 0 && !tag.isLiteral) {
    stream = stream.join(shrinkContents(tag.contents).map(contents => ({ ...tag, contents })))
  }
  if (tag.attributes.length > 0) {
    stream = stream.join(shrinkArray(shrinkTag, tag.attributes).map(attributes => ({ ...tag, attributes })))
  }
  return stream
}

function shrinkContent(content: Content): fc.Stream<Content> {
  return typeof content === "string" ? fc.Stream.nil() : shrinkTag(content)
}

function shrinkContents(contents: Content[]) {
  return shrinkArray(shrinkContent, contents).map(joinTexts)
}

function assertProperty(arbitrary: fc.Arbitrary<Content[]>, predicate: (contents: Content[]) => boolean) {
  fc.assert(fc.property(arbitrary, predicate), {
    reporter(details) {
      if (details.failed) {
        console.log(
          `Failed after ${details.numRuns} tests and ${details.numShrinks} shrinks with seed ${details.seed}.`,
        )
        if (details.counterexample !== null && details.counterexample.length > 0) {
          let counterexample = details.counterexample[0]
          // for (;;) {
          //   const shrinks = shrinkContents(counterexample)
          //   let newCounterexample: Content[] | undefined
          //   for (const shrink of shrinks) {
          //     log(shakeContents(shrink))
          //     if (!predicate(shrink)) {
          //       newCounterexample = shrink
          //       break
          //     }
          //   }
          //   if (newCounterexample) counterexample = newCounterexample
          //   else break
          // }
          logPrint(counterexample)
        }
      }
    },
  })
}

assertProperty(contentsArb(5), contents => {
  const output = printContents(contents)
  return printContents(parseContents(output)) === output
})
