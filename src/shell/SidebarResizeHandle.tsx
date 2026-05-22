import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarLayoutState,
} from '@/lib/sidebarState';
import { cn } from '@/lib/utils';

type SidebarResizeHandleLayout = Pick<
  SidebarLayoutState,
  | 'resizeHandleTabIndex'
  | 'resizeHandleInteractive'
  | 'resizeRailActive'
  | 'resizeRailHoverable'
>;

interface SidebarResizeHandleProps {
  width: number;
  layout: SidebarResizeHandleLayout;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResetWidth: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export function SidebarResizeHandle({
  width,
  layout,
  onPointerDown,
  onResetWidth,
  onKeyDown,
}: SidebarResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      title="Drag to resize sidebar (double-click to reset, arrow keys to adjust)"
      tabIndex={layout.resizeHandleTabIndex}
      onPointerDown={onPointerDown}
      onDoubleClick={onResetWidth}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative h-full select-none',
        layout.resizeHandleInteractive ? 'cursor-col-resize' : 'pointer-events-none',
      )}
      style={{ touchAction: 'none' }}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border transition-colors',
          layout.resizeRailActive && 'bg-primary',
          layout.resizeRailHoverable && 'group-hover:bg-primary/60',
        )}
      />
    </div>
  );
}
