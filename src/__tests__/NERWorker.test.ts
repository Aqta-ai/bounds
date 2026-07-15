import { describe, it, expect } from 'vitest'
import { nerLabelToPiiType, buildNERDetections, mergePersonSpans } from '../pipeline/NERWorker'
import type { PiiType } from '../types'
import type { RawNERDetection } from '../pipeline/NERWorker'

// ---------------------------------------------------------------------------
// nerLabelToPiiType
// ---------------------------------------------------------------------------
describe('nerLabelToPiiType', () => {
  it('maps PER → PERSON', () => expect(nerLabelToPiiType('PER')).toBe('PERSON'))
  it('maps PERSON → PERSON', () => expect(nerLabelToPiiType('PERSON')).toBe('PERSON'))
  it('maps B-PER → PERSON', () => expect(nerLabelToPiiType('B-PER')).toBe('PERSON'))
  it('maps I-PER → PERSON', () => expect(nerLabelToPiiType('I-PER')).toBe('PERSON'))
  it('maps LOC → ADDRESS', () => expect(nerLabelToPiiType('LOC')).toBe('ADDRESS'))
  it('maps LOCATION → ADDRESS', () => expect(nerLabelToPiiType('LOCATION')).toBe('ADDRESS'))
  it('maps ORG → ORG', () => expect(nerLabelToPiiType('ORG')).toBe('ORG'))
  it('maps MISC → MISC', () => expect(nerLabelToPiiType('MISC')).toBe('MISC'))
  it('returns null for unknown labels', () => expect(nerLabelToPiiType('FOOBAR')).toBeNull())
})

