import { describe, expect, it } from 'vitest';

import { shouldFocusStartupEditor } from './startupEditorFocus';

describe('shouldFocusStartupEditor', () => {
  it('focuses the editor when the page has no active control', () => {
    expect(
      shouldFocusStartupEditor({
        activeElement: document.body,
        documentBody: document.body,
        documentElement: document.documentElement,
        editorDom: document.createElement('div'),
      }),
    ).toBe(true);
  });

  it('keeps focus restoration inside the editor surface', () => {
    const editorDom = document.createElement('div');
    const textarea = document.createElement('textarea');
    editorDom.append(textarea);

    expect(
      shouldFocusStartupEditor({
        activeElement: textarea,
        documentBody: document.body,
        documentElement: document.documentElement,
        editorDom,
      }),
    ).toBe(true);
  });

  it('does not steal focus from another app control', () => {
    expect(
      shouldFocusStartupEditor({
        activeElement: document.createElement('input'),
        documentBody: document.body,
        documentElement: document.documentElement,
        editorDom: document.createElement('div'),
      }),
    ).toBe(false);
  });
});
