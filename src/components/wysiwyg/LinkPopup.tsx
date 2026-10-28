import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { Check, Copy, CornerDownLeft, ExternalLink, Unlink } from 'lucide-react';

import { publishEditorEvent, subscribeEditorEvent } from '@/lib/editorEvents';

import {
  applyLinkDraft,
  captureExistingLinkTarget,
  captureLinkTarget,
  isAllowedLinkHref,
  isLinkTargetCurrent,
  removeLinkTarget,
  type LinkTarget,
} from './linkEditing';
import { useEditorSurfaceClamp } from './useEditorSurfaceClamp';

interface Props {
  editor: Editor | null;
  /** When false, listeners are detached and nothing is rendered. */
  enabled?: boolean;
}

type Placement = 'above' | 'below';

type AnchorRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type LinkPopupState =
  | { mode: 'closed' }
  | {
      /**
       * Existing link: the URL field sits above Open / Copy / Remove. Focusing
       * the field (click or ArrowUp) switches to editing; Enter or Save
       * applies the new URL.
       */
      mode: 'viewing';
      target: LinkTarget;
      anchor: AnchorRect;
      status: string | null;
      editing: boolean;
      error: string | null;
    }
  | {
      mode: 'creating';
      target: LinkTarget;
      anchor: AnchorRect;
      error: string | null;
    }
  | { mode: 'invalid-create'; anchor: AnchorRect; error: string };

const POPUP_GUTTER_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

function targetForState(state: LinkPopupState): LinkTarget | null {
  if (state.mode === 'viewing' || state.mode === 'creating') {
    return state.target;
  }
  return null;
}

function isEditingUrl(state: LinkPopupState): boolean {
  return state.mode === 'creating' || (state.mode === 'viewing' && state.editing);
}

function measureAnchor(
  editor: Editor,
  range: { from: number; to: number },
): AnchorRect | null {
  try {
    const start = editor.view.coordsAtPos(range.from);
    const end = editor.view.coordsAtPos(range.to, -1);
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: start.left,
      right: end.right,
    };
  } catch {
    return null;
  }
}

function mutationError(reason: 'empty-url' | 'invalid-url' | 'stale-target') {
  if (reason === 'empty-url') return 'Enter a link URL';
  if (reason === 'invalid-url') return 'Enter a valid link URL';
  return 'The document changed. Open the link editor again.';
}

/**
 * Explicit WYSIWYG link UI.
 *
 * Ordinary link clicks open a compact card styled like the formatting
 * toolbar: the URL field above Open / Copy / Remove. Clicking the field or
 * pressing ArrowUp edits the URL. New links use the full form. Drafts live in
 * React state and the document changes exactly once, on Save/Apply or Remove.
 */
