// Pure helpers split out so the Web Worker logic stays unit-testable
// under Node, which has no Worker global.

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

// Rejects malformed JSON, sub-floor confidence, wrong type, non-gemma
// ruleId, missing reason, and any text not present in sourceChunk after
// NFC normalisation. The NFC normalise is what tolerates the PDF-vs-LLM
// encoding split that would otherwise drop legitimate hits.
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

// Prefer paragraph boundaries; fall back to sentence boundaries inside
// paragraphs larger than CHUNK_MAX_CHARS.
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
