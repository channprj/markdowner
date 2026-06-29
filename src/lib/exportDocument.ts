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
import { MARKDOWN_CONTENT_SCOPE_CLASS } from './themeScope';

const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdown|mkd)$/i;
const PATH_SEPARATOR_RE = /[\\/]/;

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

export interface WorkspacePdfExportTarget {
  sourcePath: string;
  outputPath: string;
  title: string;
}

export function buildWorkspacePdfExportTargets(input: {
  rootDir: string;
  workspaceDocuments: readonly string[];
}): WorkspacePdfExportTarget[] {
  const rootDir = trimTrailingSeparators(input.rootDir);
  if (!rootDir) return [];

  const separator = detectPathSeparator(rootDir);
  const rootPrefix = `${rootDir}${separator}`;
  const seen = new Set<string>();
  const targets: WorkspacePdfExportTarget[] = [];

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

    const relativePdfPath = replaceMarkdownExtension(relativePath, '.pdf');
    targets.push({
      sourcePath,
      outputPath: joinPath(separator, rootDir, 'exports', relativePdfPath),
      title: exportBaseName(fileName(sourcePath)),
    });
    seen.add(sourcePath);
  }

  return targets;
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
  paperSize?: 'A4' | 'Letter';
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
    paperSize = 'A4',
    doc = document,
    embedImages = readImagesBase64,
  } = options;

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
    ? `@page { size: ${paperSize}; }
.markdowner-export { box-sizing: border-box; width: 100%; max-width: none; }
.markdowner-export pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.markdowner-export pre code { white-space: inherit; }
img, svg, video { max-width: 100%; height: auto; }`
    : `.markdowner-export { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 40px 32px; }`;
  const exportCss = `${css}
html, body { margin: 0; background: var(--background, #ffffff); }
${printCss}`;

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
