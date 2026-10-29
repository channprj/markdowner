import { render } from '@testing-library/react';
import { EditorSelection, runScopeHandlers, type EditorView } from '@uiw/react-codemirror';
import { describe, expect, it } from 'vitest';

import { SourceEditorView } from './SourceEditorView';

// CodeMirror reads "Mod" as ⌘ on macOS and Ctrl elsewhere.
const commandKey = /Mac/.test(navigator.platform) ? 'metaKey' : 'ctrlKey';

function mountSourceEditor(value: string): EditorView {
  let view: EditorView | null = null;
  render(
    <SourceEditorView
      value={value}
      extensions={[]}
      theme="light"
      onChange={() => {}}
      onStatistics={() => {}}
      onCreateEditor={(created) => {
        view = created;
      }}
    />,
  );
  if (!view) throw new Error('CodeMirror view was not created');
  return view;
}

/** Shift+⌘ chord as WebKit reports it: shifted `key` plus the physical `keyCode`. */
function press(view: EditorView, key: string) {
  const event = new KeyboardEvent('keydown', { key, shiftKey: true, [commandKey]: true, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) });
  return runScopeHandlers(view, event, 'editor');
}

describe('SourceEditorView keyboard shortcuts', () => {
  it('deletes the lines the selection touches with Cmd+Shift+K, like Zed', () => {
    const view = mountSourceEditor('alpha\nbeta\ngamma\ndelta');
    view.dispatch({ selection: EditorSelection.range(8, 13) });

    expect(press(view, 'K')).toBe(true);
    expect(view.state.doc.toString()).toBe('alpha\ndelta');
  });

  it('leaves Cmd+Shift+I to the app so it can open the AI prompt', () => {
    const view = mountSourceEditor('alpha\nbeta');
    view.dispatch({ selection: EditorSelection.range(6, 10) });

    expect(press(view, 'I')).toBe(false);
    expect(view.state.doc.toString()).toBe('alpha\nbeta');
  });
});
