import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodeBlockView } from './CodeBlockView';

// Tiptap pulls in ProseMirror primitives in CodeBlockView.tsx only via the
// NodeView render helpers (which we stub below), so mocking @tiptap/react
// here keeps the test isolated from the full editor stack.
vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <div data-testid="node-view-wrapper" {...props}>
      {children}
    </div>
  ),
  NodeViewContent: (props: Record<string, unknown>) => <div data-testid="node-view-content" {...props} />,
}));

type ChainStub = {
  focus: ReturnType<typeof vi.fn>;
  setTextSelection: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
};

type EditorStub = {
  isEditable: boolean;
  chain: () => ChainStub;
};

function createChainStub(): ChainStub {
  const chain = {} as ChainStub;
  chain.focus = vi.fn(() => chain);
  chain.setTextSelection = vi.fn(() => chain);
  chain.run = vi.fn(() => true);
  return chain;
}

function renderView({
  language = null as string | null,
  editable = true,
  pos = 5,
}: { language?: string | null; editable?: boolean; pos?: number } = {}) {
  const chain = createChainStub();
  const editor: EditorStub = {
    isEditable: editable,
    chain: () => chain,
  };
  const updateAttributes = vi.fn();
  const getPos = vi.fn(() => pos);

  render(
    <CodeBlockView
      // The component only touches the fields we provide; cast at the boundary.
      node={{ attrs: { language } } as any}
      updateAttributes={updateAttributes}
      editor={editor as any}
      getPos={getPos as any}
      decorations={[] as any}
      selected={false}
      extension={{} as any}
      view={{} as any}
      innerDecorations={[] as any}
      HTMLAttributes={{}}
      deleteNode={vi.fn() as any}
    />,
  );

  return {
    chain,
    editor,
    updateAttributes,
    getPos,
    select: screen.getByLabelText(/code block language/i) as HTMLSelectElement,
  };
}

describe('CodeBlockView language picker', () => {
  afterEach(() => {
    cleanup();
  });

  it('cycles through languages starting with the same letter on repeated key presses', () => {
    const { select, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });

    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'javascript' });

    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'json' });

    // Wraps back to the first j-language after the last match.
    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });
  });

  it('resets the cycle when a different letter is pressed', () => {
    const { select, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });

    fireEvent.keyDown(select, { key: 'k' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'kotlin' });

    // Coming back to 'j' starts fresh from the first j-option, not from
    // wherever the previous j-cycle stopped.
    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });
  });

  it('treats Plain text (plaintext value) as null when a letter is matched', () => {
    const { select, updateAttributes } = renderView({ language: 'java' });

    fireEvent.keyDown(select, { key: 'p' });
    // Plain text maps to a null attribute so the fenced markdown emits no
    // language tag.
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: null });
  });

  it('passes ArrowDown through into the code body and ArrowUp back above the block', () => {
    const { select, chain } = renderView({ language: null, pos: 7 });

    fireEvent.keyDown(select, { key: 'ArrowDown' });
    expect(chain.setTextSelection).toHaveBeenLastCalledWith(8); // pos + 1
    expect(chain.run).toHaveBeenCalled();

    chain.setTextSelection.mockClear();
    chain.run.mockClear();
    fireEvent.keyDown(select, { key: 'ArrowUp' });
    expect(chain.setTextSelection).toHaveBeenLastCalledWith(6); // pos − 1
    expect(chain.run).toHaveBeenCalled();
  });

  it('does not run typeahead while a modifier key is held', () => {
    const { select, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(select, { key: 'j', metaKey: true });
    expect(updateAttributes).not.toHaveBeenCalled();

    fireEvent.keyDown(select, { key: 'j', ctrlKey: true });
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('does not run typeahead when no language starts with the pressed letter', () => {
    const { select, updateAttributes } = renderView({ language: 'java' });

    // No language label starts with 'z' in CODE_BLOCK_LANGUAGES.
    fireEvent.keyDown(select, { key: 'z' });
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('opens the dropdown via showPicker when Enter is pressed on the focused select', () => {
    const { select } = renderView({ language: null });
    // jsdom does not implement showPicker; stub it so we can assert the call.
    const showPicker = vi.fn();
    Object.defineProperty(select, 'showPicker', {
      configurable: true,
      value: showPicker,
    });

    fireEvent.keyDown(select, { key: 'Enter' });
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('swallows the showPicker NotAllowedError so Enter never throws into React', () => {
    const { select } = renderView({ language: null });
    const showPicker = vi.fn(() => {
      throw new DOMException('NotAllowedError', 'NotAllowedError');
    });
    Object.defineProperty(select, 'showPicker', {
      configurable: true,
      value: showPicker,
    });

    expect(() => fireEvent.keyDown(select, { key: 'Enter' })).not.toThrow();
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('resets the cycle after the select loses focus', () => {
    const { select, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });

    fireEvent.blur(select);

    // Returning to the picker and pressing 'j' again starts a fresh cycle.
    fireEvent.keyDown(select, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });
  });
});
