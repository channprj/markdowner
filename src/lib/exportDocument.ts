import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { readImagesBase64, type EmbeddedImageResult } from './desktop';
import {
  resolveMarkdownImageLocalPath,
  resolveMarkdownImageSrc,
} from './markdownImageSrc';
import {
  RAW_HTML_IMAGE_TITLE_PREFIX,
  createSourceLineMarkdownComponents,
} from './sourceLineComponents';
import {
  DEFAULT_EXPORT_PAGE_LAYOUT,
  normalizeExportPageLayout,
  type ExportPageLayout,
} from './exportPageLayout';
import {
  DEFAULT_PDF_PAPER,
  MAX_PDF_PAGES,
  normalizePdfPaper,
  resolvePdfPaper,
  type PdfPaper,
} from './pdfPaper';
import { buildPdfPaginationScript } from './pdfPagination';
import { MARKDOWN_CONTENT_SCOPE_CLASS } from './themeScope';

const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdown|mkd)$/i;
const PATH_SEPARATOR_RE = /[\\/]/;
const EXPORT_STYLE_STORAGE_KEY = 'markdowner.exportStyle.v1';
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export type ExportFormat = 'html' | 'pdf';
export type ExportScope = 'document' | 'workspace';
export type ExportFontFamily = 'sans' | 'serif' | 'mono';
export type ExportStylePreset = 'app' | 'light' | 'dark' | 'custom';
export type ExportTheme = 'light' | 'dark';

export interface ExportStyle extends PdfPaper, ExportPageLayout {
  preset: ExportStylePreset;
  fontSize: number;
  fontFamily: ExportFontFamily;
  textColor: string;
  backgroundColor: string;
  inlineCodeTextColor: string;
  inlineCodeBackgroundColor: string;
  kbdTextColor: string;
  kbdBackgroundColor: string;
  tableBorderColor: string;
  tableHeaderTextColor: string;
  tableHeaderBackgroundColor: string;
  lineHeight: number;
  paragraphSpacing: number;
}

export const DEFAULT_EXPORT_STYLE: ExportStyle = {
  preset: 'app',
  fontSize: 14,
  fontFamily: 'sans',
  textColor: '#202124',
  backgroundColor: '#ffffff',
  inlineCodeTextColor: '#7c2d12',
  inlineCodeBackgroundColor: '#ffedd5',
  kbdTextColor: '#334155',
  kbdBackgroundColor: '#e2e8f0',
  tableBorderColor: '#d4d4d8',
  tableHeaderTextColor: '#18181b',
  tableHeaderBackgroundColor: '#f4f4f5',
  lineHeight: 1.6,
  paragraphSpacing: 8,
  ...DEFAULT_EXPORT_PAGE_LAYOUT,
  ...DEFAULT_PDF_PAPER,
};

export const DARK_EXPORT_STYLE: ExportStyle = {
  ...DEFAULT_EXPORT_STYLE,
  preset: 'dark',
  textColor: '#f4f4f5',
  backgroundColor: '#18181b',
  inlineCodeTextColor: '#fed7aa',
  inlineCodeBackgroundColor: '#431407',
  kbdTextColor: '#e2e8f0',
  kbdBackgroundColor: '#334155',
  tableBorderColor: '#3f3f46',
  tableHeaderTextColor: '#fafafa',
  tableHeaderBackgroundColor: '#27272a',
};

const LEGACY_APPEARANCE_KEYS = [
  'fontSize',
  'fontFamily',
  'textColor',
  'backgroundColor',
  'inlineCodeTextColor',
  'inlineCodeBackgroundColor',
  'kbdTextColor',
  'kbdBackgroundColor',
  'lineHeight',
  'paragraphSpacing',
  'contentPaddingTop',
  'contentPaddingRight',
  'contentPaddingBottom',
  'contentPaddingLeft',
] as const satisfies readonly (keyof ExportStyle)[];

type ExportStyleStorage = Pick<Storage, 'getItem' | 'setItem'>;

