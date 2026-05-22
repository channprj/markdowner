import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SidebarLayoutState } from '@/lib/sidebarState';
import { SidebarResizeHandle } from './SidebarResizeHandle';

type ResizeHandleLayout = Pick<
  SidebarLayoutState,
  | 'resizeHandleTabIndex'
  | 'resizeHandleInteractive'
  | 'resizeRailActive'
  | 'resizeRailHoverable'
>;

const openLayout: ResizeHandleLayout = {
  resizeHandleTabIndex: 0,
  resizeHandleInteractive: true,
  resizeRailActive: false,
  resizeRailHoverable: true,
};

const closedLayout: ResizeHandleLayout = {
  resizeHandleTabIndex: -1,
  resizeHandleInteractive: false,
  resizeRailActive: true,
  resizeRailHoverable: false,
};

function renderHandle(layout: ResizeHandleLayout = openLayout) {
  const props = {
    width: 312,
    layout,
    onPointerDown: vi.fn(),
    onResetWidth: vi.fn(),
    onKeyDown: vi.fn(),
  };

  render(<SidebarResizeHandle {...props} />);
  return props;
}

describe('SidebarResizeHandle', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the resize separator with accessible width metadata', () => {
    renderHandle();

    const separator = screen.getByRole('separator', { name: /resize sidebar/i });

    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuenow', '312');
    expect(separator).toHaveAttribute('aria-valuemin', '220');
    expect(separator).toHaveAttribute('aria-valuemax', '720');
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveClass('cursor-col-resize');
    expect(separator).toHaveStyle({ touchAction: 'none' });
    expect(separator.firstElementChild).toHaveClass('group-hover:bg-primary/60');
  });

  it('routes pointer, reset, and keyboard events to callers', () => {
    const props = renderHandle();
    const separator = screen.getByRole('separator', { name: /resize sidebar/i });

    fireEvent.pointerDown(separator);
    fireEvent.doubleClick(separator);
    fireEvent.keyDown(separator, { key: 'ArrowRight' });

    expect(props.onPointerDown).toHaveBeenCalled();
    expect(props.onResetWidth).toHaveBeenCalled();
    expect(props.onKeyDown).toHaveBeenCalled();
  });

  it('disables interaction affordances while the sidebar is collapsed', () => {
    renderHandle(closedLayout);

    const separator = screen.getByRole('separator', { name: /resize sidebar/i });

    expect(separator).toHaveAttribute('tabindex', '-1');
    expect(separator).toHaveClass('pointer-events-none');
    expect(separator.firstElementChild).toHaveClass('bg-primary');
    expect(separator.firstElementChild).not.toHaveClass('group-hover:bg-primary/60');
  });
});
