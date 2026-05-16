import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';

import { CodeBlockView } from './CodeBlockView';

// Shared lowlight registry. `common` covers the languages exposed through
// `CODE_BLOCK_LANGUAGES` plus a few near-aliases (e.g. shell vs bash) that
// users may type into the dropdown.
const lowlight = createLowlight(common);

export function createCodeBlockExtension() {
  return CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
  }).configure({
    lowlight,
    defaultLanguage: null,
    HTMLAttributes: {
      class: 'code-block',
    },
  });
}
