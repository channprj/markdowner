import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette, type CommandPaletteCommand } from './CommandPalette';

const SUBMENU_PLACEHOLDER = 'Select a code block theme…';

function buildCommands(spies: {
  preview: (value: string) => void;
  commit: (value: string) => void;
  cancel: () => void;
}): CommandPaletteCommand[] {
  return [
    { id: 'root.alpha', label: 'Alpha', category: 'Root', run: vi.fn() },
    {
      id: 'theme.codeBlockTheme',
      label: 'Change Code Block Theme…',
      category: 'Theme',
      submenu: {
        title: 'Code Block Theme',
        placeholder: SUBMENU_PLACEHOLDER,
        initialSelectedId: 'cb.two',
        onCancel: spies.cancel,
        items: [
          { id: 'cb.one', label: 'One', preview: () => spies.preview('one'), run: () => spies.commit('one') },
          { id: 'cb.two', label: 'Two', preview: () => spies.preview('two'), run: () => spies.commit('two') },
          { id: 'cb.three', label: 'Three', preview: () => spies.preview('three'), run: () => spies.commit('three') },
        ],
      },
    },
  ];
}

function openSubmenu(spies: Parameters<typeof buildCommands>[0], onOpenChange = vi.fn()) {
  render(<CommandPalette open onOpenChange={onOpenChange} commands={buildCommands(spies)} />);
  fireEvent.click(screen.getByText('Change Code Block Theme…'));
  return onOpenChange;
}

describe('CommandPalette submenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('dims the editor behind the palette without blurring live previews', () => {
    const spies = { preview: vi.fn(), commit: vi.fn(), cancel: vi.fn() };

    render(<CommandPalette open onOpenChange={vi.fn()} commands={buildCommands(spies)} />);

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toHaveClass('bg-black/35');
    expect(overlay).toHaveClass('supports-backdrop-filter:backdrop-blur-none');
  });

  it('opens the nested theme list and previews the initial selection', () => {
    const spies = { preview: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
    openSubmenu(spies);

    // Breadcrumb + nested items render; the root list is replaced.
    expect(screen.getByText('Code Block Theme')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SUBMENU_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();

    // initialSelectedId (cb.two) is highlighted and previewed on open.
    expect(spies.preview).toHaveBeenLastCalledWith('two');
  });

  it('live-previews on arrow navigation and commits on Enter', () => {
    const spies = { preview: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
    const onOpenChange = openSubmenu(spies);
    const input = screen.getByPlaceholderText(SUBMENU_PLACEHOLDER);

    // From the initial highlight (cb.two) move down to cb.three → preview fires.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(spies.preview).toHaveBeenLastCalledWith('three');

    // Enter commits the highlighted theme and closes the palette.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spies.commit).toHaveBeenCalledWith('three');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('returns to the root list on Escape and reverts the preview without closing', () => {
    const spies = { preview: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
    const onOpenChange = openSubmenu(spies);
    const input = screen.getByPlaceholderText(SUBMENU_PLACEHOLDER);

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(spies.cancel).toHaveBeenCalledTimes(1);
    // Back at the root list; the palette stays open.
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Code Block Theme')).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(spies.commit).not.toHaveBeenCalled();
  });
});
