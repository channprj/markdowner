import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import {
  filterLocalAgentMentions,
  isEligibleLocalAgentMentionKey,
  LOCAL_AGENT_MENTIONS,
} from "./mentions";

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "@",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

function viewAt(
  text: string,
  position: number,
  options: {
    parent?: string;
    ancestors?: string[];
    marks?: string[];
    parentOffset?: number;
    composing?: boolean;
    selection?: {
      from: number;
      to: number;
      empty: boolean;
      constructor?: { name: string };
    };
  } = {},
) {
  const parent = options.parent ?? "paragraph";
  const ancestors = options.ancestors ?? [parent, "doc"];
  const $from = {
    pos: position,
    parent: { type: { name: parent }, isTextblock: true },
    depth: ancestors.length - 1,
    node: (depth: number) => ({ type: { name: ancestors[depth] ?? "doc" } }),
    marks: () => (options.marks ?? []).map((name) => ({ type: { name } })),
    parentOffset: options.parentOffset ?? position - 1,
  };
  return {
    composing: options.composing ?? false,
    state: {
      doc: {
        textBetween: (from: number, to: number) => text.slice(from - 1, to - 1),
      },
      selection: {
        ...(options.selection ?? {
          from: position,
          to: position,
          empty: true,
        }),
        $from,
        $to: $from,
      },
    },
  } as unknown as Parameters<typeof isEligibleLocalAgentMentionKey>[0];
}

describe("local agent mentions", () => {
  it("offers only the fixed agents in a stable case-insensitive order", () => {
    expect(LOCAL_AGENT_MENTIONS.map((item) => item.mention)).toEqual([
      "@claude",
      "@codex",
      "@opencode",
    ]);
    expect(filterLocalAgentMentions("@").map((item) => item.mention)).toEqual([
      "@claude",
      "@codex",
      "@opencode",
    ]);
    expect(filterLocalAgentMentions("@c").map((item) => item.mention)).toEqual([
      "@claude",
      "@codex",
    ]);
    expect(filterLocalAgentMentions("@O").map((item) => item.mention)).toEqual([
      "@opencode",
    ]);
    expect(filterLocalAgentMentions("@new-agent")).toEqual([]);
  });

  it.each(["", "hello ", "@name "])("leaves the first @ as ordinary text after %j", (text) => {
    expect(isEligibleLocalAgentMentionKey(viewAt(text, text.length + 1), key())).toBeNull();
  });

  it("allows the second @ only at a safe block boundary or after whitespace", () => {
    expect(isEligibleLocalAgentMentionKey(viewAt("@", 2), key())).toEqual({
      from: 1,
      to: 2,
    });
    expect(isEligibleLocalAgentMentionKey(viewAt("hello @", 8), key())).toEqual({
      from: 7,
      to: 8,
    });
    expect(
      isEligibleLocalAgentMentionKey(
        viewAt("second block@", 14, { parentOffset: 1 }),
        key(),
      ),
    ).toEqual({ from: 13, to: 14 });
  });

  it("leaves @ over a text selection as ordinary replacement input", () => {
    expect(
      isEligibleLocalAgentMentionKey(
        viewAt("@hello", 2, {
          selection: { from: 2, to: 7, empty: false },
        }),
        key(),
      ),
    ).toBeNull();
  });

  it("rejects a collapsed paragraph selection inside a real table cell", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        text: { group: "inline" },
        paragraph: { group: "block", content: "inline*" },
        table: { group: "block", content: "tableRow+" },
        tableRow: { content: "tableCell+" },
        tableCell: { content: "paragraph+" },
      },
    });
    const document = schema.node("doc", null, [
      schema.node("table", null, [
        schema.node("tableRow", null, [
          schema.node("tableCell", null, [
            schema.node("paragraph", null, [schema.text("@")]),
          ]),
        ]),
      ]),
    ]);
    let textPosition = 0;
    document.descendants((node, position) => {
      if (node.isText) textPosition = position;
    });
    const state = EditorState.create({
      doc: document,
      selection: TextSelection.create(document, textPosition + 1),
    });

    expect(isEligibleLocalAgentMentionKey({ state }, key())).toBeNull();
  });

  it.each([
    ["inside a word", viewAt("hello", 6)],
    ["inside an email", viewAt("me@example", 11)],
    ["after an email at-sign", viewAt("me@", 4)],
    ["after two at-signs", viewAt("@@", 3)],
    ["inline code", viewAt("@", 2, { marks: ["code"] })],
    [
      "a code block",
      viewAt("@", 2, { parent: "codeBlock", ancestors: ["codeBlock", "doc"] }),
    ],
    [
      "frontmatter",
      viewAt("@", 2, {
        parent: "frontMatter",
        ancestors: ["frontMatter", "doc"],
      }),
    ],
    [
      "an unsupported node",
      viewAt("@", 2, { parent: "image", ancestors: ["image", "doc"] }),
    ],
    [
      "a multi-cell table selection",
      viewAt("", 1, {
        selection: {
          from: 1,
          to: 4,
          empty: false,
          constructor: { name: "CellSelection" },
        },
      }),
    ],
  ])("rejects %s", (_label, view) => {
    expect(isEligibleLocalAgentMentionKey(view, key())).toBeNull();
  });

  it.each([
    key({ key: "Process" }),
    key({ isComposing: true }),
    key({ ctrlKey: true }),
    key({ metaKey: true }),
    key({ altKey: true }),
  ])("rejects composing and unsafe keyboard events", (event) => {
    expect(isEligibleLocalAgentMentionKey(viewAt("@", 2), event)).toBeNull();
  });

  it("rejects @ while the ProseMirror view is composing", () => {
    expect(
      isEligibleLocalAgentMentionKey(
        viewAt("@", 2, { composing: true }),
        key({ isComposing: false }),
      ),
    ).toBeNull();
  });
});
