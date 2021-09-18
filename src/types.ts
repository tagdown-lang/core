// Types

// The tag represents structure within the language,
// allowing reuse and things like widgets to exist within the text.
export type Tag = {
  // Whether the tag should be taken as-is, not allowing it to be further interpreted.
  // The reason for having this as a property on the tag rather than converting the tag to text,
  // is that there would have been the requirement that the text could later still be converted back to a tag.
  // However this would make the syntax part of the internal representation,
  // fixating the language to its current syntax if we want the internal representation to be future proof,
  // therby hindering future improvements to the syntax.
  isQuoted: boolean

  // Whether the tag is an attribute. Every attribute is a tag, but not every tag is an attribute.
  isAttribute: boolean

  // The name (i.e. label) of the tag.
  name: string

  // The list of attributes belonging to the tag. Detailing more about the tag itself.
  attributes: Tag[]

  // Whether the content of the tag should be taken literally,
  // i.e. escapes sequences and tags will be ignored.
  // In that case the contents will always consist of just text.
  isLiteral: boolean

  // The contents of the tag, allowing assigning textual value to a tag,
  // giving further meaning to the structures build with the tags,
  // and allowing the tagging of text, i.e. marking a piece of text with a label.
  contents: Content[]

  // The way the tag should be layed out.
  // Without this, supporting any kind of widgets that programmatically modifies tags
  // while editing a Tagdown document, would become really painful
  // as it would force to use of the layout as dictated by the printer, rather than the user.
  layout?: TagLayout
}

// The language consists of a mixed content of text and tags.
export type Content = string | Tag

// The supported ways a tag can be layed out.
export type TagLayout = "atom" | "brace" | "line" | "end" | "indent"

export type PartialTag = Omit<Partial<Tag>, "attributes" | "contents"> & {
  attributes?: PartialTag[]
  contents?: (string | PartialTag)[]
}

// Check

export function isText(arg: any): arg is string {
  return typeof arg === "string"
}

export function isTag(arg: any): arg is Tag {
  return (
    typeof arg === "object" &&
    arg !== null &&
    typeof arg.isQuoted === "boolean" &&
    typeof arg.isAttribute === "boolean" &&
    typeof arg.name === "string" &&
    Array.isArray(arg.attributes) &&
    arg.attributes.every(isTag) &&
    typeof arg.isLiteral === "boolean" &&
    Array.isArray(arg.contents) &&
    arg.contents.every(isContent)
  )
}

export function isContent(arg: any): arg is Content {
  return isText(arg) || isTag(arg)
}

export function isContents(arg: any): arg is Content[] {
  return Array.isArray(arg) && arg.every(isContent)
}

export function isTextContent<T extends PartialTag>(content: string | T): content is string {
  return typeof content === "string"
}

export function isTagContent<T extends PartialTag>(content: string | T): content is T {
  return typeof content === "object"
}

export function isAttributeContent<T extends PartialTag>(content: string | T): content is T {
  return isTagContent(content) && !!content.isAttribute
}

export function isTextContents<T extends PartialTag>(contents: (string | T)[]): contents is string[] {
  return contents.length === 1 && isTextContent(contents[0])
}

export function isTagContents<T extends PartialTag>(contents: (string | T)[]): contents is T[] {
  return contents.length === 1 && isTagContent(contents[0])
}

export function isEqualTag(tag1: Tag, tag2: Tag): boolean {
  if (
    !(
      tag1.isQuoted === tag2.isQuoted &&
      tag1.isAttribute === tag2.isAttribute &&
      tag1.name === tag2.name &&
      tag1.attributes.length === tag2.attributes.length &&
      tag1.isLiteral === tag2.isLiteral &&
      tag1.contents.length === tag2.contents.length
    )
  ) {
    return false
  }
  for (let i = 0; i < tag1.attributes.length; i++) {
    if (!isEqualTag(tag1.attributes[i], tag2.attributes[i])) return false
  }
  for (let i = 0; i < tag1.contents.length; i++) {
    if (
      !(typeof tag1.contents[i] === typeof tag2.contents[i] && typeof tag1.contents[i] === "string"
        ? tag1.contents[i] === tag2.contents[i]
        : isEqualTag(tag1.contents[i] as Tag, tag2.contents[i] as Tag))
    ) {
      return false
    }
  }
  return true
}

export function cloneTag(tag: Tag): Tag {
  return {
    ...tag,
    attributes: tag.attributes.map(cloneTag),
    contents: tag.contents.map(mapTagContent(cloneTag)),
  }
}

export function mapTagContent<T extends PartialTag, R>(
  mapTag: (tag: T) => R,
): (content: string | T) => string | R {
  return (content) => (typeof content === "object" ? mapTag(content) : content)
}
