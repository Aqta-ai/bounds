import { PDFDocument, PDFPage, rgb, degrees } from 'pdf-lib'
import type { BBox, Detection, OcrWord, PageLayout, RedactionOptions, TextSpan } from '../types'

// ---------------------------------------------------------------------------
// PDFEngine
// Two responsibilities:
//   1. extractLayouts() — use pdfjs-dist to get text content + bounding boxes
//   2. applyRedactions() — true redaction: rasterize pages with detections via
//      canvas (removing text layer), then re-embed as images in a new PDF.
//      Pages without detections are copied intact.
//
// Coordinate systems:
//   pdfjs-dist: origin bottom-left, y increases upward (matches PDF spec)
//   OffscreenCanvas: origin top-left, y increases downward
//   pdf-lib: origin bottom-left, y increases upward
// ---------------------------------------------------------------------------

async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString()
  return pdfjs
}

export async function extractLayouts(buffer: ArrayBuffer): Promise<PageLayout[]> {
  const pdfjs = await getPdfjs()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) })
  const pdf = await loadingTask.promise
  const layouts: PageLayout[] = []

  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const viewport = page.getViewport({ scale: 1.0 })
    const content = await page.getTextContent()

    const spans: TextSpan[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [sx, , , sy, tx, ty] = item.transform as number[]
      const width = item.width ?? Math.abs(sx * item.str.length * 0.6)
      const height = Math.abs(sy)
      spans.push({
        text: item.str,
        x: tx,
        y: ty,
        width: width,
        height: height || 10,
      })
    }

    const totalChars = spans.reduce((n, s) => n + s.text.length, 0)

    // Detect embedded images via operator list — if any image-drawing ops exist,
    // the page may be a scan or contain a scanned image embedded inside a PDF wrapper.
    // In that case we must run OCR regardless of how many text-layer chars exist.
    const ops = await page.getOperatorList()
    const hasImages = ops.fnArray.some(
      (fn: number) =>
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject ||
        fn === pdfjs.OPS.paintXObject,
    )

    layouts.push({
      pageIndex: i,
      width: viewport.width,
      height: viewport.height,
      spans,
      // Require OCR only when text is sparse AND the page has images (scanned form
      // inside a PDF wrapper). Text-rich pages with logos (totalChars >= 300) have a
      // reliable text layer — forcing OCR on those breaks span bbox resolution.
      requiresOCR: totalChars < 300 && hasImages,
    })
  }

  return layouts
}

