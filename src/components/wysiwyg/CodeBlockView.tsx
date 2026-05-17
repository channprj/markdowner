import { useMemo, type KeyboardEvent } from 'react';
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

  // Move the caret back into the codeblock content. Used when the user presses
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

  const handleSelectKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    // Native <select> handles ArrowUp/Down to flip through options. Let those
    // through unchanged — the document-level "pass through" navigation only
    // applies to Tab and Escape so the user can step back into the code with
    // a familiar key. Escape returns focus to the code; Tab is normal.
    if (event.key === 'Escape') {
      event.preventDefault();
      focusCodeContent();
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
            const next = event.target.value;
            // markdown serialisation expects null for fences without a tag.
            updateAttributes({ language: next === PLAINTEXT_VALUE ? null : next });
          }}
          onKeyDown={handleSelectKeyDown}
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
