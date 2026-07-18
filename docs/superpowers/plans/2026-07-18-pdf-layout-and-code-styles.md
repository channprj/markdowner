# PDF Layout and Code Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Repository instructions require sequential execution in the main thread; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add asymmetric PDF content padding, repeated page headers/footers, configurable page numbers, export-specific fenced-code themes, and preset inline-code palettes while keeping live Preview and final PDF output identical.

**Architecture:** Extend the persisted export style through two focused pure modules: one for page layout/furniture and one for code-style presets. Upgrade the existing parent-side HTML paginator to consume per-side insets and generate repeated page-decoration layers, then expose focused controls in the 300 px Export Preview rail. The native Rust exporter keeps clipping the already-paginated HTML, so Preview and final PDF continue to share one rendering contract.

**Tech Stack:** React 19, TypeScript 5.8, Vitest/jsdom, Tailwind/shadcn UI, Tauri 2, Rust, WebKit `WKPDFConfiguration`, PDFKit.

---

## File Map

- Create `src/lib/exportPageLayout.ts`: padding/page-furniture types, defaults, normalization, page-number templates, decoration-band geometry, and validation.
- Create `src/lib/exportPageLayout.test.ts`: legacy padding migration, template rendering/validation, position defaults, and geometry coverage.
- Create `src/lib/exportCodeStyles.ts`: code-theme validation, inline preset catalog, tone resolution, palette inference, and preset application.
- Create `src/lib/exportCodeStyles.test.ts`: all preset families, light/dark variants, luminance, migration, and invalid-value coverage.
- Create `src/shell/ExportControlPrimitives.tsx`: shared range and color controls extracted from Export Preview.
- Create `src/shell/ContentPaddingControls.tsx`: approved All sides/Per side selector and four-side controls.
- Create `src/shell/ContentPaddingControls.test.tsx`: mode transitions, value preservation, accessibility, and disabled-state coverage.
- Create `src/shell/PdfPageFurnitureControls.tsx`: optional header/footer text, alignments, page-number switch, format/position, custom template, and validation feedback.
- Create `src/shell/PdfPageFurnitureControls.test.tsx`: conditional controls, default format/position, custom-template error, and emitted patch coverage.
- Create `src/shell/ExportCodeStyleControls.tsx`: fenced-code theme selector, inline preset selector/sample, and Custom color controls.
- Create `src/shell/ExportCodeStyleControls.test.tsx`: complete option catalog, Match app labeling, preset application, Custom editing, and busy-state coverage.
- Modify `src/lib/exportDocument.ts`: extend `ExportStyle`, migrate storage, preserve layout/code choices across Theme changes, emit four-side CSS, and override export code-theme root attributes.
- Modify `src/lib/exportDocument.test.ts`: defaults, storage migration, four-side CSS, theme preservation, inline preset CSS, and fixed/app code-theme output.
- Modify `src/lib/pdfPagination.ts`: replace scalar margin with per-side geometry, validate decoration bands, repeat header/footer/page-number layers, and serialize the same helpers into the embedded runtime.
- Modify `src/lib/pdfPagination.test.ts`: asymmetric movement, page-decoration repetition, all slots, stacking, rerun cleanup, text safety, and serialized config.
- Modify `src/shell/PdfPreviewPage.tsx`: accept page insets/furniture and pass exact page width to the paginator.
- Modify `src/shell/PdfPreviewPage.test.tsx`: assert the loaded iframe receives and renders the new pagination contract.
- Modify `src/shell/ExportPreviewTab.tsx`: compose focused control components, pause invalid page layouts, pass furniture to every page, and rebuild Match app code themes.
- Modify `src/shell/ExportPreviewTab.test.tsx`: end-to-end control visibility, preview regeneration, invalid layout, page furniture, code styles, confirmation, Reset, and current pagination regression coverage.
- Modify `src/App.tsx`: pass the resolved app code theme into Export Preview and persist/confirm the expanded style.
- Modify `src/App.test.tsx`: app-theme propagation plus document/workspace confirmation coverage for the expanded style.
- Modify `src/styles.test.ts`: retain code-theme selector coverage after export-root overrides.

### Task 1: Add the pure page-layout model and migrate ExportStyle

**Files:**
- Create: `src/lib/exportPageLayout.ts`
- Create: `src/lib/exportPageLayout.test.ts`
- Modify: `src/lib/exportDocument.ts`
- Modify: `src/lib/exportDocument.test.ts`
- Modify: `src/shell/ExportPreviewTab.tsx`

- [ ] **Step 1: Write failing page-layout model tests**

Create `src/lib/exportPageLayout.test.ts` with the exact public behavior:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_PAGE_LAYOUT,
  formatPageNumber,
  normalizeExportPageLayout,
  pageNumberTemplateForFormat,
  validatePageNumberTemplate,
  validatePdfPageGeometry,
} from './exportPageLayout';