const EXPORT_FONT_STACKS: Record<ExportFontFamily, string> = {
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

function exportStyleStorage(storage?: ExportStyleStorage): ExportStyleStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeExportStyle(value: unknown): ExportStyle {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const presetCandidate = candidate.preset;
  const hasValidPreset =
    presetCandidate === 'app' ||
    presetCandidate === 'light' ||
    presetCandidate === 'dark' ||
    presetCandidate === 'custom';
  const fallbackStyle = presetCandidate === 'dark' ? DARK_EXPORT_STYLE : DEFAULT_EXPORT_STYLE;
  const fontFamily = candidate.fontFamily;
  const textColor = candidate.textColor;
  const backgroundColor = candidate.backgroundColor;

  const normalized: ExportStyle = {
    preset: hasValidPreset ? presetCandidate : 'app',
    fontSize: clampNumber(candidate.fontSize, DEFAULT_EXPORT_STYLE.fontSize, 10, 24),
    fontFamily:
      fontFamily === 'sans' || fontFamily === 'serif' || fontFamily === 'mono'
        ? fontFamily
        : DEFAULT_EXPORT_STYLE.fontFamily,
    textColor: normalizeHexColor(textColor, fallbackStyle.textColor),
    backgroundColor: normalizeHexColor(backgroundColor, fallbackStyle.backgroundColor),
    inlineCodeTextColor: normalizeHexColor(
      candidate.inlineCodeTextColor,
      fallbackStyle.inlineCodeTextColor,
    ),
    inlineCodeBackgroundColor: normalizeHexColor(
      candidate.inlineCodeBackgroundColor,
      fallbackStyle.inlineCodeBackgroundColor,
    ),
    kbdTextColor: normalizeHexColor(candidate.kbdTextColor, fallbackStyle.kbdTextColor),
    kbdBackgroundColor: normalizeHexColor(
      candidate.kbdBackgroundColor,
      fallbackStyle.kbdBackgroundColor,
    ),
    tableBorderColor: normalizeHexColor(
      candidate.tableBorderColor,
      fallbackStyle.tableBorderColor,
    ),
    tableHeaderTextColor: normalizeHexColor(
      candidate.tableHeaderTextColor,
      fallbackStyle.tableHeaderTextColor,
    ),
    tableHeaderBackgroundColor: normalizeHexColor(
      candidate.tableHeaderBackgroundColor,
      fallbackStyle.tableHeaderBackgroundColor,
    ),
    lineHeight: clampNumber(candidate.lineHeight, DEFAULT_EXPORT_STYLE.lineHeight, 0.8, 2.2),
    paragraphSpacing: clampNumber(
      candidate.paragraphSpacing,
      DEFAULT_EXPORT_STYLE.paragraphSpacing,
      0,
      32,
    ),
    ...normalizeExportPageLayout(candidate),
    ...normalizePdfPaper(candidate),
  };

  if (!hasValidPreset) {
    const hasLegacyCustomization = LEGACY_APPEARANCE_KEYS.some(
      (key) =>
        Object.prototype.hasOwnProperty.call(candidate, key) &&
        normalized[key] !== DEFAULT_EXPORT_STYLE[key],
    ) ||
      (Object.prototype.hasOwnProperty.call(candidate, 'contentPadding') &&
        normalized.contentPaddingTop !== DEFAULT_EXPORT_STYLE.contentPaddingTop);
    normalized.preset = hasLegacyCustomization ? 'custom' : 'app';
  }

  return normalized;
}

export function applyExportStylePreset(
  style: ExportStyle,
  preset: ExportStylePreset,
  appTheme: ExportTheme,
): ExportStyle {
  const current = normalizeExportStyle(style);
  if (preset === 'custom') return { ...current, preset };

  const useDark = preset === 'dark' || (preset === 'app' && appTheme === 'dark');
  const template = useDark ? DARK_EXPORT_STYLE : DEFAULT_EXPORT_STYLE;
  const pageLayout = normalizeExportPageLayout(current);
  const paper = normalizePdfPaper(current);
  return { ...template, ...pageLayout, ...paper, preset };
}

export function resolveExportStyleForTheme(
  style: ExportStyle,
  appTheme: ExportTheme,
): ExportStyle {
  const normalized = normalizeExportStyle(style);
  return normalized.preset === 'app'
    ? applyExportStylePreset(normalized, 'app', appTheme)
    : normalized;
}

export function loadExportStyle(storage?: ExportStyleStorage): ExportStyle {
  try {
    const saved = exportStyleStorage(storage)?.getItem(EXPORT_STYLE_STORAGE_KEY);
    return saved ? normalizeExportStyle(JSON.parse(saved)) : { ...DEFAULT_EXPORT_STYLE };
  } catch {
    return { ...DEFAULT_EXPORT_STYLE };
  }
}

export function saveExportStyle(style: ExportStyle, storage?: ExportStyleStorage): void {
  try {
    exportStyleStorage(storage)?.setItem(
      EXPORT_STYLE_STORAGE_KEY,
      JSON.stringify(normalizeExportStyle(style)),
    );
  } catch {
    // Export still works when storage is disabled or full.
  }
}

/** Strip the markdown extension from a document name for an export filename. */
export function exportBaseName(activeDocumentName: string | null | undefined): string {
  if (!activeDocumentName) return 'Untitled';
  return activeDocumentName.replace(MARKDOWN_EXTENSION_RE, '') || 'Untitled';
}

function detectPathSeparator(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function trimSeparators(path: string): string {
  return path.replace(/^[\\/]+|[\\/]+$/g, '');
}

function pathSegments(path: string): string[] {
  return path.split(PATH_SEPARATOR_RE).filter(Boolean);
}

function replaceMarkdownExtension(path: string, extension: string): string {
  return MARKDOWN_EXTENSION_RE.test(path)
    ? path.replace(MARKDOWN_EXTENSION_RE, extension)
    : `${path}${extension}`;
}

function fileName(path: string): string {
  const segments = pathSegments(path);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

function joinPath(separator: '/' | '\\', ...parts: string[]): string {
  const [first, ...rest] = parts.filter((part) => part.length > 0);
  if (!first) return '';
  return [
    trimTrailingSeparators(first),
    ...rest.map(trimSeparators).filter((part) => part.length > 0),
  ].join(separator);
}

export function defaultPdfExportPath(
  activeDocumentPath: string | null | undefined,
  activeDocumentName: string | null | undefined,
): string {
  if (!activeDocumentPath) return `${exportBaseName(activeDocumentName)}.pdf`;
  return replaceMarkdownExtension(activeDocumentPath, '.pdf');
}

export interface WorkspaceExportTarget {
  sourcePath: string;
  outputPath: string;
  title: string;
}

export function buildWorkspaceExportTargets(input: {
  rootDir: string;
  workspaceDocuments: readonly string[];
  format: ExportFormat;
}): WorkspaceExportTarget[] {
  const rootDir = trimTrailingSeparators(input.rootDir);
  if (!rootDir) return [];

  const separator = detectPathSeparator(rootDir);
  const rootPrefix = `${rootDir}${separator}`;
  const seen = new Set<string>();
  const targets: WorkspaceExportTarget[] = [];
  const exportExtension = input.format === 'html' ? '.html' : '.pdf';

  for (const sourcePath of input.workspaceDocuments) {
    if (!sourcePath || seen.has(sourcePath) || !MARKDOWN_EXTENSION_RE.test(sourcePath)) {
      continue;
    }
    if (!sourcePath.startsWith(rootPrefix)) {
      continue;
    }

    const relativePath = sourcePath.slice(rootPrefix.length);
    const [topLevel] = pathSegments(relativePath);
    if (topLevel?.toLowerCase() === 'exports') {
      continue;
    }

    const relativeExportPath = replaceMarkdownExtension(relativePath, exportExtension);
    targets.push({
      sourcePath,
      outputPath: joinPath(separator, rootDir, 'exports', relativeExportPath),
      title: exportBaseName(fileName(sourcePath)),
    });
    seen.add(sourcePath);
  }

  return targets;
}

export type WorkspacePdfExportTarget = WorkspaceExportTarget;

export function buildWorkspacePdfExportTargets(input: {
  rootDir: string;
  workspaceDocuments: readonly string[];
}): WorkspacePdfExportTarget[] {
  return buildWorkspaceExportTargets({ ...input, format: 'pdf' });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render markdown to the same static HTML the split-view preview shows: GFM
 * tables/task-lists via remark-gfm, and lowlight-highlighted code blocks via
 * the shared preview components. Reusing those components keeps the export
 * pixel-identical to the in-app preview.
 */
type ImageSrcResolver = (
  src: string | undefined,
  activeDocumentPath: string | null | undefined,
) => string | undefined;

export function renderMarkdownToHtml(
  source: string,
  activeDocumentPath: string | null,
  resolveImageSrc?: ImageSrcResolver,
): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: createSourceLineMarkdownComponents({ activeDocumentPath, resolveImageSrc }),
      },
      source,
    ),
  );
}

