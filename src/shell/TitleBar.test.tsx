import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TitleBar } from './TitleBar';

function renderTitleBar() {
  const props = {
    onStartWindowDrag: vi.fn(),
  };

  const { container } = render(
    <TitleBar
      onStartWindowDrag={props.onStartWindowDrag}
      menu={<button type="button">App menu</button>}
    />,
  );

  return { ...props, container };
}

describe('TitleBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders fixed titlebar drag regions and the menu slot', () => {
    const { container } = renderTitleBar();

    const titlebar = screen.getByTestId('app-titlebar');
    const dragRegions = container.querySelectorAll('[data-tauri-drag-region]');

    expect(titlebar).toHaveClass('h-[35px]');
    expect(dragRegions).toHaveLength(2);
    expect(dragRegions[0]).toHaveClass('w-20');
    expect(screen.getByTestId('app-titlebar-drag-region')).toHaveClass('flex-1');
    expect(within(titlebar).getByRole('button', { name: /^app menu$/i })).toBeInTheDocument();
  });

  it('places the tab strip between the drag regions, ahead of the menu', () => {
    render(
      <TitleBar
        onStartWindowDrag={vi.fn()}
        tabs={<div role="tablist" aria-label="Open documents" />}
        menu={<button type="button">App menu</button>}
      />,
    );

    const titlebar = screen.getByTestId('app-titlebar');
    expect(Array.from(titlebar.children)).toEqual([
      titlebar.querySelector('.w-20'),
      screen.getByRole('tablist', { name: /open documents/i }),
      screen.getByTestId('app-titlebar-drag-region'),
      screen.getByRole('button', { name: /^app menu$/i }),
    ]);
  });

  it('routes pointer down from both drag regions', () => {
    const { container, onStartWindowDrag } = renderTitleBar();
    const dragRegions = container.querySelectorAll('[data-tauri-drag-region]');

    fireEvent.pointerDown(dragRegions[0], { button: 0 });
    fireEvent.pointerDown(dragRegions[1], { button: 0 });

    expect(onStartWindowDrag).toHaveBeenCalledTimes(2);
  });
});
