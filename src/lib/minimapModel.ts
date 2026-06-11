/**
 * Pure layout + classification model for the Zed-style minimap.
 *
 * Mirrors the mechanics of Zed's minimap (zed-industries/zed PR #26893,
 * crates/editor/src/element.rs): a fixed mini line height, proportional
 * sliding of the minimap content when the document overflows it, a thumb
 * sized to the editor viewport, jump-then-grab track clicks and delta-based
 * thumb drags. All formulas work in *line units* and convert editor pixels
 * through `editorLineHeightPx = scrollHeight / totalLines`, which also
 * absorbs soft-wrap / WYSIWYG height differences proportionally.
 */

export type MinimapLineKind =
  | 'blank'
  | 'heading'
  | 'code'
  | 'list'
  | 'quote'
  | 'regular';

export interface MinimapLineSpec {
  kind: MinimapLineKind;
  /** Indentation-preserving text to draw, clipped to MAX_RENDER_COLUMNS. */
  text: string;
}

/** Zed: MINIMAP_FONT_SIZE = px(2.) */
export const MINIMAP_FONT_SIZE_PX = 2;
/** Zed: MINIMAP_FONT_WEIGHT = FontWeight::BLACK */
export const MINIMAP_FONT_WEIGHT = 900;
/** Zed: ScrollbarLayout::MIN_THUMB_SIZE = px(25.) */
export const MINIMAP_MIN_THUMB_PX = 25;
/** Drawing budget per line; anything longer is clipped by the canvas anyway. */
export const MINIMAP_MAX_RENDER_COLUMNS = 120;
/** Zed: MINIMAP_WIDTH_PCT = 0.15 (fraction of the text width). */
export const MINIMAP_WIDTH_PCT = 0.15;
/** ~80 columns at minimap scale — Zed's max_width_columns default. */
export const MINIMAP_MAX_WIDTH_PX = 96;
/** Below this the minimap hides entirely (Zed: MINIMAP_MIN_WIDTH_COLUMNS). */
export const MINIMAP_MIN_WIDTH_PX = 24;