// ---------------------------------------------------------------------------
// Rasterize a single PDF page to PNG with redaction boxes drawn on the canvas.
// This is the key to TRUE redaction: the original text is never present in
// the output — only a flat image remains.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rasterizePageWithRedactions(
  pdfjsDoc: any,
  pageIndex: number,
  dets: Detection[],
  layout: PageLayout,
  options: RedactionOptions,
): Promise<Uint8Array> {
  const SCALE = 2.0
  const pdfjsPage = await pdfjsDoc.getPage(pageIndex + 1)
  const viewport = pdfjsPage.getViewport({ scale: SCALE })
  const canvas = new OffscreenCanvas(viewport.width, viewport.height)
  const ctx = canvas.getContext('2d')!

  // Render the page content onto the canvas
  await pdfjsPage.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise

  const { r, g, b } = options.color
  const fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
  ctx.fillStyle = fillStyle

  const pageH = layout.height  // PDF units at scale 1.0

  for (const det of dets) {
    const { x, y, width, height } = det.boundingBox
    if (width <= 0 || height <= 0) continue

    const PAD = 2
    // Convert PDF bottom-left coords → canvas top-left coords, scaled
    const cx = (x - PAD) * SCALE
    const cy = (pageH - y - height - PAD) * SCALE
    const cw = (width + PAD * 2) * SCALE
    const ch = (height + PAD * 2) * SCALE

    ctx.fillRect(cx, cy, cw, ch)

    // Optionally stamp the token label inside the box
    if (options.labelStyle === 'token') {
      const isDark = r + g + b < 1.5
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)'
      const fontSize = Math.max(9, ch * 0.55)
      ctx.font = `bold ${fontSize}px monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      // Clip to box bounds so long tokens don't overflow
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx, cy, cw, ch)
      ctx.clip()
      ctx.fillText(det.token, cx + 4, cy + ch / 2)
      ctx.restore()
      ctx.fillStyle = fillStyle
    }
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

// ---------------------------------------------------------------------------
// Stamp a diagonal watermark on a pdf-lib page
// ---------------------------------------------------------------------------
function addWatermarkToPage(
  page: PDFPage,
  watermark: { text: string; opacity: number },
): void {
  if (!watermark.text.trim()) return
  const { width, height } = page.getSize()
  const fontSize = Math.min(width, height) * 0.07
  const textLen = watermark.text.length
  page.drawText(watermark.text, {
    x: width / 2 - (textLen * fontSize * 0.28),
    y: height / 2,
    size: fontSize,
    color: rgb(0.45, 0.45, 0.45),
    opacity: watermark.opacity,
    rotate: degrees(45),
  })
}

// ---------------------------------------------------------------------------
// applyRedactions — builds a new PDF document:
//   • Pages with detections → rasterized image (text layer removed) + boxes
//   • Pages without detections → copied verbatim from source
//   • Watermark stamped on all pages if enabled
// ---------------------------------------------------------------------------
export async function applyRedactions(
  originalBuffer: ArrayBuffer,
  detections: Detection[],
  layouts: PageLayout[],
  options: RedactionOptions,
): Promise<Uint8Array> {
  const originalDoc = await PDFDocument.load(originalBuffer)
  const newDoc = await PDFDocument.create()

  // Load pdfjs doc once for all rasterizations
  const pdfjs = await getPdfjs()
  const pdfjsDoc = await pdfjs.getDocument({ data: new Uint8Array(originalBuffer.slice(0)) }).promise

  // Group enabled detections by page
  const byPage = new Map<number, Detection[]>()
  for (const d of detections) {
    if (!d.enabled) continue
    if (!byPage.has(d.pageIndex)) byPage.set(d.pageIndex, [])
    byPage.get(d.pageIndex)!.push(d)
  }

  const pageCount = originalDoc.getPageCount()

  for (let i = 0; i < pageCount; i++) {
    const dets = byPage.get(i) ?? []
    const layout = layouts[i]

    if (dets.length > 0) {
      // ── True redaction: rasterize → draw boxes → embed image ───────────────
      const pageW = layout?.width ?? originalDoc.getPage(i).getWidth()
      const pageH = layout?.height ?? originalDoc.getPage(i).getHeight()

      const imageBytes = await rasterizePageWithRedactions(pdfjsDoc, i, dets, layout, options)
      const image = await newDoc.embedPng(imageBytes)
      const newPage = newDoc.addPage([pageW, pageH])
      newPage.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH })

      if (options.watermark.enabled) {
        addWatermarkToPage(newPage, options.watermark)
      }
    } else {
      // ── Copy original page intact ───────────────────────────────────────────
      const [copied] = await newDoc.copyPages(originalDoc, [i])
      newDoc.addPage(copied)

      if (options.watermark.enabled) {
        addWatermarkToPage(newDoc.getPage(newDoc.getPageCount() - 1), options.watermark)
      }
    }
  }

  return newDoc.save()
}

/** Merge a set of spans into their union bounding box. */
function unionBBox(spans: TextSpan[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxRight = -Infinity, maxBottom = -Infinity
  for (const s of spans) {
    minX = Math.min(minX, s.x)
    minY = Math.min(minY, s.y)
    maxRight = Math.max(maxRight, s.x + s.width)
    maxBottom = Math.max(maxBottom, s.y + s.height)
  }
  return { x: minX, y: minY, width: maxRight - minX, height: maxBottom - minY }
}

/**
 * Scan page spans to find the bounding box of a match string.
 *
 *   Pass 1 — exact substring in a single span
 *   Pass 2 — join 2–5 consecutive same-line spans (handles multi-word names)
 *   Pass 3 — any significant word match ≥4 chars (last-resort fallback)
 *
 * `occurrence` (0-based) skips that many earlier matches so duplicate text
 * on the same page (e.g. a name in two columns) each get their own bbox.
 */
export function findSpanBBox(
  spans: TextSpan[],
  matchText: string,
  occurrence = 0,
): { x: number; y: number; width: number; height: number } | null {
  const needle = matchText.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!needle) return null

  let seen = 0
  for (const span of spans) {
    const spanLower = span.text.toLowerCase()
    const idx = spanLower.indexOf(needle)
    if (idx !== -1) {
      if (seen++ < occurrence) continue
      const charWidth = span.width / span.text.length
      return {
        x: span.x + idx * charWidth,
        y: span.y,
        width: charWidth * needle.length,
        height: span.height,
      }
    }
  }

  seen = 0
  for (let windowSize = 2; windowSize <= 5; windowSize++) {
    for (let i = 0; i <= spans.length - windowSize; i++) {
      const window = spans.slice(i, i + windowSize)
      const baseY = window[0].y
      if (window.some((s) => Math.abs(s.y - baseY) > 4)) continue
      const joined = window.map((s) => s.text)
      if (joined.join('').toLowerCase().includes(needle) || joined.join(' ').toLowerCase().includes(needle)) {
        if (seen++ < occurrence) continue
        return unionBBox(window)
      }
    }
  }

  // Pass 3 doesn't support occurrence — fall back to first significant word match
  const words = needle.split(' ').filter((w) => w.length >= 4)
  for (const word of words) {
    for (const span of spans) {
      if (span.text.toLowerCase().includes(word)) {
        return { x: span.x, y: span.y, width: span.width, height: span.height }
      }
    }
  }

  return null
}

export function getPageCount(buffer: ArrayBuffer): Promise<number> {
  return getPdfjs().then(async (pdfjs) => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise
    return pdf.numPages
  })
}

/** Convert image-pixel bbox (top-left origin) to PDF user-space (bottom-left origin). */
function imgBBoxToPdf(x0: number, y0: number, x1: number, y1: number, pageHeight: number, scale: number): BBox {
  return {
    x: x0 / scale,
    y: pageHeight - y1 / scale,   // flip y: PDF origin is bottom-left
    width: (x1 - x0) / scale,
    height: (y1 - y0) / scale,
  }
}

/**
 * Find the bounding box of a detection in OCR word results.
 * Words carry image-pixel coordinates at `scale`; we convert to PDF user-space.
 *
 *   Pass 1 — any single word that contains the needle
 *   Pass 2 — 2–6 consecutive words whose joined text contains the needle
 *   Pass 3 — any significant word (≥4 chars) from the needle (last-resort)
 */
export function findOcrWordBBox(
  words: OcrWord[],
  matchText: string,
  pageHeight: number,
  scale: number,
): BBox | null {
  const needle = matchText.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!needle) return null
  const lowers = words.map((w) => w.text.toLowerCase())

  // Pass 1 — single word
  for (let i = 0; i < words.length; i++) {
    if (lowers[i].includes(needle)) {
      const w = words[i]
      return imgBBoxToPdf(w.x0, w.y0, w.x1, w.y1, pageHeight, scale)
    }
  }

  // Pass 2 — consecutive window
  for (let windowSize = 2; windowSize <= 6; windowSize++) {
    for (let i = 0; i <= words.length - windowSize; i++) {
      const group = words.slice(i, i + windowSize)
      const joined = group.map((w) => w.text).join(' ').toLowerCase()
      if (joined.includes(needle)) {
        const x0 = Math.min(...group.map((w) => w.x0))
        const y0 = Math.min(...group.map((w) => w.y0))
        const x1 = Math.max(...group.map((w) => w.x1))
        const y1 = Math.max(...group.map((w) => w.y1))
        return imgBBoxToPdf(x0, y0, x1, y1, pageHeight, scale)
      }
    }
  }

  // Pass 3 — any significant part word
  const parts = needle.split(' ').filter((p) => p.length >= 4)
  for (const part of parts) {
    for (let i = 0; i < words.length; i++) {
      if (lowers[i].includes(part)) {
        const w = words[i]
        return imgBBoxToPdf(w.x0, w.y0, w.x1, w.y1, pageHeight, scale)
      }
    }
  }

  return null
}
