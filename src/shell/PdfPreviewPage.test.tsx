import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PDF_PREVIEW_READY_MESSAGE } from '@/lib/pdfPagination';

import { PdfPreviewPage } from './PdfPreviewPage';

function renderPage() {
  const onReady = vi.fn();
  const onError = vi.fn();
  render(
    <PdfPreviewPage
      html="<!doctype html><html><body>Preview</body></html>"
      token="preview-7"
      pageIndex={1}
      width={595.2755905511812}
      height={841.8897637795276}
      pageMargin={32}
      backgroundColor="#ffffff"
      onReady={onReady}
      onError={onError}
    />,
  );
  const frame = screen.getByTitle('PDF preview page 2') as HTMLIFrameElement;
  Object.defineProperty(frame, 'clientWidth', {
    configurable: true,
    value: 595,
  });
  Object.defineProperty(frame, 'clientHeight', {
    configurable: true,
    value: 842,
  });
  Object.defineProperty(frame.contentDocument!.documentElement, 'clientWidth', {
    configurable: true,
    value: 595,
  });
  return { frame, onReady, onError };
}

describe('PdfPreviewPage', () => {
  afterEach(() => cleanup());

  it('paginates the loaded document directly without allowing iframe scripts', async () => {
    const { frame, onReady, onError } = renderPage();
    const frameDocument = frame.contentDocument!;
    frameDocument.body.innerHTML =
      '<main class="markdowner-export"><p>First page</p><p>More content</p></main>';
    Object.defineProperty(frameDocument.body, 'scrollHeight', {
      configurable: true,
      value: 1_700,
    });
    Object.defineProperty(frameDocument.documentElement, 'scrollHeight', {
      configurable: true,
      value: 1_700,
    });

    fireEvent.load(frame);

    await waitFor(() =>
      expect(onReady).toHaveBeenCalledWith({
        type: PDF_PREVIEW_READY_MESSAGE,
        token: 'preview-7',
        pageIndex: 1,
        pageCount: 3,
        pageWidth: 595.2755905511812,
        pageHeight: 841.8897637795276,
      }),
    );
    expect(frameDocument.querySelector('.markdowner-export')).toHaveStyle({
      transform: 'translateY(-841.8897637795276px)',
      transformOrigin: 'top left',
    });
    expect(frameDocument.documentElement).toHaveStyle({
      overflow: 'hidden',
    });
    expect(onError).not.toHaveBeenCalled();
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
  });

  it('waits for the iframe to receive its layout width before measuring pagination', async () => {
    const { frame, onReady, onError } = renderPage();
    const frameDocument = frame.contentDocument!;
    frameDocument.body.innerHTML =
      '<main class="markdowner-export"><p>First page</p><p>More content</p></main>';
    let layoutReady = false;
    Object.defineProperty(frame, 'clientWidth', {
      configurable: true,
      get: () => (layoutReady ? 595 : 0),
    });
    Object.defineProperty(frame, 'clientHeight', {
      configurable: true,
      get: () => (layoutReady ? 842 : 0),
    });
    Object.defineProperty(frameDocument.documentElement, 'clientWidth', {
      configurable: true,
      get: () => (layoutReady ? 595 : 0),
    });
    Object.defineProperty(frameDocument.body, 'scrollHeight', {
      configurable: true,
      get: () => (layoutReady ? 1_700 : 400_000),
    });
    Object.defineProperty(frameDocument.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => (layoutReady ? 1_700 : 400_000),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      layoutReady = true;
      callback(0);
      return 1;
    });

    fireEvent.load(frame);

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(onReady).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pageCount: 3,
      }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports iframe failures', () => {
    const { frame, onError } = renderPage();

    fireEvent.error(frame);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
