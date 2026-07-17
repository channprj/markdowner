import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EXPORT_STYLE, type ExportHtmlOptions } from '@/lib/exportDocument';
import { PDF_PREVIEW_READY_MESSAGE } from '@/lib/pdfPagination';
import { ExportPreviewTab, type ExportPreviewRequest } from './ExportPreviewTab';

const previewPageMockState = vi.hoisted(() => ({
  readyPageCount: 1,
  readyByToken: new Map<string, () => void>(),
}));

vi.mock('./PdfPreviewPage', () => ({
  PdfPreviewPage: ({
    token,
    pageIndex,
    pageCount,
    width,
    height,
    onReady,
    onError,
  }: {
    token: string;
    pageIndex: number;
    pageCount: number;
    width: number;
    height: number;
    onReady: (result: {
      type: typeof PDF_PREVIEW_READY_MESSAGE;
      token: string;
      pageIndex: number;
      pageCount: number;
      pageWidth: number;
      pageHeight: number;
    }) => void;
    onError: () => void;
  }) => {
    const ready = (overrides: Partial<{
      token: string;
      pageIndex: number;
      pageCount: number;
    }> = {}) =>
      onReady({
        type: PDF_PREVIEW_READY_MESSAGE,
        token,
        pageIndex,
        pageCount: previewPageMockState.readyPageCount,
        pageWidth: width,
        pageHeight: height,
        ...overrides,
      });
    previewPageMockState.readyByToken.set(`${token}:${pageIndex}`, () => ready());
    return (
      <div
        data-testid={`mock-pdf-preview-page-${pageIndex}`}
        data-token={token}
        data-width={width}
        data-height={height}
      >
        <span>Page {pageIndex + 1} / {pageCount}</span>
        <button type="button" onClick={() => ready()}>
          Ready page {pageIndex + 1}
        </button>
        <button type="button" onClick={() => ready({ token: 'stale-token' })}>
          Stale page {pageIndex + 1}
        </button>
        <button type="button" onClick={() => ready({ pageIndex: pageIndex + 1 })}>
          Wrong page {pageIndex + 1}
        </button>
        <button type="button" onClick={onError}>
          Fail page {pageIndex + 1}
        </button>
      </div>
    );
  },
}));

const HTML_REQUEST: ExportPreviewRequest = {
  format: 'html',
  scope: 'document',
  title: 'notes',
  source: '# Notes',
  activeDocumentPath: '/tmp/notes.md',
  targetCount: 1,
};

const PDF_REQUEST: ExportPreviewRequest = {
  ...HTML_REQUEST,
  format: 'pdf',
};

let resizeObserverCallback: ResizeObserverCallback | null = null;

class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

