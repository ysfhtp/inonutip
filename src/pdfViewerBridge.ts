import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface PdfRenderHandle {
  numPages: number;
  renderPageToCanvas: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    displayWidth: number,
    zoomMultiplier?: number,
  ) => Promise<{ width: number; height: number }>;
  destroy: () => Promise<void>;
}

export async function openPdfBlobDocument(blob: Blob): Promise<PdfRenderHandle> {
  const buffer = await blob.arrayBuffer();
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDoc = await loadingTask.promise;

  return {
    numPages: pdfDoc.numPages,
    async renderPageToCanvas(
      pageNumber: number,
      canvas: HTMLCanvasElement,
      displayWidth: number,
      zoomMultiplier = 1,
    ) {
      const page = await pdfDoc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetCssWidth = Math.max(240, displayWidth) * Math.max(0.5, Math.min(3, zoomMultiplier));
      const cssScale = targetCssWidth / baseViewport.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const cssViewport = page.getViewport({ scale: cssScale });
      const renderViewport = page.getViewport({ scale: cssScale * dpr });

      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${Math.floor(cssViewport.width)}px`;
      canvas.style.height = `${Math.floor(cssViewport.height)}px`;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        return { width: cssViewport.width, height: cssViewport.height };
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        canvas,
        viewport: renderViewport,
      }).promise;

      return { width: cssViewport.width, height: cssViewport.height };
    },
    async destroy() {
      try {
        await loadingTask.destroy();
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}
