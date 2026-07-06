import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShortcutsDialog } from './ShortcutsDialog';

function renderDialog(overrides: Record<string, string> = {}, onChange = vi.fn()) {
  render(
    <ShortcutsDialog
      open
      onOpenChange={vi.fn()}
      keybindingOverrides={overrides}
      onKeybindingOverridesChange={onChange}
    />,
  );
  return onChange;
}

function rowFor(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const row = cell.closest('tr');
  if (!row) throw new Error(`row for ${label} not found`);
  return row;
}

describe('ShortcutsDialog keymap', () => {
  afterEach(cleanup);

  it('renders the keymap table with effective bindings', () => {
    renderDialog({ 'file.newDocument': 'mod+shift+x' });

    const table = screen.getByTestId('keymap-table');
    expect(within(table).getByText('Toggle Sidebar')).toBeInTheDocument();
    expect(within(table).getByText('⌘⇧B')).toBeInTheDocument();
    // Overridden binding shows instead of the default ⌘N.
    expect(within(rowFor('New file')).getByText('⌘⇧X')).toBeInTheDocument();
    // Fixed rows render without an edit affordance.
    expect(
      within(rowFor('WYSIWYG mode')).queryByRole('button', { name: /edit shortcut/i }),
    ).toBeNull();
  });

  it('blocks saving a conflicting capture and warns in red', () => {
    const onChange = renderDialog();

    fireEvent.click(
      within(rowFor('New file')).getByRole('button', { name: /edit shortcut for new file/i }),
    );
    const recorder = screen.getByTestId('keymap-recorder');

    // ⌘S belongs to Save — conflict, no save possible.
    fireEvent.keyDown(recorder, { key: 's', metaKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent(/conflicts with .save./i);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();

    // ⌘C is reserved by the system.
    fireEvent.keyDown(recorder, { key: 'c', metaKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent(/copy \(system\)/i);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves a non-conflicting capture as an override', () => {
    const onChange = renderDialog();

    fireEvent.click(
      within(rowFor('New file')).getByRole('button', { name: /edit shortcut for new file/i }),
    );
    const recorder = screen.getByTestId('keymap-recorder');
    fireEvent.keyDown(recorder, { key: 'X', metaKey: true, shiftKey: true });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onChange).toHaveBeenCalledWith({ 'file.newDocument': 'mod+shift+x' });
  });

  it('removes the override when re-recording the default combination', () => {
    const onChange = renderDialog({ 'file.newDocument': 'mod+shift+x' });

    fireEvent.click(
      within(rowFor('New file')).getByRole('button', { name: /edit shortcut for new file/i }),
    );
    fireEvent.keyDown(screen.getByTestId('keymap-recorder'), { key: 'n', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it('resets an overridden binding back to its default', () => {
    const onChange = renderDialog({ 'file.newDocument': 'mod+shift+x' });

    fireEvent.click(
      within(rowFor('New file')).getByRole('button', { name: /reset shortcut for new file/i }),
    );

    expect(onChange).toHaveBeenCalledWith({});
  });
});
