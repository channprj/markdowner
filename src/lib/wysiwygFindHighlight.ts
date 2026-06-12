import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';

export type WysiwygFindHighlightSpec = {
  matches: ReadonlyArray<{ from: number; to: number }>;
  activeIndex: number;
} | null;

const findHighlightPluginKey = new PluginKey<DecorationSet>('wysiwygFindHighlight');

/**
 * Find-in-document highlights for the WYSIWYG surface. The find bar keeps
 * keyboard focus while cycling, and WebKit does not paint the selection of
 * an unfocused contenteditable — these inline decorations are the visible
 * feedback: every match translucent yellow, the active one emphasized.
 */
export const WysiwygFindHighlight = Extension.create({
  name: 'wysiwygFindHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: findHighlightPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, current) {
            const spec = transaction.getMeta(findHighlightPluginKey) as
              | WysiwygFindHighlightSpec
              | undefined;
            if (spec === undefined) {
              return current.map(transaction.mapping, transaction.doc);
            }
            if (!spec || spec.matches.length === 0) {
              return DecorationSet.empty;
            }
            const docSize = transaction.doc.content.size;
            const decorations: Decoration[] = [];
            spec.matches.forEach((match, index) => {
              const from = Math.max(0, Math.min(match.from, docSize));
              const to = Math.max(from, Math.min(match.to, docSize));
              if (to <= from) return;
              decorations.push(
                Decoration.inline(from, to, {
                  class:
                    index === spec.activeIndex
                      ? 'wysiwyg-find-match wysiwyg-find-match-active'
                      : 'wysiwyg-find-match',
                }),
              );
            });
            return DecorationSet.create(transaction.doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return findHighlightPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

/** Push the current match set (or null to clear) into the editor view. */
export function setWysiwygFindHighlight(
  editor: Pick<Editor, 'view'> | null | undefined,
  spec: WysiwygFindHighlightSpec,
) {
  const view = editor?.view;
  // Partially-initialized editors and test mocks expose a reduced view —
  // bail instead of crashing the find flow.
  if (!view?.dispatch || typeof view.state?.tr?.setMeta !== 'function') return;
  view.dispatch(
    view.state.tr.setMeta(findHighlightPluginKey, spec).setMeta('addToHistory', false),
  );
}
