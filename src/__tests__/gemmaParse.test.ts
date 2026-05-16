import { describe, it, expect } from 'vitest'
import {
  HEALTHCARE_CONFIDENCE_FLOOR,
  CHUNK_MAX_CHARS,
  chunkText,
  parseAndValidate,
} from '../workers/gemmaParse'

// ---------------------------------------------------------------------------
// parseAndValidate — accepts only well-formed, in-corpus health PHI.
// ---------------------------------------------------------------------------

const SAMPLE_CHUNK =
  'Patient presents with generalised anxiety disorder. She is on lithium ' +
  'and has been taking Adderall for three years. Underwent CABG last April.'

function buildItem(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify([
    {
      text: 'generalised anxiety disorder',
      type: 'HEALTH_DATA',
      confidence: 0.88,
      ruleId: 'gemma:inline_diagnosis',
      reason: 'Inline diagnosis without a structured label.',
      ...overrides,
    },
  ])
}

describe('parseAndValidate — happy path', () => {
  it('accepts a well-formed array with one valid item', () => {
    const out = parseAndValidate(buildItem(), SAMPLE_CHUNK)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('generalised anxiety disorder')
    expect(out[0].confidence).toBeGreaterThanOrEqual(HEALTHCARE_CONFIDENCE_FLOOR)
    expect(out[0].ruleId).toBe('gemma:inline_diagnosis')
  })

  it('strips ```json ... ``` fences before parsing', () => {
    const fenced = '```json\n' + buildItem() + '\n```'
    const out = parseAndValidate(fenced, SAMPLE_CHUNK)
    expect(out).toHaveLength(1)
  })

  it('returns an empty array for an empty array input', () => {
    expect(parseAndValidate('[]', SAMPLE_CHUNK)).toEqual([])
  })
})

describe('parseAndValidate — rejection cases', () => {
  it('rejects malformed JSON', () => {
    expect(parseAndValidate('not json at all', SAMPLE_CHUNK)).toEqual([])
  })

  it('rejects a non-array top-level value', () => {
    expect(parseAndValidate('{"detections": []}', SAMPLE_CHUNK)).toEqual([])
  })

  it('drops items below the healthcare confidence floor', () => {
    const raw = buildItem({ confidence: 0.6 })
    expect(parseAndValidate(raw, SAMPLE_CHUNK)).toEqual([])
  })

  it('drops items whose text is not a substring of the source chunk', () => {
    const raw = buildItem({ text: 'multiple sclerosis' }) // not in chunk
    expect(parseAndValidate(raw, SAMPLE_CHUNK)).toEqual([])
  })

  it('drops items with the wrong type', () => {
    const raw = buildItem({ type: 'PERSON' })
    expect(parseAndValidate(raw, SAMPLE_CHUNK)).toEqual([])
  })

  it('drops items with a non-gemma rule namespace', () => {
    const raw = buildItem({ ruleId: 'regex:diagnosis' })
    expect(parseAndValidate(raw, SAMPLE_CHUNK)).toEqual([])
  })

  it('drops items missing the reason field', () => {
    const raw = buildItem({ reason: '' })
    expect(parseAndValidate(raw, SAMPLE_CHUNK)).toEqual([])
  })

  it('drops items with an empty text field', () => {
    const raw = buildItem({ text: '' })
    expect(parseAndValidate(raw, SAMPLE_CHUNK)).toEqual([])
  })

  it('keeps the valid item when one of two is malformed', () => {
    const arr = JSON.stringify([
      {
        text: 'Adderall',
        type: 'HEALTH_DATA',
        confidence: 0.82,
        ruleId: 'gemma:medication_mention',
        reason: 'Medication mention in narrative.',
      },
      { type: 'HEALTH_DATA' }, // missing text + reason
    ])
    const out = parseAndValidate(arr, SAMPLE_CHUNK)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Adderall')
  })
})

// ---------------------------------------------------------------------------
// chunkText — preserves paragraph and sentence boundaries.
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns a single chunk when text is below the limit', () => {
    expect(chunkText('short')).toEqual(['short'])
  })

  it('respects paragraph boundaries when splitting', () => {
    const a = 'A'.repeat(500)
    const b = 'B'.repeat(500)
    const text = `${a}\n\n${b}`
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toContain('A')
    expect(chunks[1]).toContain('B')
  })

  it('falls back to sentence boundaries inside an oversize paragraph', () => {
    const sentence = 'This is a sentence about clinical context. '
    // ~600 chars of sentences > CHUNK_MAX_CHARS (800) once doubled
    const text = sentence.repeat(40)
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
    }
  })

  it('does not lose content across chunks', () => {
    const text = ('paragraph A. '.repeat(60) + '\n\n' + 'paragraph B. '.repeat(60)).trim()
    const chunks = chunkText(text)
    const joined = chunks.join(' ')
    // every word from the original must appear somewhere in the joined chunks
    expect(joined).toContain('paragraph A.')
    expect(joined).toContain('paragraph B.')
  })
})
