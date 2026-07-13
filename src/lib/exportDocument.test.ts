import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_EXPORT_STYLE,
  buildExportHtml,
  buildWorkspaceExportTargets,
  buildWorkspacePdfExportTargets,
  defaultPdfExportPath,
  exportBaseName,
  loadExportStyle,
  normalizeExportStyle,
  renderMarkdownToHtml,
  saveExportStyle,
} from './exportDocument';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

describe('exportBaseName', () => {
  it('strips markdown extensions', () => {
    expect(exportBaseName('notes.md')).toBe('notes');
    expect(exportBaseName('readme.markdown')).toBe('readme');
    expect(exportBaseName('a.MKD')).toBe('a');
  });

  it('falls back to Untitled for empty/missing names', () => {
    expect(exportBaseName(null)).toBe('Untitled');
    expect(exportBaseName(undefined)).toBe('Untitled');
    expect(exportBaseName('')).toBe('Untitled');
  });
});

describe('renderMarkdownToHtml', () => {
  it('renders GFM markdown to static HTML', () => {
    const html = renderMarkdownToHtml('# Title\n\n- one\n- two', null);
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<li');
  });
});

describe('defaultPdfExportPath', () => {
  it('defaults to a PDF beside the saved active document', () => {
    expect(defaultPdfExportPath('/tmp/project/docs/guide.md', 'guide.md')).toBe(
      '/tmp/project/docs/guide.pdf',
    );
  });

  it('falls back to the document name for untitled documents', () => {
    expect(defaultPdfExportPath(null, 'Draft.markdown')).toBe('Draft.pdf');
  });
});

describe('export styles', () => {
  it('uses a compact default and normalizes unsafe persisted values', () => {
    expect(DEFAULT_EXPORT_STYLE.fontSize).toBe(14);
    expect(
      normalizeExportStyle({
        fontSize: 99,
        fontFamily: 'unknown',
        textColor: 'red',
        backgroundColor: '#fefefe',
        lineHeight: 0,
        paragraphSpacing: -4,
        contentPadding: 999,
        paperSize: 'Legal',
      }),
    ).toEqual({
      ...DEFAULT_EXPORT_STYLE,
      fontSize: 24,
      backgroundColor: '#fefefe',
      lineHeight: 1.2,
      paragraphSpacing: 0,
      contentPadding: 72,
    });
  });

  it('round-trips a confirmed style through storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const style = {
      ...DEFAULT_EXPORT_STYLE,
      fontSize: 13,
      fontFamily: 'serif' as const,
    };

    saveExportStyle(style, storage);

    expect(loadExportStyle(storage)).toEqual(style);
  });

  it('falls back to defaults when saved JSON cannot be read', () => {
    const storage = {
      getItem: () => '{broken',
      setItem: () => undefined,
    };

    expect(loadExportStyle(storage)).toEqual(DEFAULT_EXPORT_STYLE);
  });
});

describe('buildWorkspaceExportTargets', () => {
  it('preserves project-relative folders for HTML exports', () => {
    expect(
      buildWorkspaceExportTargets({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/docs/guide.markdown',
        ],
        format: 'html',
      }),
    ).toEqual([
      {
        sourcePath: '/tmp/project/README.md',
        outputPath: '/tmp/project/exports/README.html',
        title: 'README',
      },
      {
        sourcePath: '/tmp/project/docs/guide.markdown',
        outputPath: '/tmp/project/exports/docs/guide.html',
        title: 'guide',
      },
    ]);
  });
});

describe('buildWorkspacePdfExportTargets', () => {
  it('preserves the project-relative folder structure under exports', () => {
    expect(
      buildWorkspacePdfExportTargets({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/docs/guide.markdown',
          '/tmp/project/deep/nested/spec.MKD',
        ],
      }),
    ).toEqual([
      {
        sourcePath: '/tmp/project/README.md',
        outputPath: '/tmp/project/exports/README.pdf',
        title: 'README',
      },
      {
        sourcePath: '/tmp/project/docs/guide.markdown',
        outputPath: '/tmp/project/exports/docs/guide.pdf',
        title: 'guide',
      },
      {
        sourcePath: '/tmp/project/deep/nested/spec.MKD',
        outputPath: '/tmp/project/exports/deep/nested/spec.pdf',
        title: 'spec',
      },
    ]);
  });

  it('skips files already inside exports and de-duplicates source paths', () => {
    expect(
      buildWorkspacePdfExportTargets({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/docs/guide.md',
          '/tmp/project/docs/guide.md',
          '/tmp/project/exports/docs/guide.md',
          '/tmp/project/notes.txt',
          '/tmp/other/outside.md',
        ],
      }),
    ).toEqual([
      {
        sourcePath: '/tmp/project/docs/guide.md',
        outputPath: '/tmp/project/exports/docs/guide.pdf',
        title: 'guide',
      },
    ]);
  });

  it('keeps the source path separator style when building export targets', () => {
    expect(
      buildWorkspacePdfExportTargets({
        rootDir: 'C:\\Users\\chann\\project',
        workspaceDocuments: ['C:\\Users\\chann\\project\\docs\\guide.md'],
      }),
    ).toEqual([
      {
        sourcePath: 'C:\\Users\\chann\\project\\docs\\guide.md',
        outputPath: 'C:\\Users\\chann\\project\\exports\\docs\\guide.pdf',
        title: 'guide',
      },
    ]);
  });
});

