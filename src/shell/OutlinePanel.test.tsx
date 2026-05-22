import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OutlinePanel } from './OutlinePanel';
import type { OutlineItem } from '@/lib/outline';

const outlineItems: OutlineItem[] = [
  {
    id: 'intro',
    title: 'Intro',
    depth: 1,
    titleStart: 2,
    titleEnd: 7,
    selectionStart: 0,
    selectionEnd: 7,
  },
  {
    id: 'details',
    title: 'Details',
    depth: 3,
    titleStart: 13,
    titleEnd: 20,
    selectionStart: 10,
    selectionEnd: 20,
  },
];

function renderOutlinePanel(
  overrides: Partial<Parameters<typeof OutlinePanel>[0]> = {},
) {
  const props = {
    items: outlineItems,
    busy: false,
    fontSize: 13,
    rowSpacing: 3,
    onSelectItem: vi.fn(),
    ...overrides,
  };

  render(<OutlinePanel {...props} />);
  return props;
}

describe('OutlinePanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders empty state when no headings exist', () => {
    renderOutlinePanel({ items: [] });

    expect(screen.getByText('No headings')).toBeInTheDocument();
    expect(screen.queryByTestId('outline-list')).not.toBeInTheDocument();
  });

  it('renders outline rows with density styles and selection callbacks', () => {
    const props = renderOutlinePanel();

    const intro = screen.getByRole('button', { name: 'Intro' });
    const details = screen.getByRole('button', { name: 'Details' });

    expect(screen.getByTestId('outline-list')).toHaveStyle({ gap: '3px' });
    expect(intro).toHaveStyle({
      fontSize: '13px',
      paddingTop: '5px',
      paddingBottom: '5px',
      paddingLeft: '8px',
    });
    expect(details).toHaveStyle({ paddingLeft: '32px' });

    fireEvent.click(details);

    expect(props.onSelectItem).toHaveBeenCalledWith(outlineItems[1]);
  });

  it('disables rows while busy', () => {
    renderOutlinePanel({ busy: true });

    expect(screen.getByRole('button', { name: 'Intro' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Details' })).toBeDisabled();
  });

  it('supports keyboard navigation and Enter activation', () => {
    const props = renderOutlinePanel();
    const intro = screen.getByRole('button', { name: 'Intro' });
    const details = screen.getByRole('button', { name: 'Details' });

    intro.focus();
    fireEvent.keyDown(intro, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(details);

    fireEvent.keyDown(details, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(intro);

    fireEvent.keyDown(intro, { key: 'Enter' });
    expect(props.onSelectItem).toHaveBeenCalledWith(outlineItems[0]);
  });
});
