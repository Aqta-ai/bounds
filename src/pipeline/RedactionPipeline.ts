import type { Detection, DetectionResult, Language, PiiType, PipelineResult, PipelineStep, RedactionOptions, RiskLevel } from '../types'
import { extractLayouts, applyRedactions, findSpanBBox, findOcrWordBBox } from './PDFEngine'
import { detectRegex, resetRegexIdCounter } from './RegexDetector'
import { detectNER, buildNERDetections, resetNerIdCounter, setNERModelProgressCallback } from './NERWorker'
import { ocrPageFull, renderPageToBlob, OCR_RENDER_SCALE } from './OCRWorker'
import { KeyVaultService } from './KeyVaultService'
import { generateSummary } from './ExplainWorker'
import { sha256Hex, stemName } from '../utils/fileUtils'

// ---------------------------------------------------------------------------
// RedactionPipeline — orchestrates detection, then (separately) PDF output.
// ---------------------------------------------------------------------------

// Risk weight per PII type — higher = more sensitive data
const RISK_WEIGHTS: Partial<Record<PiiType, number>> = {
  HEALTH_DATA:   4,
  SSN:           4,
  CREDIT_CARD:   3,
  IBAN:          3,
  PASSPORT:      3,
  DATE_OF_BIRTH: 2,
  PERSON:        2,
  ADDRESS:       2,
  ID_NUMBER:     2,
  PHONE:         1,
  EMAIL:         1,
  IP_ADDRESS:    1,
  ORG:           1,
  CONFIDENTIAL:  1,
  PROPRIETARY:   1,
  LEGAL_CLAUSE:  1,
  MISC:          1,
}

export function computeRisk(detections: Detection[]): { riskScore: number; riskLevel: RiskLevel } {
  const enabled = detections.filter((d) => d.enabled)
  const riskScore = enabled.reduce((sum, d) => sum + (RISK_WEIGHTS[d.type] ?? 1), 0)
  let riskLevel: RiskLevel = 'clean'
  if (riskScore >= 30)     riskLevel = 'critical'
  else if (riskScore >= 15) riskLevel = 'high'
  else if (riskScore >= 5)  riskLevel = 'medium'
  else if (riskScore > 0)   riskLevel = 'low'
  return { riskScore, riskLevel }
}

export type ProgressCallback = (step: PipelineStep) => void

/**
 * Phase 1: extract text, detect PII, encrypt the redaction map.
 * Does NOT generate the redacted PDF — that happens at export time so the
 * user's chosen options (color, watermark, label style) are applied.
 */
