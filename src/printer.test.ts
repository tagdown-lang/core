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

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: ".",
    attributes: [
      {
        isQuoted: false,
        isAttribute: true,
        name: "Q",
        attributes: [],
        isLiteral: true,
        contents: ["}"],
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
    name: "a",
    attributes: [],
    isLiteral: false,
    contents: ["{g:}"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "7",
    attributes: [
      {
        isQuoted: false,
        isAttribute: true,
        name: "i",
        attributes: [],
        isLiteral: true,
        contents: ["{"],
      },
    ],
    isLiteral: true,
    contents: [""],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "Y",
    attributes: [],
    isLiteral: false,
    contents: ["{{W: \n}"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "Z",
    attributes: [],
    isLiteral: false,
    contents: [
      "\n",
      {
        isQuoted: false,
        isAttribute: false,
        name: "6",
        attributes: [],
        isLiteral: false,
        contents: [],
      },
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "~",
    attributes: [],
    isLiteral: false,
    contents: ["Q{C!}>{m8i{"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "G",
    attributes: [],
    isLiteral: false,
    contents: [
      "Z",
      {
        isQuoted: false,
        isAttribute: false,
        name: "7",
        attributes: [],
        isLiteral: false,
        contents: [],
      },
      "}",
    ],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "1",
    attributes: [
      {
        isQuoted: false,
        isAttribute: true,
        name: "0",
        attributes: [],
        isLiteral: false,
        contents: ["{\\:"],
      },
      {
        isQuoted: false,
        isAttribute: true,
        name: "T",
        attributes: [],
        isLiteral: true,
        contents: ["}"],
      },
    ],
    isLiteral: false,
    contents: [],
  },
  "}",
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "Y",
    attributes: [],
    isLiteral: false,
    contents: ["{:"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: "t",
    attributes: [],
    isLiteral: false,
    contents: ["\\{0}\n"],
  },
])

testPrinter([
  {
    isQuoted: false,
    isAttribute: false,
    name: ")",
    attributes: [],
    isLiteral: false,
    contents: ["{{D}\n"],
  },
])
