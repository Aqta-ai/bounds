export type PiiType =
  | 'PERSON'
  | 'ADDRESS'
  | 'EMAIL'
  | 'PHONE'
  | 'IBAN'
  | 'SSN'
  | 'PASSPORT'
  | 'ID_NUMBER'
  | 'DATE_OF_BIRTH'
  | 'IP_ADDRESS'
  | 'CREDIT_CARD'
  | 'URL'
  | 'ORG'
  | 'MISC'
  | 'HEALTH_DATA'
  | 'CONFIDENTIAL'
  | 'PROPRIETARY'
  | 'LEGAL_CLAUSE'

export type DetectionSource = 'NER' | 'REGEX' | 'OCR' | 'MANUAL'

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Detection {
  id: string
  type: PiiType
  text: string
  token: string      // replacement token e.g. "[PERSON_001]"
  pageIndex: number
  boundingBox: BBox  // in PDF user-space units
  confidence: number // 0–1
  source: DetectionSource
  enabled: boolean   // user can toggle individual detections
}

export interface OcrWord {
  text: string
  x0: number  // image pixel coords (top-left origin, at ocrScale)
  y0: number
  x1: number
  y1: number
  confidence: number  // Tesseract confidence 0–100
}

export interface PageLayout {
  pageIndex: number
  width: number
  height: number
  spans: TextSpan[]
  requiresOCR: boolean
  ocrWords?: OcrWord[]   // populated after OCR, used for bbox resolution
  ocrScale?: number      // render scale used when producing ocrWords (default 2.0)
}

export interface TextSpan {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface RedactionMap {
  documentHash: string
  documentName: string
  createdAt: string
  version: number
  detections: Array<{
    token: string
    original: string
    type: PiiType
  }>
}

export interface RedactionOptions {
  color: { r: number; g: number; b: number }  // 0–1 per channel
  labelStyle: 'blank' | 'token'
  watermark: { enabled: boolean; text: string; opacity: number }
}

export const DEFAULT_REDACTION_OPTIONS: RedactionOptions = {
  color: { r: 0, g: 0, b: 0 },
  labelStyle: 'blank',
  watermark: { enabled: false, text: 'CONFIDENTIAL', opacity: 0.15 },
}

/** Returned after detection + encryption pass (before PDF is generated). */
export interface DetectionResult {
  detections: Detection[]
  layouts: PageLayout[]
  keyFileBlob: Blob
  rawKeyBlob: Blob
  documentHash: string
  documentName: string
  pageCount: number
  /** 1-based page numbers where OCR was attempted but failed (empty = all good) */
  ocrFailedPages: number[]
}

export type RiskLevel = 'clean' | 'low' | 'medium' | 'high' | 'critical'

/** Final export bundle once PDF has been generated with chosen options. */
export interface PipelineResult {
  redactedPdfBytes: Uint8Array
  detections: Detection[]
  keyFileBlob: Blob    // encrypted RedactionMap (.bounds)
  rawKeyBlob: Blob     // AES key bytes (.key)
  documentName: string
  pageCount: number
  privacySummary?: string  // AI-generated plain-English risk summary
  riskLevel: RiskLevel     // computed from detection types + counts
  riskScore: number        // raw weighted score
}

export type PipelineStep =
  | { stage: 'idle' }
  | { stage: 'extracting'; progress: number }
  | { stage: 'detecting_regex'; progress: number }
  | { stage: 'loading_model'; modelProgress: number }
  | { stage: 'detecting_ner'; progress: number; page: number; total: number }
  | { stage: 'detecting_ocr'; progress: number; page: number; total: number }
  | { stage: 'redacting'; progress: number }
  | { stage: 'encrypting' }
  | { stage: 'summarizing' }
  | { stage: 'done' }
  | { stage: 'error'; message: string }

export type AppStep = 0 | 1 | 2 | 3

export type Language = 'en' | 'de' | 'fr' | 'it' | 'es'
