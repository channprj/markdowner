import { FileDown, Minus, Plus, RotateCcw, Scan, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  applyExportStylePreset,
  buildExportHtml,
  normalizeExportStyle,
  resolveExportStyleForTheme,
  type ExportFormat,
  type ExportHtmlOptions,
  type ExportScope,
  type ExportStyle,
  type ExportStylePreset,
  type ExportTheme,
} from '@/lib/exportDocument';
import {
  PREVIEW_ZOOM_MAX_PERCENT,
  PREVIEW_ZOOM_MIN_PERCENT,
  fitPreviewZoomPercent,
  previewPageSize,
  stepPreviewZoomPercent,
  type PreviewSize,
  type PreviewZoomDirection,
} from '@/lib/exportPreviewZoom';
import { resolvePdfPaper, type PdfPaper } from '@/lib/pdfPaper';
import type { PdfPreviewReadyMessage } from '@/lib/pdfPagination';
import { cn } from '@/lib/utils';
import { PdfPaperControls } from './PdfPaperControls';
import { PdfPreviewPage } from './PdfPreviewPage';

export interface ExportPreviewRequest {
  format: ExportFormat;
  scope: ExportScope;
  title: string;
  source: string;
  activeDocumentPath: string | null;
  targetCount: number;
}

export interface ExportPreviewTabProps {
  request: ExportPreviewRequest;
  initialStyle: ExportStyle;
  appTheme: ExportTheme;
  busy: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: (style: ExportStyle) => void;
  buildPreview?: (options: ExportHtmlOptions) => Promise<string>;
}

type NumericStyleKey = 'fontSize' | 'lineHeight' | 'paragraphSpacing' | 'contentPadding';
type ColorStyleKey =
  | 'textColor'
  | 'backgroundColor'
  | 'inlineCodeTextColor'
  | 'inlineCodeBackgroundColor'
  | 'kbdTextColor'
  | 'kbdBackgroundColor'
  | 'tableBorderColor'
  | 'tableHeaderTextColor'
  | 'tableHeaderBackgroundColor';

interface RangeControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  disabled: boolean;
  onChange: (value: number) => void;
}

function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: RangeControlProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-xs font-medium text-foreground/85">
          {label}
        </Label>
        <output
          htmlFor={id}
          className="min-w-12 rounded-md bg-muted px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {value}{suffix}
        </output>
      </div>
      <Input
        id={id}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 cursor-pointer appearance-none border-0 bg-muted p-0 accent-foreground shadow-none focus-visible:ring-2"
      />
    </div>
  );
}

