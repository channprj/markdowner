import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const pluginKey = new PluginKey('preventTableHoverSelection');

/**
 * Drops `mousemove` events inside `<table>` regions when no mouse button is
 * held. prosemirror-tables' built-in cell-selection plugin tracks
 * mousedown/mousemove pairs to extend a CellSelection — when its mouseup
 * handler is missed (e.g. focus loss, the cursor leaving the editor between
 * gestures) the next idle mousemove can extend a stale selection. Swallowing
 * idle moves makes cell selection achievable only by explicit click + drag
 * or by Shift+arrow keys, matching the user expectation.
 *
 * The handler returns `false` (does not swallow) when any button is held so
 * legitimate drag selections still reach the table extension. Outside of
 * tables it is a complete no-op.
 */
export const PreventTableHoverSelection = Extension.create({
  name: 'preventTableHoverSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleDOMEvents: {
            mousemove(_view, event) {
              const mouseEvent = event as MouseEvent;
              if (mouseEvent.buttons !== 0) return false;
              const target = mouseEvent.target as HTMLElement | null;
              if (!target) return false;
              if (target.closest('table')) {
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
