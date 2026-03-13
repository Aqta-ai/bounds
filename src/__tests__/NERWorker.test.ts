import { describe, it, expect } from 'vitest'
import { nerLabelToPiiType, buildNERDetections } from '../pipeline/NERWorker'
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
// buildNERDetections — enabled logic
// ---------------------------------------------------------------------------
describe('buildNERDetections — enabled flag', () => {
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

  it('does NOT enable MISC detections — the Swiss-text bug fix', () => {
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
