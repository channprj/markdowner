import { createElement, isValidElement } from 'react';
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

/** Resolves a markdown image `src` to the URL the rendered `<img>` should use. */
type ImageSrcResolver = (
  src: string | undefined,
  activeDocumentPath: string | null | undefined,
) => string | undefined;

export const RAW_HTML_IMAGE_TITLE_PREFIX = 'markdowner-raw-html-image:';

type RawHtmlImageAttributes = {
  width?: string;
  height?: string;
  title?: string;
};

interface SourceLineMarkdownComponentsOptions {
  activeDocumentPath?: string | null;
  /**
   * Override how image sources are resolved. Defaults to the asset-protocol
   * resolver used by the live preview; exporters pass a resolver that yields
   * self-contained `data:` URIs.
   */
  resolveImageSrc?: ImageSrcResolver;
  /**
   * When set, a ```mermaid fence becomes that SVG instead of a code block.
   * Return null to keep the source. The live preview leaves this unset.
   */
  renderMermaidDiagram?: (source: string) => string | null;
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

function parseRawHtmlImageTitle(title: unknown): RawHtmlImageAttributes | null {
  if (typeof title !== 'string' || !title.startsWith(RAW_HTML_IMAGE_TITLE_PREFIX)) {
    return null;
  }

  try {
    const raw = decodeURIComponent(title.slice(RAW_HTML_IMAGE_TITLE_PREFIX.length));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const attributes: RawHtmlImageAttributes = {};
    for (const key of ['width', 'height', 'title'] as const) {
      if (typeof parsed[key] === 'string' && parsed[key].length > 0) {
        attributes[key] = parsed[key];
      }
    }
    return attributes;
  } catch {
    return {};
  }
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

function createSourceLineImageComponent(
  activeDocumentPath: string | null | undefined,
  resolveImageSrc: ImageSrcResolver,
) {
  return function SourceLineImageComponent(props: MarkdownSourceLineProps) {
    const { node, src, title, ...elementProps } = props as MarkdownSourceLineProps & {
      src?: string;
      title?: string;
    } & Record<string, unknown>;
    const rawHtmlAttributes = parseRawHtmlImageTitle(title);

    return createElement('img', {
      ...elementProps,
      ...(rawHtmlAttributes ?? {}),
      src: resolveImageSrc(src, activeDocumentPath),
      title: rawHtmlAttributes ? rawHtmlAttributes.title : title,
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

const MERMAID_LANGUAGE_RE = /(?:^|\s)language-mermaid(?:\s|$)/i;

function plainText(children: unknown): string | null {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!Array.isArray(children)) return null;
  let text = '';
  for (const child of children) {
    if (typeof child !== 'string' && typeof child !== 'number') return null;
    text += child;
  }
  return text;
}

/** Source of a fenced ```mermaid block, before the code component highlights it. */
function mermaidDiagramSource(children: unknown): string | null {
  const nodes = Array.isArray(children) ? children : [children];
  for (const node of nodes) {
    if (!isValidElement(node)) continue;
    const props = node.props as { className?: unknown; children?: unknown };
    const className = typeof props.className === 'string' ? props.className : '';
    if (!MERMAID_LANGUAGE_RE.test(className)) continue;
    const text = plainText(props.children);
    if (text !== null) return text.replace(/\n$/, '');
  }
  return null;
}

// Mirror the WYSIWYG code block: `.code-block-view > pre > code.hljs` with
// lowlight token spans, so the `data-cb-theme` palettes color the split-view
// preview exactly like the editor surface.
function createPreviewPreComponent(
  renderMermaidDiagram?: (source: string) => string | null,
) {
  return function PreviewPreComponent(props: MarkdownSourceLineProps) {
    const { node, ...elementProps } = props as MarkdownSourceLineProps & Record<string, unknown>;
    if (renderMermaidDiagram) {
      const source = mermaidDiagramSource(elementProps.children);
      const svg = source === null ? null : renderMermaidDiagram(source);
      if (svg) {
        return createElement(
          'figure',
          {
            className: 'mermaid-export',
            ...sourcePositionAttributes(node),
          },
          createElement(
            'div',
            {
              className: 'mermaid-diagram-canvas',
              role: 'img',
              'aria-label': 'Rendered Mermaid diagram',
            },
            createElement('div', {
              className: 'mermaid-diagram-svg',
              dangerouslySetInnerHTML: { __html: svg },
            }),
          ),
        );
      }
    }
    return createElement(
      'div',
      { className: 'code-block-view', ...sourcePositionAttributes(node) },
      createElement('pre', elementProps),
    );
  };
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
    pre: createPreviewPreComponent(options.renderMermaidDiagram),
    code: PreviewCodeComponent,
    table: createSourceLineComponent('table'),
    tr: createSourceLineComponent('tr'),
    img: createSourceLineImageComponent(
      options.activeDocumentPath,
      options.resolveImageSrc ?? resolveMarkdownImageSrc,
    ),
  } satisfies Components;
}

export const sourceLineMarkdownComponents = createSourceLineMarkdownComponents();
