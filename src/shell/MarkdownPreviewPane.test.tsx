import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MarkdownPreviewPane } from './MarkdownPreviewPane';

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
});
