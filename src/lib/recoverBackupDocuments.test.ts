import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverBackupDocuments } from './recoverBackupDocuments';
import { createDocumentTab, createMissingDocumentTab } from './documentTabs';

const { readTextFiles } = vi.hoisted(() => ({ readTextFiles: vi.fn() }));
vi.mock('./desktop', () => ({ readTextFiles }));

describe('backup document recovery', () => {
  beforeEach(() => { readTextFiles.mockReset(); });

  it('recovers a file draft absent from the tabs session without activating a backend document', async () => {
    readTextFiles.mockResolvedValue([{ path: '/notes.md', contents: 'disk' }]);
    const tabs = await recoverBackupDocuments([], [{ path: '/notes.md', untitledId: null, name: 'notes.md', draft: '' }]);
    expect(tabs).toEqual([expect.objectContaining({ path: '/notes.md', source: 'disk', draft: '' })]);
  });

  it('recovers a deleted file as an editable untitled buffer and retains its tab identity', async () => {
    readTextFiles.mockRejectedValue(new Error('not found'));
    const missing = createMissingDocumentTab({ id: 'old', path: '/gone.md', name: 'gone.md' });
    const tabs = await recoverBackupDocuments([missing], [{ path: '/gone.md', untitledId: null, name: 'gone.md', draft: 'precious draft' }]);
    expect(tabs).toEqual([expect.objectContaining({ id: 'old', path: null, missing: false, draft: 'precious draft' })]);
  });

  it('preserves already restored documents and avoids duplicate reads', async () => {
    const existing = createDocumentTab({ id: 'one', path: '/notes.md', name: 'notes.md', source: 'disk' });
    const entry = { path: '/notes.md', untitledId: null, name: 'notes.md', draft: 'draft' };
    expect(await recoverBackupDocuments([existing], [entry, entry])).toEqual([existing]);
    expect(readTextFiles).not.toHaveBeenCalled();
  });
});