const TAB_AS_SPACES = '    ';
const FENCE_RE = /^(```|~~~)/;
const HEADING_RE = /^#{1,6}\s/;
const LIST_RE = /^([-*+]\s|\d+[.)]\s|\[\s\]|\[x\])/i;

function classifyLine(raw: string, inFence: boolean): MinimapLineKind {
  const trimmed = raw.trim();
  if (inFence) return 'code';
  if (!trimmed) return 'blank';
  if (FENCE_RE.test(trimmed)) return 'code';
  if (HEADING_RE.test(trimmed)) return 'heading';
  if (LIST_RE.test(trimmed)) return 'list';
  if (trimmed.startsWith('>')) return 'quote';
  if (raw.startsWith(TAB_AS_SPACES) || raw.startsWith('\t')) return 'code';
  return 'regular';
}

/**
 * Splits markdown into per-line render specs. Tracks fenced code regions with
 * a small state machine so fence *bodies* classify as code, and preserves
 * leading indentation (tabs expanded) so the minimap shows real text shape.
 */
export function buildLineSpecs(text: string): MinimapLineSpec[] {
  let inFence = false;
  return text.split('\n').map((raw) => {
    const trimmed = raw.trim();
    const isFenceLine = FENCE_RE.test(trimmed);
    // The closing fence line itself still renders as code, so classify with
    // the pre-toggle state when opening and post-toggle handled below.
    const kind = classifyLine(raw, inFence || isFenceLine);
    if (isFenceLine) inFence = !inFence;
    const expanded = raw.includes('\t')
      ? raw.replace(/\t/g, TAB_AS_SPACES)
      : raw;
    return {
      kind,
      text: expanded.length > MINIMAP_MAX_RENDER_COLUMNS
        ? expanded.slice(0, MINIMAP_MAX_RENDER_COLUMNS)
        : expanded,
    };
  });
}

export interface MinimapMetricsInput {
  totalLines: number;
  minimapHeightPx: number;
  minimapLineHeightPx: number;
  /** Editor scroll metrics in pixels. */
  scrollHeight: number;
  clientHeight: number;
}

export interface MinimapLayoutInput extends MinimapMetricsInput {
  scrollTop: number;
}

export interface MinimapLayout {
  /** Minimap content scroll offset in lines (Zed's minimap_scroll_top). */
  minimapScrollTopLines: number;
  firstVisibleLine: number;
  lastVisibleLine: number;
  thumbTopPx: number;
  thumbHeightPx: number;
  /** Zed only draws the thumb when the editor actually scrolls. */
  showThumb: boolean;
}

interface LineUnitMetrics {
  editorLineHeightPx: number;
  scrollTopLines: number;
  visibleEditorLines: number;
  visibleMinimapLines: number;
}

function deriveLineUnits(input: MinimapLayoutInput): LineUnitMetrics | null {
  const { totalLines, scrollHeight, clientHeight, minimapHeightPx, minimapLineHeightPx } = input;
  if (totalLines <= 0 || scrollHeight <= 0 || minimapLineHeightPx <= 0) {
    return null;
  }
  const editorLineHeightPx = scrollHeight / totalLines;
  return {
    editorLineHeightPx,
    scrollTopLines: input.scrollTop / editorLineHeightPx,
    visibleEditorLines: clientHeight / editorLineHeightPx,
    visibleMinimapLines: minimapHeightPx / minimapLineHeightPx,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Zed's MinimapLayout::calculate_minimap_top_offset, in line units:
 * the minimap slides so editor-start maps to minimap-start and editor-end
 * maps to minimap-end; a document that fits the minimap never slides.
 */
function minimapScrollTopLinesFor(
  input: MinimapLayoutInput,
  units: LineUnitMetrics,
): number {
  const nonVisibleDocLines = Math.max(
    input.totalLines - units.visibleEditorLines,
    0,
  );
  if (nonVisibleDocLines === 0) return 0;
  const scrollPct = clamp(units.scrollTopLines / nonVisibleDocLines, 0, 1);
  return scrollPct * Math.max(input.totalLines - units.visibleMinimapLines, 0);
}

export function computeMinimapLayout(input: MinimapLayoutInput): MinimapLayout {
  const units = deriveLineUnits(input);
  if (!units) {
    return {
      minimapScrollTopLines: 0,
      firstVisibleLine: 0,
      lastVisibleLine: -1,
      thumbTopPx: 0,
      thumbHeightPx: 0,
      showThumb: false,
    };
  }

  const minimapScrollTopLines = minimapScrollTopLinesFor(input, units);
  const thumbHeightPx = clamp(
    units.visibleEditorLines * input.minimapLineHeightPx,
    MINIMAP_MIN_THUMB_PX,
    input.minimapHeightPx,
  );
  const thumbTopPx = clamp(
    (units.scrollTopLines - minimapScrollTopLines) * input.minimapLineHeightPx,
    0,
    Math.max(input.minimapHeightPx - thumbHeightPx, 0),
  );
  const firstVisibleLine = Math.max(0, Math.floor(minimapScrollTopLines));
  const lastVisibleLine = Math.min(
    input.totalLines - 1,
    Math.ceil(minimapScrollTopLines + units.visibleMinimapLines),
  );

  return {
    minimapScrollTopLines,
    firstVisibleLine,
    lastVisibleLine,
    thumbTopPx,
    thumbHeightPx,
    showThumb: input.scrollHeight > input.clientHeight + 1,
  };
}

function clampScrollTop(value: number, input: MinimapMetricsInput): number {
  return clamp(value, 0, Math.max(input.scrollHeight - input.clientHeight, 0));
}

/**
 * Click outside the thumb: jump so the thumb centers on the click point,
 * after which the caller enters drag state (Zed's "jump then grab").
 */
export function scrollTopForTrackJump(
  input: MinimapLayoutInput & { clickYPx: number },
): number {
  const units = deriveLineUnits(input);
  if (!units) return 0;
  const layout = computeMinimapLayout(input);
  const top = Math.max(input.clickYPx - layout.thumbHeightPx / 2, 0);
  const targetLines =
    layout.minimapScrollTopLines + top / input.minimapLineHeightPx;
  return clampScrollTop(targetLines * units.editorLineHeightPx, input);
}

/**
 * Delta drag: Zed's pixels_per_line = min(minimap_height / total_lines,
 * minimap_line_height) — dragging the full minimap height traverses the
 * full document once it overflows the minimap.
 */
export function scrollTopForDragDelta(
  input: MinimapMetricsInput & { startScrollTop: number; deltaYPx: number },
): number {
  const units = deriveLineUnits({ ...input, scrollTop: input.startScrollTop });
  if (!units) return 0;
  const pixelsPerLine = Math.min(
    input.minimapHeightPx / input.totalLines,
    input.minimapLineHeightPx,
  );
  if (pixelsPerLine <= 0) return input.startScrollTop;
  const deltaLines = input.deltaYPx / pixelsPerLine;
  return clampScrollTop(
    input.startScrollTop + deltaLines * units.editorLineHeightPx,
    input,
  );
}

/**
 * Zed's get_minimap_width: min(15% of the pane, the 80-column cap); hide
 * entirely when the result would be unusably narrow. Returns 0 to hide.
 */
export function minimapWidthPx(paneWidthPx: number): number {
  const width = Math.min(paneWidthPx * MINIMAP_WIDTH_PCT, MINIMAP_MAX_WIDTH_PX);
  return width < MINIMAP_MIN_WIDTH_PX ? 0 : width;
}
