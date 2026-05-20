import { useMemo, useRef, type KeyboardEvent } from 'react';
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';

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

export function CodeBlockView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props;
  const language = (node.attrs.language as string | null) ?? PLAINTEXT_VALUE;
  const editable = editor.isEditable;

  const options = useMemo(() => CODE_BLOCK_LANGUAGES, []);

  // Track the most-recent letter-key cycle so consecutive presses of the same
  // letter advance through every matching language (j → java → javascript → …
  // → wraps). Cleared implicitly whenever a different letter starts a fresh
  // search via the `currentIdx >= 0 ? currentIdx + 1 : 0` branch below.
  const cycleRef = useRef<{ letter: string; index: number } | null>(null);

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

  const handleSelectKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;

    // Pass arrow navigation through the picker so it behaves like a single
    // focusable stop — ArrowDown carries the user into the code body, ArrowUp
    // out to the block above. Native <select> would otherwise consume these
    // for option cycling; we surface that via Enter/Space (open dropdown) and
    // a–z typeahead below.
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

    // Enter opens the option list. The native <select> on macOS WebKit only
    // opens on Space by default, so we forward Enter through showPicker()
    // (standardized on HTMLSelectElement; supported in Tauri's WebKit).
    // Calling from a keydown handler counts as a user gesture, so the
    // NotAllowedError path is effectively unreachable here.
    if (event.key === 'Enter') {
      event.preventDefault();
      cycleRef.current = null;
      const select = event.currentTarget;
      if (typeof select.showPicker === 'function') {
        try {
          select.showPicker();
        } catch {
          /* user-gesture restriction — silently ignore */
        }
      }
      return;
    }

    // a–z typeahead with cycling: first press lands on the first matching
    // language; repeated presses of the same letter advance through the rest
    // and wrap. A different letter resets the cycle. The dropdown stays
    // closed — Space (native) and Enter (handled above) open it.
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

  return (
    <NodeViewWrapper className="code-block-view" data-language={language}>
      <pre>
        <NodeViewContent
          as={'code' as unknown as 'div'}
          className={`language-${language} hljs`}
        />
      </pre>
      <div className="code-block-toolbar" contentEditable={false}>
        <select
          aria-label="Code block language"
          className="code-block-language-select"
          value={language}
          disabled={!editable}
          data-code-block-language-select=""
          onChange={(event) => {
            // Mouse / dropdown-driven changes reset the typeahead cycle so the
            // next letter press always starts from the freshly-picked language.
            cycleRef.current = null;
            setLanguage(event.target.value);
          }}
          onKeyDown={handleSelectKeyDown}
          onBlur={() => {
            cycleRef.current = null;
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </NodeViewWrapper>
  );
}

export default CodeBlockView;
