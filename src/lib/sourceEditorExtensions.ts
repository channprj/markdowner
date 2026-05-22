import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@uiw/react-codemirror';

import { createSourceLinkClickExtension } from './sourceLinkClick';

export const sourceFocusModeExtension = EditorView.theme({
  '&.cm-focused .cm-line': {
    opacity: '0.46',
    transition: 'opacity 120ms ease',
  },
  '&.cm-focused .cm-line:hover, &.cm-focused .cm-line:has(.cm-selectionBackground)': {
    opacity: '1',
  },
});

export const sourceTypewriterModeExtension = EditorView.theme({
  '.cm-scroller': {
    scrollPaddingBlock: '45%',
  },
  '.cm-content': {
    paddingTop: '35vh',
    paddingBottom: '35vh',
  },
});

interface SourceEditorExtensionOptions {
  activeDocumentPath: () => string | null;
  editorLineWrap: boolean;
  focusModeEnabled: boolean;
  typewriterModeEnabled: boolean;
  onViewportChange: (scrollElement: HTMLElement) => void;
  onTypewriterChange: (view: EditorView) => void;
}

export function buildSourceEditorExtensions({
  activeDocumentPath,
  editorLineWrap,
  focusModeEnabled,
  typewriterModeEnabled,
  onViewportChange,
  onTypewriterChange,
}: SourceEditorExtensionOptions): unknown[] {
  return [
    markdown(),
    createSourceLinkClickExtension(activeDocumentPath),
    ...(editorLineWrap ? [EditorView.lineWrapping] : []),
    ...(focusModeEnabled ? [sourceFocusModeExtension] : []),
    ...(typewriterModeEnabled ? [sourceTypewriterModeExtension] : []),
    EditorView.updateListener.of((update) => {
      if (update.viewportChanged) {
        onViewportChange(update.view.scrollDOM);
      }
      if (update.selectionSet || update.docChanged || update.focusChanged) {
        onTypewriterChange(update.view);
      }
    }),
  ];
}