function ColorControl({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id} className="truncate text-xs font-medium text-foreground/85" title={label}>
        {label}
      </Label>
      <div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-1.5">
        <Input
          id={id}
          aria-label={label}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-8 shrink-0 cursor-pointer rounded border-0 p-0 shadow-none"
        />
        <span className="min-w-0 truncate font-mono text-[10px] uppercase text-muted-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}

function exportActionLabel(request: ExportPreviewRequest, busy: boolean): string {
  if (busy) return 'Exporting…';
  const format = request.format.toUpperCase();
  return request.scope === 'workspace'
    ? `Export ${request.targetCount} ${format} files`
    : `Export ${format}`;
}

function requestDescription(request: ExportPreviewRequest): string {
  return request.scope === 'workspace'
    ? `${request.targetCount} Markdown files`
    : request.activeDocumentPath ?? 'Unsaved document';
}

export function ExportPreviewTab({
  request,
  initialStyle,
  appTheme,
  busy,
  errorMessage = null,
  onCancel,
  onConfirm,
  buildPreview = buildExportHtml,
}: ExportPreviewTabProps) {
  const idPrefix = useId();
  const isPdf = request.format === 'pdf';
  const requestIdentity = JSON.stringify([
    request.format,
    request.scope,
    request.activeDocumentPath,
    request.title,
    request.source,
    request.targetCount,
  ]);
  const [draftStyle, setDraftStyle] = useState<ExportStyle>(() =>
    resolveExportStyleForTheme(initialStyle, appTheme),
  );
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewStatus, setPreviewStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [paperValid, setPaperValid] = useState(true);
  const [pageCount, setPageCount] = useState(1);
  const [paginationToken, setPaginationToken] = useState('');
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const [manualZoomPercent, setManualZoomPercent] = useState(100);
  const [previewViewport, setPreviewViewport] = useState<PreviewSize>({ width: 0, height: 0 });
  const previewRequestRef = useRef(0);
  const paginationTokenRef = useRef('');
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previousRequestIdentityRef = useRef(requestIdentity);

  useEffect(() => {
    const requestChanged = previousRequestIdentityRef.current !== requestIdentity;
    previousRequestIdentityRef.current = requestIdentity;
    if (requestChanged) {
      setDraftStyle(resolveExportStyleForTheme(initialStyle, appTheme));
      setPaperValid(true);
      setPageCount(1);
      setZoomMode('fit');
      setManualZoomPercent(100);
      return;
    }
    setDraftStyle((current) =>
      current.preset === 'app'
        ? resolveExportStyleForTheme(initialStyle, appTheme)
        : current,
    );
  }, [appTheme, initialStyle, requestIdentity]);

  useEffect(() => {
    if (isPdf && !paperValid) {
      previewRequestRef.current += 1;
      paginationTokenRef.current = '';
      setPreviewStatus('loading');
      return;
    }
    const previewRequest = ++previewRequestRef.current;
    const token = isPdf ? `pdf-preview-${previewRequest}` : '';
    paginationTokenRef.current = token;
    setPaginationToken(token);
    setPageCount(1);
    setPreviewHtml('');
    setPreviewStatus('loading');

    void buildPreview({
      title: request.title,
      source: request.source,
      activeDocumentPath: request.activeDocumentPath,
      forPrint: request.format === 'pdf',
      paginationToken: token,
      style: draftStyle,
    })
      .then((html) => {
        if (previewRequest !== previewRequestRef.current) return;
        setPreviewHtml(html);
        if (!isPdf) setPreviewStatus('ready');
      })
      .catch(() => {
        if (previewRequest !== previewRequestRef.current) return;
        setPreviewHtml('');
        setPreviewStatus('error');
      });
  }, [buildPreview, draftStyle, isPdf, paperValid, request]);

  useEffect(() => {
    if (!isPdf || typeof ResizeObserver === 'undefined') return;

    const viewport = previewViewportRef.current;
    if (!viewport) return;

    const updateSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      setPreviewViewport((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    const measure = () => updateSize(viewport.clientWidth, viewport.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });

    measure();
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [isPdf]);

  const updateNumber = (key: NumericStyleKey, value: number) => {
    setDraftStyle((current) =>
      normalizeExportStyle({ ...current, [key]: value, preset: 'custom' }),
    );
  };
  const updateColor = (key: ColorStyleKey, value: string) => {
    setDraftStyle((current) =>
      normalizeExportStyle({ ...current, [key]: value, preset: 'custom' }),
    );
  };
  const controlId = (name: string) => `${idPrefix}-${name}`;
  const formatLabel = request.format.toUpperCase();
  const resolvedPaper = resolvePdfPaper(draftStyle);
  const pageSize = previewPageSize(resolvedPaper);
  const fitZoomPercent = fitPreviewZoomPercent(previewViewport, pageSize);
  const zoomPercent = zoomMode === 'fit' ? fitZoomPercent : manualZoomPercent;
  const zoomScale = zoomPercent / 100;
  const applyManualZoom = (direction: PreviewZoomDirection) => {
    setManualZoomPercent(stepPreviewZoomPercent(zoomPercent, direction));
    setZoomMode('manual');
  };
  const updatePaper = (paper: PdfPaper) => {
    setDraftStyle((current) =>
      normalizeExportStyle({
        ...current,
        paperSize: paper.paperSize,
        paperOrientation: paper.paperOrientation,
        paperWidthMm: paper.paperWidthMm,
        paperHeightMm: paper.paperHeightMm,
      }),
    );
  };
  const handlePageReady = (result: PdfPreviewReadyMessage) => {
    if (result.token !== paginationTokenRef.current || result.pageIndex !== 0) return;
    setPageCount(result.pageCount);
    setPreviewStatus('ready');
  };
  const handlePaginationError = (token: string) => {
    if (token !== paginationTokenRef.current) return;
    setPreviewStatus('error');
  };

  const previewStatusContents = (
    <>
      {previewStatus === 'loading' ? (
        <div
          className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-muted"
          role="status"
          aria-live="polite"
        >
          <span className="block h-full w-1/3 animate-pulse bg-foreground/70" />
          <span className="sr-only">Updating preview…</span>
        </div>
      ) : null}
      {previewStatus === 'error' ? (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-background p-8 text-center"
          role="alert"
        >
          <div>
            <p className="font-heading text-base font-medium">Preview unavailable</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Check document images and reopen Export Preview.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <section
      data-testid="export-preview-surface"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background shadow-sm">
          <FileDown className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-medium tracking-[-0.02em]">Export Preview</h2>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono font-semibold tracking-[0.12em] text-foreground">
              {formatLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate" title={requestDescription(request)}>
              {requestDescription(request)}
            </span>
          </p>
        </div>
        <div
          data-testid="export-preview-actions"
          className="ml-auto flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setPaperValid(true);
              setDraftStyle(applyExportStylePreset(initialStyle, 'app', appTheme));
            }}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            <X />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !paperValid || previewStatus !== 'ready'}
            onClick={() => onConfirm(normalizeExportStyle(draftStyle))}
          >
            <FileDown />
            {exportActionLabel(request, busy)}
          </Button>
        </div>
      </header>

      {errorMessage ? (
        <div className="shrink-0 border-b border-border bg-destructive/5 px-4 py-3">
          <Alert variant="destructive">
            <AlertTitle>Export failed</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div
        data-testid="export-preview-layout"
        className="grid min-h-0 flex-1 grid-rows-[minmax(180px,2fr)_minmax(240px,3fr)] lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-1"
      >
        <aside
          data-testid="export-preview-config"
          className="min-h-0 overflow-y-auto border-b border-border bg-background px-4 py-4 lg:border-r lg:border-b-0"
        >
          <div className="mb-5 border-l-2 border-foreground pl-3">
            <p className="font-heading text-sm font-medium">Config</p>
          </div>

          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor={controlId('preset')} className="text-xs font-medium text-foreground/85">
                Preset
              </Label>
              <select
                id={controlId('preset')}
                aria-label="Preset"
                value={draftStyle.preset}
                disabled={busy}
                onChange={(event) =>
                  setDraftStyle((current) =>
                    applyExportStylePreset(
                      current,
                      event.target.value as ExportStylePreset,
                      appTheme,
                    ),
                  )
                }
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <option value="app">Match app theme</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <RangeControl
              id={controlId('font-size')}
              label="Body size"
              value={draftStyle.fontSize}
              min={10}
              max={24}
              step={1}
              suffix=" px"
              disabled={busy}
              onChange={(value) => updateNumber('fontSize', value)}
            />

            <div className="grid gap-2">
              <Label htmlFor={controlId('font-family')} className="text-xs font-medium text-foreground/85">
                Font family
              </Label>
              <select
                id={controlId('font-family')}
                aria-label="Font family"
                value={draftStyle.fontFamily}
                disabled={busy}
                onChange={(event) =>
                  setDraftStyle((current) =>
                    normalizeExportStyle({
                      ...current,
                      fontFamily: event.target.value,
                      preset: 'custom',
                    }),
                  )
                }
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <option value="sans">Sans — clean</option>
                <option value="serif">Serif — editorial</option>
                <option value="mono">Mono — technical</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ColorControl
                id={controlId('text-color')}
                label="Text color"
                value={draftStyle.textColor}
                disabled={busy}
                onChange={(value) => updateColor('textColor', value)}
              />
              <ColorControl
                id={controlId('background-color')}
                label="Background color"
                value={draftStyle.backgroundColor}
                disabled={busy}
                onChange={(value) => updateColor('backgroundColor', value)}
              />
            </div>

            <fieldset className="grid gap-3 border-t border-border pt-4">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Table
              </legend>
              <ColorControl
                id={controlId('table-border-color')}
                label="Table border color"
                value={draftStyle.tableBorderColor}
                disabled={busy}
                onChange={(value) => updateColor('tableBorderColor', value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <ColorControl
                  id={controlId('table-header-text-color')}
                  label="Table header text color"
                  value={draftStyle.tableHeaderTextColor}
                  disabled={busy}
                  onChange={(value) => updateColor('tableHeaderTextColor', value)}
                />
                <ColorControl
                  id={controlId('table-header-background-color')}
                  label="Table header background color"
                  value={draftStyle.tableHeaderBackgroundColor}
                  disabled={busy}
                  onChange={(value) => updateColor('tableHeaderBackgroundColor', value)}
                />
              </div>
            </fieldset>

            <RangeControl
              id={controlId('line-height')}
              label="Line height"
              value={draftStyle.lineHeight}
              min={0.8}
              max={2.2}
              step={0.1}
              suffix="×"
              disabled={busy}
              onChange={(value) => updateNumber('lineHeight', value)}
            />
            <RangeControl
              id={controlId('paragraph-spacing')}
              label="Paragraph spacing"
              value={draftStyle.paragraphSpacing}
              min={0}
              max={32}
              step={1}
              suffix=" px"
              disabled={busy}
              onChange={(value) => updateNumber('paragraphSpacing', value)}
            />
            <RangeControl
              id={controlId('content-padding')}
              label="Content padding"
              value={draftStyle.contentPadding}
              min={0}
              max={72}
              step={2}
              suffix=" px"
              disabled={busy}
              onChange={(value) => updateNumber('contentPadding', value)}
            />

            <fieldset className="grid gap-3 border-t border-border pt-4">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Inline code
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <ColorControl
                  id={controlId('inline-code-text-color')}
                  label="Inline code text color"
                  value={draftStyle.inlineCodeTextColor}
                  disabled={busy}
                  onChange={(value) => updateColor('inlineCodeTextColor', value)}
                />
                <ColorControl
                  id={controlId('inline-code-background-color')}
                  label="Inline code background color"
                  value={draftStyle.inlineCodeBackgroundColor}
                  disabled={busy}
                  onChange={(value) => updateColor('inlineCodeBackgroundColor', value)}
                />
              </div>
            </fieldset>

            <fieldset className="grid gap-3 border-t border-border pt-4">
              <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Keyboard keys
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <ColorControl
                  id={controlId('kbd-text-color')}
                  label="Keyboard key text color"
                  value={draftStyle.kbdTextColor}
                  disabled={busy}
                  onChange={(value) => updateColor('kbdTextColor', value)}
                />
                <ColorControl
                  id={controlId('kbd-background-color')}
                  label="Keyboard key background color"
                  value={draftStyle.kbdBackgroundColor}
                  disabled={busy}
                  onChange={(value) => updateColor('kbdBackgroundColor', value)}
                />
              </div>
            </fieldset>

            {isPdf ? (
              <div className="border-t border-border pt-4">
                <PdfPaperControls
                  idPrefix={controlId('paper')}
                  value={draftStyle}
                  disabled={busy}
                  onChange={updatePaper}
                  onValidityChange={setPaperValid}
                />
              </div>
            ) : null}
          </div>
        </aside>

        <div
          data-testid="export-preview-panel"
          className="relative flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--border)_72%,transparent)_1px,transparent_0)] bg-[length:18px_18px]"
        >
          {isPdf ? (
            <div className="flex shrink-0 justify-end border-b border-border/70 bg-background/90 px-3 py-2 backdrop-blur-sm">
              <div
                role="group"
                aria-label="Preview zoom controls"
                className="flex items-center rounded-lg border border-border bg-background p-0.5 shadow-sm"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom out"
                  disabled={busy || zoomPercent <= PREVIEW_ZOOM_MIN_PERCENT}
                  onClick={() => applyManualZoom('out')}
                >
                  <Minus />
                </Button>
                <output
                  aria-label={`Preview zoom: ${zoomPercent}%`}
                  aria-live="polite"
                  className="min-w-12 px-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground"
                >
                  {zoomPercent}%
                </output>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom in"
                  disabled={busy || zoomPercent >= PREVIEW_ZOOM_MAX_PERCENT}
                  onClick={() => applyManualZoom('in')}
                >
                  <Plus />
                </Button>
                <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
                <Button
                  type="button"
                  variant={zoomMode === 'fit' ? 'secondary' : 'ghost'}
                  size="xs"
                  aria-label="Fit preview"
                  aria-pressed={zoomMode === 'fit'}
                  disabled={busy}
                  onClick={() => setZoomMode('fit')}
                >
                  <Scan />
                  Fit
                </Button>
              </div>
            </div>
          ) : null}

          <div
            ref={isPdf ? previewViewportRef : undefined}
            data-testid={isPdf ? 'pdf-preview-viewport' : undefined}
            className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"
          >
            {isPdf ? (
              <div className="flex min-h-full min-w-full flex-col items-center gap-4">
                {previewHtml
                  ? Array.from({ length: pageCount }, (_, pageIndex) => (
                      <div
                        key={`${paginationToken}-${pageIndex}`}
                        data-testid="pdf-preview-wrapper"
                        className="relative shrink-0"
                        style={{
                          width: pageSize.width * zoomScale,
                          height: pageSize.height * zoomScale,
                        }}
                      >
                        <div
                          data-testid="pdf-preview-page-scale"
                          className="origin-top-left"
                          style={{
                            transform: `scale(${zoomScale})`,
                            transformOrigin: 'top left',
                          }}
                        >
                          <PdfPreviewPage
                            html={previewHtml}
                            token={paginationToken}
                            pageIndex={pageIndex}
                            pageCount={pageCount}
                            width={pageSize.width}
                            height={pageSize.height}
                            backgroundColor={draftStyle.backgroundColor}
                            onReady={handlePageReady}
                            onError={() => handlePaginationError(paginationToken)}
                          />
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            ) : (
              <div
                className="relative mx-auto h-full min-h-[520px] w-full max-w-[1080px] overflow-hidden border border-black/10 shadow-[0_28px_90px_-36px_rgba(0,0,0,0.62)]"
                style={{ backgroundColor: draftStyle.backgroundColor }}
              >
                {previewHtml ? (
                  <iframe
                    title={`${formatLabel} export preview`}
                    sandbox=""
                    srcDoc={previewHtml}
                    className={cn('h-full w-full border-0', 'min-h-[520px]')}
                    style={{ backgroundColor: draftStyle.backgroundColor }}
                  />
                ) : null}
              </div>
            )}
          </div>
          {previewStatusContents}
        </div>
      </div>
    </section>
  );
}
