/**
 * Proof of removal.
 *
 * A redacted PDF that merely looks redacted is the classic failure of this
 * category: a black box drawn over text that a copy-paste recovers. Bounds
 * rasterises redacted pages, so the text layer is gone by construction, but a
 * claim is not a check. This module checks the actual output file and writes
 * the result into the signed redaction record, so the record no longer says
 * "Bounds redacted this" but "this exact file was scanned and nothing that was
 * meant to be removed could be found in it, under this procedure".
 *
 * Four checks, each PASS or FAIL, never silently skipped:
 *   residual_text_scan  extracted text of every page contains none of the
 *                       redacted strings, and the regex detectors find none of
 *                       the redacted categories in it
 *   pdf_object_scan     pages that carried detections expose no text objects
 *                       at all (they were rasterised)
 *   rendered_ocr_scan   each redacted page is rendered and OCR'd; the OCR text
 *                       contains none of the redacted strings, and no OCR word
 *                       touching a box's edge is a leading or trailing fragment
 *                       of the span the box was meant to cover
 *   metadata_scan       document metadata carries none of the redacted strings
 *
 * The scan depends on three capabilities injected as functions so the logic
 * can be tested without workers, and so the browser adapter and any future
 * Node adapter share one procedure.
 */

import type { Detection, Language, OcrWord, PiiType } from '../types'
import { detectRegex } from './RegexDetector'
import { findPartialLeaks, normaliseForMatch } from './geometry'

export { normaliseForMatch }

/** v2 adds the partial-leak check: a glyph left standing beside a box. */
export const RESIDUAL_SCAN_PROCEDURE = 'bounds-residual-scan/v2'

/** One rendered, OCR'd page of the output: text, word boxes in image pixels at `scale`, page height in PDF units. */
export interface OcrRender {
  text: string
  words: OcrWord[]
  scale: number
  pageHeight: number
}

export interface ResidualScanDeps {
  /** Text content of every page of the OUTPUT file, in page order. */
  extractPageTexts(outputBytes: Uint8Array): Promise<string[]>
  /** Render one page of the OUTPUT file and OCR it: recognised text plus word boxes. */
  renderAndOcr(outputBytes: Uint8Array, pageIndex: number, language: Language): Promise<OcrRender>
  /** Document metadata of the OUTPUT file: title, author, subject, keywords, producer, creator. */
  readMetadata(outputBytes: Uint8Array): Promise<Record<string, string>>
}

export type ScanVerdict = 'PASS' | 'FAIL'

export interface ResidualFinding {
  check: 'residual_text_scan' | 'pdf_object_scan' | 'rendered_ocr_scan' | 'metadata_scan'
  page: number | null
  /** The PII category or metadata field, never the text itself. */
  kind: string
}

export interface ResidualScanResult {
  procedure: typeof RESIDUAL_SCAN_PROCEDURE
  pages_scanned: number
  redacted_pages: number
  spans_checked: number
  ocr_language: Language
  residual_text_scan: ScanVerdict
  pdf_object_scan: ScanVerdict
  rendered_ocr_scan: ScanVerdict
  metadata_scan: ScanVerdict
  /** Characters the OCR read back from the rendered redacted pages. A PASS with
      zero characters read on a page that still carries other text would be a
      no-op, so the number travels with the verdict. */
  ocr_chars_read: number
  residual_findings: number
  findings: ResidualFinding[]
}

/** Spans shorter than this, once normalised, are not searched for in OCR
    output: a four-digit year or a two-letter initial would produce false
    positives against unrelated text. They are still checked in the exact
    extracted-text and metadata scans. */
export const OCR_MIN_SPAN = 6

const MAX_FINDINGS = 40

