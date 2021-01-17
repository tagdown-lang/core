import { isObject } from "./utils"

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
}

// The language consists of a mixed content of text and tags.
export type Content = string | Tag

// The top-level contents can be considered to be both within brace and indent contents,
// so they are defined as bit flags to allow for unions.
export enum ContentsLayout {
  Atom = 1 << 0, // {name}
  Brace = 1 << 1, // {name: text}
  Line = 1 << 2, // {name=} text
  Indent = 1 << 3, // {name=}\n: text
  End = 1 << 4, // {name=}\n--\ntext
}

// Check

export function isText(arg: any): arg is string {
  return typeof arg === "string"
}

export function isTag(arg: any): arg is Tag {
  return (
    isObject(arg) &&
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

export function isTextContent(content: Content): content is string {
  return isText(content)
}

export function isTagContent(content: Content): content is Tag {
  return isObject(content)
}
