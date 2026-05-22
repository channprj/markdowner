import { describe, expect, it } from 'vitest';

import {
  buildDocumentMeta,
  buildOpenEditorItems,
  buildStatusBarModel,
  buildTabStripItems,
} from './shellModel';
import type { DocumentTab } from './documentTabs';

const tabs: DocumentTab[] = [
  {
    id: 'doc-1',
    kind: 'document',
    path: '/tmp/project/docs/draft.md',
    name: 'draft.md',
    source: '# Draft',
    draft: '# Draft\nupdated',
    missing: false,
  },
  {
    id: 'settings',
    kind: 'settings',
    path: null,
    name: 'Settings',
    source: '',
    draft: '',
    missing: false,
  },
  {
    id: 'doc-2',
    kind: 'document',
    path: '/tmp/project/docs/missing.md',
    name: 'missing.md',
    source: '# Missing',
    draft: '# Missing',
    missing: true,
  },
];

describe('buildOpenEditorItems', () => {
  it('maps tabs into Explorer open-editor items without owning dirty rules', () => {
    expect(
      buildOpenEditorItems({
        tabs,
        activeTabId: 'settings',
        isDirty: (tab) => tab.id === 'doc-1',
      }),
    ).toEqual([
      {
        id: 'doc-1',
        name: 'draft.md',
        path: '/tmp/project/docs/draft.md',
        isActive: false,
        isDirty: true,
        missing: false,
      },
      {
        id: 'settings',
        name: 'Settings',
        path: null,
        isActive: true,
        isDirty: false,
        missing: false,
      },
      {
        id: 'doc-2',
        name: 'missing.md',
        path: '/tmp/project/docs/missing.md',
        isActive: false,
        isDirty: false,
        missing: true,
      },
    ]);
  });
});

describe('buildTabStripItems', () => {
  it('maps tabs into tab-strip items with existing shortcut labels', () => {
    const manyTabs = Array.from({ length: 11 }, (_, index): DocumentTab => ({
      id: `doc-${index + 1}`,
      kind: 'document',
      path: `/tmp/${index + 1}.md`,
      name: `${index + 1}.md`,
      source: '',
      draft: '',
      missing: index === 10,
    }));

    const items = buildTabStripItems({
      tabs: manyTabs,
      isDirty: (tab) => tab.id === 'doc-2',
    });

    expect(items[0]).toMatchObject({
      id: 'doc-1',
      kind: 'document',
      name: '1.md',
      isDirty: false,
      missing: false,
      shortcutLabel: '⌘1',
    });
    expect(items[1]).toMatchObject({ isDirty: true, shortcutLabel: '⌘2' });
    expect(items[8]).toMatchObject({ shortcutLabel: '⌘9' });
    expect(items[9]).toMatchObject({ shortcutLabel: '⌘0' });
    expect(items[10]).toMatchObject({ missing: true, shortcutLabel: null });
  });
});

describe('buildDocumentMeta', () => {
  it('prefers workspace-relative active document paths', () => {
    expect(
      buildDocumentMeta({
        activeDocumentPath: '/tmp/project/docs/draft.md',
        rootDir: '/tmp/project',
        activeDocumentOpen: true,
      }),
    ).toBe('docs/draft.md');
  });

  it('describes untitled and empty states without duplicating strings in App', () => {
    expect(
      buildDocumentMeta({
        activeDocumentPath: null,
        rootDir: '/tmp/project',
        activeDocumentOpen: true,
      }),
    ).toBe('Save As to choose where this draft lives.');

    expect(
      buildDocumentMeta({
        activeDocumentPath: null,
        rootDir: '/tmp/project',
        activeDocumentOpen: false,
      }),
    ).toBe('Open a workspace or a Markdown file to begin.');
  });
});

describe('buildStatusBarModel', () => {
  it('maps active document state into status bar display props', () => {
    expect(
      buildStatusBarModel({
        currentMode: 'Editor',
        themeKind: 'BuiltInDark',
        busy: true,
        activeDocumentOpen: true,
        activeDocumentDirty: true,
        activeDocumentName: 'draft.md',
        activeDocumentPath: '/tmp/project/docs/draft.md',
        rootDir: '/tmp/project',
        cursorPosition: { line: 12, column: 4 },
        documentStats: {
          words: 321,
          characters: 1800,
          readingTimeMinutes: 2,
        },
      }),
    ).toEqual({
      mode: 'Editor',
      theme: 'Dark',
      busy: true,
      isDirty: true,
      documentName: 'draft.md',
      documentPath: '/tmp/project/docs/draft.md',
      workspaceName: 'project',
      activeDocumentLabel: 'docs/draft.md',
      cursorLine: 12,
      cursorColumn: 4,
      wordCount: 321,
      characterCount: 1800,
      readingTimeMinutes: 2,
    });
  });

  it('hides document-only details when there is no active document or WYSIWYG owns the cursor', () => {
    expect(
      buildStatusBarModel({
        currentMode: 'Wysiwyg',
        themeKind: 'BuiltInLight',
        busy: false,
        activeDocumentOpen: false,
        activeDocumentDirty: false,
        activeDocumentName: null,
        activeDocumentPath: null,
        rootDir: '/tmp/project',
        cursorPosition: { line: 6, column: 3 },
        documentStats: {
          words: 12,
          characters: 48,
          readingTimeMinutes: 1,
        },
      }),
    ).toEqual({
      mode: 'WYSIWYG',
      theme: 'Light',
      busy: false,
      isDirty: null,
      documentName: null,
      documentPath: null,
      workspaceName: 'project',
      activeDocumentLabel: null,
      cursorLine: null,
      cursorColumn: null,
      wordCount: null,
      characterCount: null,
      readingTimeMinutes: null,
    });
  });
});
