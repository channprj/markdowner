import { describe, expect, it } from 'vitest';

import {
  resolvePersistedWysiwygMarkdown,
  resolveWysiwygContentSyncAction,
} from './wysiwygEditorSync';

describe('resolveWysiwygContentSyncAction', () => {
  it('skips editor-authored updates on the same tab to avoid redundant setContent', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-1',
        lastSyncedTabId: 'doc-1',
        localDraft: '# Draft',
        lastEditorMarkdown: '# Draft',
        isComposing: false,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'skip',
    });
  });

  it('defers same-tab external updates while IME composition is active', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-1',
        lastSyncedTabId: 'doc-1',
        localDraft: '# External',
        lastEditorMarkdown: '# Editor',
        isComposing: true,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'skip',
    });
  });

  it('syncs tab changes even when markdown matches and requests composition finalization when needed', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-2',
        lastSyncedTabId: 'doc-1',
        localDraft: '',
        lastEditorMarkdown: '',
        isComposing: false,
        viewComposing: true,
      }),
    ).toEqual({
      kind: 'sync',
      tabChanged: true,
      shouldClearDomSelection: true,
      shouldFinalizeComposition: true,
    });
  });

  it('syncs external draft changes on the same tab without clearing DOM selection', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-1',
        lastSyncedTabId: 'doc-1',
        localDraft: '# External',
        lastEditorMarkdown: '# Editor',
        isComposing: false,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'sync',
      tabChanged: false,
      shouldClearDomSelection: false,
      shouldFinalizeComposition: false,
    });
  });

  it('skips same-tab drafts that differ only by the trailing newline', () => {
    // The save path normalizes a trailing \n in while getMarkdown() never
    // emits one; both parse to an identical doc, so a resync would only
    // destroy the selection and any unflushed keystrokes.
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-1',
        lastSyncedTabId: 'doc-1',
        localDraft: '# Draft\n',
        lastEditorMarkdown: '# Draft',
        isComposing: false,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'skip',
    });
  });

  it('still syncs across tab changes even for trailing-newline-only differences', () => {
    expect(
      resolveWysiwygContentSyncAction({
        activeTabId: 'doc-2',
        lastSyncedTabId: 'doc-1',
        localDraft: '# Draft\n',
        lastEditorMarkdown: '# Draft',
        isComposing: false,
        viewComposing: false,
      }),
    ).toEqual({
      kind: 'sync',
      tabChanged: true,
      shouldClearDomSelection: true,
      shouldFinalizeComposition: false,
    });
  });
});

describe('resolvePersistedWysiwygMarkdown', () => {
  it('returns the verbatim loaded bytes when the editor still matches the canonical round-trip', () => {
    // Opening a file containing a raw HTML block; @tiptap/markdown
    // round-trips it as escaped text, so `loaded` differs from `canonical`.
    // The user hasn't typed anything, so the live serialised markdown
    // equals `canonical`. We want the save path to write `loaded`, not
    // `current` — otherwise the HTML block silently gets HTML-escaped on
    // disk.
    const loaded = '# Title\n\n<details>note</details>\n';
    const canonical = '# Title\n\n&lt;details&gt;note&lt;/details&gt;\n';
    expect(resolvePersistedWysiwygMarkdown(canonical, loaded, canonical)).toBe(loaded);
  });

  it('returns the live serialised markdown once the user actually edits', () => {
    const loaded = '# Title\n';
    const canonical = '# Title\n\n';
    const current = '# Title\n\nNew paragraph the user just typed\n';
    expect(resolvePersistedWysiwygMarkdown(current, loaded, canonical)).toBe(current);
  });

  it('falls back to the live serialised markdown when load tracking is unavailable', () => {
    expect(resolvePersistedWysiwygMarkdown('x', null, null)).toBe('x');
    expect(resolvePersistedWysiwygMarkdown('x', 'y', null)).toBe('x');
    expect(resolvePersistedWysiwygMarkdown('x', null, 'y')).toBe('x');
  });

  it('returns loaded bytes for a clean round-trip (loaded === canonical) so the no-edit case is still byte-identical', () => {
    // Even when the round-trip is already lossless, we still want
    // byte-for-byte equivalence after a no-op edit (trailing whitespace,
    // EOL normalisation, etc. should never get rewritten).
    const md = '# Title\n';
    expect(resolvePersistedWysiwygMarkdown(md, md, md)).toBe(md);
  });

  it('preserves the user reverting to the canonical state', () => {
    // User typed, then deleted back to the load-time state. Should still
    // save the loaded bytes since the canonical comparison matches.
    const loaded = '~~~\ncode\n~~~\n';
    const canonical = '```\ncode\n```\n';
    expect(resolvePersistedWysiwygMarkdown(canonical, loaded, canonical)).toBe(loaded);
  });
});