const HTTP_URL_RE = /^https?:\/\//i;
const RAW_HTML_IMAGE_PARAGRAPH_RE = /<p\b[^>]*>\s*(<img\b[^>]*>)\s*<\/p>/gi;
const RAW_HTML_IMAGE_RE = /<img\b[^>]*>/gi;

/** Reads local files / fetches remote URLs and returns each as a `data:` URI. */
export type ImageEmbedder = (sources: string[]) => Promise<EmbeddedImageResult[]>;

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match;
  });
}

function parseHtmlTagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<img\b/i, '').replace(/\/?>\s*$/i, '');
  const attrRe = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(body)) !== null) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const rawValue = match[2] ?? match[3] ?? match[4] ?? '';
    attributes.set(name, decodeHtmlAttribute(rawValue));
  }

  return attributes;
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function escapeMarkdownTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function markdownLinkDestination(value: string): string {
  return `<${value.replace(/[<>\r\n]/g, (char) => encodeURIComponent(char))}>`;
}

function safeImageDimension(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^\d+(?:\.\d+)?%?$/.test(trimmed) ? trimmed : undefined;
}

function markdownImageFromRawHtmlTag(tag: string): string | null {
  const attributes = parseHtmlTagAttributes(tag);
  const src = attributes.get('src')?.trim();
  if (!src) return null;

  const rawAttributes = {
    width: safeImageDimension(attributes.get('width')),
    height: safeImageDimension(attributes.get('height')),
    title: attributes.get('title')?.trim() || undefined,
  };
  const metadata = encodeURIComponent(JSON.stringify(rawAttributes));
  const title = `${RAW_HTML_IMAGE_TITLE_PREFIX}${metadata}`;

  return `![${escapeMarkdownImageAlt(attributes.get('alt') ?? '')}](${markdownLinkDestination(
    src,
  )} "${escapeMarkdownTitle(title)}")`;
}

