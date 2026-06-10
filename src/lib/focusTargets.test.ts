import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  focusActiveEditor,
  focusExplorerFilter,
  focusExplorerTree,
  focusOutlineTree,
} from './focusTargets';

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Manually-driven requestAnimationFrame stub: callbacks queue up and run one
 * frame at a time via flush(), so tests can mount elements between frames.
 */
function createFrameQueue() {
  const callbacks: FrameRequestCallback[] = [];
  return {
    requestFrame(callback: FrameRequestCallback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    flush() {
      const callback = callbacks.shift();
      callback?.(0);
    },
    get pending() {
      return callbacks.length;
    },
  };
}

function appendWysiwygSurface() {
  const surface = document.createElement('div');
  surface.dataset.testid = 'editor-surface-wysiwyg';
  const proseMirror = document.createElement('div');
  proseMirror.className = 'ProseMirror';
  proseMirror.tabIndex = -1;
  surface.appendChild(proseMirror);
  document.body.appendChild(surface);
  return proseMirror;
}

function appendButton(attributes: Record<string, string>, text = 'button') {
  const button = document.createElement('button');
  button.textContent = text;
  for (const [key, value] of Object.entries(attributes)) {
    button.setAttribute(key, value);
  }
  document.body.appendChild(button);
  return button;
}

describe('focusExplorerTree', () => {
  it('restores the remembered explorer element when it is still connected', () => {
    const root = document.createElement('aside');
    root.dataset.explorerRoot = '';
    const remembered = document.createElement('button');
    root.appendChild(remembered);
    document.body.appendChild(root);

    expect(focusExplorerTree(remembered)).toBe(true);
    expect(document.activeElement).toBe(remembered);
  });

  it('falls back to the first explorer workspace row', () => {
    const root = document.createElement('aside');
    root.dataset.explorerRoot = '';
    const tree = document.createElement('div');
    tree.dataset.testid = 'explorer-workspace-tree';
    const row = document.createElement('button');
    tree.appendChild(row);
    root.appendChild(tree);
    document.body.appendChild(root);

    expect(focusExplorerTree(null)).toBe(true);
    expect(document.activeElement).toBe(row);
  });
});

describe('focusOutlineTree', () => {
  it('restores the remembered outline row when available', () => {
    const root = document.createElement('nav');
    root.dataset.outlineRoot = '';
    const remembered = document.createElement('button');
    root.appendChild(remembered);
    document.body.appendChild(root);

    expect(focusOutlineTree(remembered)).toBe(true);
    expect(document.activeElement).toBe(remembered);
  });

  it('falls back to the outline root when no row exists', () => {
    const root = document.createElement('nav');
    root.dataset.outlineRoot = '';
    root.tabIndex = -1;
    document.body.appendChild(root);

    expect(focusOutlineTree(null)).toBe(true);
    expect(document.activeElement).toBe(root);
  });
});

describe('focusExplorerFilter', () => {
  it('focuses and selects the explorer filter input on the next frame', () => {
    const root = document.createElement('aside');
    root.dataset.explorerRoot = '';
    const input = document.createElement('input');
    input.dataset.explorerFilter = '';
    input.value = 'draft';
    root.appendChild(input);
    document.body.appendChild(root);
    const select = vi.spyOn(input, 'select');

    focusExplorerFilter({
      requestFrame: (callback) => {
        callback(0);
        return 0;
      },
    });

    expect(document.activeElement).toBe(input);
    expect(select).toHaveBeenCalled();
  });
});

describe('focusActiveEditor', () => {
  it('focuses the WYSIWYG ProseMirror surface in WYSIWYG mode', () => {
    const proseMirror = appendWysiwygSurface();

    expect(
      focusActiveEditor({
        currentMode: 'Wysiwyg',
        sourceEditorView: null,
        sourceEditorContainer: null,
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(proseMirror);
  });

  it('focuses CodeMirror before falling back to the source textarea', () => {
    const sourceEditorView = {
      focus: vi.fn(),
    };

    expect(
      focusActiveEditor({
        currentMode: 'Editor',
        sourceEditorView,
        sourceEditorContainer: null,
      }),
    ).toBe(true);
    expect(sourceEditorView.focus).toHaveBeenCalled();
  });

  it('falls back to a textarea in the source editor container', () => {
    const container = document.createElement('div');
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);
    document.body.appendChild(container);

    expect(
      focusActiveEditor({
        currentMode: 'SplitView',
        sourceEditorView: null,
        sourceEditorContainer: container,
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(textarea);
  });

  it('retries until the WYSIWYG surface mounts on a later frame', () => {
    const frames = createFrameQueue();

    expect(
      focusActiveEditor({
        currentMode: 'Wysiwyg',
        sourceEditorView: null,
        sourceEditorContainer: null,
        requestFrame: frames.requestFrame,
      }),
    ).toBe(false);

    // Surface is still missing for a couple of frames.
    frames.flush();
    frames.flush();
    expect(document.activeElement).toBe(document.body);

    const proseMirror = appendWysiwygSurface();
    frames.flush();

    expect(document.activeElement).toBe(proseMirror);
    // Loop stops early on success instead of burning the remaining budget.
    expect(frames.pending).toBe(0);
  });

  it('gives up after the bounded frame budget', () => {
    const frames = createFrameQueue();

    focusActiveEditor({
      currentMode: 'Wysiwyg',
      sourceEditorView: null,
      sourceEditorContainer: null,
      requestFrame: frames.requestFrame,
    });

    let flushed = 0;
    while (frames.pending > 0 && flushed < 50) {
      frames.flush();
      flushed += 1;
    }
    expect(flushed).toBe(10);
  });

  it('stops retrying when another element takes focus mid-loop', () => {
    const outsider = document.createElement('input');
    document.body.appendChild(outsider);
    const frames = createFrameQueue();

    focusActiveEditor({
      currentMode: 'Wysiwyg',
      sourceEditorView: null,
      sourceEditorContainer: null,
      requestFrame: frames.requestFrame,
    });
    frames.flush();

    // The user moves focus elsewhere while we are still waiting.
    outsider.focus();
    frames.flush();
    expect(frames.pending).toBe(0);

    // Even once the surface mounts, focus stays where the user put it.
    appendWysiwygSurface();
    expect(document.activeElement).toBe(outsider);
  });

  it('keeps retrying when focus held before the first attempt is unchanged', () => {
    // E.g. the Explorer row the user clicked still has focus; that must not
    // count as the user stealing focus mid-loop.
    const explorerButton = appendButton({});
    explorerButton.focus();
    const frames = createFrameQueue();

    focusActiveEditor({
      currentMode: 'Wysiwyg',
      sourceEditorView: null,
      sourceEditorContainer: null,
      requestFrame: frames.requestFrame,
    });
    frames.flush();

    const proseMirror = appendWysiwygSurface();
    frames.flush();
    expect(document.activeElement).toBe(proseMirror);
  });

  it('verifies CodeMirror focus landed inside the source container and retries until it does', () => {
    const container = document.createElement('div');
    const content = document.createElement('div');
    content.tabIndex = -1;
    container.appendChild(content);
    document.body.appendChild(container);

    // Simulate a hidden CodeMirror view: focus() is ignored until visible.
    let visible = false;
    const sourceEditorView = {
      focus: vi.fn(() => {
        if (visible) content.focus();
      }),
    };
    const frames = createFrameQueue();

    expect(
      focusActiveEditor({
        currentMode: 'Editor',
        sourceEditorView,
        sourceEditorContainer: container,
        requestFrame: frames.requestFrame,
      }),
    ).toBe(false);
    expect(document.activeElement).not.toBe(content);

    frames.flush();
    visible = true;
    frames.flush();

    expect(document.activeElement).toBe(content);
    expect(frames.pending).toBe(0);
  });

  it('returns true synchronously when CodeMirror focus lands inside the container', () => {
    const container = document.createElement('div');
    const content = document.createElement('div');
    content.tabIndex = -1;
    container.appendChild(content);
    document.body.appendChild(container);

    expect(
      focusActiveEditor({
        currentMode: 'Editor',
        sourceEditorView: { focus: () => content.focus() },
        sourceEditorContainer: container,
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(content);
  });
});
