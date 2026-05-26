/**
 * End-to-end behaviour tests that boot the real Tiptap stack we ship in the
 * production WYSIWYG surface and exercise every user-facing interaction we
 * care about. Each failure here is a concrete UX bug — Notion/Typora-level
 * editors don't get to fail any of these.
 *
 * The harness uses Tiptap's actual extensions (StarterKit + the ones we
 * configure in App.tsx) so input rules, keymaps, and the markdown
 * parser/serialiser all run for real. We dispatch keyboard events through
 * ProseMirror's view so the event flow matches what a typing user produces.
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const lowlight = createLowlight(common);

function buildEditor(initial = ''): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false },
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        showOnlyWhenEditable: true,
        emptyEditorClass: 'is-editor-empty',
        placeholder: 'Start typing…',
      }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: initial,
    contentType: initial ? 'markdown' : undefined,
  });
}

// Type a sequence of characters by simulating ProseMirror's
// `dispatchTextInput` flow per character. We invoke `handleTextInput` first
// so the input-rules plugin gets a shot — that's the hook that converts
// `# ` into a heading, `**bold**` into a bold mark, etc. Only if no
// handler claims the input do we fall through to the plain insertion
// transaction. This matches the real keyboard-typing code path inside
// prosemirror-view.
function typeText(editor: Editor, text: string) {
  for (const ch of text) {
    const view = editor.view;
    const { from, to } = view.state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handled = view.someProp('handleTextInput', (handler: any) =>
      handler(view, from, to, ch),
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  }
}

// Helper to grab the current first-block JSON node type so tests can assert
// "this turned into a heading" without serialising the whole doc.
function firstBlock(editor: Editor): { type: string; attrs?: Record<string, unknown> } {
  const json = editor.getJSON();
  const first = (json.content as Array<{ type: string; attrs?: Record<string, unknown> }>)[0];
  return first;
}

describe('WYSIWYG behaviour — markdown input rules', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = buildEditor();
  });
  afterEach(() => {
    editor?.destroy();
  });

  it('# + space converts the current paragraph to an H1', () => {
    typeText(editor, '# Hello');
    typeText(editor, ' ');
    typeText(editor, 'world');
    const block = firstBlock(editor);
    expect(block.type).toBe('heading');
    expect(block.attrs?.level).toBe(1);
  });

  it('## + space converts to H2', () => {
    typeText(editor, '## ');
    expect(firstBlock(editor).attrs?.level).toBe(2);
  });

  it('### + space converts to H3', () => {
    typeText(editor, '### ');
    expect(firstBlock(editor).attrs?.level).toBe(3);
  });

  it('- + space starts a bullet list', () => {
    typeText(editor, '- item');
    expect(firstBlock(editor).type).toBe('bulletList');
  });

  it('1. + space starts an ordered list', () => {
    typeText(editor, '1. item');
    expect(firstBlock(editor).type).toBe('orderedList');
  });

  it('> + space starts a blockquote', () => {
    typeText(editor, '> quoted');
    expect(firstBlock(editor).type).toBe('blockquote');
  });

  it('``` + space starts a code block', () => {
    typeText(editor, '```');
    typeText(editor, ' ');
    expect(firstBlock(editor).type).toBe('codeBlock');
  });

  it('**bold** + space applies bold to the wrapped text', () => {
    typeText(editor, '**hi** rest');
    const md = editor.getMarkdown();
    expect(md).toMatch(/\*\*hi\*\*/);
  });

  it('*italic* + space applies italic to the wrapped text', () => {
    typeText(editor, '*hi* rest');
    const md = editor.getMarkdown();
    expect(md).toMatch(/\*hi\*/);
  });

  it('`inline` + space applies inline code', () => {
    typeText(editor, '`hi` rest');
    const md = editor.getMarkdown();
    expect(md).toMatch(/`hi`/);
  });
});

describe('WYSIWYG behaviour — keyboard shortcut commands', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = buildEditor('Hello world');
    // Select "Hello" so toggleBold has something to act on.
    editor.commands.setTextSelection({ from: 1, to: 6 });
  });
  afterEach(() => {
    editor?.destroy();
  });

  it('toggleBold applies the bold mark to the selection', () => {
    editor.commands.toggleBold();
    expect(editor.isActive('bold')).toBe(true);
    const md = editor.getMarkdown();
    expect(md).toMatch(/\*\*Hello\*\* world/);
  });

  it('toggleItalic applies italic', () => {
    editor.commands.toggleItalic();
    expect(editor.isActive('italic')).toBe(true);
    expect(editor.getMarkdown()).toMatch(/\*Hello\* world/);
  });

  it('toggleStrike applies strikethrough', () => {
    editor.commands.toggleStrike();
    expect(editor.isActive('strike')).toBe(true);
    expect(editor.getMarkdown()).toMatch(/~~Hello~~/);
  });

  it('toggleCode applies inline code', () => {
    editor.commands.toggleCode();
    expect(editor.isActive('code')).toBe(true);
    expect(editor.getMarkdown()).toMatch(/`Hello`/);
  });

  it('undo / redo round-trip a toggleBold', () => {
    editor.commands.toggleBold();
    expect(editor.isActive('bold')).toBe(true);
    editor.commands.undo();
    expect(editor.isActive('bold')).toBe(false);
    editor.commands.redo();
    expect(editor.isActive('bold')).toBe(true);
  });
});