function normalizeRawHtmlImagesInSegment(source: string): string {
  const replaceRawImage = (tag: string) => markdownImageFromRawHtmlTag(tag) ?? tag;
  return source
    .replace(RAW_HTML_IMAGE_PARAGRAPH_RE, (_match, tag: string) => replaceRawImage(tag))
    .replace(RAW_HTML_IMAGE_RE, (tag) => replaceRawImage(tag));
}

function normalizeRawHtmlImagesForExport(source: string): string {
  let fence: { marker: '`' | '~'; length: number } | null = null;

  return source
    .split(/(?<=\n)/)
    .map((line) => {
      const text = line.replace(/\r?\n$/, '');
      const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(text);
      if (match) {
        const marker = match[1][0] as '`' | '~';
        const length = match[1].length;
        if (!fence) {
          fence = { marker, length };
          return line;
        }
        if (marker === fence.marker && length >= fence.length) {
          fence = null;
          return line;
        }
      }

      return fence ? line : normalizeRawHtmlImagesInSegment(line);
    })
    .join('');
}

/**
 * Render once to discover every image the document references, classified into
 * embeddable sources: absolute local paths (read from disk) and http(s) URLs
 * (fetched). Using react-markdown's own render guarantees we collect exactly the
 * images the final export will emit.
 */
