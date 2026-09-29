import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import gfmContractFixture from '../../tests/fixtures/gfm-contract.md?raw';
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

  it('follows footnote references and backlinks inside this preview', () => {
    const parentClick = vi.fn();
    const { container } = render(<div onClick={parentClick}><MarkdownPreviewPane source={'Text[^report] again[^report].\n\n[^report]: **출처**.'} /></div>);
    const reference = container.querySelector<HTMLAnchorElement>('a[data-footnote-ref]')!;
    const definition = container.querySelector<HTMLElement>('li[id="user-content-fn-report"]')!;
    const scroll = vi.fn();
    definition.scrollIntoView = scroll;
    fireEvent.click(reference);
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(definition);
    expect(parentClick).not.toHaveBeenCalled();
    const backref = definition.querySelector<HTMLAnchorElement>('a[data-footnote-backref]')!;
    reference.scrollIntoView = vi.fn();
    fireEvent.click(backref);
    expect(document.activeElement).toBe(reference);
  });

  it('renders the complete authoring heading hierarchy as semantic h1 through h4', () => {
    const { container } = render(
      <MarkdownPreviewPane
        source={[
          '# Heading one',
          '',
          '## Heading two',
          '',
          '### Heading three',
          '',
          '#### Heading four',
        ].join('\n')}
      />,
    );

    expect(container.querySelector('h1')).toHaveTextContent('Heading one');
    expect(container.querySelector('h2')).toHaveTextContent('Heading two');
    expect(container.querySelector('h3')).toHaveTextContent('Heading three');
    expect(container.querySelector('h4')).toHaveTextContent('Heading four');
    expect(container.querySelector('h4')).toHaveAttribute('data-source-line', '7');
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

  it('renders the complete always-on GFM contract safely', () => {
    const { container } = render(<MarkdownPreviewPane source={gfmContractFixture} />);

    expect(container.querySelector('table')).toBeInTheDocument();
    expect(
      container.querySelectorAll('li.task-list-item > input[type="checkbox"]'),
    ).toHaveLength(2);
    expect(container.querySelector('del')).toHaveTextContent('Retired text');
    expect(container.querySelector('a[href="https://example.com/gfm"]')).toBeInTheDocument();
    expect(container.querySelector('a[href="http://www.example.org"]')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(
      (window as Window & { __markdownerGfmProbe?: boolean }).__markdownerGfmProbe,
    ).toBeUndefined();
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

  it('highlights known skill tokens outside inline and fenced code', () => {
    const { container } = render(
      <MarkdownPreviewPane
        source={[
          'Run /goal and `$git-commit`.',
          '',
          '```sh',
          '/goal',
          '```',
          '',
          'Then $git-commit.',
        ].join('\n')}
        skillNames={new Set(['goal', 'git-commit'])}
        highlightSkillTokens
      />,
    );

    const tokens = container.querySelectorAll('.preview-skill-token');
    expect(tokens).toHaveLength(2);
    expect([...tokens].map((token) => token.textContent)).toEqual([
      '/goal',
      '$git-commit',
    ]);
    expect(container.querySelector('code .preview-skill-token')).toBeNull();
    expect(container.querySelector('pre .preview-skill-token')).toBeNull();
  });

  it('omits preview token spans when skill highlighting is disabled', () => {
    const { container } = render(
      <MarkdownPreviewPane
        source="Run /goal"
        skillNames={new Set(['goal'])}
        highlightSkillTokens={false}
      />,
    );

    expect(container.querySelector('.preview-skill-token')).toBeNull();
  });
});