describe('export page layout', () => {
  it('migrates legacy scalar padding to All sides', () => {
    expect(normalizeExportPageLayout({ contentPadding: 24 })).toMatchObject({
      contentPaddingMode: 'all',
      contentPaddingTop: 24,
      contentPaddingRight: 24,
      contentPaddingBottom: 24,
      contentPaddingLeft: 24,
    });
  });

  it('infers Per side for unequal persisted values', () => {
    expect(normalizeExportPageLayout({
      contentPaddingTop: 10,
      contentPaddingRight: 20,
      contentPaddingBottom: 30,
      contentPaddingLeft: 40,
    })).toMatchObject({
      contentPaddingMode: 'individual',
      contentPaddingTop: 10,
      contentPaddingRight: 20,
      contentPaddingBottom: 30,
      contentPaddingLeft: 40,
    });
  });

  it('defaults page numbers to disabled bottom-center 1/12', () => {
    expect(DEFAULT_EXPORT_PAGE_LAYOUT).toMatchObject({
      pageNumbersEnabled: false,
      pageNumberPosition: 'bottom-center',
      pageNumberFormat: 'page-total',
      pageNumberTemplate: '{page}/{pages}',
    });
    expect(formatPageNumber('{page}/{pages}', 1, 12)).toBe('1/12');
  });

  it('maps every preset and validates Custom tokens', () => {
    expect(pageNumberTemplateForFormat('page-label-of-total', '')).toBe(
      'Page {page} of {pages}',
    );
    expect(pageNumberTemplateForFormat('dash-page', '')).toBe('– {page} –');
    expect(validatePageNumberTemplate('{page} · {pages}')).toEqual({ valid: true });
    expect(validatePageNumberTemplate('{pages}')).toMatchObject({ valid: false });
    expect(validatePageNumberTemplate('{page}/{unknown}')).toMatchObject({ valid: false });
  });

  it('rejects padding and decoration bands that consume the page', () => {
    const layout = {
      ...DEFAULT_EXPORT_PAGE_LAYOUT,
      contentPaddingLeft: 60,
      contentPaddingRight: 60,
    };
    expect(validatePdfPageGeometry(100, 200, layout)).toMatchObject({ valid: false });
    expect(validatePdfPageGeometry(595, 842, layout)).toEqual({ valid: true });
  });
});
```

- [ ] **Step 2: Run the model test and verify RED**

```bash
pnpm exec vitest run src/lib/exportPageLayout.test.ts
```

Expected: FAIL because `src/lib/exportPageLayout.ts` does not exist.

- [ ] **Step 3: Implement the page-layout types and pure helpers**

Create `src/lib/exportPageLayout.ts` with these contracts:

```ts
export type ContentPaddingMode = 'all' | 'individual';
export type PageTextAlignment = 'left' | 'center' | 'right';
export type PageNumberPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type PageNumberFormat =
  | 'page-total' | 'page-total-spaced' | 'page-of-total'
  | 'page-only' | 'page-label' | 'page-label-of-total'
  | 'dash-page' | 'custom';

export interface ExportPageLayout {
  contentPaddingMode: ContentPaddingMode;
  contentPaddingTop: number;
  contentPaddingRight: number;
  contentPaddingBottom: number;
  contentPaddingLeft: number;
  headerText: string;
  headerAlignment: PageTextAlignment;
  footerText: string;
  footerAlignment: PageTextAlignment;
  pageNumbersEnabled: boolean;
  pageNumberPosition: PageNumberPosition;
  pageNumberFormat: PageNumberFormat;
  pageNumberTemplate: string;
}

export interface PdfPageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PdfPageFurniture {
  headerText: string;
  headerAlignment: PageTextAlignment;
  footerText: string;
  footerAlignment: PageTextAlignment;
  pageNumbersEnabled: boolean;
  pageNumberPosition: PageNumberPosition;
  pageNumberTemplate: string;
  textColor: string;
  fontFamily: string;
}

export const DEFAULT_EXPORT_PAGE_LAYOUT: ExportPageLayout = {
  contentPaddingMode: 'all',
  contentPaddingTop: 32,
  contentPaddingRight: 32,
  contentPaddingBottom: 32,
  contentPaddingLeft: 32,
  headerText: '',
  headerAlignment: 'center',
  footerText: '',
  footerAlignment: 'center',
  pageNumbersEnabled: false,
  pageNumberPosition: 'bottom-center',
  pageNumberFormat: 'page-total',
  pageNumberTemplate: '{page}/{pages}',
};
```

Implement:

- `normalizeExportPageLayout(value)` with `0–72` padding clamps, 120-character
  plain-text limits, enum allow-lists, scalar migration, and unequal-side mode
  inference.
- `pageNumberTemplateForFormat(format, custom)` for all seven presets plus
  Custom.
- `validatePageNumberTemplate(template)` with the 80-character limit,
  mandatory `{page}`, optional `{pages}`, and no unknown brace tokens.
- `formatPageNumber(template, page, pages)` using global literal token
  replacement.
- `pageDecorationBandHeights(layout)` using a 16 px line, 4 px stack gap, and
  6 px content gap; grow a band when text and page number share one slot.
- `validatePdfPageGeometry(pageWidth, pageHeight, layout)` requiring positive
  horizontal and vertical usable space.
- `resolvePdfPageInsets(layout)` and
  `resolvePdfPageFurniture(layout, textColor, fontFamily)`.

- [ ] **Step 4: Run the model test and verify GREEN**

```bash
pnpm exec vitest run src/lib/exportPageLayout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing ExportStyle migration and four-side CSS tests**

Add to `src/lib/exportDocument.test.ts`:

```ts
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

it('preserves page layout while applying a color Theme', () => {
  const styled = applyExportStylePreset({
    ...DEFAULT_EXPORT_STYLE,
    headerText: 'Project Atlas',
    pageNumbersEnabled: true,
    contentPaddingLeft: 48,
  }, 'dark', 'light');
  expect(styled).toMatchObject({
    preset: 'dark',
    headerText: 'Project Atlas',
    pageNumbersEnabled: true,
    contentPaddingLeft: 48,
  });
});
```

- [ ] **Step 6: Run the export-style test and verify RED**

```bash
pnpm exec vitest run src/lib/exportDocument.test.ts
```

Expected: FAIL because `ExportStyle` has no page-layout fields and CSS remains
scalar.

- [ ] **Step 7: Extend ExportStyle and update the existing uniform slider**

In `src/lib/exportDocument.ts`:

```ts
export interface ExportStyle extends PdfPaper, ExportPageLayout {
  preset: ExportStylePreset;
  // Keep the existing typography and color fields.
}

export const DEFAULT_EXPORT_STYLE: ExportStyle = {
  preset: 'app',
  // Existing defaults...
  ...DEFAULT_EXPORT_PAGE_LAYOUT,
  ...DEFAULT_PDF_PAPER,
};
```

Spread `normalizeExportPageLayout(candidate)` in `normalizeExportStyle`.
Update `LEGACY_APPEARANCE_KEYS` to include the four padding fields instead of
`contentPadding`. Preserve `normalizeExportPageLayout(current)` alongside paper
fields in `applyExportStylePreset`. Emit:

```ts
padding: ${style.contentPaddingTop}px ${style.contentPaddingRight}px
  ${style.contentPaddingBottom}px ${style.contentPaddingLeft}px;
```

In `src/shell/ExportPreviewTab.tsx`, keep the current single range compiling
until Task 4 by binding it to `contentPaddingTop` and updating all four values:

```ts
const updateUniformPadding = (value: number) => {
  setDraftStyle((current) => normalizeExportStyle({
    ...current,
    contentPaddingMode: 'all',
    contentPaddingTop: value,
    contentPaddingRight: value,
    contentPaddingBottom: value,
    contentPaddingLeft: value,
  }));
};
```