function collectEmbeddableImageSources(
  source: string,
  activeDocumentPath: string | null,
): Set<string> {
  const sources = new Set<string>();
  renderMarkdownToHtml(source, activeDocumentPath, (src) => {
    const localPath = resolveMarkdownImageLocalPath(src, activeDocumentPath);
    if (localPath) {
      sources.add(localPath);
    } else if (src && HTTP_URL_RE.test(src)) {
      sources.add(src);
    }
    return src;
  });
  return sources;
}

/**
 * Build an image resolver that yields self-contained `data:` URIs for every
 * image that could be embedded, falling back to the live asset-protocol URL
 * (local) or the original URL (remote) when embedding fails.
 */
async function buildEmbeddingImageResolver(
  source: string,
  activeDocumentPath: string | null,
  embed: ImageEmbedder,
): Promise<ImageSrcResolver> {
  const embeddable = collectEmbeddableImageSources(source, activeDocumentPath);
  if (embeddable.size === 0) {
    return resolveMarkdownImageSrc;
  }

  const results = await embed([...embeddable]);
  const dataUriBySource = new Map(
    results.filter((result) => result.dataUri).map((result) => [result.source, result.dataUri!]),
  );

  return (src, docPath) => {
    const localPath = resolveMarkdownImageLocalPath(src, docPath);
    if (localPath) {
      return dataUriBySource.get(localPath) ?? resolveMarkdownImageSrc(src, docPath);
    }
    if (src && HTTP_URL_RE.test(src)) {
      return dataUriBySource.get(src) ?? src;
    }
    return resolveMarkdownImageSrc(src, docPath);
  };
}

/**
 * Concatenate every same-origin stylesheet's rules. Cross-origin sheets throw
 * on `.cssRules` access and are skipped. This captures the app's bundled CSS
 * (markdown-surface typography + the active code-block palette) plus any
 * imported custom theme `<style>`, so the export renders without the app.
 */
function collectDocumentCss(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null; // cross-origin stylesheet — not readable
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) parts.push(rule.cssText);
  }
  return parts.join('\n');
}

/**
 * Mirror the live `<html>` element's attributes (data-theme, data-cb-theme,
 * data-cb-highlight, class, …) so the exported document inherits the exact
 * on-screen theme — light/dark and the chosen code-block palette.
 */
function rootAttributes(doc: Document): string {
  return Array.from(doc.documentElement.attributes)
    .map((attr) => `${attr.name}="${escapeHtml(attr.value)}"`)
    .join(' ');
}

export interface ExportHtmlOptions {
  title: string;
  source: string;
  activeDocumentPath: string | null;
  /** Add print page rules + pagination-friendly layout (used by PDF export). */
  forPrint?: boolean;
  paginationToken?: string;
  style?: ExportStyle;
  /** Injectable for tests; defaults to the live document. */
  doc?: Document;
  /** Injectable for tests; defaults to the Tauri image reader/fetcher. */
  embedImages?: ImageEmbedder;
}

/**
 * Build a self-contained, styled HTML document for the current markdown. Used
 * for both "Export to HTML" (written to disk) and "Export to PDF". Local images
 * are inlined as base64 `data:` URIs (and remote images fetched the same way) so
 * the document renders identically outside the app — a plain browser for HTML,
 * and the standalone WebKit instance that paginates the PDF.
 */
