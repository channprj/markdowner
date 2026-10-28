import { Component, useEffect, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import type { Editor as ReactEditor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';

import { AiSelectionPopover, type AiSelectionServices } from './AiSelectionPopover';
import { captureWysiwygEditorSelection, type AiSelectionSnapshot } from './selection';
import type { AiRunResult } from './types';

/*
 * React #185 ("Maximum update depth exceeded") reported at AiSelectionPopover.
 *
 * useEditorPopoverPosition runs a layout effect with no dependency array that
 * always calls setPosition(updater). Once the popover fiber carries a pending
 * lane, React skips the eager same-state bailout, so that call schedules a
 * SyncLane render even though the geometry is unchanged. Because the popover is
 * re-rendered by every App render (it is not memoized), each App render becomes a
 * commit that ends with sync work pending, and React flushes App's pending
 * passive effects before the next sync render. An App re-render chain that
 * would normally run as separate DefaultLane tasks (resetting React's nested
 * update counter after every commit) is thereby fused into one nested chain;
 * after 50 commits the popover's setPosition throws #185 and the error boundary
 * names AiSelectionPopover as the deepest component, as in the production
 * report. Geometry is fully static in this test.
 */

const SOURCE = '테스트\n\n이것은\n\n리스트\n\n만들기 위한\n\n문장들 입니다\n\n123123\n';
const PASSES = 80;

let editor: Editor | undefined;
let surface: HTMLElement | undefined;
afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = undefined;
  surface?.remove();
  vi.restoreAllMocks();
});

function setupEditor(): { editor: Editor; snapshot: AiSelectionSnapshot } {
  surface = document.createElement('div');
  surface.setAttribute('data-testid', 'editor-surface-wysiwyg');
  document.body.appendChild(surface);
  const mount = document.createElement('div');
  surface.appendChild(mount);
  const instance = new Editor({ element: mount, extensions: [StarterKit, Markdown], content: SOURCE, contentType: 'markdown' });
  editor = instance;
  surface.getBoundingClientRect = () => new DOMRect(0, 40, 1200, 720);
  // Static editor geometry: one 24px line per paragraph, 36px apart.
  vi.spyOn(instance.view, 'coordsAtPos').mockImplementation((pos: number) => {
    const index = instance.state.doc.resolve(Math.min(pos, instance.state.doc.content.size)).index(0);
    const top = 100 + index * 36;
    return { left: 60, right: 61, top, bottom: top + 24 };
  });
  instance.commands.setTextSelection({ from: 1, to: instance.state.doc.content.size - 1 });
  const snapshot = captureWysiwygEditorSelection({
    editor: instance, source: instance.getMarkdown(),
    from: instance.state.selection.from, to: instance.state.selection.to, documentId: 'doc-1',
  });
  if (!snapshot) throw new Error('capture failed');
  // Static panel geometry: 420px of content, capped by the inline maxHeight.
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'ai-selection-popover') {
      const max = Number.parseFloat(this.style.maxHeight);
      return new DOMRect(
        Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0,
        480, Number.isFinite(max) ? Math.min(420, max) : 420,
      );
    }
    return original.call(this);
  });
  return { editor: instance, snapshot };
}

const services: AiSelectionServices = {
  keyStatus: async () => ({ configured: true, maskedLabel: null }),
  listModels: async () => [{ id: DEFAULT_SETTINGS.aiPrimaryModel, name: 'Model', contextLength: 100_000,
    inputModalities: ['text'], outputModalities: ['text'], supportedParameters: ['structured_outputs'],
    pricing: { prompt: 0, completion: 0, updatedAt: '' } }],
  run: vi.fn(() => new Promise<AiRunResult>(() => {})),
  cancel: vi.fn(async () => true),
};

class Boundary extends Component<
  { children: ReactNode; onError: (message: string, deepest: string) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.props.onError(error.message, (info.componentStack ?? '').trim().split('\n')[0]?.trim() ?? '');
  }
  render() {
    return this.state.failed ? <p data-testid="crashed" /> : this.props.children;
  }
}

/**
 * Stand-in for App: re-renders itself PASSES times through an ordinary,
 * terminating passive effect, and passes a fresh inline onClose each render.
 */
function renderAppLike(child: (onClose: () => void) => ReactNode) {
  const errors: string[] = [];
  function AppLike() {
    const [pass, setPass] = useState(-1);
    useEffect(() => {
      if (pass >= 0 && pass < PASSES) setPass(pass + 1);
    }, [pass]);
    return (
      <>
        <button type="button" data-testid="start" onClick={() => setPass(0)} />
        <span data-testid="pass">{pass}</span>
        {child(() => {})}
      </>
    );
  }
  render(
    <Boundary onError={(message, deepest) => errors.push(`${message.slice(0, 40)} | deepest: ${deepest}`)}>
      <AppLike />
    </Boundary>,
  );
  return errors;
}

async function startChain() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('start'));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('AiSelectionPopover nested update depth', () => {
  it('control: the same App-like re-render chain is legal without the popover', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const errors = renderAppLike((onClose) => <button type="button" onClick={onClose}>other child</button>);
    await startChain();
    expect(errors).toEqual([]);
    expect(screen.getByTestId('pass')).toHaveTextContent(String(PASSES));
  });

  it('keeps the WYSIWYG AI popover mounted through an App re-render chain with static geometry', async () => {
    const { editor: instance, snapshot } = setupEditor();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const errors = renderAppLike((onClose) => (
      <AiSelectionPopover editor={instance as unknown as ReactEditor} snapshot={snapshot}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true, aiZdrOnly: false }}
        onClose={onClose} onResult={() => {}} services={services} />
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled());
    await startChain();
    // Before the fix: ["Maximum update depth exceeded. This can  | deepest: at AiSelectionPopover (...)"]
    expect(errors).toEqual([]);
    expect(screen.getByTestId('pass')).toHaveTextContent(String(PASSES));
    expect(screen.getByTestId('ai-selection-popover')).toBeInTheDocument();
  });

  it('keeps the popover mounted through the chain while the Mode picker is open', async () => {
    // Base UI syncs itemToStringLabel/isItemEqualToValue into its store from a
    // layout effect; inline callbacks made every open picker item re-render on
    // each App commit, the same amplifier as the position hook.
    const { editor: instance, snapshot } = setupEditor();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const errors = renderAppLike((onClose) => (
      <AiSelectionPopover editor={instance as unknown as ReactEditor} snapshot={snapshot}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true, aiZdrOnly: false }}
        onClose={onClose} onResult={() => {}} services={services} />
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Mode' }));
    expect(await screen.findByRole('option', { name: /^Improve/ })).toBeInTheDocument();
    await startChain();
    expect(errors).toEqual([]);
    expect(screen.getByTestId('pass')).toHaveTextContent(String(PASSES));
  });
});
