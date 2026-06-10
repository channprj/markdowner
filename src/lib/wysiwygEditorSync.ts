import { normalizeFinalNewline } from './sourceText';

export type WysiwygContentSyncAction =
  | { kind: 'skip' }
  | {
      kind: 'sync';
      tabChanged: boolean;
      shouldClearDomSelection: boolean;
      shouldFinalizeComposition: boolean;
    };

/**
 * Pick which bytes to persist for the WYSIWYG editor's current state.
 *
 * `current` is what `editor.getMarkdown()` just returned. `loaded` is the
 * verbatim markdown that was loaded into the editor on the last setContent
 * call. `canonical` is the round-trip of `loaded` — i.e. what
 * `editor.getMarkdown()` produced immediately *after* that load, before the
 * user touched anything.
 *
 * When `current === canonical`, the user hasn't authored any structural
 * edits — the editor is sitting on the exact state the load produced. In
 * that case we substitute the original `loaded` bytes so files containing
 * markdown shapes @tiptap/markdown can't perfectly preserve (raw HTML
 * blocks, tilde fences, `<https://…>` autolinks, escaped `\*`, table cell
 * whitespace, multi-paragraph list items …) survive a no-op edit
 * losslessly. Once the user actually modifies something the canonical
 * comparison will diverge and we fall back to the serialised form,
 * accepting loss only for whatever the user touched.
 */
export function resolvePersistedWysiwygMarkdown(
  current: string,
  loaded: string | null,
  canonical: string | null,
): string {
  if (loaded === null || canonical === null) return current;
  if (current === canonical) return loaded;
  return current;
}

export function resolveWysiwygContentSyncAction({
  activeTabId,
  lastSyncedTabId,
  localDraft,
  lastEditorMarkdown,
  isComposing,
  viewComposing,
}: {
  activeTabId: string | null;
  lastSyncedTabId: string | null;
  localDraft: string;
  lastEditorMarkdown: string;
  isComposing: boolean;
  viewComposing: boolean | undefined;
}): WysiwygContentSyncAction {
  const tabChanged = activeTabId !== lastSyncedTabId;
  const composing = isComposing || Boolean(viewComposing);

  if (!tabChanged && localDraft === lastEditorMarkdown) {
    return { kind: 'skip' };
  }

  // Same-tab drafts that differ only by the trailing newline parse to an
  // identical ProseMirror doc, so a resync would be a structural no-op — but
  // setContent is destructive (full doc replacement, selection remap, docView
  // teardown). getMarkdown() never emits a trailing newline while the save
  // path normalizes one in, so without this guard any unpaired draft publish
  // turns into a caret jump + erased in-flight keystrokes. Defense in depth:
  // the publish sites pair lastEditorMarkdown with the draft, this guard
  // protects future unpaired ones. Never applies across tab changes.
  if (
    !tabChanged &&
    normalizeFinalNewline(localDraft) === normalizeFinalNewline(lastEditorMarkdown)
  ) {
    return { kind: 'skip' };
  }

  if (!tabChanged && composing) {
    return { kind: 'skip' };
  }

  return {
    kind: 'sync',
    tabChanged,
    shouldClearDomSelection: tabChanged,
    shouldFinalizeComposition: tabChanged && composing,
  };
}
