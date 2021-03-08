import * as fc from "fast-check"
type Record = { contents: Content[] }
type Content = number | Record
const valueArb = fc.nat(999)
const recordArb = fc.letrec(tie => ({
  record: fc.record({
    contents: fc.frequency(
      { withCrossShrink: true },
      { arbitrary: tie("contents") as fc.Arbitrary<Content[]>, weight: 1 },
      { arbitrary: fc.array(valueArb), weight: 2 },
    ),
  }),
  contents: fc.array<Content>(fc.oneof(valueArb, tie("record") as fc.Arbitrary<Record>)),
})).record
const includesBadValue = (content: Content) =>
  typeof content === "number" ? content === 666 : content.contents.some(includesBadValue)
fc.assert(fc.property(recordArb, record => !includesBadValue(record)))
