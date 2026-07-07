import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';
import { Check, Copy } from 'lucide-react';

import { renderMermaidDiagramSvg } from './mermaidRenderer';

// Curated set kept short on purpose — these are the languages bundled in the
// common subset of highlight.js / lowlight, plus the handful most users will
// reach for first in a Markdown editor. Selecting "Plain text" maps to a
// nullable language attribute so the resulting fenced block in markdown does
// not carry a language tag.
export const CODE_BLOCK_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'plaintext', label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'diff', label: 'Diff' },
  { value: 'go', label: 'Go' },
  { value: 'html', label: 'HTML' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scss', label: 'SCSS' },
  { value: 'shell', label: 'Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'toml', label: 'TOML' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
];

const PLAINTEXT_VALUE = 'plaintext';
const MERMAID_VALUE = 'mermaid';
const POPUP_MIN_WIDTH = 192;
const POPUP_GAP = 4;

// Bumped per CodeBlockView mount so each language listbox has a unique DOM id —
// needed for `aria-controls`/`aria-activedescendant` to resolve to *this* code
// block's popup when multiple code blocks are visible on screen at once.
let LANGUAGE_PICKER_ID_SEQ = 0;
let MERMAID_RENDER_ID_SEQ = 0;

type MermaidRenderState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string };

function MermaidDiagram({ source }: { source: string }) {
  const renderId = useMemo(
    () => `markdowner-mermaid-${++MERMAID_RENDER_ID_SEQ}`,
    [],
  );
  const [renderState, setRenderState] = useState<MermaidRenderState>({ status: 'empty' });

  useEffect(() => {
    const trimmed = source.trim();
    if (!trimmed) {
      setRenderState({ status: 'empty' });
      return;
    }

    let cancelled = false;
    setRenderState({ status: 'loading' });
    renderMermaidDiagramSvg(renderId, trimmed)
      .then(({ svg }) => {
        if (!cancelled) setRenderState({ status: 'rendered', svg });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Invalid Mermaid diagram';
        setRenderState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [renderId, source]);

  return (
    <div className="mermaid-diagram-panel" contentEditable={false}>
      <div
        className="mermaid-diagram-canvas"
        role="img"
        aria-label="Rendered Mermaid diagram"
      >
        {renderState.status === 'rendered' ? (
          <div
            className="mermaid-diagram-svg"
            data-testid="mermaid-diagram-svg"
            dangerouslySetInnerHTML={{ __html: renderState.svg }}
          />
        ) : (
          <div
            className="mermaid-diagram-status"
            data-state={renderState.status}
            aria-live="polite"
          >
            {renderState.status === 'error'
              ? renderState.message
              : renderState.status === 'loading'
                ? 'Rendering diagram...'
                : 'Empty diagram'}
          </div>
        )}
      </div>
    </div>
  );
}

export function CodeBlockView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props;
  const language = (node.attrs.language as string | null) ?? PLAINTEXT_VALUE;
  const isMermaid = language === MERMAID_VALUE;
  const editable = editor.isEditable;

  const options = useMemo(() => CODE_BLOCK_LANGUAGES, []);
  const currentIndex = useMemo(() => {
    const idx = options.findIndex((opt) => opt.value === language);
    return idx >= 0 ? idx : 0;
  }, [options, language]);
  const currentOption = options[currentIndex];

  // Track the most-recent letter-key cycle so consecutive presses of the same
  // letter advance through every matching language (j → java → javascript → …
  // → wraps). Cleared implicitly whenever a different letter starts a fresh
  // search via the `currentIdx >= 0 ? currentIdx + 1 : 0` branch below.
  const cycleRef = useRef<{ letter: string; index: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pickerId = useMemo(() => `code-block-lang-picker-${++LANGUAGE_PICKER_ID_SEQ}`, []);

  // Listbox state. `popupRect` carries the viewport-relative coords we computed
  // from the trigger's getBoundingClientRect; we render the popup via a portal
  // to document.body so the .code-block-view's `overflow: hidden` (which keeps
  // the rounded corners clean) can't clip the dropdown.
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(currentIndex);
  const [popupRect, setPopupRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Move the caret into the codeblock content. Used when the user presses
  // ArrowDown on the language selector — the selector is treated as a single
  // focusable stop in document-level arrow navigation.
  const focusCodeContent = (offset = 1) => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (typeof pos !== 'number') {
      editor.chain().focus().run();
      return;
    }
    editor.chain().focus().setTextSelection(pos + offset).run();
  };

  // Move the caret to the block immediately above the codeblock. The position
  // just before the codeblock node (pos − 1) lands inside the previous
  // textblock; ProseMirror snaps it to a valid text position.
  const focusBlockAbove = () => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (typeof pos !== 'number' || pos <= 0) {
      editor.chain().focus().run();
      return;
    }
    editor.chain().focus().setTextSelection(pos - 1).run();
  };

  const setLanguage = (nextValue: string) => {
    updateAttributes({ language: nextValue === PLAINTEXT_VALUE ? null : nextValue });
  };

  const computePopupRect = (): { top: number; left: number; width: number } | null => {
    const trigger = triggerRef.current;
    if (!trigger || typeof trigger.getBoundingClientRect !== 'function') return null;
    const rect = trigger.getBoundingClientRect();
    // Width is at least POPUP_MIN_WIDTH and at most the trigger width — but
    // since the dropdown can be wider than the trigger, we widen and then
    // right-align so the popup hugs the trigger's right edge (mirroring the
    // native macOS NSPopUpButton drop direction).
    const width = Math.max(rect.width, POPUP_MIN_WIDTH);
    return {
      top: rect.bottom + POPUP_GAP,
      left: rect.right - width,
      width,
    };
  };

  const openDropdown = () => {
    if (!editable) return;
    cycleRef.current = null;
    setActiveIndex(currentIndex);
    setPopupRect(computePopupRect());
    setIsOpen(true);
  };

  const closeDropdown = (returnFocus: boolean) => {
    setIsOpen(false);
    setPopupRect(null);
    if (returnFocus) {
      // Defer so React can unmount the portal before we hand focus back; if
      // we focused synchronously the still-mounted <ul> would steal it.
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  // Land keyboard focus on the listbox once it opens — keystrokes from there
  // route to handleListKeyDown for option navigation / selection.
  useLayoutEffect(() => {
    if (!isOpen) return;
    listRef.current?.focus();
  }, [isOpen]);

  // Keep the active option visible as the user navigates with arrow keys.
  useEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, activeIndex]);

  // Close on outside mousedown / outside scroll / resize. Scrolls *inside* the
  // listbox are how arrow navigation pages through options — let those through.
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      closeDropdown(false);
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && listRef.current?.contains(target)) return;
      closeDropdown(false);
    };
    const handleResize = () => closeDropdown(false);
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;

    // Pass arrow navigation through the picker so it behaves like a single
    // focusable stop — ArrowDown carries the user into the code body, ArrowUp
    // out to the block above. The listbox itself owns the open-state arrow
    // navigation via handleListKeyDown.
    if (event.key === 'ArrowDown' && !event.shiftKey) {
      event.preventDefault();
      cycleRef.current = null;
      focusCodeContent();
      return;
    }
    if (event.key === 'ArrowUp' && !event.shiftKey) {
      event.preventDefault();
      cycleRef.current = null;
      focusBlockAbove();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cycleRef.current = null;
      focusCodeContent();
      return;
    }

    // Enter and Space both open the option list. Previously we relied on the
    // native <select>'s Space default and HTMLSelectElement.showPicker() for
    // Enter, but showPicker is a no-op in this WebKit build. With the custom
    // listbox we own both keys outright and they behave identically.
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      openDropdown();
      return;
    }

    // a–z typeahead with cycling: first press lands on the first matching
    // language; repeated presses of the same letter advance through the rest
    // and wrap. A different letter resets the cycle. The dropdown stays
    // closed — open it with Enter or Space.
    if (event.key.length === 1 && /^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      const letter = event.key.toLowerCase();
      const matches = options.filter((opt) => opt.label.toLowerCase().startsWith(letter));
      if (matches.length === 0) return;

      let nextIdx: number;
      if (cycleRef.current?.letter === letter) {
        nextIdx = (cycleRef.current.index + 1) % matches.length;
      } else {
        const currentIdx = matches.findIndex((opt) => opt.value === language);
        nextIdx = currentIdx >= 0 ? (currentIdx + 1) % matches.length : 0;
      }
      cycleRef.current = { letter, index: nextIdx };
      setLanguage(matches[nextIdx].value);
      return;
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDropdown(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((idx) => Math.min(idx + 1, options.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((idx) => Math.max(idx - 1, 0));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      const opt = options[activeIndex];
      if (opt) setLanguage(opt.value);
      closeDropdown(true);
      return;
    }
    if (event.key === 'Tab') {
      // Don't trap focus inside the listbox — let the browser move on, but
      // dismiss the picker on the way out so it isn't left dangling.
      closeDropdown(false);
      return;
    }
    // Typeahead within the open listbox: jump active to the next matching
    // option after the current one (wrapping). Independent of the closed-state
    // cycleRef so navigating in the open list doesn't perturb the closed cycle.
    if (event.key.length === 1 && /^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      const letter = event.key.toLowerCase();
      const total = options.length;
      for (let offset = 1; offset <= total; offset++) {
        const idx = (activeIndex + offset) % total;
        if (options[idx].label.toLowerCase().startsWith(letter)) {
          setActiveIndex(idx);
          return;
        }
      }
    }
  };

  const handleOptionMouseDown = (
    event: ReactMouseEvent<HTMLLIElement>,
    idx: number,
  ) => {
    // Prevent the mousedown from blurring the listbox before our click handler
    // gets to run — without this the outside-mousedown listener would fire
    // first and close the popup before the selection lands.
    event.preventDefault();
    const opt = options[idx];
    if (opt) setLanguage(opt.value);
    closeDropdown(true);
  };

  const handleTriggerClick = () => {
    if (!editable) return;
    if (isOpen) {
      closeDropdown(false);
    } else {
      openDropdown();
    }
  };

  const activeOption = options[activeIndex];
  const activeOptionDomId = activeOption
    ? `${pickerId}-option-${activeIndex}`
    : undefined;

  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const text = node.textContent ?? '';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Last-resort path for environments where the Clipboard API is
        // missing (older WebKit builds, isolated frames). Mirrors the
        // synchronous execCommand fallback used elsewhere in shadcn-style UI.
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1200);
    } catch {
      // Clipboard API can throw without permission. Silently degrade.
    }
  };

  return (
    <NodeViewWrapper
      className={`code-block-view${isMermaid ? ' code-block-view-mermaid' : ''}`}
      data-language={language}
    >
      {isMermaid ? (
        <>
          <MermaidDiagram source={node.textContent ?? ''} />
          <div className="mermaid-source-shell">
            <div className="mermaid-source-label" contentEditable={false}>
              Mermaid source
            </div>
            <pre className="mermaid-source-pre">
              <NodeViewContent
                as={'code' as unknown as 'div'}
                className="language-mermaid hljs"
              />
            </pre>
          </div>
        </>
      ) : (
        <pre>
          <NodeViewContent
            as={'code' as unknown as 'div'}
            className={`language-${language} hljs`}
          />
        </pre>
      )}
      <div className="code-block-toolbar" contentEditable={false}>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Code block language"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? pickerId : undefined}
          className="code-block-language-select"
          disabled={!editable}
          data-code-block-language-select=""
          onClick={handleTriggerClick}
          onKeyDown={handleTriggerKeyDown}
          onBlur={() => {
            cycleRef.current = null;
          }}
        >
          <span className="code-block-language-label">{currentOption.label}</span>
        </button>
        <button
          type="button"
          aria-label={copied ? 'Code copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          className="code-block-copy-button"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      {isOpen && popupRect && typeof document !== 'undefined'
        ? createPortal(
            <ul
              ref={listRef}
              id={pickerId}
              role="listbox"
              aria-label="Code block language"
              aria-activedescendant={activeOptionDomId}
              tabIndex={-1}
              contentEditable={false}
              className="code-block-language-list"
              style={{
                top: popupRect.top,
                left: popupRect.left,
                minWidth: popupRect.width,
              }}
              onKeyDown={handleListKeyDown}
            >
              {options.map((option, idx) => (
                <li
                  key={option.value}
                  id={`${pickerId}-option-${idx}`}
                  role="option"
                  data-option-index={idx}
                  data-active={idx === activeIndex ? '' : undefined}
                  aria-selected={option.value === language}
                  className="code-block-language-option"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(event) => handleOptionMouseDown(event, idx)}
                >
                  {option.label}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </NodeViewWrapper>
  );
}

export default CodeBlockView;