export async function buildExportHtml(options: ExportHtmlOptions): Promise<string> {
  const {
    title,
    source,
    activeDocumentPath,
    forPrint = false,
    paginationToken = '',
    style: rawStyle = DEFAULT_EXPORT_STYLE,
    doc = document,
    embedImages = readImagesBase64,
  } = options;
  const appTheme: ExportTheme =
    doc.documentElement.dataset.theme === 'BuiltInDark' ? 'dark' : 'light';
  const style = resolveExportStyleForTheme(normalizeExportStyle(rawStyle), appTheme);
  const paper = resolvePdfPaper(style);
  const paginationScript = forPrint
    ? buildPdfPaginationScript({
        token: paginationToken,
        pageWidth: paper.widthPt,
        pageHeight: paper.heightPt,
        pageMargin: style.contentPaddingTop,
        maxPages: MAX_PDF_PAGES,
      })
    : '';

  const exportSource = normalizeRawHtmlImagesForExport(source);
  const resolveImageSrc = await buildEmbeddingImageResolver(
    exportSource,
    activeDocumentPath,
    embedImages,
  );
  const body = renderMarkdownToHtml(exportSource, activeDocumentPath, resolveImageSrc);
  const css = collectDocumentCss(doc);
  // For PDF the renderer paginates into paper-sized slices and applies the page
  // margins itself, so the body just fills the page width and keeps media in bounds.
  const printCss = forPrint
    ? `@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; }
.markdowner-export { box-sizing: border-box; width: 100%; max-width: none; }
.markdowner-export pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.markdowner-export pre code { white-space: inherit; }
img, svg, video { max-width: 100%; height: auto; }`
    : `.markdowner-export { box-sizing: border-box; max-width: 820px; margin: 0 auto; }`;
  const styleCss = `.markdowner-export {
  --foreground: ${style.textColor};
  --background: ${style.backgroundColor};
  --primary: ${style.textColor};
  --muted-foreground: color-mix(in srgb, ${style.textColor} 68%, ${style.backgroundColor});
  --border: ${style.tableBorderColor};
  --muted: ${style.tableHeaderBackgroundColor};
  box-sizing: border-box;
  min-height: 100vh;
  padding: ${style.contentPaddingTop}px ${style.contentPaddingRight}px ${style.contentPaddingBottom}px ${style.contentPaddingLeft}px;
  color: ${style.textColor};
  background: ${style.backgroundColor};
  font-family: ${EXPORT_FONT_STACKS[style.fontFamily]};
  font-size: ${style.fontSize}px;
  line-height: ${style.lineHeight};
}
.markdowner-export h1 { font-size: 2em; }
.markdowner-export h2 { font-size: 1.5em; }
.markdowner-export h3 { font-size: 1.25em; }
.markdowner-export h4 { font-size: 1.125em; }
.markdowner-export h5, .markdowner-export h6 { font-size: 1em; }
.markdowner-export p { margin-block: 0 ${style.paragraphSpacing}px; }
.markdowner-export th,
.markdowner-export td {
  border-color: ${style.tableBorderColor};
}
.markdowner-export th {
  color: ${style.tableHeaderTextColor};
  background: ${style.tableHeaderBackgroundColor};
}
.markdowner-export code { font-size: 0.875em; }
.markdowner-export code:not(pre code) {
  color: ${style.inlineCodeTextColor};
  background: ${style.inlineCodeBackgroundColor};
}
.markdowner-export kbd {
  color: ${style.kbdTextColor};
  background: ${style.kbdBackgroundColor};
  border: 1px solid color-mix(in srgb, ${style.kbdTextColor} 35%, transparent);
}`;
  const exportCss = `${css}
html, body { margin: 0; color: ${style.textColor}; background: ${style.backgroundColor}; }
${printCss}
${styleCss}`;

  return `<!doctype html>
<html ${rootAttributes(doc)}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${exportCss}</style>
</head>
<body>
<div class="markdowner-export ${MARKDOWN_CONTENT_SCOPE_CLASS} markdown-surface">
${body}
</div>
${forPrint ? `<script>${paginationScript}</script>` : ''}
</body>
</html>`;
}

/**
 * Print a standalone HTML document via a hidden, same-origin iframe so only the
 * document (not the app chrome) reaches the print dialog. On macOS WebKit the
 * dialog offers "Save as PDF", which is how PDF export is realised without a
 * native PDF dependency.
 */
export function printExportedHtml(html: string, doc: Document = document): void {
  if (typeof doc === 'undefined') return;
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  iframe.srcdoc = html;
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    // Defer a frame so layout and fonts settle before the print snapshot.
    win.requestAnimationFrame(() => {
      win.focus();
      win.print();
      // Remove after the dialog has had time to read the document.
      win.setTimeout(() => iframe.remove(), 1000);
    });
  };
  doc.body.appendChild(iframe);
}
