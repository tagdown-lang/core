// The language consists of a mixed content of text and tags.
export type Content = string | Tag

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