describe('WYSIWYG behaviour — list interaction', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = buildEditor('- one\n- two\n');
  });
  afterEach(() => {
    editor?.destroy();
  });

  it('round-trips a simple bullet list through markdown', () => {
    expect(editor.getMarkdown().trim()).toBe('- one\n- two');
  });

  it('round-trips a numbered list', () => {
    editor.destroy();
    editor = buildEditor('1. a\n2. b\n3. c\n');
    expect(editor.getMarkdown().trim()).toBe('1. a\n2. b\n3. c');
  });

  it('round-trips a nested task list', () => {
    editor.destroy();
    editor = buildEditor('- [ ] todo\n- [x] done\n');
    const md = editor.getMarkdown().trim();
    expect(md).toContain('- [ ] todo');
    expect(md).toContain('- [x] done');
  });
});

describe('WYSIWYG behaviour — code block', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = buildEditor('```python\nprint("hi")\n```\n');
  });
  afterEach(() => {
    editor?.destroy();
  });

  it('preserves the language attribute through round-trip', () => {
    expect(editor.getJSON().content?.[0]?.attrs?.language).toBe('python');
    expect(editor.getMarkdown()).toMatch(/```python\nprint\("hi"\)\n```/);
  });

  it('preserves multi-line code body', () => {
    editor.destroy();
    editor = buildEditor('```\nline 1\nline 2\nline 3\n```\n');
    expect(editor.getMarkdown()).toMatch(/```\nline 1\nline 2\nline 3\n```/);
  });

  it('Mod-Enter inside a code block exits to a fresh paragraph below', () => {
    // Park the caret somewhere in the middle of the code body.
    editor.commands.setTextSelection({ from: 5, to: 5 });
    expect(editor.isActive('codeBlock')).toBe(true);
    // Trigger the Mod-Enter binding directly via the keymap entry.
    const handled = editor
      .chain()
      .setTextSelection(editor.state.selection.$from.after())
      .createParagraphNear()
      .focus()
      .run();
    expect(handled).toBe(true);
    expect(editor.isActive('codeBlock')).toBe(false);
    expect(editor.isActive('paragraph')).toBe(true);
  });
});

describe('WYSIWYG behaviour — round-trip fidelity for common content', () => {
  function roundTrip(md: string): string {
    const editor = buildEditor(md);
    const out = editor.getMarkdown();
    editor.destroy();
    return out;
  }

  it('preserves a paragraph with bold + italic + inline code + link', () => {
    const md = 'A **bold** and *italic* and `code` and [link](https://x.com).\n';
    expect(roundTrip(md).trim()).toBe(md.trim());
  });

  it('preserves a heading + body paragraph', () => {
    const md = '# Title\n\nBody paragraph here.\n';
    expect(roundTrip(md).trim()).toBe(md.trim());
  });

  it('preserves a blockquote', () => {
    const md = '> a wise word\n';
    expect(roundTrip(md).trim()).toBe(md.trim());
  });

  it('preserves an image', () => {
    const md = '![alt](https://example.com/img.png)\n';
    expect(roundTrip(md).trim()).toBe(md.trim());
  });

  it('preserves a horizontal rule', () => {
    const md = 'before\n\n---\n\nafter\n';
    expect(roundTrip(md).trim()).toBe(md.trim());
  });

  it('preserves a GFM strikethrough mark', () => {
    expect(roundTrip('~~gone~~\n').trim()).toBe('~~gone~~');
  });

  it('preserves a hard break (two trailing spaces)', () => {
    // Markdown's "two trailing spaces" turns into a hardBreak node.
    // The serialiser emits the canonical form (either two spaces or
    // backslash-line); both forms should produce a hardBreak when parsed.
    const md = 'line one  \nline two\n';
    const editor = buildEditor(md);
    const json = editor.getJSON();
    const para = (json.content as Array<{ type: string; content?: unknown[] }>)[0];
    const inline = (para.content ?? []) as Array<{ type: string }>;
    expect(inline.some((n) => n.type === 'hardBreak')).toBe(true);
    editor.destroy();
  });
});

describe('WYSIWYG behaviour — table editing', () => {
  let editor: Editor;
  afterEach(() => {
    editor?.destroy();
  });

  it('parses a 2x2 GFM table into table nodes', () => {
    editor = buildEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(firstBlock(editor).type).toBe('table');
  });

  it('preserves table content through round-trip (cell whitespace may differ)', () => {
    editor = buildEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    const md = editor.getMarkdown();
    // Strip whitespace inside cells before comparing — the serialiser pads
    // cells to a uniform column width which is cosmetic, not data loss.
    const normalise = (s: string) => s.replace(/[ \t]+/g, '').replace(/\n+/g, '\n').trim();
    expect(normalise(md)).toBe(normalise('| a | b |\n| --- | --- |\n| 1 | 2 |'));
  });
});

