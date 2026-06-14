import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { getMarkRange } from '@tiptap/core';
import { Check, Copy, ExternalLink, Unlink } from 'lucide-react';

import { cn } from '@/lib/utils';
import { publishEditorEvent, subscribeEditorEvent } from '@/lib/editorEvents';

interface Props {
  editor: Editor | null;
  /** When false, listeners are detached and nothing is rendered. */
  enabled?: boolean;
}

type Placement = 'above' | 'below';

type PopupState =
  | { open: false }
  | {
      open: true;
      from: number;
      to: number;
      href: string;
      anchorTop: number;
      anchorBottom: number;
      anchorLeft: number;
      anchorRight: number;
      /** 'caret' means the editor caret sits inside the link; 'hover' means the user pointed at it. */
      origin: 'caret' | 'hover';
    };

const POPUP_GUTTER_PX = 8;
const VIEWPORT_MARGIN_PX = 8;
/**
 * Grace period before a hover-opened popup hides once the pointer leaves the
 * link/popup. 120ms proved too tight to cross the gutter gap reliably (the
 * popup vanished mid-reach — "링크 수정이 안 돼요"), so give the pointer a
 * comfortable window.
 */
const HOVER_HIDE_DELAY_MS = 320;
/** Order in which Up/Down arrow keys traverse focusable popup items. */
const FOCUS_ORDER = ['url-input', 'open', 'copy', 'remove'] as const;
type FocusKey = (typeof FOCUS_ORDER)[number];

/**
 * Floating popup for editing the link at the caret or under the mouse.
 *
 * Mirrors the Notion-style chrome used elsewhere (slash menu, selection
 * toolbar). The popup appears above the link by default and flips below when
 * there is not enough room above. Up/Down arrows cycle between the URL input
 * and the action buttons inside the popup; Tab from the editor enters the
 * popup; Escape returns focus to the editor.
 */
