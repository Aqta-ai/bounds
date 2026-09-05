/** Browser adapter for the residual scan: pdf.js for text and rendering,
    the existing Tesseract worker for OCR, pdf-lib for metadata. */
import { PDFDocument } from 'pdf-lib'
import type { Language } from '../types'
import { getPdfjs } from './PDFEngine'
import { OCR_RENDER_SCALE, ocrPageFull, renderPageToBlob } from './OCRWorker'
import type { ResidualScanDeps } from './ResidualScan'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export const browserResidualScanDeps: ResidualScanDeps = {
  async extractPageTexts(outputBytes) {
    const pdfjs = await getPdfjs()
    const doc = await pdfjs.getDocument({ data: new Uint8Array(outputBytes) }).promise
    const texts: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    }
    await doc.destroy()
    return texts
  },
  async renderAndOcr(outputBytes, pageIndex, language: Language) {
    const buf = toArrayBuffer(outputBytes)
    const blob = await renderPageToBlob(buf, pageIndex)
    const { text, words } = await ocrPageFull(blob, language)
    const pdfjs = await getPdfjs()
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise
    const pageHeight = (await doc.getPage(pageIndex + 1)).getViewport({ scale: 1 }).height
    await doc.destroy()
    return { text, words, scale: OCR_RENDER_SCALE, pageHeight }
  },
  async readMetadata(outputBytes) {
    const doc = await PDFDocument.load(outputBytes, { updateMetadata: false })
    return {
      title: doc.getTitle() ?? '',
      author: doc.getAuthor() ?? '',
      subject: doc.getSubject() ?? '',
      keywords: doc.getKeywords() ?? '',
      producer: doc.getProducer() ?? '',
      creator: doc.getCreator() ?? '',
    }
  },
}
