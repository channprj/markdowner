import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DARK_EXPORT_STYLE,
  DEFAULT_EXPORT_STYLE,
  applyExportStylePreset,
  buildExportHtml,
  buildWorkspaceExportTargets,
  buildWorkspacePdfExportTargets,
  defaultPdfExportPath,
  exportBaseName,
  loadExportStyle,
  normalizeExportStyle,
  renderMarkdownToHtml,
  resolveExportStyleForTheme,
  saveExportStyle,
} from './exportDocument';
import { DEFAULT_PDF_PAPER } from './pdfPaper';

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
  it('resolves the app preset to a complete dark export palette', () => {
    const style = resolveExportStyleForTheme(DEFAULT_EXPORT_STYLE, 'dark');

    expect(style).toMatchObject({
      preset: 'app',
      textColor: '#f4f4f5',
      backgroundColor: '#18181b',
      tableBorderColor: '#3f3f46',
      tableHeaderTextColor: '#fafafa',
      tableHeaderBackgroundColor: '#27272a',
    });
  });

  it('applies fixed presets without changing paper settings', () => {
    const customPaperStyle = {
      ...DEFAULT_EXPORT_STYLE,
      paperSize: 'Custom' as const,
      paperOrientation: 'portrait' as const,
      paperWidthMm: 180.5,
      paperHeightMm: 240.2,
    };
    const style = applyExportStylePreset(
      customPaperStyle,
      'dark',
      'light',
    );

    expect(DEFAULT_EXPORT_STYLE).toMatchObject(DEFAULT_PDF_PAPER);
    expect(style).toMatchObject({
      preset: 'dark',
      paperSize: 'Custom',
      paperOrientation: 'portrait',
      paperWidthMm: 180.5,
      paperHeightMm: 240.2,
    });
  });

  it('migrates legacy paper settings to portrait defaults', () => {
    expect(normalizeExportStyle({ paperSize: 'Letter' })).toMatchObject({
      paperSize: 'Letter',
      paperOrientation: 'portrait',
      paperWidthMm: 210,
      paperHeightMm: 297,
    });
  });

  it('migrates scalar padding and persists the complete page layout', () => {
    expect(normalizeExportStyle({ contentPadding: 18 })).toMatchObject({
      contentPaddingMode: 'all',
      contentPaddingTop: 18,
      contentPaddingRight: 18,
      contentPaddingBottom: 18,
      contentPaddingLeft: 18,
      headerText: '',
      footerText: '',
      pageNumbersEnabled: false,
    });
  });

  it('preserves page layout while applying a color Theme', () => {
    const styled = applyExportStylePreset(
      {
        ...DEFAULT_EXPORT_STYLE,
        headerText: 'Project Atlas',
        pageNumbersEnabled: true,
        contentPaddingMode: 'individual',
        contentPaddingLeft: 48,
      },
      'dark',
      'light',
    );
    expect(styled).toMatchObject({
      preset: 'dark',
      headerText: 'Project Atlas',
      pageNumbersEnabled: true,
      contentPaddingMode: 'individual',
      contentPaddingLeft: 48,
    });
  });

  it('migrates untouched legacy styles to app and customized legacy styles to custom', () => {
    const {
      preset: _preset,
      tableBorderColor: _border,
      tableHeaderTextColor: _headerText,
      tableHeaderBackgroundColor: _headerBackground,
      ...legacyDefault
    } = DEFAULT_EXPORT_STYLE;

    expect(normalizeExportStyle(legacyDefault).preset).toBe('app');
    expect(normalizeExportStyle({ ...legacyDefault, fontSize: 13 }).preset).toBe('custom');
    expect(normalizeExportStyle({ ...legacyDefault, textColor: '#123456' })).toMatchObject({
      preset: 'custom',
      textColor: '#123456',
    });
  });

  it('provides readable defaults for inline code and keyboard keys', () => {
    expect(DEFAULT_EXPORT_STYLE).toEqual(
      expect.objectContaining({
        preset: 'app',
        inlineCodeTextColor: '#7c2d12',
        inlineCodeBackgroundColor: '#ffedd5',
        kbdTextColor: '#334155',
        kbdBackgroundColor: '#e2e8f0',
        tableBorderColor: '#d4d4d8',
        tableHeaderTextColor: '#18181b',
        tableHeaderBackgroundColor: '#f4f4f5',
      }),
    );
  });

  it('migrates legacy inline colors and defaults fenced code to Match app', () => {
    expect(
      normalizeExportStyle({
        inlineCodeTextColor: '#7c2d12',
        inlineCodeBackgroundColor: '#ffedd5',
      }),
    ).toMatchObject({
      codeBlockTheme: 'app',
      inlineCodePreset: 'amber',
    });
  });

  it('preserves fixed code choices while changing the Export Theme', () => {
    const next = applyExportStylePreset(
      {
        ...DEFAULT_EXPORT_STYLE,
        codeBlockTheme: 'ayu-dark',
        inlineCodePreset: 'blue',
      },
      'dark',
      'light',
    );
    expect(next).toMatchObject({
      codeBlockTheme: 'ayu-dark',
      inlineCodePreset: 'blue',
      inlineCodeTextColor: '#bfdbfe',
      inlineCodeBackgroundColor: '#172554',
    });
  });

  it('accepts compact line heights down to 0.8 and normalizes export element colors', () => {
    expect(
      normalizeExportStyle({
        ...DEFAULT_EXPORT_STYLE,
        lineHeight: 0.8,
        inlineCodePreset: 'custom',
        inlineCodeTextColor: '#314158',
        inlineCodeBackgroundColor: 'orange',
        kbdTextColor: '#abcdef',
        kbdBackgroundColor: '#f1e6d2',
      }),
    ).toEqual({
      ...DEFAULT_EXPORT_STYLE,
      lineHeight: 0.8,
      inlineCodePreset: 'custom',
      inlineCodeTextColor: '#314158',
      kbdTextColor: '#abcdef',
      kbdBackgroundColor: '#f1e6d2',
    });
    expect(normalizeExportStyle({ ...DEFAULT_EXPORT_STYLE, lineHeight: 0.4 }).lineHeight).toBe(0.8);
  });

  it('falls back invalid table colors to the selected fixed palette', () => {
    expect(
      normalizeExportStyle({
        ...DARK_EXPORT_STYLE,
        tableBorderColor: 'transparent',
        tableHeaderTextColor: '#123',
        tableHeaderBackgroundColor: 'oklch(0 0 0)',
      }),
    ).toMatchObject({
      preset: 'dark',
      tableBorderColor: '#3f3f46',
      tableHeaderTextColor: '#fafafa',
      tableHeaderBackgroundColor: '#27272a',
    });
  });

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
      preset: 'custom',
      fontSize: 24,
      backgroundColor: '#fefefe',
      lineHeight: 0.8,
      paragraphSpacing: 0,
      contentPaddingTop: 72,
      contentPaddingRight: 72,
      contentPaddingBottom: 72,
      contentPaddingLeft: 72,
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
    expect(html).not.toContain('__markdownerPaginatePdf');
  });

  it('adds explicit Custom page dimensions and the shared paginator when printing', async () => {
    const html = await buildExportHtml({
      title: 'P',
      source: 'x',
      activeDocumentPath: null,
      forPrint: true,
      paginationToken: 'export-preview-token',
      style: {
        ...DEFAULT_EXPORT_STYLE,
        paperSize: 'Custom',
        paperWidthMm: 180.5,
        paperHeightMm: 240.2,
        contentPaddingMode: 'individual',
        contentPaddingTop: 20,
        contentPaddingRight: 24,
        contentPaddingBottom: 28,
        contentPaddingLeft: 32,
        headerText: 'Project Atlas',
        headerAlignment: 'left',
        pageNumbersEnabled: true,
      },
    });
    expect(html).toContain('@page { size: 180.5mm 240.2mm; }');
    expect(html).toContain('__markdownerPaginatePdf');
    expect(html).toContain('"token":"export-preview-token"');
    expect(html).toContain(
      '"pageInsets":{"top":20,"right":24,"bottom":28,"left":32}',
    );
    expect(html).toContain('"headerText":"Project Atlas"');
    expect(html).toContain('"pageNumberTemplate":"{page}/{pages}"');
  });

  it('overrides the exported root with a fixed fenced-code theme', async () => {
    const html = await buildExportHtml({
      title: 'Code',
      source: '```ts\nconst n = 1\n```',
      activeDocumentPath: null,
      style: {
        ...DEFAULT_EXPORT_STYLE,
        codeBlockTheme: 'github-light',
      },
    });
    expect(html).toContain('data-cb-theme="github-light"');
    expect(html).toContain('data-cb-highlight="on"');
    expect(html).not.toContain('data-cb-theme="one-dark"');
  });

  it('keeps layout and code styles in HTML without PDF furniture runtime', async () => {
    const html = await buildExportHtml({
      title: 'HTML styles',
      source: '`inline`\n\n```ts\nconst n = 1\n```',
      activeDocumentPath: null,
      style: {
        ...DEFAULT_EXPORT_STYLE,
        preset: 'light',
        contentPaddingMode: 'individual',
        contentPaddingTop: 10,
        contentPaddingRight: 20,
        contentPaddingBottom: 30,
        contentPaddingLeft: 40,
        headerText: 'PDF only',
        pageNumbersEnabled: true,
        codeBlockTheme: 'monokai-dark',
        inlineCodePreset: 'green',
      },
    });

    expect(html).toContain('padding: 10px 20px 30px 40px');
    expect(html).toContain('data-cb-theme="monokai-dark"');
    expect(html).toContain('color: #166534');
    expect(html).toContain('background: #dcfce7');
    expect(html).not.toContain('__markdownerPaginatePdf');
    expect(html).not.toContain('"pageInsets"');
    expect(html).not.toContain('data-markdowner-pdf-decoration');
  });

  it('injects the selected typography, colors, and spacing into the standalone document', async () => {
    const html = await buildExportHtml({
      title: 'Styled',
      source: '# Heading\n\nBody',
      activeDocumentPath: null,
      style: {
        ...DEFAULT_EXPORT_STYLE,
        preset: 'custom',
        fontSize: 13,
        fontFamily: 'serif',
        textColor: '#223344',
        backgroundColor: '#fffaf0',
        lineHeight: 1.7,
        paragraphSpacing: 10,
        contentPaddingMode: 'all',
        contentPaddingTop: 36,
        contentPaddingRight: 36,
        contentPaddingBottom: 36,
        contentPaddingLeft: 36,
        inlineCodePreset: 'custom',
        inlineCodeTextColor: '#314158',
        inlineCodeBackgroundColor: '#e8eef5',
        kbdTextColor: '#4a3520',
        kbdBackgroundColor: '#f1e6d2',
      },
    });

    expect(html).toContain('font-size: 13px');
    expect(html).toContain('font-family: ui-serif');
    expect(html).toContain('color: #223344');
    expect(html).toContain('background: #fffaf0');
    expect(html).toContain('line-height: 1.7');
    expect(html).toContain('margin-block: 0 10px');
    expect(html).toContain('padding: 36px');
    expect(html).toContain('.markdowner-export code:not(pre code)');
    expect(html).toContain('color: #314158');
    expect(html).toContain('background: #e8eef5');
    expect(html).toContain('.markdowner-export kbd');
    expect(html).toContain('color: #4a3520');
    expect(html).toContain('background: #f1e6d2');
  });

  it('injects independent HTML padding values', async () => {
    const html = await buildExportHtml({
      title: 'Insets',
      source: 'Body',
      activeDocumentPath: null,
      style: {
        ...DEFAULT_EXPORT_STYLE,
        contentPaddingMode: 'individual',
        contentPaddingTop: 10,
        contentPaddingRight: 20,
        contentPaddingBottom: 30,
        contentPaddingLeft: 40,
      },
    });

    expect(html).toContain('padding: 10px 20px 30px 40px');
  });

  it('uses one dark palette for the page and table when the app preset follows dark', async () => {
    const html = await buildExportHtml({
      title: 'Dark table',
      source: '| Name | Value |\n| --- | --- |\n| A | 1 |',
      activeDocumentPath: null,
      style: DEFAULT_EXPORT_STYLE,
      doc: document,
    });

    expect(html).toContain('background: #18181b');
    expect(html).toContain('--border: #3f3f46');
    expect(html).toContain('border-color: #3f3f46');
    expect(html).toContain('background: #27272a');
    expect(html).toContain('color: #fafafa');
  });

  it('keeps a fixed light preset light under a dark app root', async () => {
    const html = await buildExportHtml({
      title: 'Light table',
      source: '| A |\n| --- |\n| B |',
      activeDocumentPath: null,
      style: applyExportStylePreset(DEFAULT_EXPORT_STYLE, 'light', 'dark'),
      doc: document,
    });

    expect(html).toContain('background: #ffffff');
    expect(html).toContain('border-color: #d4d4d8');
    expect(html).not.toContain('border-color: #3f3f46');
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
