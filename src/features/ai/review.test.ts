import { describe, expect, it } from 'vitest';

import {
  createAiReview,
  createLocalAgentReview,
  createPendingAiReview,
  renderLocalReviewOperations,
  resolveReviewActions,
} from './review';
import type { AiRunRequest, AiRunResult } from './types';
import type { LocalAgentRunRequest, LocalAgentRunResult } from './localAgents/types';
import type { LocalAgentTargetSnapshot } from './localAgents/targets';

const openRouterRequest: AiRunRequest = {
  requestId: 'openrouter-1',
  documentId: 'doc-1',
  source: 'alpha',
  selection: null,
  task: 'custom',
  model: 'openrouter/model',
  targetLanguage: null,
  instruction: 'Improve it',
  zdrOnly: false,
  maxOutputTokens: 1024,
  recordHistory: true,
};

const openRouterResult: AiRunResult = {
  requestId: 'openrouter-1',
  documentId: 'doc-1',
  task: 'custom',
  model: 'openrouter/model',
  generationId: 'generation-1',
  result: null,
  validationIssues: [],
  rawDiagnostic: null,
  usage: null,
  retryAfterSeconds: null,
};

describe('resolveReviewActions', () => {
  it('keeps stale results inspectable without allowing either apply action', () => {
    expect(
      resolveReviewActions({
        task: 'prd',
        sourcePresent: true,
        sourceRevisionMatches: false,
        validationPassed: true,
      }),
    ).toEqual({
      applySelected: false,
      applyAll: false,
      openAsDocument: true,
      rerun: true,
    });
  });

  it('blocks every result-consuming action when validation failed', () => {
    expect(
      resolveReviewActions({
        task: 'prd',
        sourcePresent: true,
        sourceRevisionMatches: true,
        validationPassed: false,
      }),
    ).toEqual({
      applySelected: false,
      applyAll: false,
      openAsDocument: false,
      rerun: true,
    });
  });

  it('allows all review actions for a valid result whose source is current', () => {
    expect(
      resolveReviewActions({
        task: 'prd',
        sourcePresent: true,
        sourceRevisionMatches: true,
        validationPassed: true,
      }),
    ).toEqual({
      applySelected: true,
      applyAll: true,
      openAsDocument: true,
      rerun: true,
    });
  });

  it('keeps validated summaries open-only even when the source is current', () => {
    expect(
      resolveReviewActions({
        task: 'summary',
        sourcePresent: true,
        sourceRevisionMatches: true,
        validationPassed: true,
      }),
    ).toEqual({
      applySelected: false,
      applyAll: false,
      openAsDocument: true,
      rerun: true,
    });
  });
});

