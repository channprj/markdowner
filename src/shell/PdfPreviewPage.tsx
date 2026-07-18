import { useEffect, useRef } from 'react';

import {
  PDF_PREVIEW_READY_MESSAGE,
  paginatePdfDocument,
  type PdfPreviewReadyMessage,
} from '@/lib/pdfPagination';
import type { PdfPageFurniture, PdfPageInsets } from '@/lib/exportPageLayout';
import { MAX_PDF_PAGES } from '@/lib/pdfPaper';

export interface PdfPreviewPageProps {
  html: string;
  token: string;
  pageIndex: number;
  width: number;
  height: number;
  pageInsets: PdfPageInsets;
  pageFurniture: PdfPageFurniture;
  backgroundColor: string;
  onReady: (result: PdfPreviewReadyMessage) => void;
  onError: () => void;
}

async function waitForPreviewAssets(doc: Document): Promise<void> {
  const fonts = doc.fonts?.ready
    ? Promise.resolve(doc.fonts.ready).catch(() => undefined)
    : Promise.resolve();
  const images = Array.from(doc.images, (image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  });
  await Promise.all([fonts, ...images]);
}

async function waitForPreviewLayout(
  frame: HTMLIFrameElement,
  doc: Document,
): Promise<void> {
  const maxFrames = 60;
  for (let frameIndex = 0; frameIndex < maxFrames; frameIndex += 1) {
    if (
      frame.clientWidth > 0 &&
      frame.clientHeight > 0 &&
      doc.documentElement.clientWidth > 0
    ) {
      return;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  throw new Error('PDF preview did not receive a measurable layout.');
}

export function PdfPreviewPage({
  html,
  token,
  pageIndex,
  width,
  height,
  pageInsets,
  pageFurniture,
  backgroundColor,
  onReady,
  onError,
}: PdfPreviewPageProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = iframeRef.current;
    frame?.addEventListener('error', onError);
    return () => frame?.removeEventListener('error', onError);
  }, [onError]);

  const paginatePage = () => {
    const frame = iframeRef.current;
    const frameDocument = frame?.contentDocument;
    if (!frame || !frameDocument) {
      onError();
      return;
    }

    void waitForPreviewAssets(frameDocument)
      .then(() => waitForPreviewLayout(frame, frameDocument))
      .then(() => {
        if (
          iframeRef.current !== frame ||
          frame.contentDocument !== frameDocument
        ) {
          return;
        }
        const result = paginatePdfDocument(frameDocument, {
          pageWidth: width,
          pageHeight: height,
          pageInsets,
          pageFurniture,
          maxPages: MAX_PDF_PAGES,
        });
        const container =
          (frameDocument.querySelector('.markdowner-export') as HTMLElement | null) ??
          frameDocument.body;
        container.style.transform = `translateY(-${pageIndex * height}px)`;
        container.style.transformOrigin = 'top left';
        frameDocument.documentElement.style.overflow = 'hidden';
        frameDocument.body.style.overflow = 'hidden';
        onReady({
          type: PDF_PREVIEW_READY_MESSAGE,
          token,
          pageIndex,
          pageCount: result.pageCount,
          pageWidth: width,
          pageHeight: height,
        });
      })
      .catch(onError);
  };

  return (
    <div
      className="overflow-hidden border border-border/70 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.45)]"
      style={{ width, height, backgroundColor }}
    >
      <iframe
        ref={iframeRef}
        title={`PDF preview page ${pageIndex + 1}`}
        sandbox="allow-same-origin"
        srcDoc={html}
        onLoad={paginatePage}
        className="block border-0"
        style={{ width, height, backgroundColor }}
      />
    </div>
  );
}
