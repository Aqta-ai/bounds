import type { Language, OcrWord } from '../types'

// ---------------------------------------------------------------------------
// OCRWorker — main-thread facade for the ocr.worker.ts Web Worker.
// Used only for pages that have no extractable text (scanned image PDFs).
// ---------------------------------------------------------------------------

/** Single source of truth for the render scale used during OCR. Must match layout.ocrScale in RedactionPipeline. */
export const OCR_RENDER_SCALE = 2.0

const TESSERACT_LANG_MAP: Record<Language, string> = {
  en: 'eng',
  de: 'deu',
  fr: 'fra',
  it: 'ita',
  es: 'spa',
}

export interface OcrResult {
  text: string
  words: OcrWord[]
}

interface OCRJob {
  id: number
  resolve: (result: OcrResult) => void
  reject: (err: Error) => void
}

let _worker: Worker | null = null
let _jobCounter = 0
const _pendingJobs = new Map<number, OCRJob>()

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' })
    _worker.onmessage = (e: MessageEvent<{ id: number; text?: string; words?: OcrWord[]; error?: string }>) => {
      const { id, text, words, error } = e.data
      const job = _pendingJobs.get(id)
      if (!job) return
      _pendingJobs.delete(id)
      if (error) {
        job.reject(new Error(error))
      } else {
        job.resolve({ text: text ?? '', words: words ?? [] })
      }
    }
    _worker.onerror = (e) => {
      for (const job of _pendingJobs.values()) {
        job.reject(new Error(e.message))
      }
      _pendingJobs.clear()
      _worker = null
    }
  }
  return _worker
}

/**
 * Run OCR on an ImageData blob for a single PDF page.
 * Returns extracted text and word-level bounding boxes (in image pixel coords).
 */
export function ocrPageFull(imageBlob: Blob, language: Language): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    const id = ++_jobCounter
    const tesseractLang = TESSERACT_LANG_MAP[language]

    const timer = setTimeout(() => {
      if (_pendingJobs.has(id)) {
        _pendingJobs.delete(id)
        reject(new Error('OCR timed out'))
      }
    }, 90_000)

    _pendingJobs.set(id, {
      id,
      resolve: (r) => { clearTimeout(timer); resolve(r) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    try {
      getWorker().postMessage({ id, imageBlob, lang: tesseractLang })
    } catch (err) {
      clearTimeout(timer)
      _pendingJobs.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** Convenience wrapper that returns plain text only. */
export async function ocrPage(imageBlob: Blob, language: Language): Promise<string> {
  return (await ocrPageFull(imageBlob, language)).text
}

export function terminateOCRWorker(): void {
  _worker?.terminate()
  _worker = null
  _pendingJobs.clear()
}

/**
 * Render a PDF page to a Blob using an offscreen canvas.
 * pageIndex is 0-based.
 */
export async function renderPageToBlob(buffer: ArrayBuffer, pageIndex: number): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString()
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise
  const page = await pdf.getPage(pageIndex + 1)
  const scale = OCR_RENDER_SCALE
  const viewport = page.getViewport({ scale })
  const canvas = new OffscreenCanvas(viewport.width, viewport.height)
  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
  return canvas.convertToBlob({ type: 'image/png' })
}
