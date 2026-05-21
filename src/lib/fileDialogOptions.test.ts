import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_FILE_EXTENSIONS,
  defaultMarkdownSavePath,
  normalizeOpenDialogPaths,
} from './fileDialogOptions';

describe('file dialog options', () => {
  it('normalizes open dialog selections to path arrays', () => {
    expect(normalizeOpenDialogPaths(null)).toEqual([]);
    expect(normalizeOpenDialogPaths(undefined)).toEqual([]);
    expect(normalizeOpenDialogPaths('/tmp/project/a.md')).toEqual(['/tmp/project/a.md']);
    expect(normalizeOpenDialogPaths(['/tmp/project/a.md', '/tmp/project/b.md'])).toEqual([
      '/tmp/project/a.md',
      '/tmp/project/b.md',
    ]);
    expect(normalizeOpenDialogPaths([])).toEqual([]);
  });

  it('uses the saved path, document name, then untitled fallback for markdown saves', () => {
    expect(defaultMarkdownSavePath('/tmp/project/a.md', 'a.md')).toBe('/tmp/project/a.md');
    expect(defaultMarkdownSavePath(null, 'draft.md')).toBe('draft.md');
    expect(defaultMarkdownSavePath(null, null)).toBe('Untitled.md');
  });

  it('keeps the supported markdown extensions in one reusable list', () => {
    expect(MARKDOWN_FILE_EXTENSIONS).toEqual(['md', 'markdown', 'mdown', 'mkd']);
  });
});
