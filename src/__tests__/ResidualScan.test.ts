import { describe, expect, it } from 'vitest'
import { runResidualScan, scanPassed, normaliseForMatch, OCR_MIN_SPAN, type ResidualScanDeps } from '../pipeline/ResidualScan'
import type { Detection } from '../types'

const det = (over: Partial<Detection>): Detection => ({
  id: 'd1', type: 'EMAIL', text: 'maire.osullivan@example.ie', token: '[EMAIL_001]', pageIndex: 0,
  boundingBox: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.99, source: 'REGEX', enabled: true, ...over,
})
const bytes = new Uint8Array([1, 2, 3])

function deps(over: Partial<ResidualScanDeps>): ResidualScanDeps {
  return {
    extractPageTexts: async () => ['', 'Page two has ordinary text only.'],
    renderAndOcr: async () => ({ text: 'REDACTED REDACTED consultant note hypertension review', words: [], scale: 3, pageHeight: 842 }),
    readMetadata: async () => ({ title: 'summary.pdf', author: '', subject: '', keywords: '', producer: 'Bounds', creator: '' }),
    ...over,
  }
}

describe('residual scan', () => {
  it('passes a clean output: rasterised redacted page, no residual text, clean OCR and metadata', async () => {
    const r = await runResidualScan(bytes, [det({})], 'en', deps({}))
    expect(scanPassed(r)).toBe(true)
    expect(r).toMatchObject({ pages_scanned: 2, redacted_pages: 1, spans_checked: 1, residual_findings: 0 })
    expect(r.ocr_chars_read).toBeGreaterThan(0)   // the OCR leg actually read text, so the PASS is not a no-op
  })
  it('fails when the extracted text still contains a redacted span', async () => {
    const r = await runResidualScan(bytes, [det({})], 'en', deps({ extractPageTexts: async () => ['contact maire.osullivan@example.ie today', ''] }))
    expect(r.residual_text_scan).toBe('FAIL')
    expect(r.pdf_object_scan).toBe('FAIL')            // the redacted page still carries text objects
    expect(r.findings.some((f) => f.check === 'residual_text_scan' && f.kind === 'EMAIL')).toBe(true)
    expect(JSON.stringify(r.findings)).not.toContain('osullivan')   // never the text itself
  })
  it('fails when the regex detectors find the redacted category in leftover text', async () => {
    const r = await runResidualScan(bytes, [det({ text: 'x@y.ie' })], 'en', deps({ extractPageTexts: async () => ['', 'reach me at someone.else@example.com'] }))
    expect(r.residual_text_scan).toBe('FAIL')
    expect(r.findings.some((f) => f.kind === 'regex:EMAIL')).toBe(true)
  })
  it('fails when OCR of the rendered page recovers a redacted span, tolerant of spacing and case', async () => {
    const r = await runResidualScan(bytes, [det({})], 'en', deps({ renderAndOcr: async () => ({ text: 'MAIRE . OSULLIVAN @ EXAMPLE . IE was seen', words: [], scale: 3, pageHeight: 842 }) }))
    expect(r.rendered_ocr_scan).toBe('FAIL')
  })
  // Box for a 12pt span at x=100..130, y=700 on an A4 page, drawn with the shared 2pt pad,
  // in image pixels at scale 3: x 294..396, y 384..432 (top-left origin).
  const boxed = (text: string, type: Detection['type']) => det({ type, text, boundingBox: { x: 100, y: 700, width: 30, height: 12 } })
  const word = (text: string, x0: number, x1: number) => ({ text, x0, x1, y0: 390, y1: 426, confidence: 90 })
  it('fails when a leading glyph is left standing at the left edge of a box', async () => {
    const r = await runResidualScan(bytes, [boxed('Maire', 'PERSON')], 'en',
      deps({ renderAndOcr: async () => ({ text: 'Patient: M', words: [word('Patient:', 200, 270), word('M', 280, 293)], scale: 3, pageHeight: 842 }) }))
    expect(r.rendered_ocr_scan).toBe('FAIL')
    expect(r.findings).toEqual([{ check: 'rendered_ocr_scan', page: 0, kind: 'PERSON:partial_left' }])
  })
  it('fails when a trailing digit is left standing at the right edge of a box', async () => {
    const r = await runResidualScan(bytes, [boxed('+353 87 123 4567', 'PHONE')], 'en',
      deps({ renderAndOcr: async () => ({ text: 'Phone 7.', words: [word('Phone', 200, 280), word('7.', 397, 410)], scale: 3, pageHeight: 842 }) }))
    expect(r.rendered_ocr_scan).toBe('FAIL')
    expect(r.findings[0].kind).toBe('PHONE:partial_right')
  })
  it('ignores neighbouring words that touch a box but are not fragments of its span', async () => {
    const r = await runResidualScan(bytes, [boxed('Maire', 'PERSON')], 'en',
      deps({ renderAndOcr: async () => ({ text: 'Patient: DOB', words: [word('Patient:', 220, 293), word('DOB', 397, 440), word('m', 100, 110)], scale: 3, pageHeight: 842 }) }))
    expect(r.rendered_ocr_scan).toBe('PASS')   // "m" far from the box is not adjacent; "Patient:" and "DOB" are not fragments
  })
  it('does not search OCR output for spans too short to be meaningful', async () => {
    const r = await runResidualScan(bytes, [det({ type: 'ID_NUMBER', text: '1981' })], 'en', deps({ renderAndOcr: async () => ({ text: 'reviewed in 1981', words: [], scale: 3, pageHeight: 842 }) }))
    expect(normaliseForMatch('1981').length).toBeLessThan(OCR_MIN_SPAN)
    expect(r.rendered_ocr_scan).toBe('PASS')
    // ...but exact extracted text is still held to it
    const r2 = await runResidualScan(bytes, [det({ type: 'ID_NUMBER', text: '1981' })], 'en', deps({ extractPageTexts: async () => ['', 'born 1981'] }))
    expect(r2.residual_text_scan).toBe('FAIL')
  })
  it('fails when metadata carries a redacted span', async () => {
    const r = await runResidualScan(bytes, [det({ type: 'PERSON', text: 'Maire OSullivan' })], 'en', deps({ readMetadata: async () => ({ title: 'Maire O Sullivan summary' }) }))
    expect(r.metadata_scan).toBe('FAIL')
    expect(r.findings[0]).toMatchObject({ check: 'metadata_scan', kind: 'title:PERSON' })
  })
  it('ignores disabled detections and reports what it checked', async () => {
    const r = await runResidualScan(bytes, [det({ enabled: false })], 'en', deps({ extractPageTexts: async () => ['maire.osullivan@example.ie'] }))
    expect(r.spans_checked).toBe(0)
    expect(scanPassed(r)).toBe(true)
  })
})
