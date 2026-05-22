import { calculateDocumentStats, type DocumentStats } from './documentStats';
import { parseMarkdownOutline, type OutlineItem } from './outline';

export const CLOSED_DOCUMENT_PREVIEW_SOURCE =
  '*Open a Markdown document to preview it.*';

export interface EditorDocumentMetrics {
  documentStats: DocumentStats;
  outlineItems: OutlineItem[];
}

export function buildEditorDocumentMetrics({
  activeDocumentOpen,
  deferredDraft,
}: {
  activeDocumentOpen: boolean;
  deferredDraft: string;
}): EditorDocumentMetrics {
  return {
    documentStats: calculateDocumentStats(deferredDraft),
    outlineItems: activeDocumentOpen ? parseMarkdownOutline(deferredDraft) : [],
  };
}

export function resolveEditorPreviewSource({
  activeDocumentOpen,
  debouncedDraft,
}: {
  activeDocumentOpen: boolean;
  debouncedDraft: string;
}): string {
  return activeDocumentOpen ? debouncedDraft : CLOSED_DOCUMENT_PREVIEW_SOURCE;
}
