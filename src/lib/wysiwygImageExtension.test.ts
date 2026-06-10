import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMarkdownImageExtension } from './wysiwygImageExtension';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

describe('createMarkdownImageExtension', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('renders local relative markdown images as Tauri asset URLs without rewriting markdown', () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        createMarkdownImageExtension(() => '/tmp/markdowner/README.md'),
        Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      ],
      content: '![OG](./assets/images/og.png)',
      contentType: 'markdown',
    });

    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(
      'asset:///tmp/markdowner/assets/images/og.png',
    );
    expect(editor.getMarkdown()).toContain('![OG](./assets/images/og.png)');
  });

  it('renders local relative raw HTML images as Tauri asset URLs', () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        createMarkdownImageExtension(() => '/tmp/markdowner/README.md'),
        Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      ],
      content:
        '<p align="center">\n  <img src="./assets/images/og.png" alt="OG" width="100%">\n</p>',
      contentType: 'markdown',
    });

    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(
      'asset:///tmp/markdowner/assets/images/og.png',
    );
  });

  it('renders remote badge image URLs unchanged', () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        createMarkdownImageExtension(() => '/tmp/markdowner/README.md'),
        Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      ],
      content: '![MIT](https://img.shields.io/badge/license-MIT-2ea44f)',
      contentType: 'markdown',
    });

    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.shields.io/badge/license-MIT-2ea44f',
    );
  });
});
