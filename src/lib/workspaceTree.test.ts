import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceTree,
  collectWorkspaceFolderKeys,
  displayFileName,
  displayWorkspacePath,
  filterWorkspaceTree,
  toggleWorkspaceFolderKey,
} from './workspaceTree';

describe('displayFileName', () => {
  it('returns the basename for Unix and Windows-style paths', () => {
    expect(displayFileName('/tmp/project/guides/draft.md')).toBe('draft.md');
    expect(displayFileName('C:\\Users\\me\\notes\\draft.md')).toBe('draft.md');
  });
});

describe('displayWorkspacePath', () => {
  it('returns a case-insensitive workspace-relative path', () => {
    expect(
      displayWorkspacePath(
        'C:\\Users\\Me\\Project\\Guides\\draft.md',
        'c:/users/me/project',
      ),
    ).toBe('Guides/draft.md');
  });

  it('falls back to a normalized absolute path outside the workspace', () => {
    expect(displayWorkspacePath('/tmp/other/readme.md', '/tmp/project')).toBe(
      '/tmp/other/readme.md',
    );
  });
});

describe('buildWorkspaceTree', () => {
  it('builds nested folder and file nodes using workspace-relative keys', () => {
    expect(
      buildWorkspaceTree(
        [
          '/tmp/project/README.md',
          '/tmp/project/guides/draft.md',
          '/tmp/project/guides/reference/api.md',
        ],
        '/tmp/project',
      ),
    ).toEqual([
      {
        kind: 'file',
        key: '/tmp/project/README.md',
        path: '/tmp/project/README.md',
        name: 'README.md',
        relativePath: 'README.md',
      },
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
          {
            kind: 'folder',
            key: 'guides/reference',
            name: 'reference',
            children: [
              {
                kind: 'file',
                key: '/tmp/project/guides/reference/api.md',
                path: '/tmp/project/guides/reference/api.md',
                name: 'api.md',
                relativePath: 'guides/reference/api.md',
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe('filterWorkspaceTree', () => {
  it('keeps matching files with their folder ancestry', () => {
    const tree = buildWorkspaceTree(
      [
        '/tmp/project/README.md',
        '/tmp/project/guides/draft.md',
        '/tmp/project/guides/reference/api.md',
      ],
      '/tmp/project',
    );

    expect(filterWorkspaceTree(tree, 'api')).toEqual([
      {
        kind: 'folder',
        key: 'guides',
        name: 'guides',
        children: [
          {
            kind: 'folder',
            key: 'guides/reference',
            name: 'reference',
            children: [
              {
                kind: 'file',
                key: '/tmp/project/guides/reference/api.md',
                path: '/tmp/project/guides/reference/api.md',
                name: 'api.md',
                relativePath: 'guides/reference/api.md',
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe('collectWorkspaceFolderKeys', () => {
  it('collects every nested folder key', () => {
    const tree = buildWorkspaceTree(
      ['/tmp/project/guides/reference/api.md'],
      '/tmp/project',
    );

    expect(collectWorkspaceFolderKeys(tree)).toEqual(['guides', 'guides/reference']);
  });
});

describe('toggleWorkspaceFolderKey', () => {
  it('adds missing folder keys and removes existing folder keys without mutating input', () => {
    const collapsedKeys = ['guides', 'notes'];

    expect(toggleWorkspaceFolderKey(collapsedKeys, 'guides')).toEqual(['notes']);
    expect(toggleWorkspaceFolderKey(collapsedKeys, 'reference')).toEqual([
      'guides',
      'notes',
      'reference',
    ]);
    expect(collapsedKeys).toEqual(['guides', 'notes']);
  });
});
