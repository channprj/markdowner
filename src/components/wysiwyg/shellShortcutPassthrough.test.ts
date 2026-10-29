/**
 * TipTap's Italic binds Mod-i and Mod-I, and ProseMirror's keymap also
 * matches Mod-i for a shifted key, so ⌘⇧I toggled italic and was consumed
 * before the app could open the AI prompt. Drives real keydown events through
 * a real editor's DOM to check that the passthrough leaves ⌘⇧I to the window.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { ShellShortcutPassthrough } from './shellShortcutPassthrough';

// ProseMirror reads "Mod" as ⌘ on macOS and Ctrl elsewhere.
const commandKey = /Mac/.test(navigator.platform) ? 'metaKey' : 'ctrlKey';
const isAiShortcut = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'i';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function buildEditor(withPassthrough: boolean): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: [
      StarterKit,
      ...(withPassthrough ? [ShellShortcutPassthrough.configure({ matches: isAiShortcut })] : []),
    ],
    content: '<p>alpha</p>',
  });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  return editor;
}

/** Dispatch a keydown on the editor DOM as WebKit reports it, with the physical keyCode. */
function press(target: Editor, key: string, shift: boolean): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey: shift, [commandKey]: true, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) });
  target.view.dom.dispatchEvent(event);
  return event;
}

describe('ShellShortcutPassthrough', () => {
  it('without it, Cmd+Shift+I toggles italic and is consumed', () => {
    const view = buildEditor(false);
    const event = press(view, 'I', true);

    expect(event.defaultPrevented).toBe(true);
    expect(view.isActive('italic')).toBe(true);
  });

  it('leaves Cmd+Shift+I to the window without formatting the text', () => {
    const view = buildEditor(true);
    let reachedWindow = false;
    const onWindowKeydown = (event: KeyboardEvent) => {
      reachedWindow = !event.defaultPrevented;
    };
    window.addEventListener('keydown', onWindowKeydown);
    try {
      press(view, 'I', true);
    } finally {
      window.removeEventListener('keydown', onWindowKeydown);
    }

    expect(reachedWindow).toBe(true);
    expect(view.isActive('italic')).toBe(false);
  });

  it('keeps Cmd+I as italic', () => {
    const view = buildEditor(true);
    const event = press(view, 'i', false);

    expect(event.defaultPrevented).toBe(true);
    expect(view.isActive('italic')).toBe(true);
  });
});
