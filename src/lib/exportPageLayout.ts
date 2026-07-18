export type ContentPaddingMode = 'all' | 'individual';
export type PageTextAlignment = 'left' | 'center' | 'right';
export type PageNumberPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';
export type PageNumberFormat =
  | 'page-total'
  | 'page-total-spaced'
  | 'page-of-total'
  | 'page-only'
  | 'page-label'
  | 'page-label-of-total'
  | 'dash-page'
  | 'custom';

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

export interface PageDecorationBandHeights {
  top: number;
  bottom: number;
}

export type PageNumberTemplateValidation =
  | { valid: true }
  | { valid: false; message: string };

export type PdfPageGeometryValidation =
  | { valid: true }
  | { valid: false; message: string };

export const CONTENT_PADDING_MIN = 0;
export const CONTENT_PADDING_MAX = 72;
export const PAGE_FURNITURE_TEXT_MAX_LENGTH = 120;
export const PAGE_NUMBER_TEMPLATE_MAX_LENGTH = 80;

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

const PAGE_TEXT_ALIGNMENTS = new Set<PageTextAlignment>(['left', 'center', 'right']);
const PAGE_NUMBER_POSITIONS = new Set<PageNumberPosition>([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]);
const PAGE_NUMBER_FORMATS = new Set<PageNumberFormat>([
  'page-total',
  'page-total-spaced',
  'page-of-total',
  'page-only',
  'page-label',
  'page-label-of-total',
  'dash-page',
  'custom',
]);

function clampPadding(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(CONTENT_PADDING_MAX, Math.max(CONTENT_PADDING_MIN, parsed));
}

function normalizePageText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, PAGE_FURNITURE_TEXT_MAX_LENGTH) : '';
}

function hasOwn(candidate: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(candidate, key);
}

export function validatePageNumberTemplate(
  template: string,
): PageNumberTemplateValidation {
  if (template.length > PAGE_NUMBER_TEMPLATE_MAX_LENGTH) {
    return {
      valid: false,
      message: `Use at most ${PAGE_NUMBER_TEMPLATE_MAX_LENGTH} characters.`,
    };
  }
  if (!template.includes('{page}')) {
    return { valid: false, message: 'Include {page} in the template.' };
  }
  const withoutKnownTokens = template
    .split('{page}')
    .join('')
    .split('{pages}')
    .join('');
  if (/[{}]/.test(withoutKnownTokens)) {
    return {
      valid: false,
      message: 'Only {page} and {pages} tokens are supported.',
    };
  }
  return { valid: true };
}

export function normalizeExportPageLayout(value: unknown): ExportPageLayout {
  const candidate =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const legacyPadding = clampPadding(
    candidate.contentPadding,
    DEFAULT_EXPORT_PAGE_LAYOUT.contentPaddingTop,
  );
  const top = clampPadding(
    candidate.contentPaddingTop,
    hasOwn(candidate, 'contentPaddingTop') ? DEFAULT_EXPORT_PAGE_LAYOUT.contentPaddingTop : legacyPadding,
  );
  const right = clampPadding(
    candidate.contentPaddingRight,
    hasOwn(candidate, 'contentPaddingRight')
      ? DEFAULT_EXPORT_PAGE_LAYOUT.contentPaddingRight
      : legacyPadding,
  );
  const bottom = clampPadding(
    candidate.contentPaddingBottom,
    hasOwn(candidate, 'contentPaddingBottom')
      ? DEFAULT_EXPORT_PAGE_LAYOUT.contentPaddingBottom
      : legacyPadding,
  );
  const left = clampPadding(
    candidate.contentPaddingLeft,
    hasOwn(candidate, 'contentPaddingLeft') ? DEFAULT_EXPORT_PAGE_LAYOUT.contentPaddingLeft : legacyPadding,
  );
  const inferredMode: ContentPaddingMode =
    top === right && right === bottom && bottom === left ? 'all' : 'individual';
  const requestedMode =
    candidate.contentPaddingMode === 'all' || candidate.contentPaddingMode === 'individual'
      ? candidate.contentPaddingMode
      : inferredMode;
  const uniformPadding = top;
  const contentPaddingMode = requestedMode;
  const customTemplate =
    typeof candidate.pageNumberTemplate === 'string'
      ? candidate.pageNumberTemplate.slice(0, PAGE_NUMBER_TEMPLATE_MAX_LENGTH)
      : DEFAULT_EXPORT_PAGE_LAYOUT.pageNumberTemplate;
  const pageNumberTemplate = validatePageNumberTemplate(customTemplate).valid
    ? customTemplate
    : DEFAULT_EXPORT_PAGE_LAYOUT.pageNumberTemplate;

  return {
    contentPaddingMode,
    contentPaddingTop: uniformPadding,
    contentPaddingRight: contentPaddingMode === 'all' ? uniformPadding : right,
    contentPaddingBottom: contentPaddingMode === 'all' ? uniformPadding : bottom,
    contentPaddingLeft: contentPaddingMode === 'all' ? uniformPadding : left,
    headerText: normalizePageText(candidate.headerText),
    headerAlignment: PAGE_TEXT_ALIGNMENTS.has(candidate.headerAlignment as PageTextAlignment)
      ? (candidate.headerAlignment as PageTextAlignment)
      : DEFAULT_EXPORT_PAGE_LAYOUT.headerAlignment,
    footerText: normalizePageText(candidate.footerText),
    footerAlignment: PAGE_TEXT_ALIGNMENTS.has(candidate.footerAlignment as PageTextAlignment)
      ? (candidate.footerAlignment as PageTextAlignment)
      : DEFAULT_EXPORT_PAGE_LAYOUT.footerAlignment,
    pageNumbersEnabled:
      typeof candidate.pageNumbersEnabled === 'boolean'
        ? candidate.pageNumbersEnabled
        : DEFAULT_EXPORT_PAGE_LAYOUT.pageNumbersEnabled,
    pageNumberPosition: PAGE_NUMBER_POSITIONS.has(
      candidate.pageNumberPosition as PageNumberPosition,
    )
      ? (candidate.pageNumberPosition as PageNumberPosition)
      : DEFAULT_EXPORT_PAGE_LAYOUT.pageNumberPosition,
    pageNumberFormat: PAGE_NUMBER_FORMATS.has(candidate.pageNumberFormat as PageNumberFormat)
      ? (candidate.pageNumberFormat as PageNumberFormat)
      : DEFAULT_EXPORT_PAGE_LAYOUT.pageNumberFormat,
    pageNumberTemplate,
  };
}

