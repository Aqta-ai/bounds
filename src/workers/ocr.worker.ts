// OCR Web Worker — runs Tesseract.js WASM in isolation.
// Only invoked for pages with no extractable text (scanned image PDFs).
//
// The Tesseract worker is cached at module level so WASM + traineddata are
// only downloaded/initialised once per language per session, not once per page.

import { createWorker } from 'tesseract.js'

let _tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null
let _loadedLang: string | null = null

async function getTesseractWorker(lang: string) {
  if (_tesseractWorker && _loadedLang === lang) return _tesseractWorker
  if (_tesseractWorker) {
    await _tesseractWorker.terminate()
    _tesseractWorker = null
  }
  _tesseractWorker = await createWorker(lang, 1, {
    logger: (m: { status: string; progress: number }) => {
      self.postMessage({ type: 'ocr_progress', status: m.status, progress: m.progress })
    },
  })
  _loadedLang = lang
  return _tesseractWorker
}

self.onmessage = async (e: MessageEvent<{ id: number; imageBlob: Blob; lang: string }>) => {
  const { id, imageBlob, lang } = e.data
  try {
    const worker = await getTesseractWorker(lang)
    const { data } = await worker.recognize(imageBlob)
    const words = (data.words ?? []).map((w: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }) => ({
      text: w.text,
      confidence: w.confidence,
      x0: w.bbox.x0,
      y0: w.bbox.y0,
      x1: w.bbox.x1,
      y1: w.bbox.y1,
    }))
    self.postMessage({ id, text: data.text, words })
  } catch (err: unknown) {
    self.postMessage({ id, error: String(err) })
  }
}
