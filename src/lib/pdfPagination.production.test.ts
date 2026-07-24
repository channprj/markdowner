// @vitest-environment node

// @ts-expect-error jsdom does not publish TypeScript declarations.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { build as buildVite } from 'vite';

import type {
  PdfPaginationRuntimeConfig,
  buildPdfPaginationScript,
} from './pdfPagination';

describe('production PDF pagination runtime', () => {
  it('executes after minification without module bindings', async () => {
    const buildResult = await buildVite({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: 'esbuild',
        lib: {
          entry: new URL('./pdfPagination.ts', import.meta.url).pathname,
          formats: ['iife'],
          name: 'PdfPaginationProductionProbe',
        },
      },
    });
    const productionBuild = (Array.isArray(buildResult) ? buildResult[0] : buildResult) as {
      output: Array<{ code?: string; type: string }>;
    };
    const chunk = productionBuild.output.find((item) => item.type === 'chunk');
    expect(chunk?.type).toBe('chunk');
    if (!chunk?.code) throw new Error('Missing production bundle');

    const dom = new JSDOM(
      '<!doctype html><main class="markdowner-export"><p>Probe</p></main>',
      { runScripts: 'dangerously' },
    );
    dom.window.eval(chunk.code);
    const productionWindow = dom.window as unknown as typeof dom.window & {
      PdfPaginationProductionProbe: {
        buildPdfPaginationScript: typeof buildPdfPaginationScript;
      };
      __markdownerPaginatePdf: () => Promise<{
        totalHeight: number;
        pageCount: number;
      }>;
    };
    const config: PdfPaginationRuntimeConfig = {
      token: 'production-runtime-token',
      pageWidth: 160,
      pageHeight: 200,
      pageInsets: { top: 32, right: 32, bottom: 32, left: 32 },
      pageFurniture: {
        headerText: '',
        headerAlignment: 'center',
        footerText: '',
        footerAlignment: 'center',
        pageNumbersEnabled: false,
        pageNumberPosition: 'bottom-center',
        pageNumberTemplate: '{page}/{pages}',
        textColor: '#202124',
        fontFamily: 'system-ui, sans-serif',
      },
      maxPages: 100,
    };

    productionWindow.eval(
      productionWindow.PdfPaginationProductionProbe.buildPdfPaginationScript(config),
    );
    const result = await productionWindow.__markdownerPaginatePdf();

    expect(result.pageCount).toBe(1);
  });
});
