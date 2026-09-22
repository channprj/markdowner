import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const channels = vi.hoisted(() => [] as Array<{ onmessage?: (event: unknown) => void }>);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage?: (event: unknown) => void;

    constructor() {
      channels.push(this);
    }
  },
}));

import {
  exportImageFile,
  exportPdfFile,
  exportPdfFiles,
  exportTextFiles,
  localAgentCancel,
  localAgentRun,
  localAgentStatuses,
  reloadActiveDocumentFromDisk,
  replaceActiveDocumentSource,
  saveActiveDocument,
  saveActiveDocumentAs,
  type AppSnapshot,
} from './desktop';
import type {
  LocalAgentRunRequest,
  LocalAgentStatus,
  LocalAgentStreamEvent,
} from '@/features/ai/localAgents/types';

describe('desktop document reload', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    channels.length = 0;
  });

  it('invokes the dedicated disk reload command instead of opening the cached document', async () => {
    const snapshot = {
      activeDocumentName: 'notes.md',
      activeDocumentPath: '/tmp/notes.md',
      activeDocumentSource: '# Updated',
      activeDocumentDirty: false,
      rootDir: null,
      workspaceDocuments: [],
      recentDocuments: [],
      mode: 'Editor' as const,
      theme: { kind: 'BuiltInDark' as const },
      lastError: null,
    };
    invokeMock.mockResolvedValue(snapshot);

    await expect(
      reloadActiveDocumentFromDisk({
        path: '/tmp/notes.md',
        expectedSource: '# Previous',
        expectedDirty: false,
      }),
    ).resolves.toEqual(snapshot);

    expect(invokeMock).toHaveBeenCalledWith('reload_active_document_from_disk', {
      path: '/tmp/notes.md',
      expectedSource: '# Previous',
      expectedDirty: false,
    });
  });
});

describe('desktop document mutation targets', () => {
  it('sends the captured document identity and strictly increasing revisions for edit and save', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    const snapshot = { activeDocumentVersion: { id: 7, revision: 40 } } as AppSnapshot;
    await replaceActiveDocumentSource('draft', snapshot);
    await saveActiveDocument(snapshot);
    await saveActiveDocumentAs('/tmp/copy.md', snapshot);
    const calls = invokeMock.mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      'replace_active_document_source', 'save_active_document', 'save_active_document_as',
    ]);
    const targets = calls.map(([, args]) => args.target);
    expect(targets.every((target) => target.id === 7)).toBe(true);
    expect(targets[0].revision).toBeGreaterThan(40);
    expect(targets[1].revision).toBeGreaterThan(targets[0].revision);
    expect(targets[2].revision).toBeGreaterThan(targets[1].revision);
    expect(calls[0][1].source).toBe('draft');
    expect(calls[2][1].path).toBe('/tmp/copy.md');
  });

  it('rejects mutations without an active document identity before invoking native code', async () => {
    invokeMock.mockReset();
    await expect(saveActiveDocument({ activeDocumentVersion: null } as AppSnapshot)).rejects.toThrow('No current document');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('desktop local-agent bridge', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    channels.length = 0;
  });

  it('forwards status, streamed events, and cancellation through the local-agent commands', async () => {
    const executablePaths = {
      claude: '/opt/homebrew/bin/claude',
      codex: '',
      opencode: '',
    };
    const request: LocalAgentRunRequest = {
      requestId: 'local-agent-1',
      documentId: 'notes.md',
      agent: 'claude',
      target: 'selection',
      source: '# Notes',
      selection: { start: 0, end: 7 },
      cursor: null,
      instruction: 'Improve this.',
      executablePath: '/opt/homebrew/bin/claude',
    };
    const onEvent = vi.fn();
    const event: LocalAgentStreamEvent = { type: 'running', requestId: 'local-agent-1' };
    invokeMock.mockResolvedValue(undefined);

    await localAgentStatuses(executablePaths);
    await localAgentRun(request, onEvent);
    channels[0]?.onmessage?.(event);
    await localAgentCancel('local-agent-1');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'local_agent_statuses', {
      executablePaths,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'local_agent_run', {
      request,
      onEvent: channels[0],
    });
    expect(onEvent).toHaveBeenCalledWith(event);
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'local_agent_cancel', {
      requestId: 'local-agent-1',
    });
  });

  it('coalesces concurrent status probes and reuses their recent result', async () => {
    const executablePaths = {
      claude: '/test/cache/claude-260824',
      codex: '/test/cache/codex-260824',
      opencode: '/test/cache/opencode-260824',
    };
    const pending = deferred<LocalAgentStatus[]>();
    const statuses: LocalAgentStatus[] = [
      {
        kind: 'codex',
        mention: '@codex',
        label: 'Codex',
        installed: true,
        compatible: true,
        pathLabel: 'bin/codex',
        version: '0.149.0',
        reason: null,
        source: 'manual',
      },
    ];
    invokeMock.mockReturnValue(pending.promise);

    const first = localAgentStatuses(executablePaths);
    const concurrent = localAgentStatuses({ ...executablePaths });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    pending.resolve(statuses);
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      statuses,
      statuses,
    ]);
    await expect(localAgentStatuses({ ...executablePaths })).resolves.toEqual(
      statuses,
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('desktop export bridge', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it('passes batch HTML files to the native writer', async () => {
    const files = [{ path: '/tmp/exports/a.html', contents: '<h1>A</h1>' }];

    await exportTextFiles(files);

    expect(invokeMock).toHaveBeenCalledWith('write_export_files', { files });
  });

  it('passes explicit paper dimensions for single and batch PDF exports', async () => {
    await exportPdfFile('/tmp/a.pdf', '<h1>A</h1>', 297, 210);
    expect(invokeMock).toHaveBeenLastCalledWith('write_pdf_file', {
      path: '/tmp/a.pdf',
      html: '<h1>A</h1>',
      paperWidthMm: 297,
      paperHeightMm: 210,
    });

    const files = [
      {
        path: '/tmp/a.pdf',
        html: '<h1>A</h1>',
        paperWidthMm: 180.5,
        paperHeightMm: 240.2,
      },
    ];
    await exportPdfFiles(files);
    expect(invokeMock).toHaveBeenLastCalledWith('write_pdf_files', { files });
  });

  it('passes the complete image request through one typed command argument', async () => {
    const request = {
      path: '/tmp/Guide.webp',
      html: '<html />',
      format: 'webp' as const,
      layout: 'pages' as const,
      scale: 2 as const,
      quality: 90,
      paperWidthMm: 210,
      paperHeightMm: 297,
      backgroundColor: '#ffffff',
    };
    const result = {
      paths: ['/tmp/Guide-001.webp'],
      width: 1587,
      height: 2245,
      pageCount: 1,
    };
    invokeMock.mockResolvedValueOnce(result);

    await expect(exportImageFile(request)).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenLastCalledWith('write_image_file', { request });
  });
});
