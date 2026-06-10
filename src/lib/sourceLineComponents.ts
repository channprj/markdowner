import { createElement } from 'react';
import type { Components } from 'react-markdown';

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
    pre: createSourceLineComponent('pre'),
    table: createSourceLineComponent('table'),
    tr: createSourceLineComponent('tr'),
    img: createSourceLineImageComponent(options.activeDocumentPath),
  } satisfies Components;
}

export const sourceLineMarkdownComponents = createSourceLineMarkdownComponents();
