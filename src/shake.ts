import { Content, isTagContent, isText, Tag } from "./types"
import { isJSONObject } from "./utils"

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
  if (tag.attributes.length > 0) shakenTag.attributes = tag.attributes.map(attr => shakeTag(attr, true))
  if (tag.isLiteral) shakenTag.isLiteral = true
  if (tag.contents.length > 0) shakenTag.contents = shakeContents(tag.contents)
  return shakenTag
}

export function shakeContents(contents: Content[]): ShakenContent[] {
  return contents.map(content => (isTagContent(content) ? shakeTag(content, false) : content))
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
    attributes: attributes.map(attr => unshakeTag(attr, true)),
    isLiteral,
    contents: unshakeContents(contents),
  }
}

export function unshakeContents(contents: ShakenContent[]): Content[] {
  return contents.map(content => (typeof content === "object" ? unshakeTag(content) : content))
}

export function isShakenTextContent(content: ShakenContent): content is string {
  return isText(content)
}

export function isShakenTagContent(content: ShakenContent): content is ShakenTag {
  return isJSONObject(content)
}