export function pageNumberTemplateForFormat(
  format: PageNumberFormat,
  customTemplate: string,
): string {
  const templates: Record<Exclude<PageNumberFormat, 'custom'>, string> = {
    'page-total': '{page}/{pages}',
    'page-total-spaced': '{page} / {pages}',
    'page-of-total': '{page} of {pages}',
    'page-only': '{page}',
    'page-label': 'Page {page}',
    'page-label-of-total': 'Page {page} of {pages}',
    'dash-page': '– {page} –',
  };
  return format === 'custom' ? customTemplate : templates[format];
}

export function formatPageNumber(
  template: string,
  page: number,
  pages: number,
): string {
  return template
    .split('{pages}')
    .join(String(pages))
    .split('{page}')
    .join(String(page));
}

function pageNumberSlot(
  position: PageNumberPosition,
): { band: 'top' | 'bottom'; alignment: PageTextAlignment } {
  const [band, alignment] = position.split('-') as [
    'top' | 'bottom',
    PageTextAlignment,
  ];
  return { band, alignment };
}

export function pageDecorationBandHeights(
  layout: Pick<
    ExportPageLayout,
    | 'headerText'
    | 'headerAlignment'
    | 'footerText'
    | 'footerAlignment'
    | 'pageNumbersEnabled'
    | 'pageNumberPosition'
  >,
): PageDecorationBandHeights {
  const lineHeight = 16;
  const stackGap = 4;
  const contentGap = 6;
  const headerVisible = layout.headerText.trim().length > 0;
  const footerVisible = layout.footerText.trim().length > 0;
  const numberSlot = layout.pageNumbersEnabled
    ? pageNumberSlot(layout.pageNumberPosition)
    : null;
  const topVisible = headerVisible || numberSlot?.band === 'top';
  const bottomVisible = footerVisible || numberSlot?.band === 'bottom';
  const topCollision =
    headerVisible &&
    numberSlot?.band === 'top' &&
    numberSlot.alignment === layout.headerAlignment;
  const bottomCollision =
    footerVisible &&
    numberSlot?.band === 'bottom' &&
    numberSlot.alignment === layout.footerAlignment;
  const bandHeight = (visible: boolean, collision: boolean) =>
    visible ? lineHeight + contentGap + (collision ? lineHeight + stackGap : 0) : 0;

  return {
    top: bandHeight(topVisible, topCollision),
    bottom: bandHeight(bottomVisible, bottomCollision),
  };
}

export function validatePdfPageGeometry(
  pageWidth: number,
  pageHeight: number,
  layout: ExportPageLayout,
): PdfPageGeometryValidation {
  if (
    !Number.isFinite(pageWidth) ||
    pageWidth <= 0 ||
    !Number.isFinite(pageHeight) ||
    pageHeight <= 0
  ) {
    return { valid: false, message: 'PDF paper dimensions must be positive.' };
  }
  const horizontalSpace =
    pageWidth - layout.contentPaddingLeft - layout.contentPaddingRight;
  if (horizontalSpace <= 0) {
    return {
      valid: false,
      message: 'Left and right padding leave no room for content.',
    };
  }
  const bands = pageDecorationBandHeights(layout);
  const verticalSpace =
    pageHeight -
    layout.contentPaddingTop -
    layout.contentPaddingBottom -
    bands.top -
    bands.bottom;
  if (verticalSpace <= 0) {
    return {
      valid: false,
      message: 'Top and bottom padding leave no room for content.',
    };
  }
  return { valid: true };
}

export function resolvePdfPageInsets(
  layout: Pick<
    ExportPageLayout,
    | 'contentPaddingTop'
    | 'contentPaddingRight'
    | 'contentPaddingBottom'
    | 'contentPaddingLeft'
  >,
): PdfPageInsets {
  return {
    top: layout.contentPaddingTop,
    right: layout.contentPaddingRight,
    bottom: layout.contentPaddingBottom,
    left: layout.contentPaddingLeft,
  };
}

export function resolvePdfPageFurniture(
  layout: ExportPageLayout,
  textColor: string,
  fontFamily: string,
): PdfPageFurniture {
  return {
    headerText: layout.headerText,
    headerAlignment: layout.headerAlignment,
    footerText: layout.footerText,
    footerAlignment: layout.footerAlignment,
    pageNumbersEnabled: layout.pageNumbersEnabled,
    pageNumberPosition: layout.pageNumberPosition,
    pageNumberTemplate: pageNumberTemplateForFormat(
      layout.pageNumberFormat,
      layout.pageNumberTemplate,
    ),
    textColor,
    fontFamily,
  };
}
