import * as jsc from "jsverify"
import * as lazyseq from "lazy-seq"

import { logPrint, parseContents, printContents } from "."
import { Content, Tag } from "./types"
import { inspect } from "./utils"

const gen = jsc.generator
const shr = jsc.shrink

function bless<T>(generator: jsc.Generator<T>, shrink: jsc.Shrink<T>): jsc.Arbitrary<T> {
  return jsc.bless<T>({
    generator,
    shrink,
    show: inspect,
  })
}

function alphabetToCharArbitrary(alphabet: string): jsc.Arbitrary<string> {
  return jsc.nat(alphabet.length - 1).smap(
    n => alphabet[n],
    chr => alphabet.indexOf(chr),
  )
}

function alphabetToStringArbitrary(alphabet: string): jsc.Arbitrary<string> {
  return jsc.nearray(alphabetToCharArbitrary(alphabet)).smap(
    arr => arr.join(""),
    str => str.split(""),
  )
}

const arbVisibleAscii = alphabetToStringArbitrary(
  "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
)

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

const specialProbs = {
  "\\": 1,
  "{": 3,
  "}": 3,
  ":": 2,
  "\n": 1,
  "": 12,
}

const totalProb = Object.values(specialProbs).reduce((a, b) => a + b, 0)

const genText = arbVisibleAscii.generator.map(str => {
  let text = ""
  for (const chr of str) {
    const rnd = jsc.random(0, totalProb - 1)
    let accumProb = 0
    for (const special of Object.keys(specialProbs)) {
      const specialProb = specialProbs[special]
      if (rnd >= accumProb && rnd < accumProb + specialProb) {
        text += special === "" ? chr : special
        break
      }
      accumProb += specialProb
    }
  }
  return text
})

const genTagName = arbVisibleAscii.generator

function mapTagGen(name: string, attributes: Tag[], contents: Content[]): Tag {
  const isLiteral = contents.length === 1 && typeof contents[0] === "string" && jsc.random(1, 4) === 1
  return {
    isQuoted: false,
    isAttribute: false,
    name,
    attributes,
    isLiteral,
    contents,
  }
}

const genZTag = gen.combine(
  genTagName,
  gen.array(genText),
  (name, texts): Tag => {
    const text = texts.join("")
    const contents = text === "" && jsc.random(1, 2) === 1 ? [] : [text]
    return mapTagGen(name, [], contents)
  },
)

const genAttributes = (genTag: jsc.Generator<Tag>) =>
  gen.array(genTag).map(tags => {
    for (const tag of tags) {
      tag.isAttribute = true
    }
    return tags
  })

const genTagContent = (genTag: jsc.Generator<Tag>) => gen.oneof<Content>([genText, genTag])

const genTagContents = (genTag: jsc.Generator<Tag>) =>
  gen
    .array(genTagContent(genTag))
    .map(joinTexts)
    .map((contents: Content[]) => {
      for (const content of contents) {
        if (typeof content !== "string") {
          if (jsc.random(1, 12) === 1) {
            content.isQuoted = true
          }
          if (jsc.random(1, 3) === 1) {
            content.isAttribute = true
          }
        }
      }
      return contents
    })

const genSTag = (genTag: jsc.Generator<Tag>) =>
  gen.combine(genTagName, genAttributes(genTag), genTagContents(genTag), mapTagGen)

// @ts-ignore: Bug in verify.d.ts.
const genTag = gen.recursive(genZTag, genSTag) as jsc.Generator<Tag>

const genContents = genTagContents(genTag)

// A shrinker behaves the best when the smallest values to still fail the propery are returned first.

const shrText = shr.bless((text: string) =>
  shr
    .array(shr.noop)(text.split(""))
    .map(chrs => chrs.join("")),
)

const shrTagName = shr.bless((text: string) =>
  shr
    .nearray(shr.noop)(text.split(""))
    .map(chrs => chrs.join("")),
)

const shrContentTag = shrinkTag(false)
const shrAttribute = shrinkTag(true)

function shrinkTag(ensureIsAttribute: boolean) {
  return shr.bless((tag: Tag) => {
    let shrs = lazyseq.nil
    if (tag.contents.length > 0) {
      shrs = shrs.append(() => {
        let tags = tag.contents.filter(content => typeof content !== "string") as Tag[]
        if (ensureIsAttribute) {
          tags = tags.map(tag => ({ ...tag, isAttribute: true }))
        }
        return tags
      })
    }
    if (tag.attributes.length > 0) {
      shrs = shrs.append(tag.attributes)
    }
    if (tag.contents.length > 0) {
      if (tag.isLiteral) {
        shrs = shrs.append(shrText(tag.contents[0] as string).map(text => ({ ...tag, contents: [text] })))
      } else {
        shrs = shrs.append(shrContents(tag.contents).map(contents => ({ ...tag, contents })))
      }
    }
    if (tag.attributes.length > 0) {
      shrs = shrs.append(
        shr
          .array(shrAttribute)(tag.attributes)
          .map(attributes => ({ ...tag, attributes })),
      )
    }
    shrs = shrs.append(shrTagName(tag.name).map(name => ({ ...tag, name })))
    if (tag.isLiteral) {
      shrs = shrs.append([{ ...tag, isLiteral: false }])
    }
    if (tag.isAttribute && !ensureIsAttribute) {
      shrs = shrs.append([{ ...tag, isAttribute: false }])
    }
    if (tag.isQuoted) {
      shrs = shrs.append([{ ...tag, isQuoted: false }])
    }
    return shrs
  })
}

const shrContent = shr.bless<Content>(content =>
  typeof content === "string" ? shrText(content) : shrContentTag(content),
)

const shrContents = shr.bless<Content[]>(contents => shr.array(shrContent)(contents).map(joinTexts))

const arbContents = bless(genContents, shrContents)

const lossless = jsc.forall(arbContents, contents => {
  const output = printContents(contents)
  return output === printContents(parseContents(output))
})

const result = jsc.check(lossless, {
  quiet: true,
  tests: 100,
})

if (typeof result === "object") {
  console.log(
    `Failed after ${result.tests} tests and ${result.shrinks} shrinks with seed ${result.rngState}.`,
  )
  // @ts-ignore: Bug in verify.d.ts.
  if (result.counterexample.length > 0) {
    // @ts-ignore: Bug in verify.d.ts.
    logPrint(result.counterexample[0])
  }
}