// ---------------------------------------------------------------------------
// buildNERDetections - enabled logic
// ---------------------------------------------------------------------------
describe('buildNERDetections - enabled flag', () => {
  function makeRaw(type: string, word: string, score: number): RawNERDetection {
    return { text: word, type: type as PiiType, confidence: score, start: 0, end: word.length }
  }

  function counters() {
    return new Map<PiiType, number>()
  }

  it('enables PERSON detections by default', () => {
    const dets = buildNERDetections([makeRaw('PER', 'Anna Müller', 0.95)], 0, counters())
    expect(dets[0].enabled).toBe(true)
    expect(dets[0].type).toBe('PERSON')
  })

  it('enables ADDRESS (LOC) detections by default', () => {
    const dets = buildNERDetections([makeRaw('LOC', 'Zurich', 0.90)], 0, counters())
    expect(dets[0].enabled).toBe(true)
    expect(dets[0].type).toBe('ADDRESS')
  })

  it('does NOT enable MISC detections - the Swiss-text bug fix', () => {
    const dets = buildNERDetections([makeRaw('MISC', 'Swiss', 0.80)], 0, counters())
    expect(dets[0].enabled).toBe(false)
    expect(dets[0].type).toBe('MISC')
  })

  it('does NOT enable ORG detections by default', () => {
    const dets = buildNERDetections([makeRaw('ORG', 'Nestlé SA', 0.88)], 0, counters())
    expect(dets[0].enabled).toBe(false)
    expect(dets[0].type).toBe('ORG')
  })

  it('drops detections below 0.65 confidence', () => {
    const dets = buildNERDetections([makeRaw('PER', 'John', 0.64)], 0, counters())
    expect(dets).toHaveLength(0)
  })

  it('keeps detections at exactly 0.65 confidence', () => {
    const dets = buildNERDetections([makeRaw('PER', 'Maria', 0.65)], 0, counters())
    expect(dets).toHaveLength(1)
  })

  it('assigns source NER', () => {
    const dets = buildNERDetections([makeRaw('PER', 'Hans', 0.90)], 0, counters())
    expect(dets[0].source).toBe('NER')
  })

  it('trims whitespace from word', () => {
    const dets = buildNERDetections([makeRaw('PER', '  Sophie  ', 0.90)], 0, counters())
    expect(dets[0].text).toBe('Sophie')
  })

  it('increments token counters per type', () => {
    const c = counters()
    const dets = buildNERDetections(
      [makeRaw('PER', 'Alice', 0.90), makeRaw('PER', 'Bob', 0.90)],
      0,
      c,
    )
    expect(dets[0].token).toBe('[PERSON_001]')
    expect(dets[1].token).toBe('[PERSON_002]')
  })

  it('maps unknown entity_group to MISC and disables it', () => {
    const dets = buildNERDetections([makeRaw('UNKNOWN_TAG', 'foobar', 0.90)], 0, counters())
    expect(dets[0].type).toBe('MISC')
    expect(dets[0].enabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mergePersonSpans - re-joining tokeniser-split names (source-text path)
// ---------------------------------------------------------------------------
describe('mergePersonSpans - source-text path', () => {
  // Build a raw span whose offsets point into a known source string.
  function span(word: string, start: number, type = 'PER', score = 0.95): RawNERDetection {
    return { text: word, type: type as PiiType, confidence: score, start, end: start + word.length }
  }

  it('joins "Sarah" + "O" + "Donnell" (apostrophe split) into one PERSON span', () => {
    const src = "Sarah O'Donnell"
    // BERT splits the apostrophe: "Sarah"[0,5], "O"[6,7], "Donnell"[8,15]
    const raws = [span('Sarah', 0), span('O', 6), span('Donnell', 8)]
    const merged = mergePersonSpans(raws, src)
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe("Sarah O'Donnell")
    expect(merged[0].start).toBe(0)
    expect(merged[0].end).toBe(15)
  })

  it('joins "Mary" + "Mc" + "Donald" into one PERSON span', () => {
    const src = 'Mary Mc Donald'
    const raws = [span('Mary', 0), span('Mc', 5), span('Donald', 8)]
    const merged = mergePersonSpans(raws, src)
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe('Mary Mc Donald')
  })

  it('joins "Niall" + "O" + "Brien" into one PERSON span', () => {
    const src = 'Niall O Brien'
    const raws = [span('Niall', 0), span('O', 6), span('Brien', 8)]
    const merged = mergePersonSpans(raws, src)
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe('Niall O Brien')
  })

  it('does NOT merge two distinct people separated by other words', () => {
    const src = 'Alice met with Bob yesterday'
    const raws = [span('Alice', 0), span('Bob', 15)]
    const merged = mergePersonSpans(raws, src)
    expect(merged).toHaveLength(2)
  })

  it('does NOT merge PERSON spans separated by a non-name word', () => {
    const src = 'Sarah and Michael'
    // "Sarah"[0,5] and "Michael"[10,17] separated by " and " (5 chars, not a connector)
    const raws = [span('Sarah', 0), span('Michael', 10)]
    const merged = mergePersonSpans(raws, src)
    expect(merged).toHaveLength(2)
  })

  it('leaves non-PERSON spans untouched', () => {
    const src = 'Dublin Cork'
    const raws = [span('Dublin', 0, 'LOC'), span('Cork', 7, 'LOC')]
    const merged = mergePersonSpans(raws, src)
    expect(merged).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// mergePersonSpans - offset-only fallback (no source text)
// ---------------------------------------------------------------------------
describe('mergePersonSpans - offset-only fallback', () => {
  function span(word: string, start: number, type = 'PER', score = 0.95): RawNERDetection {
    return { text: word, type: type as PiiType, confidence: score, start, end: start + word.length }
  }

  it('re-joins "Sarah" + "O\'Donnell" without source text', () => {
    // Two-way split where the apostrophe stays attached to the surname
    const raws = [span('Sarah', 0), span("O'Donnell", 6)]
    const merged = mergePersonSpans(raws)
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe("Sarah O'Donnell")
  })
})

// ---------------------------------------------------------------------------
// buildNERDetections - surname keep + trailing over-capture strip
// ---------------------------------------------------------------------------
describe('buildNERDetections - PERSON assembly', () => {
  function span(word: string, start: number, type = 'PER', score = 0.95): RawNERDetection {
    return { text: word, type: type as PiiType, confidence: score, start, end: start + word.length }
  }
  function counters() {
    return new Map<PiiType, number>()
  }

  it('keeps a split surname as one PERSON detection ("Sarah O\'Donnell")', () => {
    const raws = [span('Sarah', 0), span("O'Donnell", 6)]
    const dets = buildNERDetections(raws, 0, counters())
    expect(dets).toHaveLength(1)
    expect(dets[0].type).toBe('PERSON')
    expect(dets[0].text).toBe("Sarah O'Donnell")
  })

  it('strips a trailing article over-captured from the next sentence', () => {
    // Live failure: NER returned "Dr Michael Byrne The" as one span
    const dets = buildNERDetections([span('Dr Michael Byrne The', 0)], 0, counters())
    expect(dets).toHaveLength(1)
    expect(dets[0].text).toBe('Michael Byrne')
  })

  it('strips a leading title without touching the name', () => {
    const dets = buildNERDetections([span('Prof Amara Osei', 0)], 0, counters())
    expect(dets[0].text).toBe('Amara Osei')
  })

  it('keeps a plain single-token name', () => {
    const dets = buildNERDetections([span('Sarah', 0)], 0, counters())
    expect(dets).toHaveLength(1)
    expect(dets[0].text).toBe('Sarah')
  })

  it('does not eat a real name particle when stripping trailing words', () => {
    // "van" is a particle, never a trailing stopword
    const dets = buildNERDetections([span('Johan van der Berg', 0)], 0, counters())
    expect(dets[0].text).toBe('Johan van der Berg')
  })

  it('still excludes NOT_A_PERSON blocklist words', () => {
    const dets = buildNERDetections([span('department', 0)], 0, counters())
    expect(dets).toHaveLength(0)
  })
})
