import { describe, expect, it } from 'vitest';

import { buildQuickOpenItems } from './quickOpenItems';

describe('buildQuickOpenItems', () => {
  it('builds workspace items before recent items with display metadata', () => {
    expect(
      buildQuickOpenItems(
        {
          workspaceDocuments: [
            '/tmp/project/README.md',
            '/tmp/project/docs/guide.md',
          ],
          recentDocuments: ['/tmp/other/notes.md'],
          rootDir: '/tmp/project',
        },
      ),
    ).toEqual([
      {
        path: '/tmp/project/README.md',
        name: 'README.md',
        relativePath: 'README.md',
        kind: 'workspace',
      },
      {
        path: '/tmp/project/docs/guide.md',
        name: 'guide.md',
        relativePath: 'docs/guide.md',
        kind: 'workspace',
      },
      {
        path: '/tmp/other/notes.md',
        name: 'notes.md',
        relativePath: '/tmp/other/notes.md',
        kind: 'recent',
      },
    ]);
  });

  it('deduplicates blank and repeated paths while preserving the first source kind', () => {
    expect(
      buildQuickOpenItems({
        workspaceDocuments: ['/tmp/project/README.md', '', '/tmp/project/README.md'],
        recentDocuments: ['/tmp/project/README.md', '/tmp/project/notes.md'],
        rootDir: '/tmp/project',
      }),
    ).toEqual([
      {
        path: '/tmp/project/README.md',
        name: 'README.md',
        relativePath: 'README.md',
        kind: 'workspace',
      },
      {
        path: '/tmp/project/notes.md',
        name: 'notes.md',
        relativePath: 'notes.md',
        kind: 'recent',
      },
    ]);
  });
});
