import { useEffect, useEffectEvent, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { EditorMode } from './desktop';
import { sanitizeMarkdownControlChars } from '@/components/wysiwyg/tableMarkdownExtensions';
import { resolvePersistedWysiwygMarkdown, resolveWysiwygContentSyncAction } from './wysiwygEditorSync';

const WYSIWYG_FLUSH_DEBOUNCE_MS = 120;

interface DraftSyncInput {
  currentModeRef: RefObject<EditorMode>;
  editorInstanceRef: RefObject<TiptapEditor | null>;
  localDraftRef: RefObject<string>;
  setLocalDraft: Dispatch<SetStateAction<string>>;
}

/** Owns editor serialization, IME-aware flushes, and original-source preservation. */
export function useWysiwygDraftSync({
  currentModeRef, editorInstanceRef, localDraftRef, setLocalDraft,
}: DraftSyncInput) {
  // Mirror of the markdown most recently emitted by the Tiptap editor. The
  // localDraft <-> editor sync effect compares against this instead of
  // re-reading editor.getMarkdown(), which can change between keystrokes due
  // to markdown renormalization and would otherwise cause setContent to fire
  // mid-typing — breaking IME composition (e.g. typing Korean "안녕하세요"
  // would split into two lines).
  const lastEditorMarkdownRef = useRef<string>('');
  // The exact markdown bytes most recently *loaded into* the editor (via
  // setContent / external sync). Untouched after the load; if the editor's
  // current `getMarkdown()` still matches `lastLoadedCanonicalRef` we know
  // the user hasn't authored any structural edits and can preserve the
  // original bytes verbatim instead of writing the lossy round-trip back to
  // disk. Without this, opening a file that contains markdown shapes
  // @tiptap/markdown can't perfectly round-trip (raw HTML blocks, tilde
  // code fences, explicit `<https://…>` autolinks, escaped `\*` …) would
  // overwrite the file with a normalised, content-shifted equivalent the
  // moment the user pressed Cmd+S.
  const lastLoadedMarkdownRef = useRef<string | null>(null);
  // The result of `editor.getMarkdown()` immediately after the load above —
  // i.e. the canonical round-trip of `lastLoadedMarkdownRef`. The flush
  // compares its serialised output against this value: equal => zero
  // edits => save original bytes; different => user edited => save the
  // serialised form (the only path that can lose lossy fragments, and only
  // for regions the user actually touched).
  const lastLoadedCanonicalRef = useRef<string | null>(null);
  // Tracks which tab's content the editor currently displays. Allows the
  // sync effect to detect tab switches even when both tabs share identical
  // markdown (e.g. a fresh untitled doc after closing another empty one),
  // which the markdown-only comparison would silently skip.
  const lastEditorActiveTabIdRef = useRef<string | null>(null);
  const isWysiwygComposingRef = useRef(false);
  const wysiwygCompositionFlushTimerRef = useRef<number | null>(null);

  const publishWysiwygMarkdownDraft = useEffectEvent((markdown: string) => {
    // Defense in depth: documents corrupted by the old table serializer carry
    // literal U+001F cell separators; heal them (→ space) before the draft
    // can reach the mirror/save paths so the bytes never go back to disk.
    const sanitized = sanitizeMarkdownControlChars(markdown);
    lastEditorMarkdownRef.current = sanitized;
    localDraftRef.current = sanitized;
    setLocalDraft(sanitized);
  });

  // Serialize the editor's current state into localDraft. Skips silently when
  // not in WYSIWYG mode or while a CJK IME composition is in flight; the
  // compositionend handler reschedules in that case.
  const runWysiwygFlush = useEffectEvent(() => {
    if (currentModeRef.current !== 'Wysiwyg') return;
    const ed = editorInstanceRef.current;
    if (!ed) return;
    if (isWysiwygComposingRef.current || ed.view?.composing) return;
    publishWysiwygMarkdownDraft(
      resolvePersistedWysiwygMarkdown(
        ed.getMarkdown(),
        lastLoadedMarkdownRef.current,
        lastLoadedCanonicalRef.current,
      ),
    );
  });

  // Debounced flush. Per-keystroke updates schedule with the default debounce;
  // compositionend / cancel callers pass 0 to flush on the next tick.
  const scheduleWysiwygFlush = useEffectEvent(
    (delayMs: number = WYSIWYG_FLUSH_DEBOUNCE_MS) => {
      if (wysiwygCompositionFlushTimerRef.current !== null) {
        window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
      }
      wysiwygCompositionFlushTimerRef.current = window.setTimeout(() => {
        wysiwygCompositionFlushTimerRef.current = null;
        runWysiwygFlush();
      }, delayMs);
    },
  );

  // Synchronous force-flush for paths that need an up-to-date markdown
  // snapshot (save, mode switch, tab stash, close prompts). Returns the
  // serialized markdown so callers can compare against it without waiting for
  // the React state update that setLocalDraft schedules.
  const flushWysiwygDraftNow = useEffectEvent((): string | null => {
    if (currentModeRef.current !== 'Wysiwyg') return null;
    const ed = editorInstanceRef.current;
    if (!ed) return null;
    if (wysiwygCompositionFlushTimerRef.current !== null) {
      window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
      wysiwygCompositionFlushTimerRef.current = null;
    }
    // CJK IME finalization: if the user triggers save (or any sync-critical
    // path) while still composing a Hangul syllable, returning null here used
    // to drop the in-flight character — callers would fall back to the stale
    // localDraft and persist a document that's missing the user's last
    // keystroke. Blurring the contenteditable commits the composition
    // synchronously on every browser we ship to; we restore focus right
    // afterwards so typing keeps working. After the blur, getMarkdown()
    // reflects the finalized character.
    const dom = ed.view?.dom as HTMLElement | undefined;
    if (isWysiwygComposingRef.current || ed.view?.composing) {
      if (!dom || typeof dom.blur !== 'function') return null;
      const hadFocus = typeof document !== 'undefined' && document.activeElement === dom;
      dom.blur();
      isWysiwygComposingRef.current = false;
      if (hadFocus) {
        // Restore caret focus on a microtask so the composition has fully
        // finalized before ProseMirror re-attaches the selection.
        Promise.resolve().then(() => {
          if (currentModeRef.current === 'Wysiwyg') ed.commands?.focus?.();
        });
      }
    }
    const markdown = resolvePersistedWysiwygMarkdown(
      ed.getMarkdown(),
      lastLoadedMarkdownRef.current,
      lastLoadedCanonicalRef.current,
    );
    publishWysiwygMarkdownDraft(markdown);
    return markdown;
  });

  // Thin alias retained so the existing compositionend / cancel handlers keep
  // their call shape; semantically identical to scheduleWysiwygFlush(0).
  const scheduleWysiwygCompositionFlush = useEffectEvent(() => {
    scheduleWysiwygFlush(0);
  });

  useEffect(() => {
    return () => {
      if (wysiwygCompositionFlushTimerRef.current !== null) {
        window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
        wysiwygCompositionFlushTimerRef.current = null;
      }
    };
  }, []);

  return {
    lastEditorMarkdownRef, lastLoadedMarkdownRef, lastLoadedCanonicalRef,
    lastEditorActiveTabIdRef, isWysiwygComposingRef, wysiwygCompositionFlushTimerRef,
    publishWysiwygMarkdownDraft, flushWysiwygDraftNow, scheduleWysiwygFlush,
    scheduleWysiwygCompositionFlush,
  };
}

/** Bind after useEditor, before startup caret restoration, so content loads first. */
export function useWysiwygContentSync({
  editor, localDraft, activeTabId, sync, onDocumentReplaced,
}: {
  editor: TiptapEditor | null;
  localDraft: string;
  activeTabId: string | null;
  sync: ReturnType<typeof useWysiwygDraftSync>;
  onDocumentReplaced: () => void;
}) {
  const {
    lastEditorMarkdownRef, lastLoadedMarkdownRef, lastLoadedCanonicalRef,
    lastEditorActiveTabIdRef, isWysiwygComposingRef, wysiwygCompositionFlushTimerRef,
  } = sync;
  const onReplaced = useEffectEvent(onDocumentReplaced);
  useEffect(() => {
    if (!editor) {
      return;
    }

    const syncAction = resolveWysiwygContentSyncAction({
      activeTabId,
      lastSyncedTabId: lastEditorActiveTabIdRef.current,
      localDraft,
      lastEditorMarkdown: lastEditorMarkdownRef.current,
      isComposing: isWysiwygComposingRef.current,
      viewComposing: editor.view?.composing,
    });

    // Only push localDraft into the editor when it changed *externally* (file
    // load, undo from menu, drag-and-drop, …). Editor-authored updates are
    // tracked via lastEditorMarkdownRef in onUpdate, so we skip the costly
    // setContent in that case — which would otherwise interrupt IME
    // composition and produce duplicated/split-line output.
    //
    // Exception: when the active tab changes, always re-sync. Otherwise two
    // tabs with identical markdown (two empty drafts, two copies of the same
    // file, …) would leave the editor showing the previous tab's ProseMirror
    // state — which is exactly the "previous file's content reappears" bug.
    // Same-tab CJK IME safety is part of the skip decision: replacing the doc
    // mid-composition tears down ProseMirror's docView, while a tab change
    // must still proceed after finalizing the IME below.
    if (syncAction.kind === 'skip') {
      return;
    }

    // Tab change during an in-flight composition MUST finalize the IME before
    // we proceed. If we deferred (like the same-tab branch does), the editor
    // would stay on the previous tab's content while activeTabId already
    // points at the new tab; the eventual compositionend flush would then
    // serialize the previous tab's markdown into the new tab's localDraft and
    // the user would see the "previous page contents leaked into the new tab"
    // bug. Blurring the editable DOM commits the composition on every browser
    // we ship to; we drop our internal composing flag and clear the pending
    // flush timer so the late compositionend can't overwrite the just-applied
    // new content.
    if (syncAction.shouldFinalizeComposition) {
      const dom = editor.view?.dom as HTMLElement | undefined;
      dom?.blur?.();
      isWysiwygComposingRef.current = false;
      if (wysiwygCompositionFlushTimerRef.current !== null) {
        window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
        wysiwygCompositionFlushTimerRef.current = null;
      }
    }

    // emitUpdate:false prevents Tiptap from firing onUpdate, which would
    // setLocalDraft to a possibly-renormalized markdown string and
    // re-trigger this effect indefinitely (React error #185).
    lastEditorMarkdownRef.current = localDraft;
    lastEditorActiveTabIdRef.current = activeTabId;
    // The setContent below replaces the whole document, so any absolute
    // positions the WebKit table-cell caret repair captured beforehand are
    // meaningless afterwards — drop them and invalidate the deferred repair
    // timers (they compare this epoch) so the caret can't be yanked to a
    // stale pre-replacement coordinate.
    onReplaced();
    const nextContent = localDraft || '';
    const setContentOptions = {
      contentType: 'markdown',
      emitUpdate: false,
    } as const;

    if (syncAction.shouldClearDomSelection) {
      const editorDom = editor.view?.dom;
      const rangeApiHasGeometry =
        typeof editorDom?.ownerDocument?.createRange === 'function' &&
        typeof editorDom.ownerDocument.createRange().getClientRects === 'function';
      const canCollapseViaEditor =
        typeof HTMLElement === 'undefined' ||
        !(editorDom instanceof HTMLElement) ||
        rangeApiHasGeometry;
      const collapsedViaEditor = canCollapseViaEditor
        ? editor
            .chain()
            .setContent(nextContent, setContentOptions)
            .setTextSelection({ from: 0, to: 0 })
            .run() !== false
        : false;
      if (!canCollapseViaEditor) {
        editor.commands.setContent(nextContent, setContentOptions);
      }
      // ProseMirror's transaction mapper carries the previous tab's
      // selection through the doc replacement above — when the prior
      // selection covered a range (Cmd+A, drag-selected paragraph, a find
      // hit, a node-selected image) the new tab can open with WebKit
      // visibly rendering that range against the new content. Collapse
      // ProseMirror state to a single caret so the focus call
      // that follows (in focusActiveEditor / the user's first click)
      // doesn't paint the entire freshly-loaded file as highlighted.
      // JSDOM lacks Range#getClientRects; in that environment we keep the
      // old DOM-only fallback to avoid ProseMirror's scroll-to-selection path.
      if (!collapsedViaEditor) {
        const win = typeof window !== 'undefined' ? window : null;
        const selection = win?.getSelection?.();
        if (selection && selection.rangeCount > 0) {
          try {
            selection.removeAllRanges();
          } catch {
            // Some embedded WebViews throw on removeAllRanges when the
            // selection's anchorNode has been detached. Non-fatal.
          }
        }
      }
    } else {
      editor.commands.setContent(nextContent, setContentOptions);
    }

    // Capture the canonical round-trip of the just-loaded markdown so the
    // save path can detect "user hasn't actually edited anything" and write
    // the original bytes back to disk verbatim. Without this, opening a file
    // containing markdown shapes @tiptap/markdown can't perfectly round-trip
    // (raw HTML blocks, escaped `\*`, tilde fences, autolinks, multi-paragraph
    // list items …) and pressing Cmd+S would silently rewrite the file to
    // the normalised equivalent — exactly the "저장/로드 시 내용 깨짐" bug.
    lastLoadedMarkdownRef.current = nextContent;
    try {
      lastLoadedCanonicalRef.current = editor.getMarkdown();
    } catch {
      lastLoadedCanonicalRef.current = null;
    }
  }, [editor, localDraft, activeTabId]);

}