function resizePdfViewport(width: number, height: number) {
  act(() => {
    resizeObserverCallback?.(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  });
}

function previewBuilder() {
  return vi.fn(async (options: ExportHtmlOptions) => {
    const size = options.style?.fontSize ?? DEFAULT_EXPORT_STYLE.fontSize;
    const inlineCodeColor = options.style?.inlineCodeTextColor ?? '';
    return `<!doctype html><style>font-size:${size}px;color:${inlineCodeColor}</style><h1>Notes</h1>`;
  });
}

function renderPreview(overrides: Partial<ComponentProps<typeof ExportPreviewTab>> = {}) {
  return render(
    <ExportPreviewTab
      request={HTML_REQUEST}
      initialStyle={DEFAULT_EXPORT_STYLE}
      appTheme="light"
      busy={false}
      onCancel={() => {}}
      onConfirm={() => {}}
      buildPreview={previewBuilder()}
      {...overrides}
    />,
  );
}

describe('ExportPreviewTab', () => {
  beforeEach(() => {
    resizeObserverCallback = null;
    previewPageMockState.readyPageCount = 1;
    previewPageMockState.readyByToken.clear();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the full editor surface and the Export Preview name', () => {
    renderPreview();

    expect(screen.getByRole('heading', { name: 'Export Preview' })).toBeInTheDocument();
    expect(screen.getByTestId('export-preview-surface')).toHaveClass('flex-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('puts Preset first under Config and removes the verbose description', () => {
    renderPreview();

    expect(screen.getByText('Config')).toBeInTheDocument();
    expect(screen.queryByText('Artifact controls')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Every value below is applied to both this preview and the exported file.',
      ),
    ).not.toBeInTheDocument();
    const preset = screen.getByLabelText('Preset');
    const bodySize = screen.getByLabelText('Body size');
    expect(
      preset.compareDocumentPosition(bodySize) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('bounds the narrow Config row and guarantees Preview height', () => {
    renderPreview({ request: PDF_REQUEST });

    expect(screen.getByTestId('export-preview-layout')).toHaveClass(
      'grid-rows-[minmax(180px,2fr)_minmax(240px,3fr)]',
      'lg:grid-cols-[300px_minmax(0,1fr)]',
      'lg:grid-rows-1',
    );
    expect(screen.getByTestId('export-preview-config')).toHaveClass(
      'min-h-0',
      'overflow-y-auto',
    );
    expect(screen.getByTestId('export-preview-panel')).toHaveClass('min-h-0', 'overflow-hidden');
    expect(screen.getByTestId('export-preview-actions')).toHaveClass(
      'max-sm:w-full',
      'max-sm:justify-end',
    );
  });

  it('starts PDF preview in Fit with accessible controls and resolved A4 geometry', async () => {
    renderPreview({ request: PDF_REQUEST });

    expect(screen.getByRole('group', { name: 'Preview zoom controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit preview' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Preview zoom: 100%')).toHaveTextContent('100%');
    expect(await screen.findByTestId('pdf-preview-page-scale')).toHaveStyle({
      transform: 'scale(1)',
      transformOrigin: 'top left',
    });
    expect(screen.getByTestId('pdf-preview-wrapper')).toHaveStyle({
      width: '595.2755905511812px',
      height: '841.8897637795276px',
    });
  });

  it('keeps HTML preview responsive without PDF page zoom controls', async () => {
    renderPreview();

    expect(screen.queryByRole('group', { name: 'Preview zoom controls' })).toBeNull();
    expect(screen.queryByTestId('pdf-preview-page-scale')).toBeNull();
    expect(screen.queryByLabelText('Size')).toBeNull();
    expect(await screen.findByTitle('HTML export preview')).toHaveClass('min-h-[520px]');
  });

  it('switches from Fit to manual zoom without changing the confirmed style', async () => {
    const onConfirm = vi.fn();
    renderPreview({ request: PDF_REQUEST, onConfirm });
    await screen.findByRole('button', { name: 'Ready page 1' });

    resizePdfViewport(403, 600);
    expect(screen.getByLabelText('Preview zoom: 67%')).toHaveTextContent('67%');
    expect(screen.getByTestId('pdf-preview-page-scale')).toHaveStyle({
      transform: 'scale(0.67)',
    });
    expect(screen.getByTestId('pdf-preview-wrapper')).toHaveStyle({
      width: '398.8346456692914px',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Preview zoom: 70%')).toHaveTextContent('70%');
    expect(screen.getByTestId('pdf-preview-page-scale')).toHaveStyle({
      transform: 'scale(0.7)',
    });
    expect(screen.getByTestId('pdf-preview-wrapper')).toHaveStyle({
      width: '416.6929133858268px',
    });
    expect(screen.getByRole('button', { name: 'Fit preview' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    resizePdfViewport(304, 430);
    expect(screen.getByLabelText('Preview zoom: 70%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ready page 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));

    expect(onConfirm).toHaveBeenCalledWith(DEFAULT_EXPORT_STYLE);
    expect(onConfirm.mock.calls[0]?.[0]).not.toHaveProperty('zoom');
  });

  it('rounds down from an irregular Fit percentage when zooming out', () => {
    renderPreview({ request: PDF_REQUEST });
    resizePdfViewport(403, 600);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));

    expect(screen.getByLabelText('Preview zoom: 60%')).toBeInTheDocument();
  });

  it('re-enables responsive Fit and resets Fit for a new request', async () => {
    const { rerender } = renderPreview({ request: PDF_REQUEST });
    resizePdfViewport(403, 600);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Preview zoom: 70%')).toBeInTheDocument();

    resizePdfViewport(304, 430);
    expect(screen.getByLabelText('Preview zoom: 70%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fit preview' }));
    expect(screen.getByLabelText('Preview zoom: 51%')).toBeInTheDocument();

    resizePdfViewport(380, 600);
    expect(screen.getByLabelText('Preview zoom: 63%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Preview zoom: 70%')).toBeInTheDocument();

    rerender(
      <ExportPreviewTab
        request={{ ...PDF_REQUEST, title: 'notes-2', source: '# Notes 2' }}
        initialStyle={DEFAULT_EXPORT_STYLE}
        appTheme="light"
        busy={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        buildPreview={previewBuilder()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fit preview' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByLabelText('Preview zoom: 63%')).toBeInTheDocument();
    });
  });

  it('keeps the zoom mode while changing paper size', () => {
    renderPreview({ request: PDF_REQUEST });
    resizePdfViewport(500, 800);
    expect(screen.getByLabelText('Preview zoom: 83%')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'Letter' } });
    expect(screen.getByLabelText('Preview zoom: 81%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit preview' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByLabelText('Preview zoom: 80%')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'A4' } });
    expect(screen.getByLabelText('Preview zoom: 80%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit preview' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('disables zoom controls at manual bounds and while exporting', () => {
    const { rerender } = renderPreview({ request: PDF_REQUEST });
    resizePdfViewport(149, 210);
    expect(screen.getByLabelText('Preview zoom: 24%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();

    resizePdfViewport(760, 1200);
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    }
    expect(screen.getByLabelText('Preview zoom: 200%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

    rerender(
      <ExportPreviewTab
        request={PDF_REQUEST}
        initialStyle={DEFAULT_EXPORT_STYLE}
        appTheme="light"
        busy
        onCancel={() => {}}
        onConfirm={() => {}}
        buildPreview={previewBuilder()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fit preview' })).toBeDisabled();
  });

  it('edits the body size in the live preview and confirms the draft style', async () => {
    const onConfirm = vi.fn();
    renderPreview({ onConfirm });

    fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '13' } });

    await waitFor(() => {
      expect(screen.getByTitle('HTML export preview')).toHaveAttribute(
        'srcdoc',
        expect.stringContaining('font-size:13px'),
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'custom', fontSize: 13 }),
    );
  });

  it('exposes typography, spacing, inline code, and keyboard-key controls', () => {
    renderPreview();

    expect(screen.getByLabelText('Body size')).toHaveValue('14');
    expect(screen.getByLabelText('Font family')).toHaveValue('sans');
    expect(screen.getByLabelText('Text color')).toHaveValue('#202124');
    expect(screen.getByLabelText('Background color')).toHaveValue('#ffffff');
    expect(screen.getByLabelText('Line height')).toHaveValue('1.6');
    expect(screen.getByLabelText('Line height')).toHaveAttribute('min', '0.8');
    expect(screen.getByLabelText('Line height')).toHaveAttribute('max', '2.2');
    expect(screen.getByLabelText('Paragraph spacing')).toHaveValue('8');
    expect(screen.getByLabelText('Content padding')).toHaveValue('32');
    expect(screen.getByLabelText('Inline code text color')).toHaveValue('#7c2d12');
    expect(screen.getByLabelText('Inline code background color')).toHaveValue('#ffedd5');
    expect(screen.getByLabelText('Keyboard key text color')).toHaveValue('#334155');
    expect(screen.getByLabelText('Keyboard key background color')).toHaveValue('#e2e8f0');
    expect(screen.getByLabelText('Table border color')).toHaveValue('#d4d4d8');
    expect(screen.getByLabelText('Table header text color')).toHaveValue('#18181b');
    expect(screen.getByLabelText('Table header background color')).toHaveValue('#f4f4f5');
  });

  it('switches presets, marks manual edits Custom, and preserves paper settings', () => {
    renderPreview({
      request: { ...HTML_REQUEST, format: 'pdf' },
      initialStyle: { ...DEFAULT_EXPORT_STYLE, paperSize: 'Letter' },
      appTheme: 'dark',
    });

    expect(screen.getByLabelText('Preset')).toHaveValue('app');
    expect(screen.getByLabelText('Background color')).toHaveValue('#18181b');
    expect(screen.getByLabelText('Table border color')).toHaveValue('#3f3f46');
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'light' } });
    expect(screen.getByLabelText('Background color')).toHaveValue('#ffffff');
    expect(screen.getByLabelText('Size')).toHaveValue('Letter');
    fireEvent.change(screen.getByLabelText('Table border color'), {
      target: { value: '#123456' },
    });
    expect(screen.getByLabelText('Preset')).toHaveValue('custom');
    expect(screen.getByLabelText('Table border color')).toHaveValue('#123456');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Preset')).toHaveValue('app');
    expect(screen.getByLabelText('Background color')).toHaveValue('#18181b');
    expect(screen.getByLabelText('Size')).toHaveValue('Letter');
  });

  it('updates an app preset when the app theme changes', () => {
    const { rerender } = renderPreview({ appTheme: 'dark' });
    expect(screen.getByLabelText('Preset')).toHaveValue('app');
    expect(screen.getByLabelText('Background color')).toHaveValue('#18181b');

    rerender(
      <ExportPreviewTab
        request={HTML_REQUEST}
        initialStyle={DEFAULT_EXPORT_STYLE}
        appTheme="light"
        busy={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        buildPreview={previewBuilder()}
      />,
    );

    expect(screen.getByLabelText('Preset')).toHaveValue('app');
    expect(screen.getByLabelText('Background color')).toHaveValue('#ffffff');
    expect(screen.getByLabelText('Table border color')).toHaveValue('#d4d4d8');
  });

  it('keeps Custom edits when the app theme changes', () => {
    const { rerender } = renderPreview({ appTheme: 'dark' });
    fireEvent.change(screen.getByLabelText('Background color'), {
      target: { value: '#123456' },
    });

    rerender(
      <ExportPreviewTab
        request={HTML_REQUEST}
        initialStyle={DEFAULT_EXPORT_STYLE}
        appTheme="light"
        busy={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        buildPreview={previewBuilder()}
      />,
    );

    expect(screen.getByLabelText('Preset')).toHaveValue('custom');
    expect(screen.getByLabelText('Background color')).toHaveValue('#123456');
  });

  it('uses the selected dark background for the preview sheet and iframe', async () => {
    renderPreview({ appTheme: 'dark' });

    const iframe = await screen.findByTitle('HTML export preview');
    expect(iframe).toHaveStyle({ backgroundColor: '#18181b' });
    expect(iframe.parentElement).toHaveStyle({ backgroundColor: '#18181b' });
  });

  it('updates inline-code color in the live preview', async () => {
    renderPreview();

    fireEvent.change(screen.getByLabelText('Inline code text color'), {
      target: { value: '#314158' },
    });

    await waitFor(() => {
      expect(screen.getByTitle('HTML export preview')).toHaveAttribute(
        'srcdoc',
        expect.stringContaining('color:#314158'),
      );
    });
  });

  it('shows complete paper controls for PDF only and resets changed values', () => {
    const commonProps = {
      initialStyle: DEFAULT_EXPORT_STYLE,
      appTheme: 'light' as const,
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      buildPreview: previewBuilder(),
    };
    const { rerender } = render(<ExportPreviewTab {...commonProps} request={HTML_REQUEST} />);
    expect(screen.queryByLabelText('Size')).toBeNull();

    rerender(
      <ExportPreviewTab
        {...commonProps}
        request={{ ...HTML_REQUEST, format: 'pdf' }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '20' } });
    const size = screen.getByLabelText('Size');
    expect(size).toHaveValue('A4');
    expect(
      Array.from((size as HTMLSelectElement).options).map((option) => option.value),
    ).toEqual(['A4', 'A3', 'A2', 'Letter', 'Custom']);
    expect(screen.getByRole('button', { name: 'Portrait' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Preset')).toHaveValue('app');
    expect(screen.getByLabelText('Body size')).toHaveValue('14');
    expect(screen.getByLabelText('Size')).toHaveValue('A4');
  });

  it('keeps invalid Custom input visible, disables export, and pauses preview builds', async () => {
    const buildPreview = previewBuilder();
    renderPreview({ request: PDF_REQUEST, buildPreview });
    await screen.findByRole('button', { name: 'Ready page 1' });

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'Custom' } });
    await screen.findByLabelText('Width');
    await waitFor(() => expect(buildPreview.mock.calls.length).toBeGreaterThanOrEqual(2));
    const callsBeforeInvalidEdit = buildPreview.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '' } });
    expect(screen.getByLabelText('Width')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '13' } });
    await act(async () => Promise.resolve());
    expect(buildPreview).toHaveBeenCalledTimes(callsBeforeInvalidEdit);
  });

  it('accepts only the current first page result and renders one shared-scale page stack', async () => {
    previewPageMockState.readyPageCount = 3;
    renderPreview({ request: PDF_REQUEST });
    const ready = await screen.findByRole('button', { name: 'Ready page 1' });

    fireEvent.click(screen.getByRole('button', { name: 'Stale page 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wrong page 1' }));
    expect(screen.getByText('Page 1 / 1')).toBeInTheDocument();

    fireEvent.click(ready);
    expect(screen.getByText('Page 1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Page 2 / 3')).toBeInTheDocument();
    expect(screen.getByText('Page 3 / 3')).toBeInTheDocument();

    resizePdfViewport(403, 600);
    for (const sheet of screen.getAllByTestId('pdf-preview-page-scale')) {
      expect(sheet).toHaveStyle({ transform: 'scale(0.67)' });
    }
  });

  it('ignores a ready callback retained by an older preview token', async () => {
    renderPreview({ request: PDF_REQUEST });
    const firstPage = await screen.findByTestId('mock-pdf-preview-page-0');
    const staleToken = firstPage.dataset.token!;
    const staleReady = previewPageMockState.readyByToken.get(`${staleToken}:0`)!;

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'A3' } });
    await waitFor(() => {
      expect(screen.getByTestId('mock-pdf-preview-page-0').dataset.token).not.toBe(
        staleToken,
      );
    });

    previewPageMockState.readyPageCount = 3;
    act(() => staleReady());

    expect(screen.getByText('Page 1 / 1')).toBeInTheDocument();
    expect(screen.queryByText('Page 2 / 3')).toBeNull();
  });

  it('shows Preview unavailable when a current page reports pagination failure', async () => {
    renderPreview({ request: PDF_REQUEST });

    fireEvent.click(await screen.findByRole('button', { name: 'Fail page 1' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });

  it('updates sheet geometry for A3 landscape and explicit Custom dimensions', async () => {
    renderPreview({ request: PDF_REQUEST });
    await screen.findByTestId('mock-pdf-preview-page-0');

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'A3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    await waitFor(() => {
      const sheet = screen.getByTestId('mock-pdf-preview-page-0');
      expect(Number(sheet.dataset.width)).toBeCloseTo(1190.5511811023623, 8);
      expect(Number(sheet.dataset.height)).toBeCloseTo(841.8897637795276, 8);
    });

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'Custom' } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '180.5' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '240.2' } });
    await waitFor(() => {
      const sheet = screen.getByTestId('mock-pdf-preview-page-0');
      expect(Number(sheet.dataset.width)).toBeCloseTo(511.65354330708664, 8);
      expect(Number(sheet.dataset.height)).toBeCloseTo(680.8818897637797, 8);
    });
  });

  it('cancels without confirming and locks actions while exporting', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = renderPreview({ onCancel, onConfirm });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <ExportPreviewTab
        request={HTML_REQUEST}
        initialStyle={DEFAULT_EXPORT_STYLE}
        appTheme="light"
        busy
        onCancel={onCancel}
        onConfirm={onConfirm}
        buildPreview={previewBuilder()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Body size')).toBeDisabled();
    expect(screen.getByLabelText('Preset')).toBeDisabled();
  });

  it('reports a preview failure without confirming an export', async () => {
    const onConfirm = vi.fn();
    renderPreview({
      onConfirm,
      buildPreview: vi.fn(async () => {
        throw new Error('image failed');
      }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.getByRole('button', { name: 'Export HTML' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a native export failure on the export preview surface', () => {
    renderPreview({
      errorMessage: "Could not export '/tmp/project/README.md' to PDF: WebKit timed out",
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Could not export '/tmp/project/README.md' to PDF: WebKit timed out",
    );
  });

  it('describes and confirms workspace batch size', () => {
    renderPreview({ request: { ...HTML_REQUEST, scope: 'workspace', targetCount: 3 } });

    expect(screen.getByText('3 Markdown files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export 3 HTML files' })).toBeInTheDocument();
  });
});
