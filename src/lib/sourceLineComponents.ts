import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';

import { sharedLowlight } from '@/components/wysiwyg/codeBlockExtension';

import { resolveMarkdownImageSrc } from './markdownImageSrc';

type MarkdownSourceNode = {
  position?: {
    start?: {
      line?: number;
      offset?: number;
    };
    end?: {
      offset?: number;
    };
  };
};

type MarkdownSourceLineProps = {
  node?: MarkdownSourceNode;
};

interface SourceLineMarkdownComponentsOptions {
  activeDocumentPath?: string | null;
}

function sourcePositionAttributes(node: MarkdownSourceNode | undefined) {
  const sourceLine = node?.position?.start?.line;
  const sourceOffset = node?.position?.start?.offset;
  const sourceEndOffset = node?.position?.end?.offset;

  return {
    'data-source-line': Number.isFinite(sourceLine) ? sourceLine : undefined,
    'data-source-offset': Number.isFinite(sourceOffset) ? sourceOffset : undefined,
    'data-source-end-offset': Number.isFinite(sourceEndOffset) ? sourceEndOffset : undefined,
  };
}

export function createSourceLineComponent(tagName: keyof HTMLElementTagNameMap) {
  return function SourceLineComponent(props: MarkdownSourceLineProps) {
    const { node, ...elementProps } = props as MarkdownSourceLineProps & Record<string, unknown>;

    return createElement(tagName, {
      ...elementProps,
      ...sourcePositionAttributes(node),
    });
  };
}

function createSourceLineImageComponent(activeDocumentPath: string | null | undefined) {
  return function SourceLineImageComponent(props: MarkdownSourceLineProps) {
    const { node, src, ...elementProps } = props as MarkdownSourceLineProps & {
      src?: string;
    } & Record<string, unknown>;

    return createElement('img', {
      ...elementProps,
      src: resolveMarkdownImageSrc(src, activeDocumentPath),
      ...sourcePositionAttributes(node),
    });
  };
}

// Minimal hast → React renderer for lowlight's highlight output (text nodes
// plus <span class="hljs-…"> elements) — keeps the preview free of extra
// dependencies while emitting the same token spans the WYSIWYG editor shows.
function renderHastNodes(nodes: unknown[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const item = node as {
      type?: string;
      value?: string;
      tagName?: string;
      properties?: { className?: unknown };
      children?: unknown[];
    };
    if (item.type === 'text') return item.value ?? '';
    if (item.type === 'element' && item.tagName) {
      const className = Array.isArray(item.properties?.className)
        ? item.properties.className.join(' ')
        : undefined;
      return createElement(
        item.tagName,
        { key: `${keyPrefix}${index}`, className },
        renderHastNodes(item.children ?? [], `${keyPrefix}${index}-`),
      );
    }
    return null;
  });
}

// Mirror the WYSIWYG code block: `.code-block-view > pre > code.hljs` with
// lowlight token spans, so the `data-cb-theme` palettes color the split-view
// preview exactly like the editor surface.
function PreviewPreComponent(props: MarkdownSourceLineProps) {
  const { node, ...elementProps } = props as MarkdownSourceLineProps & Record<string, unknown>;
  return createElement(
    'div',
    { className: 'code-block-view', ...sourcePositionAttributes(node) },
    createElement('pre', elementProps),
  );
}

function PreviewCodeComponent(props: MarkdownSourceLineProps) {
  const { node, className, children, ...elementProps } = props as MarkdownSourceLineProps & {
    className?: string;
    children?: ReactNode;
  } & Record<string, unknown>;
  const language = /language-([\w+.-]+)/.exec(className ?? '')?.[1];
  const raw = typeof children === 'string' ? children : null;
  if (!language || raw === null) {
    // Inline code (no language-* class) renders untouched.
    return createElement('code', { className, ...elementProps }, children);
  }
  const grammar = sharedLowlight.registered(language) ? language : 'plaintext';
  let highlighted: ReactNode = raw;
  try {
    const tree = sharedLowlight.highlight(grammar, raw.replace(/\n$/, ''));
    highlighted = renderHastNodes(tree.children as unknown[], 'hl-');
  } catch {
    // Unknown grammar edge cases fall back to plain text.
  }
  return createElement(
    'code',
    { className: `${className ?? ''} hljs`.trim(), ...elementProps },
    highlighted,
  );
}

export function createSourceLineMarkdownComponents(
  options: SourceLineMarkdownComponentsOptions = {},
) {
  return {
    h1: createSourceLineComponent('h1'),
    h2: createSourceLineComponent('h2'),
    h3: createSourceLineComponent('h3'),
    h4: createSourceLineComponent('h4'),
    h5: createSourceLineComponent('h5'),
    h6: createSourceLineComponent('h6'),
    p: createSourceLineComponent('p'),
    li: createSourceLineComponent('li'),
    blockquote: createSourceLineComponent('blockquote'),
    pre: PreviewPreComponent,
    code: PreviewCodeComponent,
    table: createSourceLineComponent('table'),
    tr: createSourceLineComponent('tr'),
    img: createSourceLineImageComponent(options.activeDocumentPath),
  } satisfies Components;
}

export const sourceLineMarkdownComponents = createSourceLineMarkdownComponents();
