// Pure helpers split out so the Web Worker logic stays unit-testable
// under Node, which has no Worker global.

import type { PiiType } from '../types'

export const HEALTHCARE_CONFIDENCE_FLOOR = 0.75
export const CHUNK_MAX_CHARS = 800

/** The six category ids the system prompt defines, in prompt order (so "gemma:4" resolves). */
export const GEMMA_CATEGORIES = new Set([
  'inline_diagnosis', 'medication_mention', 'treatment_procedure',
  'indirect_health_context', 'sensitive_social', 'genetic_reference',
])
const GEMMA_CATEGORY_ORDER = [...GEMMA_CATEGORIES]

/** Resolve a ruleId to "gemma:<category id>", or '' when no known category can be read from it. */
export function normaliseRuleId(ruleId: unknown, type: unknown): string {
  if (typeof ruleId !== 'string' || !ruleId.startsWith('gemma:')) return ''
  const suffix = ruleId.slice('gemma:'.length).trim().toLowerCase()
  if (GEMMA_CATEGORIES.has(suffix)) return `gemma:${suffix}`
  const n = /^[1-6]$/.test(suffix) ? Number(suffix) : 0
  if (n) return `gemma:${GEMMA_CATEGORY_ORDER[n - 1]}`
  if (typeof type === 'string' && GEMMA_CATEGORIES.has(type)) return `gemma:${type}`
  return ''
}

export interface RawGemmaDetection {
  text: string
  type: PiiType
  confidence: number
  ruleId: string
  reason: string
}

// Rejects malformed JSON, sub-floor confidence, unknown type or category,
// non-gemma ruleId, missing reason, and any text not present in sourceChunk after
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
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0
    const reason = typeof obj.reason === 'string' ? obj.reason : ''
    const ruleId = normaliseRuleId(obj.ruleId, obj.type)
    // The prompt asks for type "HEALTH_DATA" and the category in ruleId, but the
    // model often writes the category into type as well, or numbers the rule
    // ("gemma:4"). Both are the same detection; only an unknown category is refused.
    const type = obj.type === 'HEALTH_DATA' || (typeof obj.type === 'string' && GEMMA_CATEGORIES.has(obj.type)) ? 'HEALTH_DATA' : null

    if (!text) continue
    if (!type) continue
    if (confidence < HEALTHCARE_CONFIDENCE_FLOOR) continue
    if (!ruleId) continue
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
