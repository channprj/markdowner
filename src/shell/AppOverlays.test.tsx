import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppOverlays } from './AppOverlays';
import type { AppOverlaysProps } from './AppOverlays';
import type { CommandPaletteCommand } from './CommandPalette';
import type { QuickOpenItem } from './QuickOpen';
import type { DocumentStats } from '@/lib/documentStats';

type QuickOpenMockProps = {
  open: AppOverlaysProps['quickOpenOpen'];
  items: AppOverlaysProps['quickOpenItems'];
  onOpenChange: AppOverlaysProps['onQuickOpenOpenChange'];
  onSelect: AppOverlaysProps['onQuickOpenSelect'];
};
type CommandPaletteMockProps = {
  open: AppOverlaysProps['commandPaletteOpen'];
  commands: AppOverlaysProps['commandPaletteCommands'];
  onOpenChange: AppOverlaysProps['onCommandPaletteOpenChange'];
};
type DocumentStatsMockProps = {
  open: AppOverlaysProps['documentStatsOpen'];
  documentName: AppOverlaysProps['documentName'];
  documentPath: AppOverlaysProps['documentPath'];
  stats: AppOverlaysProps['stats'];
  onOpenChange: AppOverlaysProps['onDocumentStatsOpenChange'];
};
type ShortcutsMockProps = {
  open: AppOverlaysProps['shortcutsOpen'];
  onOpenChange: AppOverlaysProps['onShortcutsOpenChange'];
};

vi.mock('./QuickOpen', () => ({
  QuickOpen: ({ open, items, onOpenChange, onSelect }: QuickOpenMockProps) => (
    <section data-testid="quick-open" data-open={String(open)}>
      <span data-testid="quick-open-count">{items.length}</span>
      <button type="button" onClick={() => onSelect(items[0]?.path)}>
        Select quick item
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close quick open
      </button>
    </section>
  ),
}));

vi.mock('./CommandPalette', () => ({
  CommandPalette: ({ open, commands, onOpenChange }: CommandPaletteMockProps) => (
    <section data-testid="command-palette" data-open={String(open)}>
      <span data-testid="command-count">{commands.length}</span>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close command palette
      </button>
    </section>
  ),
}));

vi.mock('./DocumentStatsDialog', () => ({
  DocumentStatsDialog: ({
    open,
    documentName,
    documentPath,
    stats,
    onOpenChange,
  }: DocumentStatsMockProps) => (
    <section
      data-testid="document-stats-dialog"
      data-open={String(open)}
      data-document-name={documentName}
      data-document-path={documentPath}
      data-words={String(stats.words)}
    >
      <button type="button" onClick={() => onOpenChange(false)}>
        Close stats
      </button>
    </section>
  ),
}));

vi.mock('./ShortcutsDialog', () => ({
  ShortcutsDialog: ({ open, onOpenChange }: ShortcutsMockProps) => (
    <section data-testid="shortcuts-dialog" data-open={String(open)}>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close shortcuts
      </button>
    </section>
  ),
}));

const quickOpenItems: QuickOpenItem[] = [
  {
    path: '/tmp/project/docs/readme.md',
    name: 'readme.md',
    relativePath: 'docs/readme.md',
    kind: 'workspace',
  },
];

const commands: CommandPaletteCommand[] = [
  {
    id: 'save',
    label: 'Save',
    run: () => {},
  },
];

const stats: DocumentStats = {
  words: 42,
  characters: 240,
  readingTimeMinutes: 1,
  headings: 2,
  links: 1,
  images: 0,
  tables: 0,
};

describe('AppOverlays', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders every app overlay and forwards their view state', () => {
    render(
      <AppOverlays
        quickOpenOpen
        onQuickOpenOpenChange={() => {}}
        quickOpenItems={quickOpenItems}
        onQuickOpenSelect={() => {}}
        commandPaletteOpen={false}
        onCommandPaletteOpenChange={() => {}}
        commandPaletteCommands={commands}
        documentStatsOpen
        onDocumentStatsOpenChange={() => {}}
        documentName="readme.md"
        documentPath="/tmp/project/docs/readme.md"
        stats={stats}
        shortcutsOpen={false}
        onShortcutsOpenChange={() => {}}
        defaultAppPromptOpen={false}
        onDefaultAppPromptOpenChange={() => {}}
        onMakeDefaultApp={() => {}}
        onSkipDefaultAppPrompt={() => {}}
      />,
    );

    expect(screen.getByTestId('quick-open')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('quick-open-count')).toHaveTextContent('1');
    expect(screen.getByTestId('command-palette')).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('command-count')).toHaveTextContent('1');
    expect(screen.getByTestId('document-stats-dialog')).toHaveAttribute(
      'data-document-name',
      'readme.md',
    );
    expect(screen.getByTestId('document-stats-dialog')).toHaveAttribute(
      'data-document-path',
      '/tmp/project/docs/readme.md',
    );
    expect(screen.getByTestId('document-stats-dialog')).toHaveAttribute('data-words', '42');
    expect(screen.getByTestId('shortcuts-dialog')).toHaveAttribute('data-open', 'false');
  });

  it('keeps overlay callbacks owned by App while grouping their render surface', () => {
    const onQuickOpenChange = vi.fn();
    const onQuickOpenSelect = vi.fn();
    const onCommandPaletteChange = vi.fn();
    const onDocumentStatsChange = vi.fn();
    const onShortcutsChange = vi.fn();
    const onDefaultAppPromptChange = vi.fn();
    const onMakeDefaultApp = vi.fn();
    const onSkipDefaultAppPrompt = vi.fn();

    render(
      <AppOverlays
        quickOpenOpen
        onQuickOpenOpenChange={onQuickOpenChange}
        quickOpenItems={quickOpenItems}
        onQuickOpenSelect={onQuickOpenSelect}
        commandPaletteOpen
        onCommandPaletteOpenChange={onCommandPaletteChange}
        commandPaletteCommands={commands}
        documentStatsOpen
        onDocumentStatsOpenChange={onDocumentStatsChange}
        documentName="readme.md"
        documentPath="/tmp/project/docs/readme.md"
        stats={stats}
        shortcutsOpen
        onShortcutsOpenChange={onShortcutsChange}
        defaultAppPromptOpen={false}
        onDefaultAppPromptOpenChange={onDefaultAppPromptChange}
        onMakeDefaultApp={onMakeDefaultApp}
        onSkipDefaultAppPrompt={onSkipDefaultAppPrompt}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select quick item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close quick open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close command palette' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close stats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close shortcuts' }));

    expect(onQuickOpenSelect).toHaveBeenCalledWith('/tmp/project/docs/readme.md');
    expect(onQuickOpenChange).toHaveBeenCalledWith(false);
    expect(onCommandPaletteChange).toHaveBeenCalledWith(false);
    expect(onDocumentStatsChange).toHaveBeenCalledWith(false);
    expect(onShortcutsChange).toHaveBeenCalledWith(false);
  });
});
