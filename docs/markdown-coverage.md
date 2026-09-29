# Markdown Coverage

## Goal

Document the Markdown syntax that `markdowner-core` currently treats as supported,
which constructs deliberately fall back to raw source in WYSIWYG mode, and how the
v0.2 fixture catalog verifies those behaviors.

## How To Verify

Run the focused fixture suite:

```bash
cargo test -p markdowner-core markdown_fixtures
```

The harness lives in `crates/markdowner-core/tests/markdown_fixtures.rs`, and the
fixture catalog lives in `crates/markdowner-core/tests/fixtures/catalog.json`.

## Supported Syntax Today

### Desktop editor footnotes

The desktop Tiptap editor supports named and numeric footnotes (`[^report]`,
`[^1]`) as inline references and editable definition blocks. Labels survive
editing and serialization; display numbers follow first-reference order.
Repeated references, case-insensitive matching, Unicode labels, indented
multi-paragraph definitions, and formatted note bodies are supported. Code and
escaped syntax remain literal. Definitions without references are retained.

Reference buttons navigate to definitions; definition labels return to the first
reference. In WYSIWYG, a reference followed by a space converts to a footnote;
`[^label]: ` at paragraph start creates a definition. Split View and the shared
HTML/PDF export renderer use remark-gfm footnotes.

Regression coverage lives in `footnoteExtension.test.ts`,
`MarkdownPreviewPane.test.tsx`, and `exportDocument.test.ts`. The Rust model and
its older fixture catalog below remain separate: the desktop editor uses the
document's Markdown source directly, so Rust raw fallback does not prevent
structured editing in Tiptap.

### Block structures

- Headings (`#` through `######`)
- Paragraphs, including multiline paragraphs without blank separators
- Block quotes with a single supported `> ` line shape
- Bullet list items that start with `- `
- Checklist items that start with `- [ ] ` or `- [x] `
- Fenced code blocks started by triple backticks, with or without a language tag
- Standalone images written as one full-line `![alt](path "title")` block
- GFM-style pipe tables when the header, separator, and every row have matching column counts

### Inline structures

- Bold via `**` or `__`
- Italic via `*` or `_`
- Links in `[label](destination)` form
- Inline code spans using backticks
- Escaped punctuation using backslashes

### File discovery around Markdown content

Workspace scans and open dialogs currently treat `.md`, `.markdown`, `.mdown`, and `.mkd`
as Markdown files.

## Raw Fallback Rules

`WorkspaceState::active_wysiwyg_view()` marks a block as raw fallback when the source
should be preserved instead of treated as safely editable structured content.

The current unsupported-source checks in `crates/markdowner-core/src/workspace.rs`
trigger raw fallback for:

- Strikethrough markers such as `~~text~~`
- Footnote syntax such as `[^1]`
- Lines starting with `---` or `***`
- Lines starting with `<`, including HTML blocks and autolink-like forms
- Ordered list items such as `1. item`
- Indented list, quote, or ordered-list prefixes, which currently stand in for nested structures

Two parser-shape checks also force raw fallback:

- A one-line `![...]` block that looks like an image but does not parse as `Block::Image`
- A pipe-table-shaped block that does not parse as `Block::Table`

Finally, a block also falls back to raw source when `serialize_block(rendered_block) != source_block`.
That keeps unusual spacing or escaping patterns source-preserved instead of letting WYSIWYG
silently rewrite them.

## Preservation Policy In The Fixture Harness

The current fixture harness implements three preservation policies:

- `byte-for-byte`: the fixture must stay fully rendered in WYSIWYG mode, and a no-op
  `open -> save` flow must write back the expected bytes exactly
- `canonical-equivalent`: the fixture may normalize to different markdown delimiters when
  passed through `parse_markdown` plus `serialize_markdown`, but it must still parse to the
  same semantic document as the expected fixture while a no-op save keeps the untouched
  source bytes
- `raw-preserved`: the fixture must surface at least one raw fallback block in WYSIWYG
  mode, and the same no-op save flow must still preserve the expected bytes exactly

Session fixtures can also assert:

- recent-document restoration
- restored editor mode
- restored theme kind

One subtle but intentional distinction: the no-op save tests exercise
`EditorRuntime::save_active_document()`, which writes the original source bytes when the
document is untouched. That is stricter than calling `serialize_markdown(parse_markdown(source))`
directly, which can normalize details such as emphasis delimiters or a trailing final newline.

## Current v0.2 Fixture Catalog

The fixture catalog currently contains 30 v0.2 cases, matching the PRD allocation:

| Category | Count | Coverage focus |
| --- | ---: | --- |
| `headings-and-paragraphs` | 4 | H1-H6 depth, multiline paragraphs, blank-line grouping |
| `inline-formatting` | 5 | emphasis, nested emphasis, links, inline code, escapes |
| `lists-and-checklists` | 4 | bullets, checklists, adjacent list lines, inline markup inside items |
| `tables` | 4 | alignment, multi-row tables, inline cell markup, malformed uneven-column fallback |
| `images` | 3 | relative paths, parent-relative paths, titles, spaces in paths |
| `code-fences` | 4 | plain fences, Rust, JSON, and unknown language tags |
| `unsupported` | 4 | strikethrough, footnotes, HTML blocks, ordered lists |
| `workspace-and-session` | 2 | recent-document restore plus mode/theme restore |

The unsupported category documents the Rust model's limits. These inputs are
covered by source-preservation tests so a no-op open/save flow does not damage
them; the desktop editor can support additional syntax independently.

The broader catalog also now includes an early v1.0 `canonical-equivalent` seed fixture for
underscore-delimited inline emphasis, which proves the harness can validate parser/serializer
normalization behavior separately from the stricter no-op save contract. The v0.2 category
minimums are now counted only from fixtures tagged for the `v0.2` release gate, so newer
v1.0 seed fixtures cannot accidentally satisfy the earlier alpha coverage bars.

## Known Gaps

- Ordered lists, horizontal rules, and strikethrough are still preservation-only behavior,
  not native structured syntax
- The harness does not yet implement the PRD's future `known-lossy` policy
- The catalog does not yet cover front matter, nested lists, inline HTML, escaped-pipe
  tables, or larger mode-switching scenarios planned for the v1.0 fixture expansion
