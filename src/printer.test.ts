import { testPrinter } from "./printer"

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "U",
    attributes: [],
    isLiteral: false,
    contents: ["{\\{A}}"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "p",
    attributes: [],
    isLiteral: false,
    contents: ["\\\\\\"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "q",
    attributes: [],
    isLiteral: false,
    contents: [" "],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "=",
    attributes: [
      {
        isQuoted: false,
        isAttribute: true,
        name: "]",
        attributes: [],
        isLiteral: false,
        contents: [],
      },
    ],
    isLiteral: false,
    contents: [],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "=",
    attributes: [],
    isLiteral: false,
    contents: [""],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "=",
    attributes: [
      {
        isQuoted: false,
        isAttribute: true,
        name: "b",
        attributes: [],
        isLiteral: true,
        contents: ["{"],
      },
    ],
    isLiteral: false,
    contents: [],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: ",",
    attributes: [],
    isLiteral: false,
    contents: [
      {
        isQuoted: false,
        isAttribute: false,
        name: "y",
        attributes: [
          {
            isQuoted: false,
            isAttribute: true,
            name: "H",
            attributes: [],
            isLiteral: false,
            contents: ["\n"],
          },
        ],
        isLiteral: false,
        contents: [],
      },
      ":",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "}",
    attributes: [
      {
        isQuoted: false,
        isAttribute: true,
        name: "]",
        attributes: [],
        isLiteral: true,
        contents: ["{"],
      },
    ],
    isLiteral: false,
    contents: [
      "|",
      {
        isQuoted: false,
        isAttribute: false,
        name: "G",
        attributes: [],
        isLiteral: false,
        contents: [],
      },
      "\\:",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "m",
    attributes: [],
    isLiteral: false,
    contents: [
      {
        isQuoted: false,
        isAttribute: false,
        name: "r",
        attributes: [],
        isLiteral: false,
        contents: ["\n"],
      },
      "\\:",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "4",
    attributes: [],
    isLiteral: false,
    contents: [
      {
        isQuoted: false,
        isAttribute: false,
        name: "r",
        attributes: [],
        isLiteral: false,
        contents: ["\n"],
      },
      ":",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "d",
    attributes: [
      {
        isQuoted: false,
        isAttribute: true,
        name: "=",
        attributes: [
          {
            isQuoted: false,
            isAttribute: true,
            name: "u",
            attributes: [],
            isLiteral: false,
            contents: [],
          },
        ],
        isLiteral: false,
        contents: [""],
      },
      {
        isQuoted: false,
        isAttribute: true,
        name: "k",
        attributes: [],
        isLiteral: false,
        contents: ["\n"],
      },
    ],
    isLiteral: false,
    contents: [],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "n",
    attributes: [],
    isLiteral: false,
    contents: ["{|:{&}{]} \n"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "T",
    attributes: [],
    isLiteral: false,
    contents: ["{F: \n}{}"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "[",
    attributes: [],
    isLiteral: false,
    contents: [
      "={d}",
      {
        isQuoted: false,
        isAttribute: false,
        name: "l",
        attributes: [],
        isLiteral: false,
        contents: [],
      },
      "B",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "&",
    attributes: [],
    isLiteral: false,
    contents: [
      {
        isQuoted: false,
        isAttribute: false,
        name: "l",
        attributes: [
          {
            isQuoted: false,
            isAttribute: true,
            name: "t",
            attributes: [],
            isLiteral: true,
            contents: ["{"],
          },
        ],
        isLiteral: false,
        contents: [],
      },
      "\\:",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: '"',
    attributes: [],
    isLiteral: false,
    contents: [
      {
        isQuoted: false,
        isAttribute: false,
        name: "S",
        attributes: [
          {
            isQuoted: false,
            isAttribute: true,
            name: "E",
            attributes: [],
            isLiteral: false,
            contents: ["\n"],
          },
        ],
        isLiteral: false,
        contents: [],
      },
      ":",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "5",
    attributes: [],
    isLiteral: true,
    contents: ["{"],
  },
  "",
])