- [ ] **Step 8: Run focused tests and type checking**

```bash
pnpm exec vitest run src/lib/exportPageLayout.test.ts src/lib/exportDocument.test.ts src/shell/ExportPreviewTab.test.tsx
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 9: Commit the page-layout model**

```bash
git add src/lib/exportPageLayout.ts src/lib/exportPageLayout.test.ts src/lib/exportDocument.ts src/lib/exportDocument.test.ts src/shell/ExportPreviewTab.tsx
git commit -m "feat(export): add four-side page layout model"
```

### Task 2: Upgrade pagination and render repeated page furniture

**Files:**
- Modify: `src/lib/pdfPagination.ts`
- Modify: `src/lib/pdfPagination.test.ts`
- Modify: `src/lib/exportDocument.ts`
- Modify: `src/lib/exportDocument.test.ts`
- Modify: `src/shell/PdfPreviewPage.tsx`
- Modify: `src/shell/PdfPreviewPage.test.tsx`
- Modify: `src/shell/ExportPreviewTab.tsx`
- Modify: `src/shell/ExportPreviewTab.test.tsx`

- [ ] **Step 1: Write failing asymmetric-pagination and furniture tests**

Replace scalar-margin fixtures in `src/lib/pdfPagination.test.ts` and add:

```ts
const pageFurniture = {
  headerText: 'Project Atlas',
  headerAlignment: 'left' as const,
  footerText: 'Confidential',
  footerAlignment: 'right' as const,
  pageNumbersEnabled: true,
  pageNumberPosition: 'bottom-center' as const,
  pageNumberTemplate: '{page}/{pages}',
  textColor: '#202124',
  fontFamily: 'sans-serif',
};

it('moves a crossing block between asymmetric usable bounds', () => {
  document.body.innerHTML =
    '<main class="markdowner-export"><p id="crossing"></p></main>';
  const crossing = document.querySelector('#crossing') as HTMLElement;
  vi.spyOn(crossing, 'getBoundingClientRect').mockReturnValue(rect(170, 35));

  paginatePdfDocument(document, {
    pageWidth: 160,
    pageHeight: 200,
    pageInsets: { top: 12, right: 18, bottom: 28, left: 24 },
    pageFurniture: { ...pageFurniture, headerText: '', footerText: '', pageNumbersEnabled: false },
    maxPages: 100,
  });

  expect(crossing.style.marginTop).toBe('42px');
  expect((document.querySelector('.markdowner-export') as HTMLElement).style.paddingLeft)
    .toBe('24px');
  expect((document.querySelector('.markdowner-export') as HTMLElement).style.paddingRight)
    .toBe('18px');
});

it('repeats text and page-specific numbers on every page', () => {
  document.body.innerHTML =
    '<main class="markdowner-export"><p id="long"></p></main>';
  vi.spyOn(document.querySelector('#long') as HTMLElement, 'getBoundingClientRect')
    .mockReturnValue(rect(20, 260));

  const result = paginatePdfDocument(document, {
    pageWidth: 160,
    pageHeight: 200,
    pageInsets: { top: 12, right: 18, bottom: 28, left: 24 },
    pageFurniture,
    maxPages: 100,
  });

  expect(result.pageCount).toBe(2);
  const layers = document.querySelectorAll('[data-markdowner-pdf-decoration]');
  expect(layers).toHaveLength(2);
  expect(layers[0]).toHaveTextContent('Project Atlas');
  expect(layers[0]).toHaveTextContent('Confidential');
  expect(layers[0]).toHaveTextContent('1/2');
  expect(layers[1]).toHaveTextContent('2/2');
});

it('removes old decoration layers before rerunning', () => {
  document.body.innerHTML =
    '<main class="markdowner-export"><p id="long"></p></main>';
  vi.spyOn(document.querySelector('#long') as HTMLElement, 'getBoundingClientRect')
    .mockReturnValue(rect(20, 260));
  const options = {
    pageWidth: 160,
    pageHeight: 200,
    pageInsets: { top: 12, right: 18, bottom: 28, left: 24 },
    pageFurniture,
    maxPages: 100,
  };

  const first = paginatePdfDocument(document, options);
  const second = paginatePdfDocument(document, options);

  expect(second.pageCount).toBe(first.pageCount);
  expect(document.querySelectorAll('[data-markdowner-pdf-decoration]'))
    .toHaveLength(second.pageCount);
});
```

Add a parameterized test for all six `PageNumberPosition` values and a same-slot
case asserting two stacked children rather than overwritten text.

- [ ] **Step 2: Run pagination tests and verify RED**

```bash
pnpm exec vitest run src/lib/pdfPagination.test.ts
```

Expected: Type errors for the new options and failing decoration assertions.

- [ ] **Step 3: Replace scalar pageMargin with page insets and furniture**

In `src/lib/pdfPagination.ts`, change the public contracts:

```ts
export interface PdfPaginationOptions {
  pageWidth: number;
  pageHeight: number;
  pageInsets: PdfPageInsets;
  pageFurniture: PdfPageFurniture;
  maxPages: number;
}

export interface PdfPaginationRuntimeConfig extends PdfPaginationOptions {
  token: string;
}
```

At the start of `paginatePdfDocument`, remove direct children marked
`data-markdowner-pdf-decoration`, restore saved block margins, and validate via
`validatePdfPageGeometry`. Apply left/right padding and the effective first-page
top inset. Use the computed top/bottom usable bounds for every page instead of
`pageMargin`.

After `pageCount` is known, create one absolute layer per page:

```ts
const layer = doc.createElement('div');
layer.dataset.markdownerPdfDecoration = String(pageIndex + 1);
layer.style.cssText =
  `position:absolute;left:0;top:${pageIndex * pageHeight}px;` +
  `width:${pageWidth}px;height:${pageHeight}px;pointer-events:none;`;
