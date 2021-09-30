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
  readonly isQuoted: boolean

  // Whether the tag is an attribute. Every attribute is a tag, but not every tag is an attribute.
  readonly isAttribute: boolean

  // The name (i.e. label) of the tag.
  readonly name: string

  // The list of attributes belonging to the tag. Detailing more about the tag itself.
  readonly attributes: readonly Tag[]

  // Whether the content of the tag should be taken literally,
  // i.e. escapes sequences and tags will be ignored.
  // In that case the contents will always consist of just text.
  readonly isLiteral: boolean

  // The contents of the tag, allowing assigning textual value to a tag,
  // giving further meaning to the structures build with the tags,
  // and allowing the tagging of text, i.e. marking a piece of text with a label.
  readonly contents: readonly Content[]

  // The way the tag should be layed out.
  // Without this, supporting any kind of widgets that programmatically modifies tags
  // while editing a Tagdown document, would become really painful
  // as it would force to use of the layout as dictated by the printer, rather than the user.
  readonly layout?: TagLayout
}

// The language consists of a mixed content of text and tags.
export type Content = string | Tag

// The supported ways a tag can be layed out.
export type TagLayout = "atom" | "brace" | "line" | "end" | "indent"

export type PartialTag = Omit<Partial<Tag>, "attributes" | "contents"> & {
  attributes?: readonly PartialTag[]
  contents?: readonly (string | PartialTag)[]
}

// Checkers

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

// Generic checkers

export function isTextContent<T extends PartialTag>(content: string | T): content is string {
  return typeof content === "string"
}

export function isTagContent<T extends PartialTag>(content: string | T): content is T {
  return typeof content === "object"
}

export function isAttributeContent<T extends PartialTag>(content: string | T): content is T {
  return isTagContent(content) && !!content.isAttribute
}

export function isTextContents<T extends PartialTag>(
  contents: readonly (string | T)[],
): contents is readonly string[] {
  return contents.length === 1 && isTextContent(contents[0])
}

export function isTagContents<T extends PartialTag>(
  contents: readonly (string | T)[],
): contents is readonly T[] {
  return contents.length === 1 && isTagContent(contents[0])
}

export function isLeafTag<T extends PartialTag>(tag: T): boolean {
  return (
    tag.contents !== undefined &&
    (tag.contents.length === 0 || (tag.contents.length === 1 && typeof tag.contents[0] === "string"))
  )
}

export function isEqualTag<T extends PartialTag>(tag1: T, tag2: T): boolean {
  if (
    !(
      tag1.isQuoted === tag2.isQuoted &&
      tag1.isAttribute === tag2.isAttribute &&
      tag1.name === tag2.name &&
      typeof tag1.attributes === typeof tag2.attributes &&
      tag1.isLiteral === tag2.isLiteral &&
      typeof tag1.contents === typeof tag2.contents
    )
  ) {
    return false
  }
  if (tag1.attributes && tag2.attributes) {
    for (let i = 0; i < tag1.attributes.length; i++) {
      if (!isEqualTag(tag1.attributes[i], tag2.attributes[i])) return false
    }
  }
  if (tag1.contents && tag2.contents) {
    for (let i = 0; i < tag1.contents.length; i++) {
      if (
        !(
          typeof tag1.contents[i] === typeof tag2.contents[i] &&
          (typeof tag1.contents[i] === "string"
            ? tag1.contents[i] === tag2.contents[i]
            : isEqualTag(tag1.contents[i] as Tag, tag2.contents[i] as Tag))
        )
      ) {
        return false
      }
    }
  }
  return true
}

// Transformations

export function tagToJson(tag: Tag): Tag {
  return {
    ...tag,
    attributes: Array.from(tag.attributes, tagToJson),
    contents: Array.from(tag.contents, contentToJson),
  }
}

export const contentToJson = mapTagContent(tagToJson)

export const cloneTag = tagToJson

// Generic transformations

export function mapTagContent<T extends PartialTag, R>(
  mapTag: (tag: T) => R,
): (content: string | T) => string | R {
  return (content) => (typeof content === "object" ? mapTag(content) : content)
}

export function joinTexts<T extends PartialTag>(contents: readonly (string | T)[]): (string | T)[] {
  return contents.reduceRight((contents, content) => {
    if (typeof content === "string" && typeof contents[0] === "string") {
      contents[0] = content + contents[0]
    } else {
      contents.unshift(content)
    }
    return contents
  }, [] as (string | T)[])
}
