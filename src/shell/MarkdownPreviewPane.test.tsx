import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownPreviewPane } from './MarkdownPreviewPane';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

describe('MarkdownPreviewPane', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders preview markdown inside the shared themed markdown surface', () => {
    const { container } = render(
      <MarkdownPreviewPane
        source={[
          '# Preview title',
          '',
          '| Name | Value |',
          '| --- | --- |',
          '| Alpha | 1 |',
        ].join('\n')}
      />,
    );

    const surface = screen.getByTestId('markdown-preview-pane');
    const heading = screen.getByRole('heading', { name: 'Preview title' });

    expect(surface).toHaveClass('markdown-surface', 'markdowner-content');
    expect(heading).toHaveAttribute('data-source-line', '1');
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('renders gfm task lists with checkboxes the task-list styles can match', () => {
    const { container } = render(
      <MarkdownPreviewPane source={['- [ ] open item', '- [x] done item'].join('\n')} />,
    );

    const list = container.querySelector('ul.contains-task-list');
    expect(list).toBeInTheDocument();
    const checkboxes = container.querySelectorAll(
      'li.task-list-item > input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(2);
  });

  it('highlights fenced code through the shared lowlight registry', () => {
    const { container } = render(
      <MarkdownPreviewPane
        source={['```ts', 'const value = 42;', '```'].join('\n')}
      />,
    );

    // Same DOM shape as the WYSIWYG node view so the data-cb-theme palettes
    // color the preview identically.
    const wrapper = container.querySelector('.code-block-view');
    expect(wrapper).toBeInTheDocument();
    const code = wrapper?.querySelector('pre > code.hljs');
    expect(code).toBeInTheDocument();
    expect(code?.querySelector('.hljs-keyword')?.textContent).toBe('const');
  });

  it('renders README images and badges with GitHub-compatible source handling', () => {
    render(
      <MarkdownPreviewPane
        activeDocumentPath="/tmp/markdowner/README.md"
        source={[
          '![Open graph](./assets/images/og.png)',
          '',
          '![MIT](https://img.shields.io/badge/license-MIT-2ea44f)',
        ].join('\n')}
      />,
    );

    expect(screen.getByAltText('Open graph')).toHaveAttribute(
      'src',
      'asset:///tmp/markdowner/assets/images/og.png',
    );
    expect(screen.getByAltText('MIT')).toHaveAttribute(
      'src',
      'https://img.shields.io/badge/license-MIT-2ea44f',
    );
  });
});
