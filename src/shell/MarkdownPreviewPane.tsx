import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { sourceLineMarkdownComponents } from '@/lib/sourceLineComponents';
import { MARKDOWN_CONTENT_SCOPE_CLASS } from '@/lib/themeScope';
import { cn } from '@/lib/utils';

interface MarkdownPreviewPaneProps {
  source: string;
}

export function MarkdownPreviewPane({ source }: MarkdownPreviewPaneProps) {
  return (
    <div
      data-testid="markdown-preview-pane"
      className={cn(
        'markdown-surface flex-1 px-8 py-6',
        MARKDOWN_CONTENT_SCOPE_CLASS,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={sourceLineMarkdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
