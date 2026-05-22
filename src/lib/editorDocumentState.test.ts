import { describe, expect, it } from 'vitest';

import {
  buildEditorDocumentMetrics,
  resolveEditorPreviewSource,
} from './editorDocumentState';

describe('buildEditorDocumentMetrics', () => {
  it('derives stats and outline from the deferred draft while a document is open', () => {
    const state = buildEditorDocumentMetrics({
      activeDocumentOpen: true,
      deferredDraft: '# Title\n\nDraft words here',
    });

    expect(state.documentStats).toMatchObject({
      words: 5,
      characters: 25,
      headings: 1,
    });
    expect(state.outlineItems).toEqual([
      expect.objectContaining({
        title: 'Title',
        depth: 1,
      }),
    ]);
  });

  it('keeps closed-document outline empty while still deriving document stats', () => {
    const state = buildEditorDocumentMetrics({
      activeDocumentOpen: false,
      deferredDraft: '# Hidden',
    });

    expect(state.documentStats.headings).toBe(1);
    expect(state.outlineItems).toEqual([]);
  });
});

describe('resolveEditorPreviewSource', () => {
  it('uses the debounced draft only while a document is open', () => {
    expect(
      resolveEditorPreviewSource({
        activeDocumentOpen: true,
        debouncedDraft: '# Preview',
      }),
    ).toBe('# Preview');

    expect(
      resolveEditorPreviewSource({
        activeDocumentOpen: false,
        debouncedDraft: '# Hidden preview',
      }),
    ).toBe('*Open a Markdown document to preview it.*');
  });
});
