import { markdown } from '@codemirror/lang-markdown';
import {
  Decoration,
  EditorView,
  StateEffect,
  StateField,
  type DecorationSet,
} from '@uiw/react-codemirror';

import { createSourceLinkClickExtension } from './sourceLinkClick';

export type SourceFindHighlightSpec = {
  matches: ReadonlyArray<{ start: number; end: number }>;
  activeIndex: number;
};

/**
 * Find-in-document highlights for the CodeMirror surface. The find bar keeps
 * keyboard focus (so Enter cycles matches), which hides CodeMirror's caret
 * and dims its native selection — these decorations are what the user
 * actually sees: every match translucent yellow, the active one emphasized,
 * exactly like Zed / VS Code.
 */
export const setSourceFindHighlight = StateEffect.define<SourceFindHighlightSpec | null>();

const findMatchMark = Decoration.mark({ class: 'cm-findMatch' });
const findMatchActiveMark = Decoration.mark({ class: 'cm-findMatch cm-findMatch-active' });

function buildFindHighlightDecorations(
  spec: SourceFindHighlightSpec | null,
  docLength: number,
): DecorationSet {
  if (!spec || spec.matches.length === 0) {
    return Decoration.none;
  }
  const ranges = [];
  for (let index = 0; index < spec.matches.length; index += 1) {
    const match = spec.matches[index];
    const from = Math.max(0, Math.min(match.start, docLength));
    const to = Math.max(from, Math.min(match.end, docLength));
    if (to <= from) continue;
    ranges.push((index === spec.activeIndex ? findMatchActiveMark : findMatchMark).range(from, to));
  }
  return Decoration.set(ranges, true);
}

export const sourceFindHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setSourceFindHighlight)) {
        next = buildFindHighlightDecorations(effect.value, transaction.newDoc.length);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

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
  editorLineWrap: boolean;
  focusModeEnabled: boolean;
  typewriterModeEnabled: boolean;
  onViewportChange: (scrollElement: HTMLElement) => void;
  onTypewriterChange: (view: EditorView) => void;
}

export function buildSourceEditorExtensions({
  editorLineWrap,
  focusModeEnabled,
  typewriterModeEnabled,
  onViewportChange,
  onTypewriterChange,
}: SourceEditorExtensionOptions): unknown[] {
  return [
    markdown(),
    sourceFindHighlightField,
    createSourceLinkClickExtension(),
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
