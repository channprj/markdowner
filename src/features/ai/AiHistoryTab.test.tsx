import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiHistoryTab } from './AiHistoryTab';
import type { AiHistoryDetail, AiHistoryPage } from './types';

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const run: AiHistoryDetail = {
  id: 'run-1',
  task: 'prd',
  model: 'z-ai/glm-5.2',
  status: 'completed',
  scopeJson: JSON.stringify({ kind: 'document', target: { label: 'PRD.md' } }),
  sourceHash: 'sha256-only',
  promptVersion: 'ai-v2',
  instruction: 'Rewrite this as a concise release note.',
  targetLanguage: 'ko',
  maxOutputTokens: 8192,
  zdrOnly: false,
  resultJson: JSON.stringify({ summary: 'Validated PRD result' }),
  errorJson: JSON.stringify({
    code: 'local_validation_failed',
    message: 'Markdowner rejected the provider response during local validation.',
    issues: [{ code: 'invalid_schema', segmentId: 'segment-2' }],
  }),
  usageJson: JSON.stringify({
    promptTokens: 120,
    completionTokens: 30,
    totalTokens: 150,
    costUsd: 0.0042,
  }),
  startedAt: 100,
  finishedAt: 103,
  interviewTurns: [
    { position: 1, question: 'Who is this for?', answer: 'Product teams', skipped: false },
  ],
};

const page: AiHistoryPage = { items: [run], page: 0, pageSize: 20, total: 21 };

describe('AiHistoryTab', () => {
  it('pages, opens complete detail, deletes, and clears without exposing source content', async () => {
    const onPageChange = vi.fn();
    const detail = vi.fn().mockResolvedValue(run);
    const deleteRun = vi.fn().mockResolvedValue(true);
    const clear = vi.fn().mockResolvedValue(1);
    const copyPrompt = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <AiHistoryTab
        history={page}
        loading={false}
        error={null}
        onPageChange={onPageChange}
        onReload={vi.fn()}
        services={{ detail, deleteRun, clear, copyPrompt }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next history page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: /Open run run-1/i }));
    await waitFor(() => expect(detail).toHaveBeenCalledWith('run-1'));
    expect(screen.getByRole('heading', { name: 'Improve PRD' })).toBeInTheDocument();
    expect(screen.getByText('PRD.md')).toBeInTheDocument();
    expect(screen.getByText('Who is this for?')).toBeInTheDocument();
    expect(screen.getByText('Product teams')).toBeInTheDocument();
    expect(screen.getByText('Validated PRD result')).toBeInTheDocument();
    expect(screen.getByText(/rejected the provider response/i)).toBeInTheDocument();
    expect(screen.getByText(/120 prompt · 30 completion/i)).toBeInTheDocument();
    expect(screen.getByText(/USD 0.0042/i)).toBeInTheDocument();
    expect(screen.getByText('3 seconds')).toBeInTheDocument();
    expect(screen.getByText('Rewrite this as a concise release note.')).toBeInTheDocument();
    expect(screen.getByText('ai-v2')).toBeInTheDocument();
    expect(screen.getByText('sha256-only')).toBeInTheDocument();
    expect(screen.getByText('ko')).toBeInTheDocument();
    expect(screen.getByText('8,192 tokens')).toBeInTheDocument();
    expect(screen.getByText('Provider retention allowed')).toBeInTheDocument();
    expect(screen.getByText(/invalid_schema/)).toBeInTheDocument();
    expect(screen.getByText(/segment-2/)).toBeInTheDocument();
    expect(screen.queryByText(/full source body/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Copy user prompt' }));
    await waitFor(() => {
      expect(copyPrompt).toHaveBeenCalledWith('Rewrite this as a concise release note.');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete run run-1' }));
    await waitFor(() => expect(deleteRun).toHaveBeenCalledWith('run-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  });

  it('labels a Summary history entry independently', async () => {
    const summaryRun: AiHistoryDetail = {
      ...run,
      id: 'summary-run',
      task: 'summary',
      resultJson: JSON.stringify({ proposedMarkdown: '# Summary' }),
    };

    render(
      <AiHistoryTab
        history={{ items: [summaryRun], page: 0, pageSize: 20, total: 1 }}
        loading={false}
        error={null}
        onPageChange={vi.fn()}
        onReload={vi.fn()}
        services={{
          detail: vi.fn().mockResolvedValue(summaryRun),
          deleteRun: vi.fn(),
          clear: vi.fn(),
          copyPrompt: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open run summary-run/i }));

    expect(await screen.findByRole('heading', { name: 'Summarize document' })).toBeVisible();
  });

  it('offers an interrupted PRD interview as a resumable history action', async () => {
    const interrupted: AiHistoryDetail = {
      ...run,
      status: 'interrupted',
      finishedAt: 140,
      scopeJson: JSON.stringify({
        kind: 'document',
        target: { documentId: 'doc-1', path: '/PRD.md', label: 'PRD.md' },
      }),
    };
    const onResumeInterview = vi.fn();

    render(
      <AiHistoryTab
        history={{ items: [interrupted], page: 0, pageSize: 20, total: 1 }}
        loading={false}
        error={null}
        onPageChange={vi.fn()}
        onReload={vi.fn()}
        onResumeInterview={onResumeInterview}
        resumableDocumentIds={['doc-1']}
        services={{
          detail: vi.fn().mockResolvedValue(interrupted),
          deleteRun: vi.fn(),
          clear: vi.fn(),
          copyPrompt: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open run run-1/i }));
    expect(await screen.findByRole('button', { name: 'Resume PRD interview' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Resume PRD interview' }));

    expect(onResumeInterview).toHaveBeenCalledWith('run-1', 'doc-1');
  });
});