describe('AI review origins', () => {
  it('keeps existing OpenRouter reviews explicitly marked as OpenRouter', () => {
    expect(createAiReview(openRouterRequest, openRouterResult).origin).toEqual({
      kind: 'openrouter',
    });
    expect(createPendingAiReview(openRouterRequest).origin).toEqual({
      kind: 'openrouter',
    });
  });

  it('normalizes an exact local-agent selection result into a full-document proposal', () => {
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
    const request: LocalAgentRunRequest = {
      requestId: 'local-1',
      documentId: 'doc-1',
      agent: 'codex',
      target: 'selection',
      source: 'alpha beta',
      selection: { start: 6, end: 10 },
      cursor: null,
      instruction: 'Capitalize it',
      executablePath: null,
    };
    const result: LocalAgentRunResult = {
      schemaVersion: 1,
      requestId: 'local-1',
      documentId: 'doc-1',
      agent: 'codex',
      target: 'selection',
      markdown: 'BETA',
      summary: 'Capitalized the selection.',
      warnings: ['Preserved Markdown.'],
    };

    expect(createLocalAgentReview(snapshot, request, result, 'notes.md')).toMatchObject({
      sourceDocumentName: 'notes.md',
      sourceSnapshot: 'alpha beta',
      origin: { kind: 'localAgent', agent: 'codex', target: 'selection' },
      request: { task: 'custom', source: 'alpha beta', selection: { start: 6, end: 10 } },
      runResult: {
        task: 'custom',
        usage: null,
        result: {
          proposedMarkdown: 'alpha BETA',
          validation: { passed: true, issues: [] },
          operations: [
            expect.objectContaining({
              kind: 'replace',
              sourceRange: { start: 6, end: 10 },
              originalMarkdown: 'beta',
              proposedMarkdown: 'BETA',
            }),
          ],
        },
      },
    });
  });

  it('rejects local reviews whose request or result metadata drifts from the capture', () => {
    const snapshot: LocalAgentTargetSnapshot = {
      documentId: 'doc-1',
      source: 'alpha',
      surface: 'source',
      kind: 'insert',
      characterRange: { start: 2, end: 2 },
      byteRange: { start: 2, end: 2 },
      selectedText: '',
      proseMirrorRange: null,
    };
    const request: LocalAgentRunRequest = {
      requestId: 'local-1',
      documentId: 'doc-1',
      agent: 'codex',
      target: 'insert',
      source: 'alpha',
      selection: null,
      cursor: 2,
      instruction: 'Insert a heading',
      executablePath: null,
    };
    const result: LocalAgentRunResult = {
      schemaVersion: 1,
      requestId: 'local-1',
      documentId: 'doc-1',
      agent: 'codex',
      target: 'insert',
      markdown: '# Heading\\n\\n',
      summary: 'Added a heading.',
      warnings: [],
    };

    expect(() =>
      createLocalAgentReview(snapshot, request, { ...result, agent: 'claude' }),
    ).toThrow(/local-agent metadata/i);
    expect(() =>
      createLocalAgentReview(
        snapshot,
        { ...request, cursor: 3 },
        result,
      ),
    ).toThrow(/local-agent metadata/i);
    expect(() =>
      createLocalAgentReview(
        { ...snapshot, byteRange: { start: 2, end: 3 } },
        request,
        result,
      ),
    ).toThrow(/local-agent metadata/i);
  });

  it('normalizes a document result into one whole-document replacement proposal', () => {
    const snapshot: LocalAgentTargetSnapshot = {
      documentId: 'doc-1',
      source: '# Before\n',
      surface: 'wysiwyg',
      kind: 'document',
      characterRange: null,
      byteRange: null,
      selectedText: '',
      proseMirrorRange: null,
    };
    const request: LocalAgentRunRequest = {
      requestId: 'local-document-1',
      documentId: 'doc-1',
      agent: 'claude',
      target: 'document',
      source: '# Before\n',
      selection: null,
      cursor: null,
      instruction: 'Rewrite the document',
      executablePath: null,
    };
    const result: LocalAgentRunResult = {
      schemaVersion: 1,
      requestId: 'local-document-1',
      documentId: 'doc-1',
      agent: 'claude',
      target: 'document',
      markdown: '# After\n',
      summary: 'Rewrote the document.',
      warnings: [],
    };

    expect(createLocalAgentReview(snapshot, request, result).runResult?.result).toMatchObject({
      proposedMarkdown: '# After\n',
      operations: [
        expect.objectContaining({
          kind: 'replace',
          sourceRange: { start: 0, end: 9 },
          originalMarkdown: '# Before\n',
          proposedMarkdown: '# After\n',
        }),
      ],
    });
  });

  it('renders selected local-agent operations entirely from the captured review', () => {
    const snapshot: LocalAgentTargetSnapshot = {
      documentId: 'doc-1',
      source: '가나다 beta',
      surface: 'source',
      kind: 'selection',
      characterRange: { start: 4, end: 8 },
      byteRange: { start: 10, end: 14 },
      selectedText: 'beta',
      proseMirrorRange: null,
    };
    const request: LocalAgentRunRequest = {
      requestId: 'local-render-1',
      documentId: 'doc-1',
      agent: 'opencode',
      target: 'selection',
      source: snapshot.source,
      selection: { start: 10, end: 14 },
      cursor: null,
      instruction: '대문자로 바꿔 주세요',
      executablePath: null,
    };
    const result: LocalAgentRunResult = {
      schemaVersion: 1,
      requestId: request.requestId,
      documentId: request.documentId,
      agent: request.agent,
      target: request.target,
      markdown: 'BETA',
      summary: '선택 영역을 바꿨습니다.',
      warnings: [],
    };
    const review = createLocalAgentReview(snapshot, request, result);

    expect(renderLocalReviewOperations(review, ['local-agent:selection'])).toBe(
      '가나다 BETA',
    );
    expect(renderLocalReviewOperations(review, [])).toBe('가나다 beta');
    expect(() => renderLocalReviewOperations(review, ['unknown'])).toThrow(
      /unknown local-agent operation/i,
    );
    expect(() =>
      renderLocalReviewOperations(
        createAiReview(openRouterRequest, openRouterResult),
        [],
      ),
    ).toThrow(/local-agent review/i);
  });

  it('retains an immutable local-agent rerun context', () => {
    const snapshot: LocalAgentTargetSnapshot = {
      documentId: 'doc-1',
      source: 'alpha',
      surface: 'wysiwyg',
      kind: 'insert',
      characterRange: { start: 5, end: 5 },
      byteRange: { start: 5, end: 5 },
      selectedText: '',
      proseMirrorRange: { start: 5, end: 5 },
    };
    const request: LocalAgentRunRequest = {
      requestId: 'local-rerun-1',
      documentId: 'doc-1',
      agent: 'claude',
      target: 'insert',
      source: snapshot.source,
      selection: null,
      cursor: 5,
      instruction: 'Add a conclusion',
      executablePath: null,
    };
    const result: LocalAgentRunResult = {
      schemaVersion: 1,
      requestId: request.requestId,
      documentId: request.documentId,
      agent: request.agent,
      target: request.target,
      markdown: '\n\nConclusion',
      summary: 'Added a conclusion.',
      warnings: [],
    };

    const review = createLocalAgentReview(snapshot, request, result);
    snapshot.source = 'mutated by caller';
    request.instruction = 'mutated by caller';

    expect(review.localAgentContext).toEqual({
      snapshot: expect.objectContaining({
        source: 'alpha',
        surface: 'wysiwyg',
        kind: 'insert',
        proseMirrorRange: { start: 5, end: 5 },
      }),
      request: expect.objectContaining({
        agent: 'claude',
        target: 'insert',
        instruction: 'Add a conclusion',
      }),
    });
  });
});
