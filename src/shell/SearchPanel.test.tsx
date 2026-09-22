import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchPanel, type SearchResultFile } from './SearchPanel';
import type { FindReplaceOptions } from '@/lib/findReplace';

const defaultOptions: FindReplaceOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

const searchResults: SearchResultFile[] = [
  {
    path: '/tmp/project/guides/alpha.md',
    matches: [
      {
        line: 3,
        column: 5,
        preview: 'Alpha heading',
        matchStart: 0,
        matchEnd: 5,
        absoluteOffset: 12,
      },
      {
        line: 9,
        column: 1,
        preview: 'alpha body text',
        matchStart: 0,
        matchEnd: 5,
        absoluteOffset: 80,
      },
    ],
  },
];

function renderSearchPanel(
  overrides: Partial<Parameters<typeof SearchPanel>[0]> = {},
) {
  const props = {
    query: '',
    options: defaultOptions,
    results: [] as SearchResultFile[],
    busy: false,
    error: null as string | null,
    hasRun: false,
    autoFocusToken: 0,
    rootDir: '/tmp/project',
    onQueryChange: vi.fn(),
    onOptionsChange: vi.fn(),
    onRunSearch: vi.fn(),
    onSelectMatch: vi.fn(),
    displayFileName: (path: string) => path.split('/').pop() ?? path,
    displayWorkspacePath: (path: string, rootDir: string | null) =>
      rootDir ? path.replace(`${rootDir}/`, '') : path,
    ...overrides,
  };

  render(<SearchPanel {...props} />);
  return props;
}

describe('SearchPanel', () => {
  it('highlights and forwards native UTF-16 offsets after Korean and emoji text', () => {
    const match = {
      line: 2, column: 5, preview: '한😀 target 뒤',
      matchStart: 4, matchEnd: 10, absoluteOffset: 12,
    };
    const file = { path: '/tmp/project/notes.md', matches: [match] };
    const props = renderSearchPanel({ query: 'target', hasRun: true, results: [file] });
    const row = screen.getByTestId('sidebar-search-match');
    expect(row.querySelector('mark')).toHaveTextContent('target');
    expect(row).toHaveTextContent('한😀 target 뒤');
    fireEvent.click(row);
    expect(props.onSelectMatch).toHaveBeenCalledWith(file, match);
  });
  afterEach(() => {
    cleanup();
  });

  it('updates the query and runs search on Enter', () => {
    const props = renderSearchPanel({ query: 'alpha' });

    const input = screen.getByTestId('sidebar-search-input');
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onQueryChange).toHaveBeenCalledWith('beta');
    expect(props.onRunSearch).toHaveBeenCalled();
  });

  it('toggles search options without changing unrelated options', () => {
    const props = renderSearchPanel({
      options: { ...defaultOptions, wholeWord: true },
    });

    fireEvent.click(screen.getByRole('button', { name: /match case/i }));
    fireEvent.click(screen.getByRole('button', { name: /whole word/i }));

    expect(props.onOptionsChange).toHaveBeenNthCalledWith(1, {
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });
    expect(props.onOptionsChange).toHaveBeenNthCalledWith(2, {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
  });

  it('renders result summaries, highlighted previews, and selection callbacks', () => {
    const props = renderSearchPanel({
      query: 'alpha',
      hasRun: true,
      results: searchResults,
    });

    expect(screen.getByTestId('sidebar-search-summary')).toHaveTextContent(
      '2 results in 1 file',
    );
    expect(screen.getByText('alpha.md')).toBeInTheDocument();
    expect(screen.getByText('guides/alpha.md')).toBeInTheDocument();
    expect(screen.getByText('Alpha').tagName).toBe('MARK');

    fireEvent.click(screen.getAllByTestId('sidebar-search-match')[0]);

    expect(props.onSelectMatch).toHaveBeenCalledWith(
      searchResults[0],
      searchResults[0].matches[0],
    );
  });

  it('moves focus from the query input into the result list with ArrowDown', () => {
    renderSearchPanel({ query: 'alpha', hasRun: true, results: searchResults });

    const input = screen.getByTestId('sidebar-search-input');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // First row is the file header; ArrowDown walks into its matches and
    // ArrowUp from the first row returns to the input.
    const fileRow = screen.getByTitle('/tmp/project/guides/alpha.md');
    expect(document.activeElement).toBe(fileRow);

    fireEvent.keyDown(fileRow, { key: 'ArrowDown' });
    const matchRows = screen.getAllByTestId('sidebar-search-match');
    expect(document.activeElement).toBe(matchRows[0]);

    fireEvent.keyDown(matchRows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(matchRows[1]);

    fireEvent.keyDown(matchRows[1], { key: 'ArrowUp' });
    fireEvent.keyDown(matchRows[0], { key: 'ArrowUp' });
    fireEvent.keyDown(fileRow, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(input);
  });

  it('jumps to the focused match with Cmd+ArrowDown', () => {
    const props = renderSearchPanel({
      query: 'alpha',
      hasRun: true,
      results: searchResults,
    });

    const matchRows = screen.getAllByTestId('sidebar-search-match');
    matchRows[1].focus();
    fireEvent.keyDown(matchRows[1], { key: 'ArrowDown', metaKey: true });

    expect(props.onSelectMatch).toHaveBeenCalledWith(
      searchResults[0],
      searchResults[0].matches[1],
    );
  });

  it('shows a per-file match count badge', () => {
    renderSearchPanel({ query: 'alpha', hasRun: true, results: searchResults });

    expect(screen.getByLabelText('2 matches')).toHaveTextContent('2');
  });

  it('renders busy, error, empty, and initial states', () => {
    const { rerender } = render(
      <SearchPanel
        query=""
        options={defaultOptions}
        results={[]}
        busy={false}
        error={null}
        hasRun={false}
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );

    expect(screen.getByText(/type to search workspace/i)).toBeInTheDocument();

    rerender(
      <SearchPanel
        query="alpha"
        options={defaultOptions}
        results={[]}
        busy
        error={null}
        hasRun={false}
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );
    expect(screen.getByText('Searching…')).toBeInTheDocument();

    rerender(
      <SearchPanel
        query="alpha"
        options={defaultOptions}
        results={[]}
        busy={false}
        error="Search failed"
        hasRun
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Search failed');

    rerender(
      <SearchPanel
        query="alpha"
        options={defaultOptions}
        results={[]}
        busy={false}
        error={null}
        hasRun
        autoFocusToken={0}
        rootDir={null}
        onQueryChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onRunSearch={vi.fn()}
        onSelectMatch={vi.fn()}
        displayFileName={(path) => path}
        displayWorkspacePath={(path) => path}
      />,
    );
    expect(within(screen.getByTestId('sidebar-search-panel')).getByText('No results')).toBeInTheDocument();
  });
});
