import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AiRunRequest, AiRunResult } from './types';
import {
  createAiReview,
  createLocalAgentReview,
  createPendingAiReview,
} from './review';
import type { LocalAgentTargetSnapshot } from './localAgents/targets';
import type {
  LocalAgentRunRequest,
  LocalAgentRunResult,
} from './localAgents/types';
import { AiReviewTab } from './AiReviewTab';

afterEach(cleanup);

const request: AiRunRequest = {
  requestId: 'request-1',
  documentId: 'doc-1',
  source: '# PRD\n\nVague.',
  selection: null,
  task: 'prd',
  model: 'z-ai/glm-5.2',
  targetLanguage: null,
  instruction: null,
  zdrOnly: true,
  maxOutputTokens: 4096,
  recordHistory: true,
};

const runResult: AiRunResult = {
  requestId: 'request-1',
  documentId: 'doc-1',
  task: 'prd',
  model: 'z-ai/glm-5.2',
  generationId: 'generation-1',
  result: {
    sourceRevisionHash: 'revision-1',
    proposedMarkdown: '# PRD\n\nMeasurable.',
    validation: {
      passed: true,
      issues: [],
    },
    operations: [
      {
        id: 'operation-1',
        kind: 'replace',
        targetSegmentId: 'segment-1',
        sourceRange: { start: 7, end: 13 },
        originalMarkdown: 'Vague.',
        proposedMarkdown: 'Measurable.',
        findingIds: ['finding-1'],
      },
    ],
    hunks: [
      {
        operationId: 'operation-1',
        sourceRange: { start: 7, end: 13 },
        originalMarkdown: 'Vague.',
        proposedMarkdown: 'Measurable.',
      },
    ],
    summary: 'Make the requirement measurable.',
    findings: [
      {
        id: 'finding-1',
        severity: 'high',
        category: 'ambiguity',
        evidenceSegmentId: 'segment-1',
        rationale: 'No measurable threshold.',
      },
    ],
    assumptions: [],
    detectedSourceLanguage: null,
    targetLanguage: null,
    warnings: [],
  },
  validationIssues: [],
  rawDiagnostic: null,
  usage: {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    costUsd: 0.002,
    costCalculated: true,
  },
  retryAfterSeconds: null,
};

