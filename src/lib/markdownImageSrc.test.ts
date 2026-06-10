import { describe, expect, it, vi } from 'vitest';

import { resolveMarkdownImageSrc } from './markdownImageSrc';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

describe('resolveMarkdownImageSrc', () => {
  it('resolves relative README image paths from the active document directory', () => {
    expect(
      resolveMarkdownImageSrc(
        './assets/images/og.png',
        '/tmp/markdowner/README.md',
      ),
    ).toBe('asset:///tmp/markdowner/assets/images/og.png');
  });

  it('keeps GitHub-style remote badge image URLs unchanged', () => {
    const src = 'https://img.shields.io/badge/license-MIT-2ea44f';

    expect(resolveMarkdownImageSrc(src, '/tmp/markdowner/README.md')).toBe(src);
  });

  it('keeps data and blob image URLs unchanged', () => {
    expect(resolveMarkdownImageSrc('data:image/png;base64,abc', '/tmp/a.md')).toBe(
      'data:image/png;base64,abc',
    );
    expect(resolveMarkdownImageSrc('blob:http://asset.localhost/abc', '/tmp/a.md')).toBe(
      'blob:http://asset.localhost/abc',
    );
  });

  it('converts absolute local image paths to Tauri asset URLs', () => {
    expect(resolveMarkdownImageSrc('/tmp/markdowner/logo.png', '/tmp/markdowner/README.md')).toBe(
      'asset:///tmp/markdowner/logo.png',
    );
  });
});
