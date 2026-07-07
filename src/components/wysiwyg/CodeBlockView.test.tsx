import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodeBlockView } from './CodeBlockView';

const mocks = vi.hoisted(() => ({
  renderMermaidDiagramSvg: vi.fn(async () => ({
    svg: '<svg data-testid="mock-mermaid-svg" viewBox="0 0 120 80"><text>Rendered flow</text></svg>',
    bindFunctions: undefined,
  })),
}));

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

vi.mock('./mermaidRenderer', () => ({
  renderMermaidDiagramSvg: mocks.renderMermaidDiagramSvg,
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
  textContent = '',
}: { language?: string | null; editable?: boolean; pos?: number; textContent?: string } = {}) {
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
      node={{ attrs: { language }, textContent } as any}
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
    trigger: screen.getByLabelText(/code block language/i) as HTMLButtonElement,
  };
}

describe('CodeBlockView language picker', () => {
  afterEach(() => {
    cleanup();
    mocks.renderMermaidDiagramSvg.mockClear();
  });

  it('cycles through languages starting with the same letter on repeated key presses', () => {
    const { trigger, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });

    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'javascript' });

    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'json' });

    // Wraps back to the first j-language after the last match.
    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });
  });

  it('resets the cycle when a different letter is pressed', () => {
    const { trigger, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });

    fireEvent.keyDown(trigger, { key: 'k' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'kotlin' });

    // Coming back to 'j' starts fresh from the first j-option, not from
    // wherever the previous j-cycle stopped.
    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });
  });

  it('treats Plain text (plaintext value) as null when a letter is matched', () => {
    const { trigger, updateAttributes } = renderView({ language: 'java' });

    fireEvent.keyDown(trigger, { key: 'p' });
    // Plain text maps to a null attribute so the fenced markdown emits no
    // language tag.
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: null });
  });

  it('passes ArrowDown through into the code body and ArrowUp back above the block', () => {
    const { trigger, chain } = renderView({ language: null, pos: 7 });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(chain.setTextSelection).toHaveBeenLastCalledWith(8); // pos + 1
    expect(chain.run).toHaveBeenCalled();

    chain.setTextSelection.mockClear();
    chain.run.mockClear();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(chain.setTextSelection).toHaveBeenLastCalledWith(6); // pos − 1
    expect(chain.run).toHaveBeenCalled();
  });

  it('does not run typeahead while a modifier key is held', () => {
    const { trigger, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: 'j', metaKey: true });
    expect(updateAttributes).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger, { key: 'j', ctrlKey: true });
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('does not run typeahead when no language starts with the pressed letter', () => {
    const { trigger, updateAttributes } = renderView({ language: 'java' });

    // No language label starts with 'z' in CODE_BLOCK_LANGUAGES.
    fireEvent.keyDown(trigger, { key: 'z' });
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('opens the language listbox when Enter is pressed on the focused trigger', async () => {
    const { trigger } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: 'Enter' });

    // findByRole reaches into document.body, so it finds the portaled listbox.
    const listbox = await screen.findByRole('listbox', { name: /code block language/i });
    expect(listbox).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the language listbox when Space is pressed on the focused trigger', async () => {
    const { trigger } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: ' ' });

    const listbox = await screen.findByRole('listbox', { name: /code block language/i });
    expect(listbox).toBeInTheDocument();
  });

  it('applies the highlighted option and closes the listbox on Enter', async () => {
    const { trigger, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox', { name: /code block language/i });

    // Active starts at the current language (Plain text → index 0). One
    // ArrowDown moves to Bash, then Enter commits.
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'bash' });
    expect(screen.queryByRole('listbox', { name: /code block language/i })).toBeNull();
  });

  it('Escape inside the listbox dismisses it without changing the language', async () => {
    const { trigger, updateAttributes } = renderView({ language: 'java' });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox', { name: /code block language/i });
    fireEvent.keyDown(listbox, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: /code block language/i })).toBeNull();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('clicking an option commits its language and closes the listbox', async () => {
    const { trigger, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox', { name: /code block language/i });

    const ruby = within(listbox).getByRole('option', { name: 'Ruby' });
    fireEvent.mouseDown(ruby);

    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'ruby' });
    expect(screen.queryByRole('listbox', { name: /code block language/i })).toBeNull();
  });

  it('does not open the listbox when the trigger is disabled', () => {
    const { trigger } = renderView({ language: null, editable: false });

    expect(trigger).toBeDisabled();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByRole('listbox', { name: /code block language/i })).toBeNull();
  });

  it('renders Mermaid code blocks as diagrams before the editable source', async () => {
    renderView({
      language: 'mermaid',
      textContent: 'flowchart TD\n  A[Draft] --> B[Preview]\n',
    });

    expect(
      await screen.findByRole('img', { name: /rendered mermaid diagram/i }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('mermaid-diagram-svg')).toBeInTheDocument();
    expect(screen.getByTestId('mock-mermaid-svg')).toBeInTheDocument();
    expect(mocks.renderMermaidDiagramSvg).toHaveBeenCalledWith(
      expect.stringMatching(/^markdowner-mermaid-\d+$/),
      'flowchart TD\n  A[Draft] --> B[Preview]',
    );
    expect(screen.getByText('Mermaid')).toBeInTheDocument();
    expect(screen.getByText(/mermaid source/i)).toBeInTheDocument();
    expect(screen.getByTestId('node-view-content')).toBeInTheDocument();
  });

  it('resets the cycle after the trigger loses focus', () => {
    const { trigger, updateAttributes } = renderView({ language: null });

    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });

    fireEvent.blur(trigger);

    // Returning to the picker and pressing 'j' again starts a fresh cycle.
    fireEvent.keyDown(trigger, { key: 'j' });
    expect(updateAttributes).toHaveBeenLastCalledWith({ language: 'java' });
  });
});