describe('AiReviewTab', () => {
  it('renders a Summary as an open-only new-document proposal', () => {
    const onOpenAsDocument = vi.fn();
    const summaryRequest: AiRunRequest = {
      ...request,
      task: 'summary',
      targetLanguage: 'ko',
    };
    const summaryResult: AiRunResult = {
      ...runResult,
      task: 'summary',
      result: runResult.result
        ? {
            ...runResult.result,
            proposedMarkdown: '# 요약\n\n핵심 내용',
            operations: [],
            hunks: [],
            summary: 'Summary ready.',
            findings: [],
            assumptions: [],
            detectedSourceLanguage: 'en',
            targetLanguage: 'ko',
          }
        : null,
    };

    render(
      <AiReviewTab
        review={createAiReview(summaryRequest, summaryResult, 'requirements.md')}
        currentSource={request.source}
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={onOpenAsDocument}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Summary proposal' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Summary preview' })).toBeVisible();
    expect(screen.getByText('Detected en · Summary ko')).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Summary preview' }),
    ).toHaveTextContent('# 요약 핵심 내용');
    expect(screen.queryByRole('button', { name: 'Apply all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply selected' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Proposed changes' })).not.toBeInTheDocument();

    const openSummaryButton = screen.getByRole('button', {
      name: 'Open summary as new document',
    });
    expect(openSummaryButton).toBeEnabled();
    fireEvent.click(openSummaryButton);

    expect(onOpenAsDocument).toHaveBeenCalledWith('# 요약\n\n핵심 내용');
  });

  it('renders a non-applicable running state before a full-document result arrives', () => {
    render(
      <AiReviewTab
        review={createPendingAiReview(request, 'requirements.md')}
        currentSource={request.source}
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/AI request in progress/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rerun' })).toBeDisabled();
  });

  it('renders findings and diff hunks, then applies the full validated proposal', () => {
    const onApply = vi.fn();
    render(
      <AiReviewTab
        review={createAiReview(request, runResult, 'requirements.md')}
        currentSource={request.source}
        sourcePresent
        onApply={onApply}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText('No measurable threshold.')).toBeInTheDocument();
    expect(screen.getByText('− Vague.')).toBeInTheDocument();
    expect(screen.getByText('+ Measurable.')).toBeInTheDocument();
    expect(
      screen.getByText(/Prompt 100 · Completion 20 · Total 120/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$0.0020 · calculated/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply all' }));

    expect(onApply).toHaveBeenCalledWith('# PRD\n\nMeasurable.');
  });

  it('keeps OpenRouter selected-operation rendering on the provider result service', async () => {
    const onApply = vi.fn();
    const onRenderSelected = vi.fn().mockResolvedValue('# Selected only');
    render(
      <AiReviewTab
        review={createAiReview(request, runResult, 'requirements.md')}
        currentSource={request.source}
        sourcePresent
        onApply={onApply}
        onRenderSelected={onRenderSelected}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));

    await waitFor(() =>
      expect(onRenderSelected).toHaveBeenCalledWith(['operation-1']),
    );
    expect(onApply).toHaveBeenCalledWith('# Selected only');
  });

  it('disables apply when the source changed but keeps the proposal exportable', () => {
    render(
      <AiReviewTab
        review={createAiReview(request, runResult, 'requirements.md')}
        currentSource="# PRD\n\nChanged locally."
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/source document changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply all' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Open as new document' }),
    ).toBeEnabled();
  });

  it('supports translation-only review and exposes language and hunk controls', () => {
    const translationRequest: AiRunRequest = {
      ...request,
      task: 'translation',
      targetLanguage: 'ko',
    };
    const translationResult: AiRunResult = {
      ...runResult,
      task: 'translation',
      result: runResult.result
        ? {
            ...runResult.result,
            proposedMarkdown: '# 요구사항\n\n측정 가능합니다.',
            detectedSourceLanguage: 'en',
            targetLanguage: 'ko',
          }
        : null,
    };

    render(
      <AiReviewTab
        review={createAiReview(
          translationRequest,
          translationResult,
          'requirements.md',
        )}
        currentSource={request.source}
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/Detected en · Target ko/i)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Select change for segment-1/i }),
    ).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Source' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Show translation only' }),
    );

    expect(screen.queryByRole('heading', { name: 'Source' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Translation' })).toBeInTheDocument();
  });

  it('renders local-agent identity and applies selected changes without provider rendering', async () => {
    const snapshot: LocalAgentTargetSnapshot = {
      documentId: 'doc-1',
      source: '# Before\n',
      surface: 'source',
      kind: 'document',
      characterRange: null,
      byteRange: null,
      selectedText: '',
      proseMirrorRange: null,
    };
    const localRequest: LocalAgentRunRequest = {
      requestId: 'local-review-1',
      documentId: 'doc-1',
      agent: 'codex',
      target: 'document',
      source: snapshot.source,
      selection: null,
      cursor: null,
      instruction: 'Rewrite it',
      executablePath: null,
    };
    const localResult: LocalAgentRunResult = {
      schemaVersion: 1,
      requestId: localRequest.requestId,
      documentId: localRequest.documentId,
      agent: localRequest.agent,
      target: localRequest.target,
      markdown: '# After\n',
      summary: 'Rewrote the heading.',
      warnings: ['Check the final tone.'],
    };
    const review = createLocalAgentReview(
      snapshot,
      localRequest,
      localResult,
      'notes.md',
    );
    const onApply = vi.fn();
    const onRenderSelected = vi.fn().mockRejectedValue(
      new Error('OpenRouter renderer must not be called'),
    );

    render(
      <AiReviewTab
        review={review}
        currentSource={snapshot.source}
        sourcePresent
        onApply={onApply}
        onRenderSelected={onRenderSelected}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText('Codex')).toBeVisible();
    expect(screen.getByText('Rewrote the heading.')).toBeVisible();
    expect(screen.getByText('Check the final tone.')).toBeVisible();
    expect(screen.queryByText(/local-agent\/codex/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cost unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Prompt .*Completion .*Total/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));

    expect(onApply).toHaveBeenCalledWith('# After\n');
    expect(onRenderSelected).not.toHaveBeenCalled();
  });

  it('keeps a stale local proposal openable but disables both apply paths', () => {
    const snapshot: LocalAgentTargetSnapshot = {
      documentId: 'doc-1',
      source: 'alpha beta',
      surface: 'source',
      kind: 'selection',
      characterRange: { start: 6, end: 10 },
      byteRange: { start: 6, end: 10 },
      selectedText: 'beta',
      proseMirrorRange: null,
    };
    const localRequest: LocalAgentRunRequest = {
      requestId: 'local-review-stale',
      documentId: 'doc-1',
      agent: 'opencode',
      target: 'selection',
      source: snapshot.source,
      selection: { start: 6, end: 10 },
      cursor: null,
      instruction: 'Capitalize it',
      executablePath: null,
    };
    const localResult: LocalAgentRunResult = {
      schemaVersion: 1,
      requestId: localRequest.requestId,
      documentId: localRequest.documentId,
      agent: localRequest.agent,
      target: localRequest.target,
      markdown: 'BETA',
      summary: 'Capitalized it.',
      warnings: [],
    };

    render(
      <AiReviewTab
        review={createLocalAgentReview(snapshot, localRequest, localResult)}
        currentSource="alpha changed"
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText('OpenCode')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open as new document' })).toBeEnabled();
  });
});
