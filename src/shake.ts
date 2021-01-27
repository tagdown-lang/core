import { Content, isTagContent, Tag } from "./types"

export type ShakenTag = {
  isQuoted?: boolean
  isAttribute?: boolean
  name: string
  attributes?: ShakenTag[]
  isLiteral?: boolean
  contents?: ShakenContent[]
}

export type ShakenContent = string | ShakenTag

export function shakeTag(tag: Tag, isAttribute: boolean): ShakenTag {
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
