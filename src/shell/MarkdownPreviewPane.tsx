import { useMemo, type MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';

import { GFM_REMARK_PLUGINS } from '@/lib/gfm';
import { createSourceLineMarkdownComponents } from '@/lib/sourceLineComponents';
import { MARKDOWN_CONTENT_SCOPE_CLASS } from '@/lib/themeScope';
import { cn } from '@/lib/utils';
import { createPreviewSkillTokenPlugin } from '@/lib/previewSkillTokens';

interface MarkdownPreviewPaneProps {
  source: string;
  activeDocumentPath?: string | null;
  skillNames?: ReadonlySet<string>;
  highlightSkillTokens?: boolean;
}

const EMPTY_SKILL_NAMES: ReadonlySet<string> = new Set();

function followFootnote(event: MouseEvent<HTMLDivElement>) {
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest<HTMLAnchorElement>('a[data-footnote-ref], a[data-footnote-backref]');
  const href = anchor?.getAttribute('href');
  if (!href?.startsWith('#')) return;
  const target = [...event.currentTarget.querySelectorAll<HTMLElement>('[id]')]
    .find(element => element.id === href.slice(1));
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center' });
}

export function MarkdownPreviewPane({
  source,
  activeDocumentPath = null,
  skillNames = EMPTY_SKILL_NAMES,
  highlightSkillTokens = false,
}: MarkdownPreviewPaneProps) {
  const markdownComponents = useMemo(
    () => createSourceLineMarkdownComponents({ activeDocumentPath }),
    [activeDocumentPath],
  );
  const rehypePlugins = useMemo(
    () => [
      createPreviewSkillTokenPlugin(skillNames, highlightSkillTokens),
    ],
    [highlightSkillTokens, skillNames],
  );

  return (
    <div
      onClickCapture={followFootnote}
      data-testid="markdown-preview-pane"
      data-skill-highlight={String(highlightSkillTokens)}
      className={cn(
        // Same gutter as `.notion-wysiwyg-surface` so split view's right pane
        // shares the WYSIWYG geometry.
        'markdown-surface flex-1 px-5 pb-6 pt-2',
        MARKDOWN_CONTENT_SCOPE_CLASS,
      )}
    >
      <ReactMarkdown
        remarkPlugins={GFM_REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
