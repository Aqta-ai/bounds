import type { Language, OcrWord } from '../types'
import { createWorker } from 'tesseract.js'

// ---------------------------------------------------------------------------
// OCRWorker — Tesseract.js facade. Runs directly on the main thread.
// Tesseract.js v5 creates its own internal sub-worker; wrapping it in an
// additional Web Worker causes nested-worker failures in ES-module contexts.
// All Tesseract assets are served locally so OCR works fully offline.
// ---------------------------------------------------------------------------

export const OCR_RENDER_SCALE = 3.0

const TESSERACT_LANG_MAP: Record<Language, string> = {
  en: 'eng',
  de: 'deu',
  fr: 'fra',
  it: 'ita',
  es: 'spa',
  pt: 'por',
  nl: 'nld',
  pl: 'pol',
}

export interface OcrResult {
  text: string
  words: OcrWord[]
}

let _tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null
let _loadedLang: string | null = null

async function getTesseractWorker(lang: string) {
  if (_tesseractWorker && _loadedLang === lang) return _tesseractWorker
  if (_tesseractWorker) {
    await _tesseractWorker.terminate()
    _tesseractWorker = null
  }
  _tesseractWorker = await createWorker(lang, 1, {
    workerPath: '/tesseract-worker.min.js',
    corePath: '/tesseract-core-simd-lstm.wasm.js',
    langPath: '/',
    workerBlobURL: false,
  })
  // preserve_interword_spaces: retain spatial word gaps — critical for multi-word
  // names so "Jean Dubois" is tokenised as one entity rather than two fragments.
  // Wrapped in try/catch — tesseract.js v5 parameter passthrough is inconsistent;
  // if unsupported it should degrade gracefully rather than breaking OCR entirely.
  try {
    await _tesseractWorker.setParameters({ preserve_interword_spaces: '1' })
  } catch (e) {
    console.warn('preserve_interword_spaces not supported by this tesseract.js build, skipping', e)
  }
  _loadedLang = lang
  return _tesseractWorker
}

// ---------------------------------------------------------------------------
// Reconstruct natural reading order from OCR word bounding boxes.
//
// Tesseract's default text output reads in the order it segments text blocks —
// on two-column forms this means the entire left column (all labels) comes
// before the right column (all values). "Emergency contact:" and "Jean Dubois"
// then sit ~20 lines apart in the text stream, breaking every label-context
// regex that uses a tight whitespace budget.
//
// Fix: group words into rows by y-coordinate proximity, sort each row left→right,
// then join. This restores "Emergency contact: Jean Dubois" as a single line
// regardless of how Tesseract segmented the page.
// ---------------------------------------------------------------------------
function reconstructRowText(words: OcrWord[]): string {
  if (words.length === 0) return ''
  const heights = words.map((w) => w.y1 - w.y0).filter((h) => h > 0).sort((a, b) => a - b)
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 20
  // Allow words within 0.75 line-heights of each other to be on the same row.
  // ID card forms render labels and values 18px apart at canvas scale — a tighter
  // tolerance would split them onto separate lines, breaking label-context regexes.
  const tol = Math.max(8, medH * 0.75)

  const sorted = [...words].sort((a, b) => a.y0 - b.y0)
  const rows: OcrWord[][] = []
  let row: OcrWord[] = [sorted[0]]
  let rowY = sorted[0].y0

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y0 - rowY <= tol) {
      row.push(sorted[i])
    } else {
      rows.push(row)
      row = [sorted[i]]
      rowY = sorted[i].y0
    }
  }
  rows.push(row)

  return rows
    .map((r) => [...r].sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(' '))
    .join('\n')
}

export async function ocrPageFull(imageBlob: Blob, language: Language): Promise<OcrResult> {
  const lang = TESSERACT_LANG_MAP[language]
  const worker = await getTesseractWorker(lang)
  const { data } = await worker.recognize(imageBlob)

  const allWords: OcrWord[] = (data.words ?? [])
    .filter((w) => w.text.trim().length > 0)
    .map((w) => ({
      text: w.text,
      confidence: w.confidence,
      x0: w.bbox.x0,
      y0: w.bbox.y0,
      x1: w.bbox.x1,
      y1: w.bbox.y1,
    }))

  // Use BOTH Tesseract's raw text AND spatially-reconstructed row text.
  //
  // Why both? Tesseract's raw `data.text` preserves token boundaries like
  // "04.07.1989" as a single string — essential for date/IBAN/phone regexes.
  // `reconstructRowText` restores left→right reading order across columns —
  // essential for label-context regexes on two-column forms where Tesseract
  // reads the entire left column before the right ("Date of birth:" ... 20 lines
  // later ... "1986-05-29"). Combining both means neither class of regex breaks.
  const reconstructed = allWords.length > 0 ? reconstructRowText(allWords) : ''
  const text = reconstructed ? `${data.text}\n${reconstructed}` : data.text

  // Only high-confidence words for bbox lookup — avoids placing redaction boxes
  // on OCR noise characters that would produce misaligned overlays.
  const words = allWords.filter((w) => w.confidence >= 20)

  return { text, words }
}

export async function ocrPage(imageBlob: Blob, language: Language): Promise<string> {
  return (await ocrPageFull(imageBlob, language)).text
}

export function terminateOCRWorker(): void {
  _tesseractWorker?.terminate()
  _tesseractWorker = null
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
