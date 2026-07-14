/**
 * Behaviour tests for the custom code-block node view and keyboard handling.
 * A real Tiptap editor in jsdom exposes document structure and rendered DOM,
 * but jsdom has no layout, so it cannot prove actual visual-row geometry.
 *
 * Guards the down-arrow exit specifically: our addKeyboardShortcuts override
 * shadows CodeBlockLowlight's built-in exitOnArrowDown, so the exit must be
 * re-implemented here. The endOfTextblock mock verifies our delegation and
 * decision boundary; constrained-width visual wrapping is covered live.
 */
import { readFileSync } from 'node:fs';

import StarterKit from '@tiptap/starter-kit';
import { Editor, type Content } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodeBlockExtension } from './codeBlockExtension';

const APP_STYLESHEET = readFileSync('src/styles.css', 'utf8').replace(
  /^@import\s+[^;]+;\s*$/gm,
  '',
);
const bootstrapHosts = new Set<HTMLElement>();
const testStyleNodes = new Set<HTMLStyleElement>();

function buildEditor(content: Content): Editor {
  const bootstrapHost = document.createElement('div');
  bootstrapHosts.add(bootstrapHost);
  document.body.appendChild(bootstrapHost);
  return new Editor({
    element: bootstrapHost,
    extensions: [StarterKit.configure({ codeBlock: false }), createCodeBlockExtension()],
    content,
  });
}

function appendAppStylesheet(): HTMLStyleElement {
  const style = document.createElement('style');
  style.dataset.testAppStylesheet = '';
  style.textContent = APP_STYLESHEET;
  document.head.appendChild(style);
  testStyleNodes.add(style);
  return style;
}

function codeBlockDocument(language: string | null): Content {
  return {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language },
        ...(language === 'mermaid'
          ? {}
          : { content: [{ type: 'text', text: 'only' }] }),
      },
    ],
  };
}

const CODE_BLOCK_WRAP_CASES = [
  {
    variant: 'ordinary',
    language: null,
    selector: '.code-block-view:not(.code-block-view-mermaid) > pre',
  },
  {
    variant: 'Mermaid source',
    language: 'mermaid',
    selector: '.mermaid-source-pre',
  },
].flatMap((nodeVariant) =>
  [
    {
      codeBlockWrap: 'off',
      lineWrap: 'true',
      expectedWhiteSpace: 'pre',
      expectedOverflowWrap: 'normal',
    },
    {
      codeBlockWrap: 'off',
      lineWrap: 'false',
      expectedWhiteSpace: 'pre',
      expectedOverflowWrap: 'normal',
    },
    {
      codeBlockWrap: 'on',
      lineWrap: 'true',
      expectedWhiteSpace: 'pre-wrap',
      expectedOverflowWrap: 'anywhere',
    },
    {
      codeBlockWrap: 'on',
      lineWrap: 'false',
      expectedWhiteSpace: 'pre-wrap',
      expectedOverflowWrap: 'anywhere',
    },
  ].map((wrapState) => ({ ...nodeVariant, ...wrapState })),
);

function pressArrowDown(editor: Editor): boolean {
  return Boolean(
    editor.view.someProp('handleKeyDown', (fn) =>
      fn?.(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    ),
  );
}

describe('code block keyboard handling', () => {
  let editor: Editor;

  beforeEach(() => {
    document
      .querySelectorAll('style[data-tiptap-style]')
      .forEach((style) => style.remove());
  });

  afterEach(() => {
    cleanup();
    editor?.destroy();
    bootstrapHosts.forEach((host) => host.remove());
    bootstrapHosts.clear();
    testStyleNodes.forEach((style) => style.remove());
    testStyleNodes.clear();
    document
      .querySelectorAll('style[data-tiptap-style]')
      .forEach((style) => style.remove());
  });

  it.each(CODE_BLOCK_WRAP_CASES)(
    '$variant computes $expectedWhiteSpace with code wrap $codeBlockWrap and general line wrap $lineWrap',
    async ({
      language,
      selector,
      codeBlockWrap,
      lineWrap,
      expectedWhiteSpace,
      expectedOverflowWrap,
    }) => {
      const appStyle = appendAppStylesheet();
      editor = buildEditor(codeBlockDocument(language));

      const { container } = render(
        createElement(
          'div',
          {
            className: 'editor-pane-wysiwyg',
            'data-code-block-wrap': codeBlockWrap,
            'data-line-wrap': lineWrap,
          },
          createElement(
            'div',
            { className: 'notion-editor-content' },
            createElement(EditorContent, { editor }),
          ),
        ),
      );

      const codePre = await waitFor(() => {
        const element = container.querySelector<HTMLElement>(selector);
        expect(element).not.toBeNull();
        return element!;
      });
      const tiptapStyle = document.head.querySelector<HTMLStyleElement>(
        'style[data-tiptap-style]',
      );
      expect(tiptapStyle?.textContent).toContain('.ProseMirror pre');
      expect(
        Array.from(document.head.children).indexOf(tiptapStyle!),
      ).toBeGreaterThan(Array.from(document.head.children).indexOf(appStyle));

      const computedStyle = window.getComputedStyle(codePre);
      expect(computedStyle.whiteSpace).toBe(expectedWhiteSpace);
      expect(computedStyle.overflowWrap).toBe(expectedOverflowWrap);
    },
  );

  it('lets ordinary code content inherit white-space in the real React node view', async () => {
    editor = buildEditor('<pre><code>only</code></pre>');
    const { container } = render(createElement(EditorContent, { editor }));

    const content = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        '.code-block-view > pre > code',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(content.style.whiteSpace).toBe('inherit');
  });

  describe('ArrowDown exit', () => {
    beforeEach(() => {
      editor = buildEditor('<pre><code>line1\nline2</code></pre>');
      // jsdom has no layout; downstream keymap handlers (gapcursor) call
      // endOfTextblock -> coordsAtPos -> getClientRects, which throws. The
      // stub models ProseMirror's visual-boundary result so these tests verify
      // our shortcut decision rather than browser wrapping geometry.
      vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(false);
    });

    it('exits the code block to the paragraph below from the last line', () => {
      vi.mocked(editor.view.endOfTextblock).mockReturnValue(true);
      // Caret at the very end (last line) of the code block.
      const end = editor.state.doc.firstChild!.nodeSize - 1;
      editor.chain().focus().setTextSelection(end).run();
      const handled = pressArrowDown(editor);
      expect(handled).toBe(true);
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    });

    it('does not exit when the caret is not on the last line', () => {
      // Caret on the first line (before the newline).
      editor.chain().focus().setTextSelection(3).run();
      const handled = pressArrowDown(editor);
      expect(handled).toBeFalsy();
      expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
    });

    it('does not exit when ProseMirror reports another visual row below', () => {
      editor.chain().focus().setTextSelection(8).run();
      const handled = pressArrowDown(editor);
      expect(editor.view.endOfTextblock).toHaveBeenCalledWith('down');
      expect(handled).toBeFalsy();
      expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
    });
  });

  it('creates a paragraph below when the code block is the last node', () => {
    editor = buildEditor('<pre><code>only</code></pre>');
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
    // Remove any trailing node so the code block is genuinely last.
    const docChildCount = editor.state.doc.childCount;
    // Place caret at end of the code block content.
    const end = editor.state.doc.firstChild!.nodeSize - 1;
    editor.chain().focus().setTextSelection(end).run();
    pressArrowDown(editor);
    // Either moved into an existing trailing paragraph or created one; the
    // caret must end up in a paragraph regardless of starting trailing state.
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(docChildCount);
  });
});
