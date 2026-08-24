import { describe, expect, it, vi } from 'vitest';

import {
  canApplySelectionResult,
  canReplaceSourceSelection,
  captureSourceSelection,
  captureWysiwygSelection,
  applySourceSelectionReplacement,
  applyWysiwygSelectionReplacement,
  selectionReplacementFromResult,
} from './selection';
import type { AiRunResult } from './types';

describe('AI selection snapshots', () => {
  it('allows replacement only for the exact non-empty source snapshot', () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');

    expect(snapshot?.selectedText).toBe('beta');
    expect(snapshot?.byteRange).toEqual({ start: 6, end: 10 });
    expect(snapshot && canReplaceSourceSelection(snapshot, 'alpha beta')).toBe(true);
    expect(snapshot && canReplaceSourceSelection(snapshot, 'alpha BETA')).toBe(false);
    expect(captureSourceSelection('alpha', 2, 2, 'doc-1')).toBeNull();
  });

  it('uses UTF-8 byte offsets while retaining editor-native character positions', () => {
    const snapshot = captureSourceSelection('가나다 alpha', 1, 3, 'doc-1');

    expect(snapshot).toMatchObject({
      characterRange: { start: 1, end: 3 },
      byteRange: { start: 3, end: 9 },
      selectedText: '나다',
    });
  });

  it('accepts only the validated replacement for the same document and range', () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const result: AiRunResult = {
      requestId: 'request-1',
      documentId: 'doc-1',
      task: 'custom',
      model: 'z-ai/glm-5.2',
      generationId: null,
      result: {
        sourceRevisionHash: 'revision-1',
        proposedMarkdown: 'alpha BETA',
        validation: { passed: true, issues: [] },
        operations: [
          {
            id: 'selection:replace',
            kind: 'replace',
            targetSegmentId: 'selection',
            sourceRange: { start: 6, end: 10 },
            originalMarkdown: 'beta',
            proposedMarkdown: 'BETA',
            findingIds: [],
          },
        ],
        hunks: [],
        summary: null,
        findings: [],
        assumptions: [],
        detectedSourceLanguage: null,
        targetLanguage: null,
        warnings: [],
      },
      validationIssues: [],
      rawDiagnostic: null,
      usage: null,
      retryAfterSeconds: null,
    };

    expect(canApplySelectionResult(snapshot, 'doc-1', 'alpha beta', result)).toBe(
      true,
    );
    expect(selectionReplacementFromResult(snapshot, result)).toBe('BETA');
    expect(canApplySelectionResult(snapshot, 'doc-1', 'alpha BETA', result)).toBe(
      false,
    );
    expect(canApplySelectionResult(snapshot, 'doc-2', 'alpha beta', result)).toBe(
      false,
    );
    expect(
      canApplySelectionResult(
        { ...snapshot, surface: 'wysiwyg', requiresReview: true },
        'doc-1',
        'alpha beta',
        result,
      ),
    ).toBe(false);
  });

  it('dispatches a source replacement as one CodeMirror change transaction', () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const dispatch = vi.fn();

    expect(
      applySourceSelectionReplacement({
        view: { dispatch },
        snapshot,
        currentSource: 'alpha beta',
        replacement: 'BETA',
      }),
    ).toBe('alpha BETA');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 6, to: 10, insert: 'BETA' },
      selection: { anchor: 10 },
      scrollIntoView: true,
    });
  });

  it('dispatches a WYSIWYG replacement as one Tiptap Markdown transaction', () => {
    const snapshot = captureWysiwygSelection({
      source: 'alpha beta',
      markdownStart: 6,
      markdownEnd: 10,
      proseMirrorFrom: 7,
      proseMirrorTo: 11,
      documentId: 'doc-1',
    });
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn(() => true);
    const insertContentAt = vi.fn(() => ({ run }));
    const focus = vi.fn(() => ({ insertContentAt }));
    const editor = { chain: vi.fn(() => ({ focus })) };

    expect(
      applyWysiwygSelectionReplacement({
        editor,
        snapshot,
        currentSource: 'alpha beta',
        replacement: 'BETA',
      }),
    ).toBe(true);
    expect(editor.chain).toHaveBeenCalledTimes(1);
    expect(insertContentAt).toHaveBeenCalledWith(
      { from: 7, to: 11 },
      'BETA',
      { contentType: 'markdown' },
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