```

Create top and bottom three-column grids. Put header/footer text and page number
in the selected column using `textContent`. When two values share a cell, append
two child spans in a column with the specified 4 px gap. Never set `innerHTML`.

- [ ] **Step 4: Serialize every pure helper into the embedded runtime**

`paginatePdfDocument.toString()` now references page-layout helpers. In
`buildPdfPaginationScript`, serialize them into the same IIFE before the
paginator:

```ts
var formatPageNumber = ${formatPageNumber.toString()};
var pageDecorationBandHeights = ${pageDecorationBandHeights.toString()};
var validatePdfPageGeometry = ${validatePdfPageGeometry.toString()};
var paginate = ${paginatePdfDocument.toString()};
```

Pass `pageWidth`, `pageHeight`, `pageInsets`, `pageFurniture`, and `maxPages` to
`paginate`. Keep the existing token-scoped result/error globals and message
contract.

- [ ] **Step 5: Run pagination tests and verify GREEN**

```bash
pnpm exec vitest run src/lib/exportPageLayout.test.ts src/lib/pdfPagination.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write failing HTML/runtime and PdfPreviewPage tests**

In `src/lib/exportDocument.test.ts`, assert printing HTML embeds exact
asymmetric insets, header/footer strings, and page-number template in the
runtime config. Assert non-print HTML contains none of the decoration config.

In `src/shell/PdfPreviewPage.test.tsx`, render:

```tsx
<PdfPreviewPage
  html="<html><body><main class='markdowner-export'>Body</main></body></html>"
  token="preview-token"
  pageIndex={0}
  width={595}
  height={842}
  pageInsets={{ top: 10, right: 20, bottom: 30, left: 40 }}
  pageFurniture={pageFurniture}
  backgroundColor="#fff"
  onReady={onReady}
  onError={onError}
/>
```

After iframe load, assert the content container uses `40px` left and `20px`
right padding and contains the expected decoration text.

- [ ] **Step 7: Run the component/runtime tests and verify RED**

```bash
pnpm exec vitest run src/lib/exportDocument.test.ts src/shell/PdfPreviewPage.test.tsx src/shell/ExportPreviewTab.test.tsx
```

Expected: FAIL because callers still pass `pageMargin`.

- [ ] **Step 8: Wire the exact contract through HTML and Preview**

In `buildExportHtml`, resolve `pageInsets` and `pageFurniture`, then pass them to
`buildPdfPaginationScript`. In `PdfPreviewPage`, replace `pageMargin` with
`pageInsets` and `pageFurniture` props and call:

```ts
paginatePdfDocument(frameDocument, {
  pageWidth: width,
  pageHeight: height,
  pageInsets,
  pageFurniture,
  maxPages: MAX_PDF_PAGES,
});
```

In `ExportPreviewTab`, resolve the same objects from `draftStyle` once and pass
them to each page. Update the test mock prop contract and add
`data-page-insets={JSON.stringify(pageInsets)}` so component assertions can
inspect exact values.

- [ ] **Step 9: Run focused tests and type checking**

```bash
pnpm exec vitest run src/lib/exportPageLayout.test.ts src/lib/pdfPagination.test.ts src/lib/exportDocument.test.ts src/shell/PdfPreviewPage.test.tsx src/shell/ExportPreviewTab.test.tsx
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 10: Commit shared pagination furniture**

```bash
git add src/lib/pdfPagination.ts src/lib/pdfPagination.test.ts src/lib/exportDocument.ts src/lib/exportDocument.test.ts src/shell/PdfPreviewPage.tsx src/shell/PdfPreviewPage.test.tsx src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx
git commit -m "feat(export): repeat PDF page furniture"
```

### Task 3: Add export code-theme and inline-code preset models

**Files:**
- Create: `src/lib/exportCodeStyles.ts`
- Create: `src/lib/exportCodeStyles.test.ts`
- Modify: `src/lib/exportDocument.ts`
- Modify: `src/lib/exportDocument.test.ts`

- [ ] **Step 1: Write failing preset and migration tests**

Create `src/lib/exportCodeStyles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  INLINE_CODE_PRESETS,
  inferInlineCodePreset,
  normalizeExportCodeBlockTheme,
  resolveInlineCodePalette,
  resolveExportTone,
} from './exportCodeStyles';

