/**
 * Real-library tests for the CodeMirror find-match decorations (the mocked
 * sourceEditorExtensions.test.ts only checks extension ordering).
 */
import { EditorState } from '@uiw/react-codemirror';
import { describe, expect, it } from 'vitest';

import {
  setSourceFindHighlight,
  sourceFindHighlightField,
} from './sourceEditorExtensions';

function decorationClasses(state: EditorState): Array<{ from: number; to: number; cls: string }> {
  const found: Array<{ from: number; to: number; cls: string }> = [];
  const iter = state.field(sourceFindHighlightField).iter();
  while (iter.value) {
    found.push({
      from: iter.from,
      to: iter.to,
      cls: (iter.value.spec as { class?: string }).class ?? '',
    });
    iter.next();
  }
  return found;
}

describe('source find highlight field', () => {
  const baseState = () =>
    EditorState.create({
      doc: 'alpha beta alpha gamma',
      extensions: [sourceFindHighlightField],
    });

  it('marks every match and emphasizes the active one', () => {
    const state = baseState().update({
      effects: setSourceFindHighlight.of({
        matches: [
          { start: 0, end: 5 },
          { start: 11, end: 16 },
        ],
        activeIndex: 1,
      }),
    }).state;

    expect(decorationClasses(state)).toEqual([
      { from: 0, to: 5, cls: 'cm-findMatch' },
      { from: 11, to: 16, cls: 'cm-findMatch cm-findMatch-active' },
    ]);
  });

  it('clears all decorations on a null effect', () => {
    let state = baseState().update({
      effects: setSourceFindHighlight.of({
        matches: [{ start: 0, end: 5 }],
        activeIndex: 0,
      }),
    }).state;
    state = state.update({ effects: setSourceFindHighlight.of(null) }).state;

    expect(decorationClasses(state)).toEqual([]);
  });

  it('remaps decorations through document edits and clamps out-of-range matches', () => {
    let state = baseState().update({
      effects: setSourceFindHighlight.of({
        matches: [
          { start: 11, end: 16 },
          { start: 100, end: 200 },
        ],
        activeIndex: 0,
      }),
    }).state;
    // Insert at the start: the surviving decoration shifts right by 3.
    state = state.update({ changes: { from: 0, insert: '>> ' } }).state;

    expect(decorationClasses(state)).toEqual([
      { from: 14, to: 19, cls: 'cm-findMatch cm-findMatch-active' },
    ]);
  });
});
