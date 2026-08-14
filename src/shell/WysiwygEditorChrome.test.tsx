import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WysiwygEditorChrome } from './WysiwygEditorChrome';

vi.mock('@tiptap/react', () => ({
  EditorContent: ({ editor }: { editor: unknown }) => (
    <div data-testid="editor-content" data-editor-attached={String(Boolean(editor))} />
  ),
}));

vi.mock('@/components/wysiwyg/SlashCommandMenu', () => ({
  SlashCommandMenu: ({
    enabled,
    skillNames,
  }: {
    enabled?: boolean;
    skillNames?: ReadonlySet<string>;
  }) => (
    <div
      data-testid="slash-command-menu"
      data-enabled={String(Boolean(enabled))}
      data-skill-count={skillNames?.size ?? 0}
    />
  ),
}));

vi.mock('@/components/wysiwyg/SkillTokenMenu', () => ({
  SkillTokenMenu: ({
    enabled,
    skillNames,
  }: {
    enabled?: boolean;
    skillNames?: ReadonlySet<string>;
  }) => (
    <div
      data-testid="skill-token-menu"
      data-enabled={String(Boolean(enabled))}
      data-skill-count={skillNames?.size ?? 0}
    />
  ),
}));

vi.mock('@/components/wysiwyg/SelectionToolbar', () => ({
  SelectionToolbar: ({ enabled, aiShortcut }: { enabled?: boolean; aiShortcut?: string }) => (
    <div
      data-testid="selection-toolbar"
      data-enabled={String(Boolean(enabled))}
      data-ai-shortcut={aiShortcut ?? ''}
    />
  ),
}));

vi.mock('@/components/wysiwyg/LinkPopup', () => ({
  LinkPopup: ({ enabled }: { enabled?: boolean }) => (
    <div data-testid="link-popup" data-enabled={String(Boolean(enabled))} />
  ),
}));

vi.mock('@/components/wysiwyg/TableToolbar', () => ({
  TableToolbar: ({ enabled }: { enabled?: boolean }) => (
    <div data-testid="table-toolbar" data-enabled={String(Boolean(enabled))} />
  ),
}));

describe('WysiwygEditorChrome', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the Tiptap editor content mounted and enables WYSIWYG floating chrome', () => {
    const editor = { id: 'editor' } as never;

    render(
      <WysiwygEditorChrome
        editor={editor}
        enabled
        skillNames={new Set(['goal', 'git-commit'])}
        aiShortcut="⌘⇧K"
      />,
    );

    expect(screen.getByTestId('editor-content')).toHaveAttribute('data-editor-attached', 'true');
    expect(screen.getByTestId('slash-command-menu')).toHaveAttribute('data-enabled', 'true');
    expect(screen.getByTestId('slash-command-menu')).toHaveAttribute('data-skill-count', '2');
    expect(screen.getByTestId('skill-token-menu')).toHaveAttribute('data-enabled', 'true');
    expect(screen.getByTestId('skill-token-menu')).toHaveAttribute('data-skill-count', '2');
    expect(screen.getByTestId('selection-toolbar')).toHaveAttribute('data-enabled', 'true');
    expect(screen.getByTestId('selection-toolbar')).toHaveAttribute('data-ai-shortcut', '⌘⇧K');
    expect(screen.getByTestId('link-popup')).toHaveAttribute('data-enabled', 'true');
    expect(screen.getByTestId('table-toolbar')).toHaveAttribute('data-enabled', 'true');
  });

  it('leaves editor content mounted while disabling WYSIWYG-only chrome', () => {
    render(<WysiwygEditorChrome editor={null} enabled={false} />);

    expect(screen.getByTestId('editor-content')).toHaveAttribute('data-editor-attached', 'false');
    expect(screen.getByTestId('slash-command-menu')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('skill-token-menu')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('selection-toolbar')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('link-popup')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('table-toolbar')).toHaveAttribute('data-enabled', 'false');
  });
});
