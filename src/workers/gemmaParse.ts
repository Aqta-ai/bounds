// Pure helpers for the Gemma worker. Extracted into a separate module so
// they can be unit-tested without instantiating the Web Worker (which is
// not available in the Node test environment).

import type { PiiType } from '../types'

export const HEALTHCARE_CONFIDENCE_FLOOR = 0.75
export const CHUNK_MAX_CHARS = 800

export interface RawGemmaDetection {
  text: string
  type: PiiType
  confidence: number
  ruleId: string
  reason: string
}

/**
 * Validate a model response and return the surviving detections.
 *
 * Rejects:
 *  - Malformed JSON.
 *  - Non-array top-level values.
 *  - Items with confidence below HEALTHCARE_CONFIDENCE_FLOOR (0.75).
 *  - Items whose text is not (after NFC normalisation) a substring of
 *    sourceChunk. This rejects model hallucinations and paraphrases while
 *    tolerating the NFC vs NFD differences that arise when text crosses
 *    PDF font ↔ LLM ↔ JS string boundaries (e.g. "café" vs "café").
 *  - Items with a type other than HEALTH_DATA.
 *  - Items with a ruleId outside the gemma:* namespace.
 *  - Items missing a reason field (the review panel surfaces it).
 */
export function parseAndValidate(raw: string, sourceChunk: string): RawGemmaDetection[] {
  let parsed: unknown
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const sourceNfc = sourceChunk.normalize('NFC')

  const out: RawGemmaDetection[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const obj = item as Record<string, unknown>
    const text = typeof obj.text === 'string' ? obj.text.trim() : ''
    const type = obj.type === 'HEALTH_DATA' ? 'HEALTH_DATA' : null
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0
    const ruleId = typeof obj.ruleId === 'string' ? obj.ruleId : ''
    const reason = typeof obj.reason === 'string' ? obj.reason : ''

    if (!text) continue
    if (!type) continue
    if (confidence < HEALTHCARE_CONFIDENCE_FLOOR) continue
    if (!ruleId.startsWith('gemma:')) continue
    if (!reason) continue
    if (!sourceNfc.includes(text.normalize('NFC'))) continue

    out.push({ text, type: type as PiiType, confidence, ruleId, reason })
  }
  return out
}

/**
 * Split text into chunks of at most CHUNK_MAX_CHARS, preferring paragraph
 * boundaries, falling back to sentence boundaries for paragraphs that
 * exceed the limit.
 */
export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_MAX_CHARS) return [text]
  const chunks: string[] = []
  const paragraphs = text.split(/\n\s*\n/)
  let current = ''
  for (const p of paragraphs) {
    if ((current + p).length <= CHUNK_MAX_CHARS) {
      current += (current ? '\n\n' : '') + p
    } else {
      if (current) chunks.push(current)
      if (p.length <= CHUNK_MAX_CHARS) {
        current = p
      } else {
        const sentences = p.split(/(?<=[.!?])\s+/)
        let sentChunk = ''
        for (const s of sentences) {
          if ((sentChunk + s).length <= CHUNK_MAX_CHARS) {
            sentChunk += (sentChunk ? ' ' : '') + s
          } else {
            if (sentChunk) chunks.push(sentChunk)
            sentChunk = s
          }
        }
        if (sentChunk) chunks.push(sentChunk)
        current = ''
      }
    }
  }
  if (current) chunks.push(current)
  return chunks
}