describe('export code styles', () => {
  it('offers the approved extended preset catalog', () => {
    expect(INLINE_CODE_PRESETS.map((entry) => entry.value)).toEqual([
      'theme', 'neutral', 'amber', 'blue', 'green', 'rose', 'contrast', 'custom',
    ]);
  });

  it.each(['neutral', 'amber', 'blue', 'green', 'rose', 'contrast'] as const)(
    'returns readable light and dark variants for %s',
    (preset) => {
      expect(resolveInlineCodePalette(preset, 'light')).not.toEqual(
        resolveInlineCodePalette(preset, 'dark'),
      );
    },
  );

  it('derives Match export theme from the resolved export colors', () => {
    expect(resolveInlineCodePalette('theme', 'light', {
      textColor: '#202124',
      surfaceColor: '#f4f4f5',
    })).toEqual({ textColor: '#202124', backgroundColor: '#f4f4f5' });
  });

  it('infers Amber from legacy defaults and Custom from unknown valid colors', () => {
    expect(inferInlineCodePreset('#7c2d12', '#ffedd5')).toBe('amber');
    expect(inferInlineCodePreset('#123456', '#abcdef')).toBe('custom');
  });

  it('validates fixed and Match app code themes', () => {
    expect(normalizeExportCodeBlockTheme('app')).toBe('app');
    expect(normalizeExportCodeBlockTheme('github-light')).toBe('github-light');
    expect(normalizeExportCodeBlockTheme('unknown')).toBe('app');
  });

  it('uses background luminance for a Custom export palette', () => {
    expect(resolveExportTone('custom', '#fafafa', 'dark')).toBe('light');
    expect(resolveExportTone('custom', '#111827', 'light')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the model test and verify RED**

```bash
pnpm exec vitest run src/lib/exportCodeStyles.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement code-style types and palette helpers**

Create:

```ts
export type ExportCodeBlockTheme = 'app' | CodeBlockTheme;
export type InlineCodePreset =
  | 'theme' | 'neutral' | 'amber' | 'blue'
  | 'green' | 'rose' | 'contrast' | 'custom';

export const INLINE_CODE_PRESETS = [
  { value: 'theme', label: 'Match export theme' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'amber', label: 'Amber' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'rose', label: 'Rose' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'custom', label: 'Custom' },
] as const;
```

Implement paired light/dark hex colors using the approved mockup values:

- Neutral: `#37352f/#f1f1ef`, `#f4f4f5/#2f2f32`
- Amber: `#7c2d12/#ffedd5`, `#fed7aa/#431407`
- Blue: `#1e3a8a/#e8eefc`, `#bfdbfe/#172554`
- Green: `#166534/#dcfce7`, `#bbf7d0/#052e16`
- Rose: `#9d174d/#fce7f3`, `#fbcfe8/#500724`
- Contrast: `#f9fafb/#111827`, `#111827/#f9fafb`

`resolveInlineCodePalette('theme', ...)` returns the supplied export
text/surface pair. `inferInlineCodePreset` compares both tone variants.
`normalizeExportCodeBlockTheme` validates against `CODE_BLOCK_THEMES`.

- [ ] **Step 4: Run the model test and verify GREEN**

```bash
pnpm exec vitest run src/lib/exportCodeStyles.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing ExportStyle and generated-root tests**

Add:

```ts
it('migrates legacy inline colors and defaults fenced code to Match app', () => {
  expect(normalizeExportStyle({
    inlineCodeTextColor: '#7c2d12',
    inlineCodeBackgroundColor: '#ffedd5',
  })).toMatchObject({
    codeBlockTheme: 'app',
    inlineCodePreset: 'amber',
  });
});

it('overrides the exported root with a fixed fenced-code theme', async () => {
  const html = await buildExportHtml({
    title: 'Code',
    source: '```ts\\nconst n = 1\\n```',
    activeDocumentPath: null,
    style: { ...DEFAULT_EXPORT_STYLE, codeBlockTheme: 'github-light' },
  });
  expect(html).toContain('data-cb-theme="github-light"');
  expect(html).toContain('data-cb-highlight="on"');
  expect(html).not.toContain('data-cb-theme="one-dark"');
});

it('preserves fixed code choices while changing the Export Theme', () => {
  const next = applyExportStylePreset({
    ...DEFAULT_EXPORT_STYLE,
    codeBlockTheme: 'ayu-dark',
    inlineCodePreset: 'blue',
  }, 'dark', 'light');
  expect(next).toMatchObject({
    codeBlockTheme: 'ayu-dark',
    inlineCodePreset: 'blue',
    inlineCodeTextColor: '#bfdbfe',
    inlineCodeBackgroundColor: '#172554',
  });
});
```

- [ ] **Step 6: Run export tests and verify RED**

```bash
pnpm exec vitest run src/lib/exportDocument.test.ts
```

Expected: FAIL for missing fields and unchanged root attributes.

- [ ] **Step 7: Integrate code-style normalization and root override**

Extend `ExportStyle` with `codeBlockTheme` and `inlineCodePreset`. Add
`codeBlockTheme: 'app'` and `inlineCodePreset: 'amber'` defaults. During
normalization, infer a missing inline preset from saved colors, validate fixed
themes, resolve the current light/dark tone, and materialize non-custom colors.

Replace `rootAttributes(doc)` with:

```ts
function rootAttributes(doc: Document, codeBlockTheme: ExportCodeBlockTheme): string {
  const attributes = new Map(
    Array.from(doc.documentElement.attributes, (attr) => [attr.name, attr.value]),
  );
  if (codeBlockTheme !== 'app') attributes.set('data-cb-theme', codeBlockTheme);
  attributes.set('data-cb-highlight', 'on');
  return Array.from(attributes, ([name, value]) =>
    `${name}="${escapeHtml(value)}"`).join(' ');
}
```

Make `applyExportStylePreset` preserve `codeBlockTheme` and
`inlineCodePreset`, then re-resolve non-custom inline colors for the new tone.

- [ ] **Step 8: Run focused tests and type checking**

```bash
pnpm exec vitest run src/lib/exportCodeStyles.test.ts src/lib/exportDocument.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 9: Commit export code-style models**

```bash
git add src/lib/exportCodeStyles.ts src/lib/exportCodeStyles.test.ts src/lib/exportDocument.ts src/lib/exportDocument.test.ts
git commit -m "feat(export): add code style presets"
```

### Task 4: Build the approved Content padding controls

**Files:**
- Create: `src/shell/ExportControlPrimitives.tsx`
- Create: `src/shell/ContentPaddingControls.tsx`
- Create: `src/shell/ContentPaddingControls.test.tsx`
- Modify: `src/shell/ExportPreviewTab.tsx`
- Modify: `src/shell/ExportPreviewTab.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_PAGE_LAYOUT } from '@/lib/exportPageLayout';
import { ContentPaddingControls } from './ContentPaddingControls';

describe('ContentPaddingControls', () => {
  it('starts in All sides and emits four equal values', () => {
    const onChange = vi.fn();
    render(<ContentPaddingControls value={DEFAULT_EXPORT_PAGE_LAYOUT} disabled={false}
      onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'All sides' })).toHaveAttribute(
      'aria-pressed', 'true',
    );
    fireEvent.change(screen.getByLabelText('All sides padding'), {
      target: { value: '40' },
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      contentPaddingMode: 'all',
      contentPaddingTop: 40,
      contentPaddingRight: 40,
      contentPaddingBottom: 40,
      contentPaddingLeft: 40,
    }));
  });

  it('shows Top Right Bottom Left in Per side mode and preserves values', () => {
    const onChange = vi.fn();
    render(<ContentPaddingControls value={{
      ...DEFAULT_EXPORT_PAGE_LAYOUT,
      contentPaddingMode: 'individual',
      contentPaddingTop: 10,
      contentPaddingRight: 20,
      contentPaddingBottom: 30,
      contentPaddingLeft: 40,
    }} disabled={false} onChange={onChange} />);
    expect(screen.getByLabelText('Top padding')).toHaveValue('10');
    expect(screen.getByLabelText('Right padding')).toHaveValue('20');
    expect(screen.getByLabelText('Bottom padding')).toHaveValue('30');
    expect(screen.getByLabelText('Left padding')).toHaveValue('40');
  });
});
```

Add an `ExportPreviewTab.test.tsx` assertion that Per side edits reach the
preview builder and confirmed style.

- [ ] **Step 2: Run component tests and verify RED**

```bash
pnpm exec vitest run src/shell/ContentPaddingControls.test.tsx src/shell/ExportPreviewTab.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Extract common control primitives**

Move the current `RangeControl` and `ColorControl` implementations unchanged
from `ExportPreviewTab.tsx` to `ExportControlPrimitives.tsx`, exporting them as
`ExportRangeControl` and `ExportColorControl`. Keep all current labels, range
semantics, color inputs, disabled behavior, and classes.

- [ ] **Step 4: Implement the segmented padding component**

Use two pressed buttons with `aria-label="All sides"` and
`aria-label="Per side"`. In All sides mode, render one `ExportRangeControl`
labelled `All sides padding`. In Per side mode, render four controls in a
two-column grid with Top, Right, Bottom, Left labels. Emit a complete
`ExportPageLayout` patch on every change. Switching from Per side to All sides
copies the top value to every side.

- [ ] **Step 5: Replace the old scalar control in ExportPreviewTab**

Render:

```tsx
<ContentPaddingControls
  value={draftStyle}
  disabled={busy}
  onChange={(layout) => setDraftStyle((current) => normalizeExportStyle({
    ...current,
    ...layout,
  }))}
/>
```

- [ ] **Step 6: Run focused tests and type checking**

```bash
pnpm exec vitest run src/shell/ContentPaddingControls.test.tsx src/shell/ExportPreviewTab.test.tsx
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 7: Commit the padding UI**

```bash
git add src/shell/ExportControlPrimitives.tsx src/shell/ContentPaddingControls.tsx src/shell/ContentPaddingControls.test.tsx src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx
git commit -m "feat(export): add per-side padding controls"
```

### Task 5: Add header, footer, and page-number controls

**Files:**
- Create: `src/shell/PdfPageFurnitureControls.tsx`
- Create: `src/shell/PdfPageFurnitureControls.test.tsx`
- Modify: `src/shell/ExportPreviewTab.tsx`
- Modify: `src/shell/ExportPreviewTab.test.tsx`

- [ ] **Step 1: Write failing furniture-control tests**

Create:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_PAGE_LAYOUT } from '@/lib/exportPageLayout';
import { PdfPageFurnitureControls } from './PdfPageFurnitureControls';

describe('PdfPageFurnitureControls', () => {
  it('emits optional text and independent alignments', () => {
    const onChange = vi.fn();
    render(<PdfPageFurnitureControls value={DEFAULT_EXPORT_PAGE_LAYOUT}
      disabled={false} errorMessage={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Header text (optional)'), {
      target: { value: 'Project Atlas' },
    });
    fireEvent.change(screen.getByLabelText('Header alignment'), {
      target: { value: 'left' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      headerText: 'Project Atlas',
    }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      headerAlignment: 'left',
    }));
  });

  it('defaults enabled page numbers to bottom-center 1/12', () => {
    const onChange = vi.fn();
    render(<PdfPageFurnitureControls value={DEFAULT_EXPORT_PAGE_LAYOUT}
      disabled={false} errorMessage={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Page numbers' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      pageNumbersEnabled: true,
      pageNumberPosition: 'bottom-center',
      pageNumberFormat: 'page-total',
    }));
  });

  it('shows and validates the Custom template', () => {
    render(<PdfPageFurnitureControls value={{
      ...DEFAULT_EXPORT_PAGE_LAYOUT,
      pageNumbersEnabled: true,
      pageNumberFormat: 'custom',
      pageNumberTemplate: '{pages}',
    }} disabled={false} errorMessage="Include {page}." onChange={() => {}} />);
    expect(screen.getByLabelText('Custom page number template')).toHaveValue('{pages}');
    expect(screen.getByRole('alert')).toHaveTextContent('Include {page}.');
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm exec vitest run src/shell/PdfPageFurnitureControls.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the PDF-only control component**

Use native text/select controls and the shared `Switch`. Limit typed header and
footer values to 120 characters. Render all alignment options. Render Page
numbers Format and Position only while enabled. Render Custom input only for
`pageNumberFormat === 'custom'`, and expose:

```tsx
<output aria-live="polite">
  Preview · {formatPageNumber(activeTemplate, 1, 12)}
</output>
```

Keep invalid Custom text unchanged and associate the alert with the input via
`aria-describedby`.

- [ ] **Step 4: Write failing Export Preview validity tests**

Add tests proving:

- Header/footer controls are absent for HTML and present for PDF.
- Entering text rebuilds PDF Preview and the mocked page receives furniture.
- Enabling page numbers yields `bottom-center` and `{page}/{pages}`.
- An invalid Custom template leaves the raw value visible, stops new
  `buildPreview` calls, and disables Export.
- Fixing the template resumes Preview and re-enables Export after pagination
  readiness.
- A tiny Custom paper plus excessive side padding displays a geometry error and
  disables Export.

- [ ] **Step 5: Run Export Preview tests and verify RED**

```bash
pnpm exec vitest run src/shell/ExportPreviewTab.test.tsx
```

Expected: FAIL because Export Preview does not render or validate page furniture.

- [ ] **Step 6: Wire furniture and validity into ExportPreviewTab**

Derive:

```ts
const template = pageNumberTemplateForFormat(
  draftStyle.pageNumberFormat,
  draftStyle.pageNumberTemplate,
);
const templateValidation = draftStyle.pageNumbersEnabled
  ? validatePageNumberTemplate(template)
  : { valid: true as const };
const geometryValidation = validatePdfPageGeometry(
  pageSize.width,
  pageSize.height,
  draftStyle,
);
const pageLayoutValid =
  !isPdf || (templateValidation.valid && geometryValidation.valid);
```

Pause the preview-building effect when PDF paper or page layout is invalid.
Require `pageLayoutValid` in the Export button. Pass the exact error to
`PdfPageFurnitureControls`. Update draft text without calling
`normalizeExportStyle` so temporarily invalid Custom input survives; normalize
only after validation and confirmation.

- [ ] **Step 7: Run focused tests and type checking**

```bash
pnpm exec vitest run src/lib/exportPageLayout.test.ts src/lib/pdfPagination.test.ts src/shell/PdfPageFurnitureControls.test.tsx src/shell/ExportPreviewTab.test.tsx
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 8: Commit PDF page controls**

```bash
git add src/shell/PdfPageFurnitureControls.tsx src/shell/PdfPageFurnitureControls.test.tsx src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx
git commit -m "feat(export): add PDF header footer and page number controls"
```

### Task 6: Add code-style controls and App integration

**Files:**
- Create: `src/shell/ExportCodeStyleControls.tsx`
- Create: `src/shell/ExportCodeStyleControls.test.tsx`
- Modify: `src/shell/ExportPreviewTab.tsx`
- Modify: `src/shell/ExportPreviewTab.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.test.ts`

- [ ] **Step 1: Write failing code-control tests**

Create:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_STYLE } from '@/lib/exportDocument';
import { CODE_BLOCK_THEMES } from '@/lib/settings';
import { INLINE_CODE_PRESETS } from '@/lib/exportCodeStyles';
import { ExportCodeStyleControls } from './ExportCodeStyleControls';

describe('ExportCodeStyleControls', () => {
  it('offers Match app plus all fenced-code themes', () => {
    render(<ExportCodeStyleControls value={DEFAULT_EXPORT_STYLE}
      appCodeBlockTheme="one-dark" appTheme="dark" disabled={false}
      onChange={() => {}} />);
    const select = screen.getByLabelText('Code block theme') as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      'app',
      ...CODE_BLOCK_THEMES.map((theme) => theme.value),
    ]);
    expect(select.options[0]?.textContent).toContain('One Dark');
  });

  it('offers every approved inline preset and applies Blue', () => {
    const onChange = vi.fn();
    render(<ExportCodeStyleControls value={DEFAULT_EXPORT_STYLE}
      appCodeBlockTheme="one-dark" appTheme="light" disabled={false}
      onChange={onChange} />);
    const select = screen.getByLabelText('Inline code preset') as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.value)).toEqual(
      INLINE_CODE_PRESETS.map((preset) => preset.value),
    );
    fireEvent.change(select, { target: { value: 'blue' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      inlineCodePreset: 'blue',
      inlineCodeTextColor: '#1e3a8a',
      inlineCodeBackgroundColor: '#e8eefc',
    }));
  });

  it('shows color pickers only for Custom', () => {
    const { rerender } = render(<ExportCodeStyleControls
      value={{ ...DEFAULT_EXPORT_STYLE, inlineCodePreset: 'blue' }}
      appCodeBlockTheme="one-dark" appTheme="light" disabled={false}
      onChange={() => {}} />);
    expect(screen.queryByLabelText('Inline code text color')).toBeNull();
    rerender(<ExportCodeStyleControls
      value={{ ...DEFAULT_EXPORT_STYLE, inlineCodePreset: 'custom' }}
      appCodeBlockTheme="one-dark" appTheme="light" disabled={false}
      onChange={() => {}} />);
    expect(screen.getByLabelText('Inline code text color')).toBeInTheDocument();
    expect(screen.getByLabelText('Inline code background color')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component tests and verify RED**

```bash
pnpm exec vitest run src/shell/ExportCodeStyleControls.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement fenced and inline code controls**

Use `CODE_BLOCK_THEMES`, `INLINE_CODE_PRESETS`, and
`ExportColorControl`. Label Match app as
`Match app theme — ${resolved label}`. For a non-custom inline selection,
resolve and emit its tone-specific pair. For Custom, keep the current colors and
render both color controls. Render a sample `<code>` chip for every selection.

- [ ] **Step 4: Write failing Export Preview and App tests**

Add `ExportPreviewTab.test.tsx` coverage proving:

- Fixed fenced-code selection reaches `buildPreview`.
- Match app rebuilds when `appCodeBlockTheme` changes.
- Blue/Green/Rose/Contrast choices update inline CSS and confirmed style.
- Reset returns fenced code to Match app while preserving paper/page layout.
- Busy mode disables both selectors and Custom colors.

Add `App.test.tsx` coverage around the existing export flow:

```ts
expect(screen.getByLabelText('Code block theme')).toHaveValue('app');
expect(screen.getByLabelText('Inline code preset')).toHaveValue('amber');
```

Load settings with `codeBlockTheme: 'github-light'`,
`codeBlockThemeSync: false`, open Export Preview, and assert the Match app
option label includes `GitHub Light`. Confirm a fixed theme and page furniture,
then assert the style passed into generated document/workspace HTML contains
those fields.

- [ ] **Step 5: Run tests and verify RED**

```bash
pnpm exec vitest run src/shell/ExportCodeStyleControls.test.tsx src/shell/ExportPreviewTab.test.tsx src/App.test.tsx src/styles.test.ts
```

Expected: FAIL because Export Preview and App do not pass the resolved app code
theme or render the new component.

- [ ] **Step 6: Compose code controls and pass the app theme**

Add required `appCodeBlockTheme: CodeBlockTheme` to
`ExportPreviewTabProps`. Render:

```tsx
<ExportCodeStyleControls
  value={draftStyle}
  appCodeBlockTheme={appCodeBlockTheme}
  appTheme={appTheme}
  disabled={busy}
  onChange={(patch) => setDraftStyle((current) => normalizeExportStyle({
    ...current,
    ...patch,
  }))}
/>
```

Include `appCodeBlockTheme` in the preview-building effect dependencies so a
Match app draft rebuilds after a live app-theme change. In `App.tsx`, pass the
existing `effectiveCodeBlockTheme`.

Update Reset to apply the app color Theme while preserving paper/page layout
and reset `codeBlockTheme` to `app`; keep the currently selected inline preset
unless the user explicitly chooses Reset, in which case return it to Amber.

- [ ] **Step 7: Run focused tests and type checking**

```bash
pnpm exec vitest run src/lib/exportCodeStyles.test.ts src/lib/exportDocument.test.ts src/shell/ExportCodeStyleControls.test.tsx src/shell/ExportPreviewTab.test.tsx src/App.test.tsx src/styles.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 8: Commit UI and App integration**

```bash
git add src/shell/ExportCodeStyleControls.tsx src/shell/ExportCodeStyleControls.test.tsx src/shell/ExportPreviewTab.tsx src/shell/ExportPreviewTab.test.tsx src/App.tsx src/App.test.tsx src/styles.test.ts
git commit -m "feat(export): add code style controls"
```

### Task 7: Prove document and workspace export contracts

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/lib/exportDocument.test.ts`
- Modify: `src/lib/pdfPagination.test.ts`

- [ ] **Step 1: Add failing integration assertions for every explicit requirement**

Extend the existing document PDF test to select Per side
`10/20/30/40`, enter header/footer text, choose independent alignments, enable
page numbers, choose a non-default position/format, select a fixed fenced-code
theme, and choose Rose inline code. Confirm and assert the native PDF bridge
receives HTML containing:

```ts
expect.stringContaining('data-cb-theme="flexoki-dark"')
expect.stringContaining('"top":10')
expect.stringContaining('"right":20')
expect.stringContaining('"bottom":30')
expect.stringContaining('"left":40')
expect.stringContaining('"headerText":"Project Atlas"')
expect.stringContaining('"footerText":"Confidential"')
expect.stringContaining('"pageNumberTemplate":"Page {page} of {pages}"')
```

Extend the workspace PDF test to assert both generated HTML strings carry the
same furniture/style config while each has its own pagination script and page
count lifecycle. Add a non-print HTML test proving it contains four-side CSS and
code styles but no `data-markdowner-pdf-decoration` runtime config.

- [ ] **Step 2: Run integration tests and verify RED**

```bash
pnpm exec vitest run src/App.test.tsx src/lib/exportDocument.test.ts src/lib/pdfPagination.test.ts
```

Expected: at least one assertion fails if any contract is not wired end to end.

- [ ] **Step 3: Route one normalized style through every export branch**

Use the existing `handleConfirmExport` path and keep the Tauri command payload
unchanged. Both document and workspace branches must call:

```ts
const html = await buildExportHtml({
  title,
  source,
  activeDocumentPath,
  forPrint: request.format === 'pdf',
  style,
});
```

where `style` is the one `normalizeExportStyle(nextStyle)` result created at
confirmation. Do not reconstruct a partial style inside either branch.
`buildExportHtml` must guard PDF-only runtime generation solely with
`forPrint`, so HTML retains four-side padding/code colors but contains no page
furniture script config.

- [ ] **Step 4: Run the integration slice and verify GREEN**

```bash
pnpm exec vitest run src/App.test.tsx src/lib/exportDocument.test.ts src/lib/pdfPagination.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit end-to-end coverage**

```bash
git add src/App.test.tsx src/lib/exportDocument.test.ts src/lib/pdfPagination.test.ts src/App.tsx src/lib/exportDocument.ts src/lib/pdfPagination.ts
git commit -m "test(export): cover PDF layout and code styles end to end"
```

### Task 8: Full verification and installed-app PDF proof

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: Run the focused feature suite**

```bash
pnpm exec vitest run \
  src/lib/exportPageLayout.test.ts \
  src/lib/exportCodeStyles.test.ts \
  src/lib/exportDocument.test.ts \
  src/lib/pdfPagination.test.ts \
  src/shell/ContentPaddingControls.test.tsx \
  src/shell/PdfPageFurnitureControls.test.tsx \
  src/shell/ExportCodeStyleControls.test.tsx \
  src/shell/PdfPreviewPage.test.tsx \
  src/shell/ExportPreviewTab.test.tsx \
  src/App.test.tsx \
  src/styles.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run static, full repository, Rust, and build checks**

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Install and open the actual app**

```bash
pnpm build:install:open
```

Expected: packaging, install, code-sign verification, and app launch all
succeed.

- [ ] **Step 4: Verify the deterministic multi-page fixture in Export Preview**

Open a Markdown document containing at least three pages of prose, a table,
inline code, fenced TypeScript code, and an image. Verify:

- All sides changes every edge together.
- Per side visibly produces different top/right/bottom/left content insets.
- Header and footer text repeat on every preview sheet with selected
  alignments.
- Default page numbers read `1/N`, `2/N`, and `3/N` at bottom center.
- Two other format/position presets and one Custom template render correctly.
- GitHub Light and Monokai Dark visibly change fenced code.
- Neutral, Amber, Blue, Green, Rose, and Contrast each remain readable under
  Light and Dark export themes.
- Export stays disabled for an invalid custom template and for impossible
  Custom-paper geometry.

- [ ] **Step 5: Export PDF and compare the artifact**

Export the same fixture, inspect the PDF in Preview.app or `pdfinfo`, and verify:

- PDF page count equals Export Preview page count.
- Header/footer/page-number text and positions match on every page.
- Content boundaries match asymmetric Preview insets.
- Fenced and inline code colors match Preview.
- Media boxes match the selected paper size exactly.

- [ ] **Step 6: Audit the objective requirement by requirement**

Use source, tests, rendered Preview, and final PDF as evidence for:

1. one-value and four-value Content padding;
2. optional repeated header text;
3. optional repeated footer text;
4. optional page numbers with bottom-center `1/N` default;
5. preset plus Custom page-number formats and six positions;
6. Match app plus ten fixed fenced-code themes; and
7. Match export theme plus six inline-code palettes and Custom colors.

Do not mark the goal complete if any evidence is missing or only unit-level.

- [ ] **Step 7: Commit any verification fixes**

If verification required code changes, rerun the failing RED/GREEN slice and
all Step 2 commands, then commit only those fixes:

```bash
git add \
  src/lib/exportPageLayout.ts \
  src/lib/exportPageLayout.test.ts \
  src/lib/exportCodeStyles.ts \
  src/lib/exportCodeStyles.test.ts \
  src/lib/exportDocument.ts \
  src/lib/exportDocument.test.ts \
  src/lib/pdfPagination.ts \
  src/lib/pdfPagination.test.ts \
  src/shell/ExportControlPrimitives.tsx \
  src/shell/ContentPaddingControls.tsx \
  src/shell/ContentPaddingControls.test.tsx \
  src/shell/PdfPageFurnitureControls.tsx \
  src/shell/PdfPageFurnitureControls.test.tsx \
  src/shell/ExportCodeStyleControls.tsx \
  src/shell/ExportCodeStyleControls.test.tsx \
  src/shell/PdfPreviewPage.tsx \
  src/shell/PdfPreviewPage.test.tsx \
  src/shell/ExportPreviewTab.tsx \
  src/shell/ExportPreviewTab.test.tsx \
  src/App.tsx \
  src/App.test.tsx \
  src/styles.test.ts
git commit -m "fix(export): align PDF preview and artifact"
```

If no files changed, record the clean `git status --short --branch` output and
do not create an empty commit.
