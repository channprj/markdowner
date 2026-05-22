import type { EditorMode } from './desktop';

type SourceSurfaceView = {
  dom: HTMLElement;
  posAtCoords: (coords: { x: number; y: number }, precise: boolean) => number | null;
  state: {
    doc: {
      length: number;
    };
  };
};

export type SourceSurfaceMouseDownAction =
  | { kind: 'ignore' }
  | { kind: 'focusSource'; position: number };

export function resolveSourceSurfaceMouseDown({
  currentMode,
  view,
  target,
  clientX,
  clientY,
}: {
  currentMode: EditorMode;
  view: SourceSurfaceView | null;
  target: Node | null;
  clientX: number;
  clientY: number;
}): SourceSurfaceMouseDownAction {
  if (!view) return { kind: 'ignore' };
  if (currentMode !== 'Editor' && currentMode !== 'SplitView') return { kind: 'ignore' };
  if (!target) return { kind: 'ignore' };
  if (view.dom.contains(target)) return { kind: 'ignore' };

  return {
    kind: 'focusSource',
    position: view.posAtCoords({ x: clientX, y: clientY }, false) ?? view.state.doc.length,
  };
}
