import type { Detection, DetectionResult, Language, PiiType, PipelineResult, PipelineStep, RedactionOptions, RiskLevel } from '../types'
import { extractLayouts, applyRedactions, findSpanBBox, findOcrWordBBox } from './PDFEngine'
import { detectRegex, resetRegexIdCounter } from './RegexDetector'
import { detectNER, buildNERDetections, resetNerIdCounter, setNERModelProgressCallback } from './NERWorker'
import { ocrPageFull, renderPageToBlob, OCR_RENDER_SCALE } from './OCRWorker'
import { isFaceDetectionSupported, detectFaces } from './FaceDetector'
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
  // Thresholds: critical ≥ 45 (requires many high-weight items), high ≥ 20,
  // medium ≥ 6, low > 0. This ensures a well-redacted document moves from
  // Critical to High/Medium rather than staying Critical after redaction.
  if (riskScore >= 45)     riskLevel = 'critical'
  else if (riskScore >= 20) riskLevel = 'high'
  else if (riskScore >= 6)  riskLevel = 'medium'
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

  const faceDetectionAvailable = isFaceDetectionSupported()
  const faceDetectionsWithBBox: Detection[] = []

  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    const textLayerText = layout.spans.map((s) => s.text).join(' ')
    let pageText = textLayerText
    let pageBlob: Blob | null = null

    // Render page to image once — reused for both OCR and face detection
    if (layout.requiresOCR || faceDetectionAvailable) {
      try {
        pageBlob = await renderPageToBlob(buffer, i)
      } catch { /* non-fatal — OCR/face detection will be skipped */ }
    }

    if (layout.requiresOCR && pageBlob) {
      onProgress({ stage: 'detecting_ocr', progress: Math.round((i / total) * 100), page: i + 1, total })
      try {
        const ocrResult = await ocrPageFull(pageBlob, language)
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

    if (pageText.trim()) {
      onProgress({ stage: 'detecting_regex', progress: Math.round((i / total) * 100) })
      const regexDets = detectRegex(pageText, i, language, tokenCounters)
      allDetections.push(...regexDets)

      onProgress({ stage: 'detecting_ner', progress: Math.round((i / total) * 100), page: i + 1, total })
      try {
        const nerRaw = await detectNER(pageText, i, language)
        const nerDets = buildNERDetections(nerRaw, i, tokenCounters)
        const regexTexts = new Set(regexDets.map((d) => d.text.toLowerCase()))
        for (const nerDet of nerDets) {
          if (regexTexts.has(nerDet.text.toLowerCase())) continue
          // Drop NER name fragments where every word is ≤2 chars (e.g. "Si Te")
          if (nerDet.type === 'PERSON') {
            const words = nerDet.text.trim().split(/\s+/)
            if (words.every((w) => w.length <= 2)) continue
          }
          // Drop NER PERSON hits that are all-uppercase field labels (e.g. "AHV", "VALID UNTIL")
          if (nerDet.type === 'PERSON') {
            const trimmed = nerDet.text.trim()
            if (trimmed.length > 0 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
              const LABEL_RE = /^(AHV(\s*\/\s*AVS)?|AVS|BSN|NIF|NISS|NHI|VALID(\s+UNTIL)?|EXPIRES?|EXPIRY|NATIONALITY|AUTHORITY|ISSUING(\s+AUTHORITY)?|DOCUMENT(\s+(NO\.?|NUMBER))?|PERSONAL\s+(NO\.?|NUMBER)|CARD(\s+NO\.?)?|PASSPORT(\s+NO\.?)?|SURNAME|FORENAMES?|GIVEN\s+NAMES?|SEX|PLACE\s+OF\s+BIRTH|DATE\s+OF\s+BIRTH|TYPE|CODE|COUNTRY|CANTON|COMMUNE)$/
              if (LABEL_RE.test(trimmed)) continue
            }
          }
          // Drop NER address hits that contain common PDF metadata words
          if (nerDet.type === 'ADDRESS') {
            const lower = nerDet.text.toLowerCase()
            if (/\b(page|pages|embedded|document|scan|synthetic|test|sample)\b/.test(lower)) continue
          }
          allDetections.push(nerDet)
        }
      } catch {
        // NER unavailable — continue with regex only
      }
    }

    // Face detection — runs even on image-only pages with no text layer
    if (pageBlob) {
      onProgress({ stage: 'detecting_faces', progress: Math.round((i / total) * 100), page: i + 1, total })
      const faces = await detectFaces(pageBlob, layout, i, tokenCounters)
      faceDetectionsWithBBox.push(...faces)
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
      namePattern.lastIndex = 0
      while (namePattern.exec(pageTexts[pageIdx]) !== null) {
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
          ruleId: 'name_propagation',
        })
      }
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
      bbox = findOcrWordBBox(layout.ocrWords, det.text, layout.height, layout.ocrScale ?? 2.0, occurrence)
    } else if (layout) {
      // Pure text-layer page: text-layer coords are authoritative.
      bbox = findSpanBBox(layout.spans, det.text, occurrence)
    }
    return {
      ...det,
      boundingBox: bbox ?? { x: 0, y: 0, width: 0, height: 0 },
    }
  }).filter((det) => (det.boundingBox.width > 0 && det.boundingBox.height > 0) || det.source === 'MANUAL')

  // Merge face detections (bounding boxes already resolved from image coordinates)
  const allDetectionsWithBBox = [...detectionsWithBBox, ...faceDetectionsWithBBox]

  // ── 4. Encrypt redaction map ─────────────────────────────────────────────
  onProgress({ stage: 'encrypting' })
  const vault = new KeyVaultService()
  await vault.generateKey()
  const map = KeyVaultService.buildMap(allDetectionsWithBBox, documentHash, documentName)
  const keyFileBlob = await vault.encrypt(map)
  const rawKeyBlob = await vault.exportKeyBlob()

  onProgress({ stage: 'done' })

  return {
    detections: allDetectionsWithBBox,
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
  // Pre-redaction: all items treated as enabled (original document risk)
  const allEnabled = detections.map((d) => ({ ...d, enabled: true }))
  const { riskScore: preRedactionRiskScore, riskLevel: preRedactionRiskLevel } = computeRisk(allEnabled)
  // Risk of items being redacted (what the user toggled on)
  const { riskScore, riskLevel } = computeRisk(detections)
  // Residual risk: items NOT being redacted (remain in the document)
  const residualItems = detections.filter((d) => !d.enabled).map((d) => ({ ...d, enabled: true }))
  const { riskScore: residualRiskScore, riskLevel: residualRiskLevel } = computeRisk(residualItems)

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
    preRedactionRiskScore,
    preRedactionRiskLevel,
    residualRiskScore,
    residualRiskLevel,
    privacySummary,
  }
}