export function LinkPopup({ editor, enabled = true }: Props) {
  const [state, setState] = useState<PopupState>({ open: false });
  const [placement, setPlacement] = useState<Placement>('above');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonsRef = useRef<Record<Exclude<FocusKey, 'url-input'>, HTMLButtonElement | null>>({
    open: null,
    copy: null,
    remove: null,
  });
  // Track which link element the mouse is currently over so we can keep the
  // popup open while the cursor travels between the link and the popup itself.
  const hoveredLinkRef = useRef<HTMLElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  // The user is actively editing inside the popup (URL input or an action
  // button is focused). Hover hide-timers must NOT close it out from under
  // them — losing focus mid-keystroke was the "링크 수정이 간헐적으로 안 돼요"
  // bug: a slight mouse drift off the popup fired the 320ms hide while the
  // caret sat in the URL input.
  const popupHasFocus = () =>
    typeof document !== 'undefined' &&
    !!containerRef.current &&
    containerRef.current.contains(document.activeElement);

  // Recompute the active link range from the current caret position. Returns
  // null when the caret is not inside a link mark.
  const computeCaretLink = useCallback((): PopupState | null => {
    if (!editor) return null;
    const { state: edState, view } = editor;
    // `view.hasFocus()` can lag behind the actual DOM focus right after a
    // click (WebKit delivers focus between the mousedown and the rAF this
    // runs in), which made the caret popup intermittently fail to open.
    // Treat "DOM focus anywhere inside the editor surface" as focused too.
    const editorFocused =
      view.hasFocus() ||
      (typeof document !== 'undefined' && view.dom.contains(document.activeElement));
    if (!editorFocused) return null;
    const linkType = edState.schema.marks.link;
    if (!linkType) return null;
    const { $from } = edState.selection;
    const range = getMarkRange($from, linkType);
    if (!range) return null;
    const { from, to } = range;
    const mark = $from.marks().find((m) => m.type === linkType)
      ?? edState.doc.nodeAt(from)?.marks.find((m) => m.type === linkType);
    const href = (mark?.attrs.href as string | undefined) ?? '';
    let startCoords: { top: number; bottom: number; left: number };
    let endCoords: { top: number; bottom: number; right: number };
    try {
      startCoords = view.coordsAtPos(from);
      endCoords = view.coordsAtPos(to, -1);
    } catch {
      return null;
    }
    return {
      open: true,
      from,
      to,
      href,
      anchorTop: Math.min(startCoords.top, endCoords.top),
      anchorBottom: Math.max(startCoords.bottom, endCoords.bottom),
      anchorLeft: startCoords.left,
      anchorRight: endCoords.right,
      origin: 'caret',
    };
  }, [editor]);

  // Refresh the popup state on selection / transaction / focus changes.
  //
  // The popup auto-opens whenever the caret enters a link mark — that is
  // the only discoverable way for a keyboard-driven user to reach the
  // "edit URL" input. The earlier round attempted hover-only auto-open and
  // users reported "링크 주소 편집이 안 됩니다" because hovering wasn't a
  // reliable trigger (the cursor sometimes left the anchor before the
  // popup mounted, or the user simply expected click-to-edit). Caret-mode
  // re-runs on every transaction and is debounced through rAF so rapid
  // selection updates don't thrash.
  useEffect(() => {
    if (!editor || !enabled) {
      setState({ open: false });
      return;
    }
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') {
      return;
    }

    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        // Hover-mode wins until the mouse leaves the link.
        if (hoveredLinkRef.current) return;
        // If focus has moved INTO the popup itself (the user clicked the URL
        // input or an action button), the editor's `blur` fired this
        // schedule — but we must NOT close the popup, otherwise clicking the
        // input to edit the URL instantly dismisses the very thing the user
        // is trying to use. This was the core "링크 주소 편집이 안 돼요"
        // bug: editor blur → computeCaretLink returns null (no editor focus)
        // → caret popup closed before the input could receive a keystroke.
        if (
          typeof document !== 'undefined' &&
          containerRef.current &&
          containerRef.current.contains(document.activeElement)
        ) {
          return;
        }
        const next = computeCaretLink();
        if (!next) {
          setState((prev) =>
            prev.open && prev.origin === 'caret' ? { open: false } : prev,
          );
          return;
        }
        setState(next);
      });
    };

    editor.on('selectionUpdate', schedule);
    editor.on('transaction', schedule);
    editor.on('focus', schedule);
    editor.on('blur', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    // Initial pass — covers the case where Cmd+K applied a link mark right
    // before this effect mounted; without it the popup wouldn't open until
    // the next selection update fired.
    schedule();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      editor.off('selectionUpdate', schedule);
      editor.off('transaction', schedule);
      editor.off('focus', schedule);
      editor.off('blur', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [editor, enabled, computeCaretLink]);

  // Mouse hover detection on link anchors inside the editor DOM.
  useEffect(() => {
    if (!editor || !enabled) return;
    const dom = editor.view?.dom;
    if (!(dom instanceof HTMLElement)) return;

    const showForLink = (anchor: HTMLAnchorElement) => {
      const view = editor.view;
      let pos: number | null = null;
      try {
        const result = view.posAtDOM(anchor, 0);
        pos = typeof result === 'number' ? result : null;
      } catch {
        pos = null;
      }
      if (pos === null) return;
      const linkType = editor.state.schema.marks.link;
      if (!linkType) return;
      const $pos = editor.state.doc.resolve(Math.min(Math.max(pos, 0), editor.state.doc.content.size));
      const range = getMarkRange($pos, linkType);
      if (!range) return;
      const rect = anchor.getBoundingClientRect();
      setState({
        open: true,
        from: range.from,
        to: range.to,
        href: anchor.getAttribute('href') ?? '',
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        anchorLeft: rect.left,
        anchorRight: rect.right,
        origin: 'hover',
      });
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
      if (!anchor || !dom.contains(anchor)) return;
      clearHideTimer();
      hoveredLinkRef.current = anchor;
      showForLink(anchor);
    };

    const onMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
      if (!anchor || anchor !== hoveredLinkRef.current) return;
      const next = event.relatedTarget as Node | null;
      // Mouse moved into the popup → keep showing.
      if (next && containerRef.current?.contains(next)) return;
      // Mouse moved to a child of the same link.
      if (next && anchor.contains(next)) return;
      hoveredLinkRef.current = null;
      // Delay closing so the cursor can travel across the gap to the popup.
      clearHideTimer();
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        if (hoveredLinkRef.current) return;
        // Keep open while the user is editing inside the popup.
        if (popupHasFocus()) return;
        setState((prev) => {
          if (!prev.open || prev.origin !== 'hover') return prev;
          // If the caret is now inside a link, hand off to caret-mode.
          const caret = computeCaretLink();
          return caret ?? { open: false };
        });
      }, HOVER_HIDE_DELAY_MS);
    };

    dom.addEventListener('mouseover', onMouseOver);
    dom.addEventListener('mouseout', onMouseOut);
    return () => {
      dom.removeEventListener('mouseover', onMouseOver);
      dom.removeEventListener('mouseout', onMouseOut);
      clearHideTimer();
    };
  }, [editor, enabled, computeCaretLink]);

  // Sync the input draft with the active href whenever the state changes to a
  // different link. This avoids stomping mid-edit text when the popup remains
  // open across selection updates.
  useEffect(() => {
    if (!state.open) {
      setDraft('');
      setCopied(false);
      return;
    }
    setDraft(state.href);
    setCopied(false);
  }, [state.open ? `${state.from}:${state.to}:${state.href}` : null]);

  // Decide whether the popup floats above or below the link.
  useLayoutEffect(() => {
    if (!state.open) return;
    const node = containerRef.current;
    if (!node) return;
    const height = node.offsetHeight;
    if (height <= 0) return;
    const viewportHeight =
      typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const spaceAbove = state.anchorTop - POPUP_GUTTER_PX - VIEWPORT_MARGIN_PX;
    const spaceBelow = viewportHeight - state.anchorBottom - POPUP_GUTTER_PX - VIEWPORT_MARGIN_PX;
    let next: Placement;
    if (height <= spaceAbove) {
      next = 'above';
    } else if (height <= spaceBelow) {
      next = 'below';
    } else {
      next = spaceAbove >= spaceBelow ? 'above' : 'below';
    }
    setPlacement((prev) => (prev === next ? prev : next));
  }, [state]);

  // Listen for Tab on the editor DOM so the user can enter the popup with the
  // keyboard. Without this Tab would insert a tab character / move the caret.
  useEffect(() => {
    if (!editor || !enabled || !state.open) return;
    const dom = editor.view?.dom as HTMLElement | undefined;
    if (!dom) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.isComposing) return;
      // Only intercept Tab when the caret is actually inside the link — hover
      // mode shouldn't steal Tab from regular editor navigation.
      if (state.origin !== 'caret') return;
      event.preventDefault();
      focusItem('url-input');
    };
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, enabled, state]);

  const focusItem = useCallback((key: FocusKey) => {
    if (key === 'url-input') {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    buttonsRef.current[key]?.focus();
  }, []);

  const moveFocus = (current: FocusKey, direction: 1 | -1) => {
    const idx = FOCUS_ORDER.indexOf(current);
    if (idx === -1) return;
    const next = FOCUS_ORDER[(idx + direction + FOCUS_ORDER.length) % FOCUS_ORDER.length];
    focusItem(next);
  };

  // The popup's from/to are captured when it opens; any transaction since
  // (typing elsewhere, an external refresh) can shift them. Re-derive the
  // link range from the CURRENT document before mutating so a commit never
  // links/unlinks the wrong text. Returns null when no link exists at the
  // remembered position anymore — the edit target is gone, so bail.
  const resolveCurrentLinkRange = useCallback((): { from: number; to: number } | null => {
    if (!editor || !state.open) return null;
    const linkType = editor.state.schema.marks.link;
    if (!linkType) return null;
    const docSize = editor.state.doc.content.size;
    const probe = Math.min(Math.max(state.from, 0), docSize);
    const range = getMarkRange(editor.state.doc.resolve(probe), linkType);
    return range ? { from: range.from, to: range.to } : null;
  }, [editor, state]);

  const commitHref = useCallback(
    (rawHref: string) => {
      if (!editor || !state.open) return;
      const range = resolveCurrentLinkRange();
      if (!range) {
        setState({ open: false });
        return;
      }
      const trimmed = rawHref.trim();
      // Empty + "scheme only" placeholders both mean "no URL entered" — treat
      // them as cancellation and drop the link mark. Otherwise a quick click
      // on the Link button followed by a blur would leave a broken `[text]()`
      // or `[text](https://)` behind. Matches `https://`, `mailto:`, `tel:`,
      // etc. — any `scheme:` (optionally followed by 1-2 slashes) with no
      // body. A real URL always has something after the scheme separator.
      const isProtocolPlaceholder = /^[a-z][a-z0-9+.-]*:\/{0,2}$/i.test(trimmed);
      if (trimmed === '' || isProtocolPlaceholder) {
        editor
          .chain()
          .focus()
          .setTextSelection(range)
          .unsetLink()
          .setTextSelection(range.to)
          .run();
        setState({ open: false });
        return;
      }
      editor
        .chain()
        .setTextSelection(range)
        .extendMarkRange('link')
        .setLink({ href: trimmed })
        .setTextSelection(range.to)
        .focus()
        .run();
    },
    [editor, state, resolveCurrentLinkRange],
  );

  const handleRemove = () => {
    if (!editor || !state.open) return;
    const range = resolveCurrentLinkRange();
    if (!range) {
      setState({ open: false });
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection(range)
      .unsetLink()
      .setTextSelection(range.to)
      .run();
    setState({ open: false });
  };

  const handleCopy = async () => {
    if (!state.open) return;
    try {
      await navigator.clipboard.writeText(draft.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API unavailable — silently fail; manual copy still works.
    }
  };

  const handleOpen = () => {
    if (!state.open) return;
    const target = draft.trim();
    if (!target) return;
    setState({ open: false });
    // App owns link-following (resolve + apply snapshot + OS handlers). The
    // bus keeps this popup decoupled from that tab plumbing and reuses the
    // exact same path as a click in the editor surface.
    publishEditorEvent('link:open', { href: target, openInNewTab: false });
  };

  const handleKeyDownInItem = (key: FocusKey) => (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(key, 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(key, -1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (editor) editor.commands.focus();
      setState((prev) => (prev.open && prev.origin === 'hover' ? { open: false } : prev));
      return;
    }
    if (event.key === 'Enter') {
      if (key === 'url-input') {
        event.preventDefault();
        commitHref(draft);
        if (editor) editor.commands.focus();
      }
    }
  };

  // External "edit link" trigger (e.g. the Link button in the selection
  // toolbar) — focus the URL input so the user can type immediately without
  // a second click. The popup itself is opened by the selection-update
  // listener once the toolbar applies the link; toggle a state ticker so the
  // focus effect below runs once the input is actually mounted.
  const [focusRequestToken, setFocusRequestToken] = useState(0);
  useEffect(() => {
    return subscribeEditorEvent('link:edit-request', (payload) => {
      if (!payload.focusInput) return;
      setFocusRequestToken((value) => value + 1);
    });
  }, []);
  useEffect(() => {
    if (!state.open || focusRequestToken === 0) return;
    // requestAnimationFrame defers the focus until after React commits and
    // the portal mounts the input. Selecting the text lets the user type
    // straight over the placeholder.
    const handle = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(handle);
  }, [focusRequestToken, state.open]);

  // Hide popup when clicking outside both popup and editor.
  useEffect(() => {
    if (!state.open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      const dom = editor?.view?.dom;
      if (dom instanceof HTMLElement && dom.contains(target)) return;
      setState({ open: false });
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [state.open, editor]);

  const positionStyle = useMemo<CSSProperties | null>(() => {
    if (!state.open) return null;
    const centerX = (state.anchorLeft + state.anchorRight) / 2;
    if (typeof window === 'undefined') {
      return { top: 0, left: centerX };
    }
    if (placement === 'above') {
      return {
        top: state.anchorTop - POPUP_GUTTER_PX,
        left: centerX,
        transform: 'translate(-50%, -100%)',
      };
    }
    return {
      top: state.anchorBottom + POPUP_GUTTER_PX,
      left: centerX,
      transform: 'translate(-50%, 0)',
    };
  }, [placement, state]);

  if (!enabled || !state.open || !positionStyle) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  const stopMouseDown = (event: { preventDefault: () => void; target: EventTarget | null }) => {
    // Don't blur the URL input when clicking the toolbar shell.
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
  };

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Edit link"
      data-testid="link-popup"
      data-placement={placement}
      className="link-popup"
      style={positionStyle}
      onMouseDown={stopMouseDown}
      onMouseEnter={clearHideTimer}
      onMouseLeave={() => {
        // Re-evaluate after the gap; if the caret isn't on a link either,
        // the popup will close.
        if (state.origin !== 'hover') return;
        clearHideTimer();
        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null;
          // Keep open while the user is editing inside the popup.
          if (popupHasFocus()) return;
          setState((prev) => {
            if (!prev.open || prev.origin !== 'hover') return prev;
            return computeCaretLink() ?? { open: false };
          });
        }, HOVER_HIDE_DELAY_MS);
      }}
    >
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        autoComplete="off"
        className="link-popup-input"
        aria-label="Link URL"
        value={draft}
        placeholder="https://"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commitHref(draft)}
        onKeyDown={handleKeyDownInItem('url-input')}
      />
      <span aria-hidden className="link-popup-separator" />
      <LinkPopupButton
        label="Open link"
        innerRef={(node) => {
          buttonsRef.current.open = node;
        }}
        onClick={handleOpen}
        onKeyDown={handleKeyDownInItem('open')}
      >
        <ExternalLink className="size-4" />
      </LinkPopupButton>
      <LinkPopupButton
        label={copied ? 'Copied' : 'Copy URL'}
        innerRef={(node) => {
          buttonsRef.current.copy = node;
        }}
        onClick={handleCopy}
        onKeyDown={handleKeyDownInItem('copy')}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </LinkPopupButton>
      <LinkPopupButton
        label="Remove link"
        danger
        innerRef={(node) => {
          buttonsRef.current.remove = node;
        }}
        onClick={handleRemove}
        onKeyDown={handleKeyDownInItem('remove')}
      >
        <Unlink className="size-4" />
      </LinkPopupButton>
    </div>,
    portalTarget,
  );
}

interface LinkPopupButtonProps {
  label: string;
  danger?: boolean;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  innerRef: (node: HTMLButtonElement | null) => void;
  children: React.ReactNode;
}

function LinkPopupButton({
  label,
  danger = false,
  onClick,
  onKeyDown,
  innerRef,
  children,
}: LinkPopupButtonProps) {
  return (
    <button
      ref={innerRef}
      type="button"
      aria-label={label}
      title={label}
      className={cn('link-popup-button', danger && 'is-danger')}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}

export default LinkPopup;
