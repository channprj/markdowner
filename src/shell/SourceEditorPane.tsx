import type { Ref } from 'react';
import type { EditorView } from '@uiw/react-codemirror';

import { SourceEditorView } from '@/components/SourceEditorView';
import type { ThemeKind } from '@/lib/desktop';
import type { CodeBlockTheme } from '@/lib/settings';
import { sourceEditorThemeExtension } from '@/lib/sourceEditorTheme';

interface SourceEditorPaneProps {
  value: string;
  readOnly?: boolean;
  extensions: unknown[];
  themeKind: ThemeKind;
  /** Resolved code-block theme the syntax colours should match. */
  codeBlockTheme: CodeBlockTheme;
  /** When false, fall back to the plain light/dark editor (no themed tokens). */
  codeBlockHighlight: boolean;
  onChange: (value: string) => void;
  onStatistics: (stats: unknown) => void;
  onCreateEditor: (view: EditorView) => void;
  containerRef?: Ref<HTMLDivElement>;
}

export function SourceEditorPane({
  value,
  readOnly,
  extensions,
  themeKind,
  codeBlockTheme,
  codeBlockHighlight,
  onChange,
  onStatistics,
  onCreateEditor,
  containerRef,
}: SourceEditorPaneProps) {
  const theme = codeBlockHighlight
    ? sourceEditorThemeExtension(codeBlockTheme)
    : themeKind === 'BuiltInDark'
      ? 'dark'
      : 'light';
  return (
    <SourceEditorView
      value={value}
      readOnly={readOnly}
      extensions={extensions}
      theme={theme}
      onChange={onChange}
      onStatistics={onStatistics}
      onCreateEditor={onCreateEditor}
      containerRef={containerRef}
    />
  );
}