export function LinkPopup({ editor, enabled = true }: Props) {
  const [state, setState] = useState<LinkPopupState>({ mode: 'closed' });
  const [placement, setPlacement] = useState<Placement>('above');
  const [displayText, setDisplayText] = useState('');
  const [href, setHref] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const copyStatusTimerRef = useRef<number | null>(null);

  const close = useCallback(() => setState({ mode: 'closed' }), []);

  const closeAndFocusTarget = () => {
    const target = targetForState(state);
    close();
    if (editor && target) editor.commands.focus(target.to);
  };

  useEffect(
    () => () => {
      if (copyStatusTimerRef.current !== null) {
        window.clearTimeout(copyStatusTimerRef.current);
      }
    },
    [],
  );

  const openFormForTarget = useCallback(
    (target: LinkTarget, anchor: AnchorRect) => {
      setDisplayText(target.displayText);
      setHref(target.href);
      setPlacement('above');
      setState(
        target.kind === 'existing'
          ? { mode: 'viewing', target, anchor, status: null, editing: true, error: null }
          : { mode: 'creating', target, anchor, error: null },
      );
    },
    [],
  );

  const isOpen = state.mode !== 'closed';
  useEffect(() => {
    publishEditorEvent('link:popup-visibility', { open: isOpen });
  }, [isOpen]);
  useEffect(
    () => () => publishEditorEvent('link:popup-visibility', { open: false }),
    [],
  );

  useEffect(() => {
    if (!editor || !enabled) {
      setState({ mode: 'closed' });
      return;
    }

    const unsubscribeEdit = subscribeEditorEvent(
      'link:edit-request',
      payload => {
        const captured = captureLinkTarget(editor, {
          replaceRange: payload.replaceRange,
          initialDisplayText: payload.initialDisplayText,
        });
        if (!captured.ok) {
          const { from, to } = editor.state.selection;
          const anchor = measureAnchor(editor, { from, to });
          if (!anchor) {
            setState({ mode: 'closed' });
            return;
          }
          setState({
            mode: 'invalid-create',
            anchor,
            error: 'Links can only be added within one text block.',
          });
          return;
        }

        const anchor = measureAnchor(editor, captured.target);
        if (!anchor) {
          setState({ mode: 'closed' });
          return;
        }
        publishEditorEvent('link:popup-visibility', { open: true });
        openFormForTarget(captured.target, anchor);
      },
    );

    const unsubscribeInspect = subscribeEditorEvent(
      'link:inspect-request',
      ({ position }) => {
        const target = captureExistingLinkTarget(editor, position);
        if (!target) {
          setState({ mode: 'closed' });
          return;
        }
        const anchor = measureAnchor(editor, target);
        if (!anchor) {
          setState({ mode: 'closed' });
          return;
        }

        // Announce before selecting the link so the formatting toolbar never
        // flashes on top of the link card for the new text selection.
        publishEditorEvent('link:popup-visibility', { open: true });
        editor.commands.setTextSelection({ from: target.from, to: target.to });
        setHref(target.href);
        setPlacement('above');
        setState({ mode: 'viewing', target, anchor, status: null, editing: false, error: null });
      },
    );

    return () => {
      unsubscribeEdit();
      unsubscribeInspect();
    };
  }, [editor, enabled, openFormForTarget]);

  useEffect(() => {
    if (!editor || !enabled) return;
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') {
      return;
    }

    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      setState(current => {
        const target = targetForState(current);
        return target && !isLinkTargetCurrent(editor, target)
          ? { mode: 'closed' }
          : current;
      });
    };

    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor, enabled]);

  useEffect(() => {
    if (!editor || !enabled || state.mode === 'closed') return;

    const reposition = () => {
      setState(current => {
        if (current.mode === 'closed') return current;
        const target = targetForState(current);
        const range = target ?? editor.state.selection;
        const anchor = measureAnchor(editor, range);
        return anchor ? { ...current, anchor } : { mode: 'closed' };
      });
    };

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [editor, enabled, state.mode]);

  const editing = isEditingUrl(state);
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === urlInputRef.current) return;
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing, state.mode === 'closed' ? null : targetForState(state)]);

  // While the card is only showing a link, focus stays in the editor. ArrowUp
  // moves into the URL field above, mirroring the card's visual layout.
  const viewingOnly = state.mode === 'viewing' && !state.editing;
  useEffect(() => {
    if (!viewingOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        setState({ mode: 'closed' });
        return;
      }
      if (
        event.key !== 'ArrowUp' ||
        event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.isComposing
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      startEditing();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [viewingOnly]);

  useEffect(() => {
    if (state.mode === 'closed') return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      setState({ mode: 'closed' });
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [state.mode]);

  useLayoutEffect(() => {
    if (state.mode === 'closed') return;
    const node = containerRef.current;
    if (!node || node.offsetHeight <= 0) return;

    const spaceAbove = state.anchor.top - POPUP_GUTTER_PX - VIEWPORT_MARGIN_PX;
    const spaceBelow =
      window.innerHeight -
      state.anchor.bottom -
      POPUP_GUTTER_PX -
      VIEWPORT_MARGIN_PX;
    const next =
      node.offsetHeight <= spaceAbove
        ? 'above'
        : node.offsetHeight <= spaceBelow
          ? 'below'
          : spaceAbove >= spaceBelow
            ? 'above'
            : 'below';
    setPlacement(current => (current === next ? current : next));
  }, [state]);

  const positionStyle = useMemo<CSSProperties | null>(() => {
    if (state.mode === 'closed') return null;
    const centerX = (state.anchor.left + state.anchor.right) / 2;
    if (placement === 'above') {
      return {
        top: state.anchor.top - POPUP_GUTTER_PX,
        left: centerX,
        transform: 'translate(-50%, -100%)',
      };
    }
    return {
      top: state.anchor.bottom + POPUP_GUTTER_PX,
      left: centerX,
      transform: 'translate(-50%, 0)',
    };
  }, [placement, state]);

  const clamp = useEditorSurfaceClamp(
    editor,
    containerRef,
    positionStyle,
    VIEWPORT_MARGIN_PX,
    state.mode === 'closed' ? null : state.anchor,
  );

  const setViewingStatus = (status: string) => {
    setState(current =>
      current.mode === 'viewing' ? { ...current, status } : current,
    );
  };

  const handleOpen = () => {
    if (state.mode !== 'viewing') return;
    if (!isAllowedLinkHref(state.target.href)) {
      setViewingStatus('This link URL cannot be opened');
      return;
    }
    publishEditorEvent('link:open', {
      href: state.target.href,
      openInNewTab: false,
    });
    close();
  };

  const handleCopy = async () => {
    if (state.mode !== 'viewing') return;
    try {
      await navigator.clipboard.writeText(state.target.href);
      setViewingStatus('URL copied');
      if (copyStatusTimerRef.current !== null) {
        window.clearTimeout(copyStatusTimerRef.current);
      }
      copyStatusTimerRef.current = window.setTimeout(() => {
        copyStatusTimerRef.current = null;
        setState(current =>
          current.mode === 'viewing'
            ? { ...current, status: null }
            : current,
        );
      }, 1200);
    } catch {
      setViewingStatus('Could not copy URL');
    }
  };

  function startEditing() {
    setState(current =>
      current.mode === 'viewing' && !current.editing
        ? { ...current, editing: true, status: null }
        : current,
    );
    const input = urlInputRef.current;
    if (input && document.activeElement !== input) {
      input.focus();
      input.select();
    }
  }

  const setUrlError = (error: string | null) => {
    setState(current =>
      current.mode === 'creating' || current.mode === 'viewing'
        ? { ...current, error }
        : current,
    );
  };

  const handleRemove = () => {
    const target = targetForState(state);
    if (!editor || !target) return;
    const result = removeLinkTarget(editor, target);
    if (result.ok || result.reason === 'stale-target') close();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editor || (state.mode !== 'creating' && state.mode !== 'viewing')) {
      return;
    }

    // The compact card edits only the URL; the link text stays as written.
    const draft =
      state.mode === 'viewing'
        ? { displayText: state.target.displayText, href }
        : { displayText, href };
    const result = applyLinkDraft(editor, state.target, draft);
    if (result.ok) {
      close();
      return;
    }
    if (result.reason === 'stale-target') {
      close();
      return;
    }
    setUrlError(mutationError(result.reason));
  };

  const handlePopupKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusTarget();
      return;
    }
    if (event.key !== 'Tab' || !isEditingUrl(state)) {
      return;
    }

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'input, button:not([disabled])',
      ),
    );
    const active = document.activeElement;
    const leavingBackward = event.shiftKey && active === focusable[0];
    const leavingForward =
      !event.shiftKey && active === focusable[focusable.length - 1];
    if (leavingBackward || leavingForward) closeAndFocusTarget();
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!isEditingUrl(state)) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    close();
  };

  if (!enabled || !editor || state.mode === 'closed' || !positionStyle) {
    return null;
  }
  if (typeof document === 'undefined') return null;

  const clampedStyle: CSSProperties = {
    ...positionStyle,
    maxHeight: clamp.maxHeight,
    overflowY: 'auto',
    top: (typeof positionStyle.top === 'number' ? positionStyle.top : 0) + clamp.dy,
    left:
      (typeof positionStyle.left === 'number' ? positionStyle.left : 0) +
      clamp.dx,
  };

  const dialogLabel = state.mode === 'viewing' ? 'Link details' : 'Add link';

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label={dialogLabel}
      data-testid="link-popup"
      data-placement={placement}
      className={`link-popup${state.mode === 'viewing' ? ' is-compact' : ''}`}
      style={clampedStyle}
      onKeyDown={handlePopupKeyDown}
      onBlur={handleBlur}
    >
      {state.mode === 'viewing' ? (
        <div className="link-popup-compact">
          <form className="link-popup-url-row" onSubmit={handleSubmit}>
            <input
              ref={urlInputRef}
              type="text"
              aria-label="Link URL"
              title={state.editing ? undefined : 'Click or press ↑ to edit'}
              spellCheck={false}
              autoComplete="off"
              className="link-popup-url-input"
              data-editing={state.editing ? 'true' : undefined}
              value={href}
              aria-invalid={state.error ? true : undefined}
              onFocus={event => {
                if (!state.editing) {
                  startEditing();
                  event.currentTarget.select();
                }
              }}
              onMouseUp={event => {
                // Keep the select-all from focus instead of placing a caret.
                if (event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
                  event.preventDefault();
                  event.currentTarget.select();
                }
              }}
              onChange={event => {
                setHref(event.target.value);
                if (state.error) setUrlError(null);
              }}
            />
            {state.editing ? (
              <button
                type="submit"
                className="link-popup-save"
                aria-label="Save link"
                onMouseDown={event => event.preventDefault()}
              >
                <CornerDownLeft aria-hidden className="size-3.5" />
                Save
              </button>
            ) : null}
          </form>
          <div
            role="toolbar"
            aria-label="Link actions"
            className="link-popup-toolbar"
            onMouseDown={event => event.preventDefault()}
          >
            <LinkPopupButton label="Open link" onClick={handleOpen}>
              <ExternalLink aria-hidden className="size-4" />
              Open
            </LinkPopupButton>
            <LinkPopupButton label="Copy URL" onClick={() => void handleCopy()}>
              {state.status === 'URL copied' ? (
                <Check aria-hidden className="size-4" />
              ) : (
                <Copy aria-hidden className="size-4" />
              )}
              Copy
            </LinkPopupButton>
            <span aria-hidden className="selection-toolbar-separator" />
            <LinkPopupButton label="Remove link" danger onClick={handleRemove}>
              <Unlink aria-hidden className="size-4" />
              Remove
            </LinkPopupButton>
          </div>
          {state.error ? (
            <p className="link-popup-error" role="status">
              {state.error}
            </p>
          ) : state.status ? (
            <p className="link-popup-status" role="status">
              {state.status}
            </p>
          ) : null}
        </div>
      ) : state.mode === 'invalid-create' ? (
        <div className="link-popup-card">
          <p className="link-popup-error" role="status">
            {state.error}
          </p>
          <div className="link-popup-actions">
            <LinkPopupButton label="Close" onClick={close}>
              Close
            </LinkPopupButton>
          </div>
        </div>
      ) : (
        <form className="link-popup-form" onSubmit={handleSubmit}>
          <label className="link-popup-field">
            <span>Display text (optional)</span>
            <input
              type="text"
              autoComplete="off"
              value={displayText}
              onChange={event => setDisplayText(event.target.value)}
            />
          </label>
          <label className="link-popup-field">
            <span>Link URL</span>
            <input
              ref={urlInputRef}
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={href}
              aria-invalid={state.error ? true : undefined}
              onChange={event => {
                setHref(event.target.value);
                if (state.error) setUrlError(null);
              }}
            />
          </label>
          {state.error ? (
            <p className="link-popup-error" role="status">
              {state.error}
            </p>
          ) : null}
          <div className="link-popup-actions">
            <button type="submit" className="link-popup-button is-primary">
              Apply
            </button>
            <button
              type="button"
              className="link-popup-button"
              onClick={closeAndFocusTarget}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>,
    document.body,
  );
}

interface LinkPopupButtonProps {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function LinkPopupButton({
  label,
  danger = false,
  onClick,
  children,
}: LinkPopupButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`link-popup-button${danger ? ' is-danger' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default LinkPopup;
