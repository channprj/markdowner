import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';

import { CodeBlockView } from './CodeBlockView';

// Shared lowlight registry. `common` covers ~38 languages out of the box;
// we additionally register aliases for language names that appear in
// `CODE_BLOCK_LANGUAGES` (and in markdown source written by the wider world)
// but aren't in lowlight's default set — without these aliases, fenced
// blocks like ```html or ```toml render with no syntax highlighting and
// look "weird" compared to the source-mode rendering.
const lowlight = createLowlight(common);
// `html` is the obvious tag name for HTML code blocks; lowlight ships it
// only under `xml`. registerAlias makes `html` resolve to the xml grammar.
lowlight.registerAlias({ xml: ['html'] });
// `toml` isn't in `common`; the `ini` grammar is the closest visual match
// (sections + key=value pairs) so we alias it.
lowlight.registerAlias({ ini: ['toml'] });

/**
 * The split-view preview pane highlights through the same registry so both
 * surfaces color identical token sets (including the aliases above).
 */
export const sharedLowlight = lowlight;

// Move keyboard focus to the language picker rendered by the NodeView at the
// given document position. Returns true when the focus actually moved so the
// caller can `preventDefault` the originating arrow keypress. The picker is
// rendered as an HTMLButtonElement (custom listbox), not a native <select>.
function focusLanguageSelectorAtPos(editor: Editor, pos: number): boolean {
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return false;
  const trigger = dom.querySelector('[data-code-block-language-select]');
  if (trigger instanceof HTMLButtonElement && !trigger.disabled) {
    trigger.focus();
    return true;
  }
  return false;
}

export function createCodeBlockExtension() {
  return CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
    addKeyboardShortcuts() {
      return {
        ArrowDown: ({ editor }) => {
          const { state } = editor;
          const { selection } = state;
          if (!selection.empty) return false;
          const { $from } = selection;

          // Inside a code block: ArrowDown on the LAST line exits the block to
          // the paragraph below (creating one when the code block is the last
          // node). Plain Enter always inserts a newline in code, so this arrow
          // is the deliberate escape hatch the user asked for. Replaces
          // CodeBlockLowlight's built-in exitOnArrowDown, which our
          // addKeyboardShortcuts override would otherwise shadow.
          if ($from.parent.type.name === 'codeBlock') {
            const textAfterCaret = $from.parent.textBetween(
              $from.parentOffset,
              $from.parent.content.size,
            );
            // Not on the last line yet — let the caret move down within the code.
            if (textAfterCaret.includes('\n')) return false;
            if (!editor.view.endOfTextblock('down')) return false;
            const afterPos = $from.after();
            const nodeAfter = state.doc.nodeAt(afterPos);
            if (!nodeAfter) {
              return editor
                .chain()
                .insertContentAt(afterPos, { type: 'paragraph' })
                .setTextSelection(afterPos + 1)
                .scrollIntoView()
                .focus()
                .run();
            }
            return editor
              .chain()
              .setTextSelection(afterPos + 1)
              .scrollIntoView()
              .focus()
              .run();
          }

          // Above a code block: stop at the language picker first so the user
          // can change the language (or press ArrowDown again to continue in).
          if ($from.parentOffset < $from.parent.content.size) return false;
          if ($from.depth === 0) return false;
          const afterPos = $from.after();
          const nodeAfter = state.doc.nodeAt(afterPos);
          if (nodeAfter?.type.name !== 'codeBlock') return false;
          return focusLanguageSelectorAtPos(editor, afterPos);
        },
        // ArrowUp from the first line of a code block: stop at the language
        // picker so the user can change the language before leaving the block.
        ArrowUp: ({ editor }) => {
          const { state } = editor;
          const { selection } = state;
          if (!selection.empty) return false;
          const { $from } = selection;
          if ($from.parent.type.name !== 'codeBlock') return false;
          const beforeText = $from.parent.textBetween(0, $from.parentOffset);
          if (beforeText.includes('\n')) return false;
          const codeBlockPos = $from.before($from.depth);
          return focusLanguageSelectorAtPos(editor, codeBlockPos);
        },
        // Mod-Enter inside a code block exits the block — Notion/StackOverflow
        // convention. Plain Enter still inserts a newline character (so users
        // can write multi-line code without juggling shortcuts), but the
        // explicit modifier provides a one-keystroke escape hatch that
        // doesn't require reaching for ArrowDown several times.
        'Mod-Enter': ({ editor }) => {
          const { state } = editor;
          const { $from } = state.selection;
          if ($from.parent.type.name !== 'codeBlock') return false;
          // Move the caret to just after the codeBlock, then split. The
          // split lands the user inside a fresh paragraph immediately below
          // the code block, mirroring the result of pressing ArrowDown +
          // Home + Enter.
          const afterPos = $from.after();
          return editor
            .chain()
            .setTextSelection(afterPos)
            .createParagraphNear()
            .focus()
            .run();
        },
        // Tab inside a code block inserts a literal tab character (or the
        // configured indent string). Without this, Tiptap's default Tab
        // behaviour moves focus to the next focusable element, which is
        // jarring in the middle of typing code. Two-space soft indent is
        // the most common neutral default for markdown code blocks; we'll
        // expose a setting in a follow-up if users want hard tabs / 4
        // spaces.
        Tab: ({ editor }) => {
          const { state } = editor;
          if (state.selection.$from.parent.type.name !== 'codeBlock') return false;
          editor.view.dispatch(state.tr.insertText('  ').scrollIntoView());
          return true;
        },
        // Shift-Tab inside a code block deletes up to 2 spaces of leading
        // indent on the current line, mirroring the symmetric Tab insert
        // above. If the caret-preceding text doesn't contain leading
        // spaces, we fall through.
        'Shift-Tab': ({ editor }) => {
          const { state } = editor;
          const { $from, empty } = state.selection;
          if (!empty) return false;
          if ($from.parent.type.name !== 'codeBlock') return false;
          // Find the start of the current line within the code block.
          const text = $from.parent.textBetween(0, $from.parentOffset);
          const lastNewline = text.lastIndexOf('\n');
          const lineStartInParent = lastNewline + 1;
          const lineText = $from.parent.textBetween(lineStartInParent, $from.parentOffset);
          // Strip up to 2 leading spaces.
          const stripCount = lineText.startsWith('  ') ? 2 : lineText.startsWith(' ') ? 1 : 0;
          if (stripCount === 0) return false;
          const lineStartAbs = $from.start($from.depth) + lineStartInParent;
          editor.view.dispatch(state.tr.delete(lineStartAbs, lineStartAbs + stripCount));
          return true;
        },
      };
    },
  }).configure({
    lowlight,
    defaultLanguage: null,
    HTMLAttributes: {
      class: 'code-block',
    },
  });
}
