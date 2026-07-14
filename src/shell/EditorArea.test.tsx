import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorArea } from './EditorArea';

const baseProps = {
  busy: false,
  errorMessage: null,
  externalChangeMessage: null,
  showExternalChangeActions: false,
  externalCompareSource: null,
  activeDocumentOpen: true,
  onReloadActiveDocument: () => {},
  onKeepLocalChanges: () => {},
  onCompareExternalChanges: () => {},
  onHideComparison: () => {},
  localDraft: 'hi',
  editorContent: <div data-testid="wysiwyg-marker" />,
  sourceEditor: <div data-testid="source-marker" />,
  splitViewPreview: <div data-testid="preview-marker" />,
} as const;

describe('EditorArea mode switch', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(['Editor', 'Wysiwyg', 'SplitView'] as const)(
    'mounts source, wysiwyg, and preview markers in mode %s',
    (mode) => {
      render(<EditorArea {...baseProps} currentMode={mode} />);
      expect(screen.getByTestId('source-marker')).toBeInTheDocument();
      expect(screen.getByTestId('wysiwyg-marker')).toBeInTheDocument();
      expect(screen.getByTestId('preview-marker')).toBeInTheDocument();
    },
  );

  it('exposes the source pane with the editor-pane-source class so cursor-follow CSS applies', () => {
    render(<EditorArea {...baseProps} currentMode="Editor" />);
    const surface = screen.getByTestId('editor-surface-source');
    expect(surface.className).toContain('editor-pane-source');
  });

  it('wraps WYSIWYG content in a Notion-like page surface without a static title header', () => {
    render(<EditorArea {...baseProps} currentMode="Wysiwyg" />);

    const shell = screen.getByTestId('notion-editor-shell');

    expect(shell).toBeInTheDocument();
    expect(shell).toHaveClass('notion-editor-shell');
    expect(shell.querySelector('.notion-page-header')).toBeNull();
    expect(screen.getByTestId('wysiwyg-marker').parentElement).toHaveClass('notion-editor-content');
  });

  it('applies word-break keep-all to every editor surface by default', () => {
    render(<EditorArea {...baseProps} currentMode="SplitView" />);

    expect(screen.getByTestId('editor-surface-source')).toHaveAttribute(
      'data-word-break',
      'keep-all',
    );
    expect(screen.getByTestId('editor-surface-preview')).toHaveAttribute(
      'data-word-break',
      'keep-all',
    );
    expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveAttribute(
      'data-word-break',
      'keep-all',
    );
  });

  it('can disable word-break keep-all across editor surfaces', () => {
    render(
      <EditorArea
        {...baseProps}
        currentMode="SplitView"
        wordBreakKeepAll={false}
      />,
    );

    expect(screen.getByTestId('editor-surface-source')).toHaveAttribute(
      'data-word-break',
      'normal',
    );
    expect(screen.getByTestId('editor-surface-preview')).toHaveAttribute(
      'data-word-break',
      'normal',
    );
    expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveAttribute(
      'data-word-break',
      'normal',
    );
  });

  it('keeps WYSIWYG code block wrapping off by default', () => {
    render(<EditorArea {...baseProps} currentMode="Wysiwyg" />);

    expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveAttribute(
      'data-code-block-wrap',
      'off',
    );
  });

  it('enables code block wrapping on the WYSIWYG pane only', () => {
    render(
      <EditorArea {...baseProps} currentMode="SplitView" wysiwygCodeBlockWrap />,
    );

    expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveAttribute(
      'data-code-block-wrap',
      'on',
    );
    expect(screen.getByTestId('editor-surface-source')).not.toHaveAttribute(
      'data-code-block-wrap',
    );
    expect(screen.getByTestId('editor-surface-preview')).not.toHaveAttribute(
      'data-code-block-wrap',
    );
  });

  it('keeps typewriter spacing off the flex pane in source mode', () => {
    render(<EditorArea {...baseProps} currentMode="Editor" typewriterModeEnabled />);

    const pane = screen.getByTestId('editor-surface-source');

    expect(pane).not.toHaveClass('editor-typewriter-mode');
    expect(pane).toHaveAttribute('data-typewriter-mode', 'true');
  });

  it('keeps typewriter spacing off the scroll pane in WYSIWYG mode', () => {
    render(<EditorArea {...baseProps} currentMode="Wysiwyg" typewriterModeEnabled />);

    const pane = screen.getByTestId('editor-surface-wysiwyg');
    const shell = screen.getByTestId('notion-editor-shell');

    expect(pane).not.toHaveClass('editor-typewriter-mode');
    expect(shell).toHaveClass('editor-typewriter-mode');
  });
});
