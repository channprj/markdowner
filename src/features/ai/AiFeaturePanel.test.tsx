import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';
import { AiFeaturePanel } from './AiFeaturePanel';
import type { AiHistoryDetail, AiHistoryPage, AiModel } from './types';

const emptyHistory: AiHistoryPage = {
  items: [],
  page: 0,
  pageSize: 20,
  total: 0,
};

const glm: AiModel = {
  id: 'z-ai/glm-5.2',
  name: 'GLM 5.2',
  description: null,
  contextLength: 1_048_576,
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportedParameters: ['structured_outputs', 'response_format'],
  pricing: {
    prompt: 0.000_001,
    completion: 0.000_002,
    updatedAt: '2026-08-02T00:00:00Z',
  },
};

afterEach(cleanup);

describe('AiFeaturePanel', () => {
  it('exposes New, Activity, and History from the global runtime snapshot', async () => {
    const cleanup = vi.fn();
    const runtimeServices = {
      listActive: vi.fn().mockResolvedValue([
        {
          requestId: 'translation-1',
          task: 'translation' as const,
          model: 'z-ai/glm-5.2',
          scope: {
            kind: 'document' as const,
            target: { documentId: 'doc-1', path: '/notes/a.md', label: 'a.md' },
          },
          status: 'running' as const,
          progress: {
            stage: 'translating',
            fileCompleted: 0,
            fileTotal: 1,
            chunkCompleted: 3,
            chunkTotal: 8,
            label: 'a.md',
            receivedCharacters: 0,
          },
          startedAt: 1,
          cancelable: true,
        },
      ]),
      historyPage: vi.fn().mockResolvedValue(emptyHistory),
      listen: vi.fn().mockResolvedValue(cleanup),
    };

    render(
      <AiFeaturePanel
        documentId="doc-1"
        documentPath="/notes/a.md"
        source="# A"
        selection={null}
        settings={DEFAULT_SETTINGS}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        runtimeServices={runtimeServices}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          listModels: vi.fn().mockResolvedValue([]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('tab', { name: 'New' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('1 AI request running')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Activity (1)' }));
    expect(await screen.findByRole('heading', { name: 'Translate document' })).toBeVisible();
    expect(screen.getByText('Files 0/1 · Chunks 3/8 · a.md')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('No saved AI runs yet.')).toBeVisible();
    await waitFor(() => expect(runtimeServices.historyPage).toHaveBeenCalledWith(0, 20));
  });

  it('keeps the History view available when local retention is disabled', () => {
    render(
      <AiFeaturePanel
        documentId="doc-1"
        source="# A"
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiHistoryEnabled: false }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        runtimeServices={{
          listActive: vi.fn().mockResolvedValue([]),
          historyPage: vi.fn().mockResolvedValue(emptyHistory),
          listen: vi.fn().mockResolvedValue(vi.fn()),
        }}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          listModels: vi.fn().mockResolvedValue([]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText('Local history is off')).toBeVisible();
  });

  it('resumes an interrupted PRD interview selected from History', async () => {
    const scope = {
      kind: 'document' as const,
      target: { documentId: 'doc-1', path: '/notes/a.md', label: 'a.md' },
    };
    const interrupted: AiHistoryDetail = {
      id: 'interview-1',
      task: 'prd',
      model: 'z-ai/glm-5.2',
      status: 'interrupted',
      scopeJson: JSON.stringify(scope),
      sourceHash: 'hash',
      promptVersion: 'prd-interview-v1',
      instruction: null,
      targetLanguage: null,
      maxOutputTokens: 16384,
      zdrOnly: true,
      resultJson: null,
      errorJson: null,
      usageJson: null,
      startedAt: 1,
      finishedAt: null,
      interviewTurns: [
        {
          position: 0,
          question: 'Who is the primary user?',
          answer: 'Product managers.',
          skipped: false,
        },
      ],
    };
    const resumeInterview = vi.fn().mockResolvedValue({
      requestId: interrupted.id,
      documentId: 'doc-1',
      model: 'z-ai/glm-5.2',
      scope,
      sourceHash: 'hash',
      status: 'awaiting_answer' as const,
      turns: [
        {
          id: 'interview-1:1',
          position: 1,
          question: 'Which approval is still unresolved?',
          rationale: 'Launch ownership remains unclear.',
          recommendedAnswer: 'Assign one product owner as the launch decision maker.',
          unresolvedArea: 'approval',
          answer: null,
          skipped: false,
        },
      ],
    });
    const runtimeServices = {
      listActive: vi.fn().mockResolvedValue([]),
      historyPage: vi.fn().mockResolvedValue({
        items: [interrupted],
        page: 0,
        pageSize: 20,
        total: 1,
      }),
      listen: vi.fn().mockResolvedValue(vi.fn()),
    };

    render(
      <AiFeaturePanel
        documentId="doc-1"
        documentPath="/notes/a.md"
        documentLabel="a.md"
        source="# Draft PRD"
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        runtimeServices={runtimeServices}
        historyServices={{
          detail: vi.fn().mockResolvedValue(interrupted),
          deleteRun: vi.fn(),
          clear: vi.fn(),
          copyPrompt: vi.fn(),
        }}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([glm]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
        interviewServices={{
          startInterview: vi.fn(),
          answerInterview: vi.fn(),
          skipInterview: vi.fn(),
          updateAnswer: vi.fn(),
          finishInterview: vi.fn(),
          resumeInterview,
          run: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open run interview-1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume PRD interview' }));

    expect(screen.getByRole('tab', { name: 'New' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Which approval is still unresolved?')).toBeVisible();
    expect(resumeInterview).toHaveBeenCalledWith('interview-1');
  });
});