describe('buildExportHtml', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'BuiltInDark';
    document.documentElement.dataset.cbTheme = 'one-dark';
    document.documentElement.dataset.cbHighlight = 'on';
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.cbTheme;
    delete document.documentElement.dataset.cbHighlight;
  });

  it('produces a standalone document mirroring the live theme attributes', async () => {
    const html = await buildExportHtml({
      title: 'My Doc',
      source: '# Hello',
      activeDocumentPath: null,
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>My Doc</title>');
    expect(html).toContain('data-cb-theme="one-dark"');
    expect(html).toContain('data-cb-highlight="on"');
    expect(html).toContain('markdowner-content');
    expect(html).toContain('markdown-surface');
    expect(html).toContain('Hello');
    expect(html).not.toContain('@page');
  });

  it('adds print page rules sized to the requested paper when printing', async () => {
    const html = await buildExportHtml({
      title: 'P',
      source: 'x',
      activeDocumentPath: null,
      forPrint: true,
      paperSize: 'Letter',
    });
    expect(html).toContain('@page { size: Letter');
  });

  it('injects the selected typography, colors, and spacing into the standalone document', async () => {
    const html = await buildExportHtml({
      title: 'Styled',
      source: '# Heading\n\nBody',
      activeDocumentPath: null,
      style: {
        ...DEFAULT_EXPORT_STYLE,
        fontSize: 13,
        fontFamily: 'serif',
        textColor: '#223344',
        backgroundColor: '#fffaf0',
        lineHeight: 1.7,
        paragraphSpacing: 10,
        contentPadding: 36,
      },
    });

    expect(html).toContain('font-size: 13px');
    expect(html).toContain('font-family: ui-serif');
    expect(html).toContain('color: #223344');
    expect(html).toContain('background: #fffaf0');
    expect(html).toContain('line-height: 1.7');
    expect(html).toContain('margin-block: 0 10px');
    expect(html).toContain('padding: 36px');
  });

  it('wraps long code block lines for PDF export', async () => {
    const html = await buildExportHtml({
      title: 'P',
      source: '```text\n' + 'a'.repeat(240) + '\n```',
      activeDocumentPath: null,
      forPrint: true,
    });

    expect(html).toContain(
      '.markdowner-export pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }',
    );
    expect(html).toContain('.markdowner-export pre code { white-space: inherit; }');
  });

  it('escapes the title to avoid breaking the document', async () => {
    const html = await buildExportHtml({ title: 'a<b>&"', source: 'x', activeDocumentPath: null });
    expect(html).toContain('<title>a&lt;b&gt;&amp;&quot;</title>');
  });

  it('inlines local and remote images as data URIs for a self-contained export', async () => {
    const embedImages = vi.fn(async (sources: string[]) =>
      sources.map((source) => ({ source, dataUri: `data:image/png;base64,EMBED(${source})` })),
    );
    const html = await buildExportHtml({
      title: 'Doc',
      source: '![local](./pic.png)\n\n![remote](https://example.com/badge.svg)',
      activeDocumentPath: '/tmp/project/README.md',
      embedImages,
    });

    // Local path is resolved relative to the document before reading.
    expect(embedImages).toHaveBeenCalledWith(
      expect.arrayContaining(['/tmp/project/pic.png', 'https://example.com/badge.svg']),
    );
    expect(html).toContain('src="data:image/png;base64,EMBED(/tmp/project/pic.png)"');
    expect(html).toContain('src="data:image/png;base64,EMBED(https://example.com/badge.svg)"');
    // The Tauri-only asset:// protocol must not leak into the exported document.
    expect(html).not.toContain('asset://');
  });

  it('inlines relative raw HTML img tags as data URIs for a self-contained export', async () => {
    const embedImages = vi.fn(async (sources: string[]) =>
      sources.map((source) => ({ source, dataUri: `data:image/jpeg;base64,EMBED(${source})` })),
    );
    const html = await buildExportHtml({
      title: 'Doc',
      source: '<p><img src="assets/kmsg-logo.jpg" alt="kmsg logo" width="220" /></p>',
      activeDocumentPath: '/tmp/project/README.md',
      embedImages,
    });

    expect(embedImages).toHaveBeenCalledWith(['/tmp/project/assets/kmsg-logo.jpg']);
    expect(html).toContain(
      'src="data:image/jpeg;base64,EMBED(/tmp/project/assets/kmsg-logo.jpg)"',
    );
    expect(html).toContain('alt="kmsg logo"');
    expect(html).toContain('width="220"');
    expect(html).not.toContain('&lt;img');
    expect(html).not.toContain('asset://');
  });

  it('does not rewrite raw HTML img examples inside fenced code blocks', async () => {
    const embedImages = vi.fn(async () => []);
    const html = await buildExportHtml({
      title: 'Doc',
      source: '```html\n<img src="assets/kmsg-logo.jpg" alt="kmsg logo" />\n```',
      activeDocumentPath: '/tmp/project/README.md',
      embedImages,
    });

    expect(embedImages).not.toHaveBeenCalled();
    expect(html).toContain('assets/kmsg-logo.jpg');
    expect(html).toContain('kmsg logo');
    expect(html).not.toContain('markdowner-raw-html-image');
  });

  it('falls back gracefully when an image cannot be embedded', async () => {
    const embedImages = vi.fn(async (sources: string[]) =>
      sources.map((source) => ({ source, dataUri: null })),
    );
    const html = await buildExportHtml({
      title: 'Doc',
      source: '![remote](https://example.com/badge.svg)',
      activeDocumentPath: null,
      embedImages,
    });
    // Remote images keep their original URL when embedding fails.
    expect(html).toContain('src="https://example.com/badge.svg"');
  });

  it('does not read images for a document without any', async () => {
    const embedImages = vi.fn(async () => []);
    await buildExportHtml({
      title: 'Doc',
      source: '# No images here',
      activeDocumentPath: '/tmp/a.md',
      embedImages,
    });
    expect(embedImages).not.toHaveBeenCalled();
  });
});
