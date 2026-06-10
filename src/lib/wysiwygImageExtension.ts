import { mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';

import { resolveMarkdownImageSrc } from './markdownImageSrc';

type ActiveDocumentPathAccessor = () => string | null | undefined;

export function createMarkdownImageExtension(
  activeDocumentPath: ActiveDocumentPathAccessor,
) {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      const resolvedSrc =
        typeof HTMLAttributes.src === 'string'
          ? resolveMarkdownImageSrc(HTMLAttributes.src, activeDocumentPath())
          : HTMLAttributes.src;

      return [
        'img',
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          src: resolvedSrc,
        }),
      ];
    },
  });
}