export async function runDetection(
  buffer: ArrayBuffer,
  fileName: string,
  language: Language,
  onProgress: ProgressCallback,
): Promise<DetectionResult> {
  onProgress({ stage: 'extracting', progress: 0 })

  // Reset module-level ID counters so IDs start from 1 for every new document
  resetRegexIdCounter()
  resetNerIdCounter()

  const documentHash = await sha256Hex(buffer)
  const documentName = fileName

  // ── 1. Extract text layouts ──────────────────────────────────────────────
  const layouts = await extractLayouts(buffer)
  onProgress({ stage: 'extracting', progress: 100 })

  const tokenCounters = new Map<PiiType, number>()
  const allDetections: Omit<Detection, 'boundingBox'>[] = []
  const total = layouts.length
  const ocrFailedPages: number[] = []
  const pageTexts: string[] = []

  // ── 2. Per-page detection ────────────────────────────────────────────────
  // Forward NER model download progress (first run only — cached on subsequent runs)
  setNERModelProgressCallback((pct) => onProgress({ stage: 'loading_model', modelProgress: pct }))

  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    const textLayerText = layout.spans.map((s) => s.text).join(' ')
    let pageText = textLayerText

    if (layout.requiresOCR) {
      onProgress({ stage: 'detecting_ocr', progress: Math.round((i / total) * 100), page: i + 1, total })
      try {
        const blob = await renderPageToBlob(buffer, i)
        const ocrResult = await ocrPageFull(blob, language)
        if (ocrResult.text.trim()) {
          // Merge OCR text with text layer — don't replace, so text-layer detections
          // (e.g. headers/footers) are still found even on image-heavy pages.
          pageText = [textLayerText, ocrResult.text].filter(Boolean).join('\n')
          layout.ocrWords = ocrResult.words
          layout.ocrScale = OCR_RENDER_SCALE
        } else {
          ocrFailedPages.push(i + 1)
        }
      } catch {
        ocrFailedPages.push(i + 1)
      }
    }

    pageTexts.push(pageText)

    if (!pageText.trim()) continue

    onProgress({ stage: 'detecting_regex', progress: Math.round((i / total) * 100) })
    const regexDets = detectRegex(pageText, i, language, tokenCounters)
    allDetections.push(...regexDets)

    onProgress({ stage: 'detecting_ner', progress: Math.round((i / total) * 100), page: i + 1, total })
    try {
      const nerRaw = await detectNER(pageText, i, language)
      const nerDets = buildNERDetections(nerRaw, i, tokenCounters)
      const regexTexts = new Set(regexDets.map((d) => d.text.toLowerCase()))
      for (const nerDet of nerDets) {
        if (!regexTexts.has(nerDet.text.toLowerCase())) {
          allDetections.push(nerDet)
        }
      }
    } catch {
      // NER unavailable — continue with regex only
    }
  }

  setNERModelProgressCallback(null)

  // ── 2b. Name propagation ─────────────────────────────────────────────────
  // Any PERSON name found by a high-confidence label-context regex (e.g. "Insured person:
  // Lara Meier") is treated as a confirmed identity. Scan every page for additional
  // bare occurrences of that name and add detections so nothing slips through.
  const confirmedNames = new Set(
    allDetections
      .filter((d) => d.type === 'PERSON' && d.source === 'REGEX' && d.confidence >= 0.78)
      .map((d) => d.text.trim().toLowerCase()),
  )
  let _propagateCounter = 0
  for (const name of confirmedNames) {
    const namePattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
      const existingOnPage = new Set(
        allDetections
          .filter((d) => d.pageIndex === pageIdx && d.type === 'PERSON')
          .map((d) => d.text.trim().toLowerCase()),
      )
      if (existingOnPage.has(name)) continue
      if (namePattern.test(pageTexts[pageIdx])) {
        const n = (tokenCounters.get('PERSON') ?? 0) + 1
        tokenCounters.set('PERSON', n)
        allDetections.push({
          id: `prop_${++_propagateCounter}`,
          type: 'PERSON',
          text: name,
          token: `[PERSON_${String(n).padStart(3, '0')}]`,
          pageIndex: pageIdx,
          confidence: 0.82,
          source: 'REGEX',
          enabled: true,
        })
      }
      namePattern.lastIndex = 0
    }
  }

  // ── 3. Resolve bounding boxes ────────────────────────────────────────────
  // Track how many times each (page, text) pair has been resolved so that
  // duplicate text on the same page (e.g. a name in two columns) maps to
  // distinct span occurrences rather than all pointing at the first one.
  const occurrenceCounters = new Map<string, number>()
  const detectionsWithBBox: Detection[] = allDetections.filter((det) => det.text.trim().length > 0).map((det) => {
    const layout = layouts[det.pageIndex]
    const occKey = `${det.pageIndex}:${det.text.trim().toLowerCase()}`
    const occurrence = occurrenceCounters.get(occKey) ?? 0
    occurrenceCounters.set(occKey, occurrence + 1)
    let bbox = null
    if (layout?.ocrWords && layout.ocrWords.length > 0) {
      // Page was OCR-processed: only trust coordinates from the rendered image.
      // Text-layer fallback is intentionally skipped — on pages with embedded
      // images the text layer can contain invisible or mis-positioned text whose
      // coordinates don't correspond to any visible content, producing overlay
      // boxes that float over blank areas.
      bbox = findOcrWordBBox(layout.ocrWords, det.text, layout.height, layout.ocrScale ?? 2.0)
    } else if (layout) {
      // Pure text-layer page: text-layer coords are authoritative.
      bbox = findSpanBBox(layout.spans, det.text, occurrence)
    }
    return {
      ...det,
      boundingBox: bbox ?? { x: 0, y: 0, width: 0, height: 0 },
    }
  }).filter((det) => det.boundingBox.width > 0 || det.boundingBox.height > 0 || det.source === 'MANUAL')

  // ── 4. Encrypt redaction map ─────────────────────────────────────────────
  onProgress({ stage: 'encrypting' })
  const vault = new KeyVaultService()
  await vault.generateKey()
  const map = KeyVaultService.buildMap(detectionsWithBBox, documentHash, documentName)
  const keyFileBlob = await vault.encrypt(map)
  const rawKeyBlob = await vault.exportKeyBlob()

  onProgress({ stage: 'done' })

  return {
    detections: detectionsWithBBox,
    layouts,
    keyFileBlob,
    rawKeyBlob,
    documentHash,
    documentName: stemName(documentName),
    pageCount: layouts.length,
    ocrFailedPages,
  }
}

/**
 * Phase 2: generate the redacted PDF with the user's chosen options and
 * their final toggled detection list.
 */
export async function buildRedactedPdf(
  pdfBuffer: ArrayBuffer,
  detections: Detection[],
  detectionResult: DetectionResult,
  options: RedactionOptions,
  onProgress: ProgressCallback,
): Promise<PipelineResult> {
  onProgress({ stage: 'redacting', progress: 0 })
  const redactedPdfBytes = await applyRedactions(pdfBuffer, detections, detectionResult.layouts, options)
  onProgress({ stage: 'redacting', progress: 100 })

  // Re-encrypt vault with the final toggled detection list, excluding detections
  // that had no resolvable bounding box (they weren't visually redacted in the PDF).
  onProgress({ stage: 'encrypting' })
  const vault = new KeyVaultService()
  await vault.importRawKey(await detectionResult.rawKeyBlob.arrayBuffer())
  const finalDetections = detections.filter(
    (d) => d.enabled && (d.boundingBox.width > 0 || d.boundingBox.height > 0),
  )
  const finalMap = KeyVaultService.buildMap(finalDetections, detectionResult.documentHash, detectionResult.documentName)
  const keyFileBlob = await vault.encrypt(finalMap)

  // Risk scoring runs synchronously; privacy summary runs async in its worker.
  const { riskScore, riskLevel } = computeRisk(detections)
  onProgress({ stage: 'summarizing' })
  const privacySummary = await generateSummary(detections).catch(() => '')

  return {
    redactedPdfBytes,
    detections,
    keyFileBlob,
    rawKeyBlob: detectionResult.rawKeyBlob,
    documentName: detectionResult.documentName,
    pageCount: detectionResult.pageCount,
    riskScore,
    riskLevel,
    privacySummary,
  }
}