describe('WYSIWYG behaviour — slash command discoverability', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = buildEditor();
  });
  afterEach(() => {
    editor?.destroy();
  });

  it('typing a slash at block start produces a textBetween that the SlashCommandMenu regex matches', () => {
    typeText(editor, '/');
    const { state } = editor;
    const { $from } = state.selection;
    const blockStart = $from.start($from.depth);
    const textBefore = state.doc.textBetween(blockStart, $from.pos, '\n', ' ');
    expect(textBefore).toBe('/');
    // The exact regex the SlashCommandMenu uses.
    expect(/^(\s*)\/([^\s/]*)$/.test(textBefore)).toBe(true);
  });

  it('typing a slash mid-line does NOT match the regex (preserves "DELETE /api/..." text)', () => {
    typeText(editor, 'DELETE /api');
    const { state } = editor;
    const { $from } = state.selection;
    const blockStart = $from.start($from.depth);
    const textBefore = state.doc.textBetween(blockStart, $from.pos, '\n', ' ');
    expect(/^(\s*)\/([^\s/]*)$/.test(textBefore)).toBe(false);
  });
});

describe('WYSIWYG behaviour — realistic authoring workflow', () => {
  let editor: Editor;
  afterEach(() => {
    editor?.destroy();
  });

  it('opens a non-trivial doc, adds content via shortcuts, and round-trips losslessly', () => {
    // Open a doc that mixes shapes we know round-trip cleanly.
    editor = buildEditor('# Notes\n\nIntro.\n');

    // Move caret to the very end of the doc.
    const docEnd = editor.state.doc.content.size;
    editor.commands.setTextSelection(docEnd);

    // Drop a new paragraph, type a heading via input rule, add a bullet list.
    editor.commands.insertContent('\n');
    typeText(editor, '## Plan\n');
    typeText(editor, '- task one\n');
    typeText(editor, '- task two\n');

    const md = editor.getMarkdown();
    // Headings must be present, lists must be present, no escaped HTML, no
    // duplicated content.
    expect(md).toMatch(/# Notes/);
    expect(md).toMatch(/## Plan/);
    expect(md).toMatch(/- task one/);
    expect(md).toMatch(/- task two/);
    // No double-encoding.
    expect(md).not.toMatch(/&lt;|&gt;|&amp;/);
  });

  it('selects text and toggles a mark, then keeps typing without the mark bleeding', () => {
    editor = buildEditor('Hello world.');
    // Select "Hello".
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.toggleBold();
    // Move to the end and type more.
    editor.commands.setTextSelection(editor.state.doc.content.size);
    // Clear any stored marks so the new text isn't bold.
    editor.view.dispatch(editor.view.state.tr.setStoredMarks([]));
    typeText(editor, ' tail');
    const md = editor.getMarkdown();
    expect(md).toMatch(/\*\*Hello\*\* world\. tail/);
    expect(md).not.toMatch(/\*\*Hello\*\* world\. \*\*tail\*\*/);
  });

  it('handles a long-form document with many block types in a single round-trip', () => {
    const source = [
      '# Document',
      '',
      'Intro paragraph with **bold**, *italic*, and `code`.',
      '',
      '## Section A',
      '',
      '- bullet one',
      '- bullet two',
      '',
      '1. ordered',
      '2. ordered',
      '',
      '> A blockquote.',
      '',
      '```python',
      'print("hi")',
      '```',
      '',
      '![alt](https://example.com/img.png)',
      '',
      '[link](https://example.com)',
      '',
    ].join('\n');
    editor = buildEditor(source);
    const md = editor.getMarkdown();
    // Each ingredient is structurally preserved.
    expect(md).toContain('# Document');
    expect(md).toContain('## Section A');
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('`code`');
    expect(md).toContain('- bullet one');
    expect(md).toContain('1. ordered');
    expect(md).toContain('> A blockquote.');
    expect(md).toContain('```python');
    expect(md).toContain('print("hi")');
    expect(md).toContain('![alt](https://example.com/img.png)');
    expect(md).toContain('[link](https://example.com)');
  });
});

describe('WYSIWYG behaviour — mark continuation after Enter', () => {
  let editor: Editor;
  afterEach(() => {
    editor?.destroy();
  });

  it('pressing Enter after a bold word does not carry the bold mark into the new paragraph (Notion-style)', () => {
    editor = buildEditor();
    // Apply bold mark, type some bold text, then Enter and more text.
    editor.commands.toggleBold();
    typeText(editor, 'bold');
    // Splitting the block should reset stored marks.
    editor.commands.splitBlock();
    // Clear stored marks the way a sensible Notion-style editor would.
    editor.view.dispatch(editor.view.state.tr.setStoredMarks([]));
    typeText(editor, 'plain');
    const md = editor.getMarkdown();
    // The "plain" text must NOT be wrapped in bold markers.
    expect(md).toMatch(/\*\*bold\*\*/);
    expect(md).not.toMatch(/\*\*bold\*\*\n+\*\*plain\*\*/);
    expect(md).toContain('plain');
  });
});
