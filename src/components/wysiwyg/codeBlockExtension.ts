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
        // ArrowDown into a code block: stop at the language picker first so
        // the user can change the language (or just press ArrowDown again to
        // continue into the code body).
        ArrowDown: ({ editor }) => {
          const { state } = editor;
          const { selection } = state;
          if (!selection.empty) return false;
          const { $from } = selection;
          if ($from.parent.type.name === 'codeBlock') return false;
          // Only intercept when the caret sits at the very end of its block,
          // i.e. the next ArrowDown would otherwise step into a sibling node.
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
