import { describe, it, expect } from 'vitest'
import { computeRisk } from '../pipeline/RedactionPipeline'
import type { Detection, PiiType } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function det(type: PiiType, enabled = true): Detection {
  return {
    id: `${type}_1`,
    type,
    text: 'x',
    token: `[${type}_001]`,
    pageIndex: 0,
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    confidence: 0.9,
    source: 'REGEX',
    enabled,
  }
}

// ---------------------------------------------------------------------------
// computeRisk — level thresholds
// ---------------------------------------------------------------------------
describe('computeRisk — levels', () => {
  it('returns "clean" when there are no enabled detections', () => {
    const { riskLevel, riskScore } = computeRisk([])
    expect(riskLevel).toBe('clean')
    expect(riskScore).toBe(0)
  })

  it('returns "clean" when all detections are disabled', () => {
    const { riskLevel } = computeRisk([det('EMAIL', false), det('PHONE', false)])
    expect(riskLevel).toBe('clean')
  })

  it('returns "low" for score 1–4 (single phone)', () => {
    const { riskLevel, riskScore } = computeRisk([det('PHONE')]) // weight 1
    expect(riskScore).toBe(1)
    expect(riskLevel).toBe('low')
  })

  it('returns "medium" for score 6–19', () => {
    // 6 × EMAIL (weight 1) = 6
    const dets = Array.from({ length: 6 }, () => ({ ...det('EMAIL'), id: Math.random().toString() }))
    const { riskLevel, riskScore } = computeRisk(dets)
    expect(riskScore).toBe(6)
    expect(riskLevel).toBe('medium')
  })

  it('returns "high" for score 20–44', () => {
    // 5 × PERSON (weight 2) = 10, + 5 × IBAN (weight 3) = 15 → total 25
    const dets = [
      ...Array.from({ length: 5 }, (_, i) => ({ ...det('PERSON'), id: `p${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ ...det('IBAN'), id: `i${i}` })),
    ]
    const { riskLevel, riskScore } = computeRisk(dets)
    expect(riskScore).toBe(25)
    expect(riskLevel).toBe('high')
  })

  it('returns "critical" for score ≥ 45', () => {
    // 12 × SSN (weight 4) = 48
    const dets = Array.from({ length: 12 }, (_, i) => ({ ...det('SSN'), id: `s${i}` }))
    const { riskLevel, riskScore } = computeRisk(dets)
    expect(riskScore).toBe(48)
    expect(riskLevel).toBe('critical')
  })
})

// ---------------------------------------------------------------------------
// computeRisk — weight correctness
// ---------------------------------------------------------------------------
describe('computeRisk — weight values', () => {
  const cases: [PiiType, number][] = [
    ['HEALTH_DATA',   4],
    ['SSN',           4],
    ['CREDIT_CARD',   3],
    ['IBAN',          3],
    ['PASSPORT',      3],
    ['DATE_OF_BIRTH', 2],
    ['PERSON',        2],
    ['ADDRESS',       2],
    ['ID_NUMBER',     2],
    ['PHONE',         1],
    ['EMAIL',         1],
    ['IP_ADDRESS',    1],
    ['ORG',           1],
    ['CONFIDENTIAL',  1],
    ['PROPRIETARY',   1],
    ['LEGAL_CLAUSE',  1],
    ['MISC',          1],
  ]

  for (const [type, expectedWeight] of cases) {
    it(`${type} has weight ${expectedWeight}`, () => {
      const { riskScore } = computeRisk([det(type)])
      expect(riskScore).toBe(expectedWeight)
    })
  }
})

// ---------------------------------------------------------------------------
// computeRisk — disabled detections excluded
// ---------------------------------------------------------------------------
describe('computeRisk — disabled detections', () => {
  it('ignores disabled detections in score', () => {
    const dets = [det('SSN', true), det('HEALTH_DATA', false)]
    const { riskScore } = computeRisk(dets)
    expect(riskScore).toBe(4) // only SSN counted
  })

  it('boundary: score exactly 20 → high (not medium)', () => {
    // 10 × PERSON (2) = 20
    const dets = Array.from({ length: 10 }, (_, i) => ({ ...det('PERSON'), id: `p${i}` }))
    const { riskLevel, riskScore } = computeRisk(dets)
    expect(riskScore).toBe(20)
    expect(riskLevel).toBe('high')
  })

  it('boundary: score exactly 45 → critical (not high)', () => {
    // 9 × SSN (4) + 9 × EMAIL (1) = 36 + 9 = 45
    const dets = [
      ...Array.from({ length: 9 }, (_, i) => ({ ...det('SSN'), id: `s${i}` })),
      ...Array.from({ length: 9 }, (_, i) => ({ ...det('EMAIL'), id: `e${i}` })),
    ]
    const { riskLevel, riskScore } = computeRisk(dets)
    expect(riskScore).toBe(45)
    expect(riskLevel).toBe('critical')
  })
})
