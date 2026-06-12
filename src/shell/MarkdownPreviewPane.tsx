import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { createSourceLineMarkdownComponents } from '@/lib/sourceLineComponents';
import { MARKDOWN_CONTENT_SCOPE_CLASS } from '@/lib/themeScope';
import { cn } from '@/lib/utils';

interface MarkdownPreviewPaneProps {
  source: string;
  activeDocumentPath?: string | null;
}

export function MarkdownPreviewPane({
  source,
  activeDocumentPath = null,
}: MarkdownPreviewPaneProps) {
  const markdownComponents = useMemo(
    () => createSourceLineMarkdownComponents({ activeDocumentPath }),
    [activeDocumentPath],
  );

  return (
    <div
      data-testid="markdown-preview-pane"
      className={cn(
        // Same gutter as `.notion-wysiwyg-surface` so split view's right pane
        // shares the WYSIWYG geometry.
        'markdown-surface flex-1 px-5 pb-6 pt-2',
        MARKDOWN_CONTENT_SCOPE_CLASS,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