export async function runResidualScan(
  outputBytes: Uint8Array,
  detections: Detection[],
  language: Language,
  deps: ResidualScanDeps,
): Promise<ResidualScanResult> {
  const enabled = detections.filter((d) => d.enabled)
  const findings: ResidualFinding[] = []
  const add = (f: ResidualFinding) => { if (findings.length < MAX_FINDINGS) findings.push(f) }

  const spans = enabled
    .map((d) => ({ norm: normaliseForMatch(d.text), type: d.type as PiiType, page: d.pageIndex }))
    .filter((s) => s.norm.length > 0)
  const redactedTypes = new Set(spans.map((s) => s.type))
  const redactedPages = new Set(enabled.map((d) => d.pageIndex))

  // 1. Extracted text of the output.
  const pageTexts = await deps.extractPageTexts(outputBytes)
  let residualText: ScanVerdict = 'PASS'
  let pdfObject: ScanVerdict = 'PASS'
  pageTexts.forEach((text, pageIndex) => {
    const norm = normaliseForMatch(text)
    for (const s of spans) {
      if (s.norm.length > 0 && norm.includes(s.norm)) {
        residualText = 'FAIL'; add({ check: 'residual_text_scan', page: pageIndex, kind: s.type })
      }
    }
    if (text.trim().length > 0) {
      const counters = new Map<PiiType, number>()
      for (const hit of detectRegex(text, pageIndex, language, counters)) {
        if (redactedTypes.has(hit.type)) {
          residualText = 'FAIL'; add({ check: 'residual_text_scan', page: pageIndex, kind: `regex:${hit.type}` })
        }
      }
      if (redactedPages.has(pageIndex)) {
        pdfObject = 'FAIL'; add({ check: 'pdf_object_scan', page: pageIndex, kind: 'text_objects_present' })
      }
    }
  })

  // 2. Render and OCR every page that carried a redaction.
  let renderedOcr: ScanVerdict = 'PASS'
  let ocrChars = 0
  for (const pageIndex of [...redactedPages].sort((a, b) => a - b)) {
    const rendered = await deps.renderAndOcr(outputBytes, pageIndex, language)
    ocrChars += rendered.text.replace(/\s+/g, '').length
    const ocrText = normaliseForMatch(rendered.text)
    for (const s of spans) {
      if (s.norm.length >= OCR_MIN_SPAN && ocrText.includes(s.norm)) {
        renderedOcr = 'FAIL'; add({ check: 'rendered_ocr_scan', page: pageIndex, kind: s.type })
      }
    }
    const pageDets = enabled.filter((d) => d.pageIndex === pageIndex)
    for (const leak of findPartialLeaks(pageDets, rendered.words, rendered.scale, rendered.pageHeight)) {
      renderedOcr = 'FAIL'; add({ check: 'rendered_ocr_scan', page: pageIndex, kind: `${leak.detection.type}:partial_${leak.side}` })
    }
  }

  // 3. Metadata.
  let metadata: ScanVerdict = 'PASS'
  const meta = await deps.readMetadata(outputBytes)
  for (const [field, value] of Object.entries(meta)) {
    const norm = normaliseForMatch(value ?? '')
    for (const s of spans) {
      if (s.norm.length > 0 && norm.includes(s.norm)) {
        metadata = 'FAIL'; add({ check: 'metadata_scan', page: null, kind: `${field}:${s.type}` })
      }
    }
  }

  return {
    procedure: RESIDUAL_SCAN_PROCEDURE,
    pages_scanned: pageTexts.length,
    redacted_pages: redactedPages.size,
    spans_checked: spans.length,
    ocr_language: language,
    residual_text_scan: residualText,
    pdf_object_scan: pdfObject,
    rendered_ocr_scan: renderedOcr,
    metadata_scan: metadata,
    ocr_chars_read: ocrChars,
    residual_findings: findings.length,
    findings,
  }
}

export function scanPassed(r: ResidualScanResult): boolean {
  return r.residual_text_scan === 'PASS' && r.pdf_object_scan === 'PASS'
    && r.rendered_ocr_scan === 'PASS' && r.metadata_scan === 'PASS'
}
