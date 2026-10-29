import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface ShellShortcutPassthroughOptions {
  /** True for app shortcuts the editor's own keymaps must not consume. */
  matches: (event: KeyboardEvent) => boolean;
}

/**
 * Hands app shortcuts to the window listener. Returning true from a DOM
 * keydown handler skips ProseMirror's keymaps without preventing the default,
 * so ⌘⇧I opens the AI prompt instead of matching Italic's Mod-i / Mod-I.
 */
export const ShellShortcutPassthrough = Extension.create<ShellShortcutPassthroughOptions>({
  name: 'shellShortcutPassthrough',

  addOptions() {
    return { matches: () => false };
  },

  addProseMirrorPlugins() {
    const { matches } = this.options;
    return [
      new Plugin({
        key: new PluginKey('shellShortcutPassthrough'),
        props: {
          handleDOMEvents: {
            keydown: (view, event) => !view.composing && !event.isComposing && matches(event),
          },
        },
      }),
    ];
  },
});
