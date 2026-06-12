/**
 * The WYSIWYG find-match decorations render as inline spans in the editor
 * DOM — assert through the DOM since that is exactly what the user sees.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WysiwygFindHighlight,
  setWysiwygFindHighlight,
} from './wysiwygFindHighlight';

describe('WysiwygFindHighlight', () => {
  let editor: Editor;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [StarterKit.configure({ codeBlock: false }), WysiwygFindHighlight],
      content: '<p>alpha beta alpha</p>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('paints every match and emphasizes the active one', () => {
    // Positions: paragraph text starts at 1 — "alpha"(1..6), "alpha"(12..17).
    setWysiwygFindHighlight(editor, {
      matches: [
        { from: 1, to: 6 },
        { from: 12, to: 17 },
      ],
      activeIndex: 1,
    });

    const marks = host.querySelectorAll('.wysiwyg-find-match');
    const active = host.querySelectorAll('.wysiwyg-find-match-active');
    expect(marks).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe('alpha');
  });

  it('clears the highlights on a null spec', () => {
    setWysiwygFindHighlight(editor, {
      matches: [{ from: 1, to: 6 }],
      activeIndex: 0,
    });
    setWysiwygFindHighlight(editor, null);

    expect(host.querySelectorAll('.wysiwyg-find-match')).toHaveLength(0);
  });
});
