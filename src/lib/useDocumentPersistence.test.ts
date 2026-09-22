import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionWriter, useDocumentPersistence } from './useDocumentPersistence';
import { createDocumentTab } from './documentTabs';

const { saveDraftBackups, saveOpenTabs } = vi.hoisted(() => ({
  saveDraftBackups: vi.fn(), saveOpenTabs: vi.fn(),
}));
vi.mock('./desktop', () => ({ saveDraftBackups, saveOpenTabs }));

describe('session persistence', () => {
  beforeEach(() => {
    saveDraftBackups.mockReset().mockResolvedValue(undefined);
    saveOpenTabs.mockReset().mockResolvedValue(undefined);
  });

  it('serializes a final flush after an outstanding periodic write and recovers after failure', async () => {
    let release!: () => void;
    const writes: string[] = [];
    const write = createSessionWriter(async (payload) => {
      writes.push(payload.drafts[0].draft);
      if (writes.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      if (writes.length === 2) throw new Error('disk full');
    });
    const payload = (draft: string) => ({
      tabs: { openTabs: [], activeTabPath: null, cursorPositions: {} },
      drafts: [{ path: null, untitledId: 'one', name: 'Untitled', draft }],
    });
    const old = write(payload('old'));
    const latest = write(payload('latest'));
    const failure = expect(latest).rejects.toThrow('disk full');
    await Promise.resolve();
    expect(writes).toEqual(['old']);
    release();
    await old;
    await failure;
    await write(payload('retry'));
    expect(writes).toEqual(['old', 'latest', 'retry']);
  });

  it('flushes the live draft and caret, propagates failures, and permits a retry', async () => {
    const tabs = [createDocumentTab({ id: 'one', path: '/notes.md', name: 'notes.md', source: 'disk', draft: 'disk' })];
    const refs = {
      tabsRef: { current: tabs }, activeTabIdRef: { current: 'one' },
      localDraftRef: { current: 'latest' }, readyRef: { current: true },
      cursorByPathRef: { current: new Map([['/notes.md', { line: 4, column: 2 }]]) },
    };
    const { result } = renderHook(() => useDocumentPersistence({
      tabs, activeTabId: 'one', localDraft: 'rendered', ready: false, ...refs,
    }));
    saveDraftBackups.mockRejectedValueOnce(new Error('disk full'));
    await expect(result.current.flushSession()).rejects.toThrow('disk full');
    expect(saveOpenTabs).not.toHaveBeenCalled();
    await act(() => result.current.flushSession('last WYSIWYG keystroke'));
    expect(saveDraftBackups).toHaveBeenLastCalledWith([
      { path: '/notes.md', untitledId: null, name: 'notes.md', draft: 'last WYSIWYG keystroke' },
    ]);
    expect(saveOpenTabs).toHaveBeenLastCalledWith({
      openTabs: ['/notes.md'], activeTabPath: '/notes.md', cursorPositions: { '/notes.md': { line: 4, column: 2 } },
    });
    refs.readyRef.current = false;
    await expect(result.current.flushSession()).rejects.toThrow('still being restored');
  });
});
