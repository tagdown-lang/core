import { Content, mapTagContent, Tag } from "./types"

// We do not include layout, even though it will result in loss of information,
// as shaking is intended to make it more easy to inspect tags,
// and the layout property would be considered noise.
export type ShakenTag = {
  isQuoted?: boolean
  isAttribute?: boolean
  name: string
  attributes?: ShakenTag[]
  isLiteral?: boolean
  contents?: ShakenContent[]
}

export type ShakenContent = string | ShakenTag

export function shakeTag(tag: Tag, isAttribute = false): ShakenTag {
  const shakenTag = {} as ShakenTag
  if (tag.isQuoted) shakenTag.isQuoted = true
  if (tag.isAttribute && !isAttribute) shakenTag.isAttribute = true
  shakenTag.name = tag.name
  if (tag.attributes.length > 0) shakenTag.attributes = tag.attributes.map((attr) => shakeTag(attr, true))
  if (tag.isLiteral) shakenTag.isLiteral = true
  if (tag.contents.length > 0) shakenTag.contents = shakeContents(tag.contents)
  return shakenTag
}

export function shakeContents(contents: readonly Content[]): ShakenContent[] {
  return contents.map(mapTagContent((tag) => shakeTag(tag, false)))
}

export function unshakeTag(
  {
    isQuoted = false,
    isAttribute = false,
    name,
    attributes = [],
    isLiteral = false,
    contents = [],
  }: ShakenTag,
  inAttributes = false,
): Tag {
  return {
    isQuoted,
    isAttribute: inAttributes || isAttribute,
    name,
    attributes: attributes.map((attr) => unshakeTag(attr, true)),
    isLiteral,
    contents: unshakeContents(contents),
  }
}

export function unshakeContents(contents: ShakenContent[]): Content[] {
  return contents.map(mapTagContent(unshakeTag))
}
