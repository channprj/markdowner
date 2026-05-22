import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceTree } from './WorkspaceTree';
import type { WorkspaceTreeNode } from '@/lib/workspaceTree';

const tree: WorkspaceTreeNode[] = [
  {
    kind: 'folder',
    key: 'guides',
    name: 'guides',
    children: [
      {
        kind: 'file',
        key: '/tmp/project/guides/draft.md',
        path: '/tmp/project/guides/draft.md',
        name: 'draft.md',
        relativePath: 'guides/draft.md',
      },
    ],
  },
  {
    kind: 'file',
    key: '/tmp/project/README.md',
    path: '/tmp/project/README.md',
    name: 'README.md',
    relativePath: 'README.md',
  },
];

describe('WorkspaceTree', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders folders and files with active file highlighting', () => {
    render(
      <WorkspaceTree
        nodes={tree}
        activePath="/tmp/project/README.md"
        collapsedKeys={[]}
        filtering={false}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /guides/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /draft\.md/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /README\.md/i })).toHaveClass(
      'bg-accent',
    );
  });

  it('hides collapsed folder children unless filtering is active', () => {
    const { rerender } = render(
      <WorkspaceTree
        nodes={tree}
        activePath={null}
        collapsedKeys={['guides']}
        filtering={false}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /guides/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: /draft\.md/i })).not.toBeInTheDocument();

    rerender(
      <WorkspaceTree
        nodes={tree}
        activePath={null}
        collapsedKeys={['guides']}
        filtering={true}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /guides/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /draft\.md/i })).toBeInTheDocument();
  });

  it('routes folder toggles and file opens', () => {
    const onToggleFolder = vi.fn();
    const onOpenFile = vi.fn();

    render(
      <WorkspaceTree
        nodes={tree}
        activePath={null}
        collapsedKeys={[]}
        filtering={false}
        onToggleFolder={onToggleFolder}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /guides/i }));
    fireEvent.click(screen.getByRole('button', { name: /draft\.md/i }));

    expect(onToggleFolder).toHaveBeenCalledWith('guides');
    expect(onOpenFile).toHaveBeenCalledWith('/tmp/project/guides/draft.md');
    expect(
      within(screen.getByRole('button', { name: /draft\.md/i })).getByText(
        'guides/draft.md',
      ),
    ).toHaveClass('sr-only');
  });
});
