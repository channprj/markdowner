import { memo, type Ref } from 'react';
import CodeMirror, { type EditorView, type Extension } from '@uiw/react-codemirror';

export interface SourceEditorViewProps {
  value: string;
  readOnly?: boolean;
  extensions: unknown[];
  /** A CodeMirror theme extension (code-block palette) or a built-in fallback. */
  theme: Extension | 'light' | 'dark';
  onChange: (value: string) => void;
  onStatistics: (stats: unknown) => void;
  onCreateEditor: (view: EditorView) => void;
  containerRef?: Ref<HTMLDivElement>;
}

/**
 * Memoised CodeMirror host. The surrounding App re-renders on every cursor
 * tick (status bar Ln/Col updates depend on cursorPosition state); without
 * memoisation, every cursor move forced React to reconcile this subtree
 * and @uiw/react-codemirror to compare ref-identity props. With stable
 * callbacks + memoised extensions, the editor view stays untouched.
 */
function SourceEditorViewImpl({
  value,
  readOnly,
  extensions,
  theme,
  onChange,
  onStatistics,
  onCreateEditor,
  containerRef,
}: SourceEditorViewProps) {
  return (
    <div ref={containerRef} className="h-full min-h-0">
      <CodeMirror
        value={value}
        readOnly={readOnly}
        height="100%"
        extensions={extensions as Parameters<typeof CodeMirror>[0]['extensions']}
        onChange={onChange}
        onStatistics={onStatistics}
        onCreateEditor={onCreateEditor}
        theme={theme}
      />
    </div>
  );
}

export const SourceEditorView = memo(SourceEditorViewImpl);
