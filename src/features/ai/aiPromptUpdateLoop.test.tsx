import { fireEvent, render, screen } from '@testing-library/react';
import { Component, startTransition, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEditorPopoverPosition } from '@/components/wysiwyg/useEditorPopoverPosition';
import type { AppSnapshot } from '@/lib/desktop';
import { useDocumentSession } from '@/lib/useDocumentSession';

/**
 * Regression for React #185 ("Maximum update depth exceeded") thrown from
 * AiSelectionPopover in v0.261028.1. Reproduced in WebKit/Chromium with the
 * real App; this test keeps the same three ingredients with the real hooks:
 *
 * 1. A document-session transition is still pending (the draft-mirror sync and
 *    applySnapshot use `startTransition(() => setSnapshot(...))`) when the AI
 *    shortcut runs `flushWysiwygDraftNow()` -> `setLocalDraft(sameValue)` and
 *    opens the prompt. Every render now rebases that later no-op write onto the
 *    skipped transition, and `sessionReducer` returns a fresh object, so App
 *    never bails out.
 * 2. After every App commit a passive effect writes App state with an
 *    unchanged value (in App: @uiw/react-codemirror re-dispatches
 *    `StateEffect.reconfigure` because App passes useEffectEvent functions,
 *    which get a new identity each render, so `onStatistics` runs
 *    `setCursorPosition(current => current)`). App has pending lanes, so React
 *    cannot bail out eagerly and schedules a render.
 * 3. The prompt re-renders with App (it is not memoized) and
 *    useEditorPopoverPosition's dependency-less layout effect calls
 *    `setPosition` on every commit; its fiber keeps stale lanes, so each call
 *    schedules a SyncLane render. React 19 renders pending Default work with
 *    SyncLane, so the chain never yields and the 51st nested commit throws.
 */

const SNAPSHOT: AppSnapshot = {
  activeDocumentVersion: { id: 1, revision: 1 }, activeDocumentName: 'sample.md',
  activeDocumentPath: '/tmp/sample.md', activeDocumentSource: 'a\n', activeDocumentDirty: false,
  rootDir: null, workspaceDocuments: [], recentDocuments: [], mode: 'Wysiwyg',
  theme: { kind: 'BuiltInLight', stylesheet: null, stylesheetPath: null }, lastError: null,
};

class Boundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <p>crashed</p> : this.props.children;
  }
}

function fakeEditor(): Editor {
  const dom = document.createElement('div');
  dom.getBoundingClientRect = () => new DOMRect(0, 80, 800, 600);
  return {
    state: { selection: { from: 1, to: 1, head: 1 } },
    view: { dom, coordsAtPos: () => ({ left: 100, right: 100, top: 200, bottom: 224 }) },
    on: () => undefined,
    off: () => undefined,
  } as unknown as Editor;
}

afterEach(() => vi.restoreAllMocks());

describe('AI prompt update loop', () => {
  it('opens the prompt while a session transition is pending without a nested update loop', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const editor = fakeEditor();
    const STATISTICS_CAP = 400;
    let statisticsWrites = 0;
    const errors: Error[] = [];

    function Prompt({ onClose }: { onClose: () => void }) {
      const panelRef = useRef<HTMLElement | null>(null);
      const position = useEditorPopoverPosition(editor, panelRef);
      return (
        <section
          data-testid="prompt"
          ref={(element) => {
            panelRef.current = element;
            if (element) element.getBoundingClientRect = () => new DOMRect(0, 0, 480, 300);
          }}
          style={position ?? undefined}
          onClick={onClose}
        />
      );
    }

    function Shell() {
      const session = useDocumentSession(SNAPSHOT);
      const [, setCursorPosition] = useState({ line: 1, column: 1 });
      const [promptOpen, setPromptOpen] = useState(false);
      // Stands in for CodeMirror's onStatistics after each App commit. Capped
      // so a self-sustaining re-render loop fails the test instead of hanging.
      useEffect(() => {
        if (statisticsWrites >= STATISTICS_CAP) return;
        statisticsWrites += 1;
        setCursorPosition((current) => current);
      });
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              // Draft-mirror sync result still rendering in a transition...
              startTransition(() => session.setSnapshot((current) => current));
              // ...when Cmd+Shift+I flushes the WYSIWYG draft and opens the prompt.
              session.setLocalDraft(session.localDraftRef.current);
              setPromptOpen(true);
            }}
          >
            open
          </button>
          {promptOpen ? <Prompt onClose={() => setPromptOpen(false)} /> : null}
        </div>
      );
    }

    render(
      <Boundary onError={(error) => errors.push(error)}>
        <Shell />
      </Boundary>,
    );
    statisticsWrites = 0;
    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    expect(errors.map((error) => error.message)).toEqual([]);
    expect(screen.getByTestId('prompt')).toBeInTheDocument();
    // The shell must settle (and let the transition commit) instead of
    // re-rendering after every commit.
    expect(statisticsWrites).toBeLessThan(10);
  });
});
