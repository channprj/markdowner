/**
 * Regression tests for the link-edit popup. Uses a real TipTap editor so the
 * caret → popup → commit flow exercises the production code path. jsdom has
 * no layout, so `coordsAtPos`/`hasFocus` are stubbed on the live view.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WYSIWYG_LINK_OPTIONS } from '@/lib/wysiwygLinkOptions';

import { LinkPopup } from './LinkPopup';

function linkAt(editor: Editor): { text: string; href: string } | null {
  let found: { text: string; href: string } | null = null;
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((m) => m.type.name === 'link');
    if (mark && !found) {
      found = { text: node.text ?? '', href: mark.attrs.href as string };
    }
  });
  return found;
}

async function flushPopupFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('LinkPopup', () => {
  let editor: Editor;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ link: WYSIWYG_LINK_OPTIONS, codeBlock: false }),
      ],
      content: '<p><a href="https://old.example">docs</a> tail</p>',
    });
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      top: 100,
      bottom: 116,
      left: 40,
      right: 80,
    });
  });

  afterEach(() => {
    // Unmount before destroying the editor so the popup portal is removed
    // even when a test left it open.
    cleanup();
    editor.destroy();
    host.remove();
  });

  async function openAtCaret() {
    render(<LinkPopup editor={editor} enabled />);
    await act(async () => {
      editor.commands.setTextSelection(3); // inside "docs"
    });
    await flushPopupFrame();
    return screen.findByTestId('link-popup');
  }

  it('opens when the caret enters a link and shows its href', async () => {
    await openAtCaret();
    const input = screen.getByRole('textbox', { name: /link url/i });
    expect(input).toHaveValue('https://old.example');
  });

  it('commits an edited href back onto the link', async () => {
    await openAtCaret();
    const input = screen.getByRole('textbox', { name: /link url/i });
    fireEvent.change(input, { target: { value: 'https://new.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(linkAt(editor)).toEqual({ text: 'docs', href: 'https://new.example' });
  });

  it('removes the link via the remove button', async () => {
    await openAtCaret();
    fireEvent.click(screen.getByRole('button', { name: /remove link/i }));

    expect(linkAt(editor)).toBeNull();
    expect(editor.state.doc.textContent).toBe('docs tail');
  });

  it('keeps the hover popup open while the URL input is focused, even on pointer drift', async () => {
    render(<LinkPopup editor={editor} enabled />);
    // Park the caret outside the link so ONLY hover can open the popup.
    await act(async () => {
      editor.commands.setTextSelection(8); // inside " tail"
    });
    await flushPopupFrame();

    const anchor = host.querySelector('a') as HTMLAnchorElement;
    await act(async () => {
      fireEvent.mouseOver(anchor);
    });
    const input = await screen.findByRole('textbox', { name: /link url/i });
    expect(input).toHaveValue('https://old.example');

    // User moves into the popup and focuses the URL input to edit it.
    await act(async () => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);

    // Pointer drifts off the popup; the hide grace period (320ms) elapses.
    await act(async () => {
      fireEvent.mouseLeave(screen.getByTestId('link-popup'));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // The popup must NOT have closed out from under the mid-edit caret.
    expect(screen.queryByTestId('link-popup')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /link url/i })).toHaveValue(
      'https://old.example',
    );
  });

  it('bails instead of linking the wrong range when positions went stale', async () => {
    await openAtCaret();
    const input = screen.getByRole('textbox', { name: /link url/i });
    fireEvent.change(input, { target: { value: 'https://new.example' } });

    // Shift the document under the open popup (positions 1..5 → 4..8)
    // without letting the rAF refresh run, then commit immediately.
    editor.view.dispatch(editor.state.tr.insertText('XX ', 1));
    fireEvent.keyDown(input, { key: 'Enter' });

    // The stored position now points at plain text — the commit must not
    // apply the href there. The original link keeps its old href.
    expect(linkAt(editor)).toEqual({ text: 'docs', href: 'https://old.example' });
  });
});
