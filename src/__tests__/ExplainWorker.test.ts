import { describe, it, expect } from 'vitest'
import { buildExplainPrompt } from '../pipeline/ExplainWorker'
import type { Detection, PiiType } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function det(type: PiiType, enabled = true, id = Math.random().toString()): Detection {
  return {
    id,
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
// buildExplainPrompt
// ---------------------------------------------------------------------------
describe('buildExplainPrompt', () => {
  it('returns empty string when no detections', () => {
    expect(buildExplainPrompt([])).toBe('')
  })

  it('returns empty string when all detections are disabled', () => {
    expect(buildExplainPrompt([det('EMAIL', false), det('PERSON', false)])).toBe('')
  })

  it('prompt starts with instruction prefix', () => {
    const prompt = buildExplainPrompt([det('EMAIL')])
    expect(prompt).toMatch(/^Summarize in one plain sentence/)
  })

  it('prompt ends with sentence-start instruction', () => {
    const prompt = buildExplainPrompt([det('EMAIL')])
    expect(prompt).toContain('Start with "This document"')
  })

  it('includes human-readable label, not raw PiiType key', () => {
    const prompt = buildExplainPrompt([det('EMAIL')])
    // PII_TYPE_LABELS['EMAIL'] = 'Email'
    expect(prompt).toContain('email')
    expect(prompt).not.toContain('EMAIL') // raw key should not appear
  })

  it('pluralises count > 1 correctly', () => {
    const dets = [det('EMAIL', true, 'a'), det('EMAIL', true, 'b')]
    const prompt = buildExplainPrompt(dets)
    expect(prompt).toContain('2 emails')
  })

  it('singular for count = 1', () => {
    const prompt = buildExplainPrompt([det('PERSON')])
    expect(prompt).toContain('1 name')
    expect(prompt).not.toContain('names')
  })

  it('only counts enabled detections', () => {
    const dets = [det('EMAIL', true, 'a'), det('EMAIL', false, 'b'), det('EMAIL', true, 'c')]
    const prompt = buildExplainPrompt(dets)
    expect(prompt).toContain('2 emails')
  })

  it('includes multiple PII types', () => {
    const dets = [det('EMAIL', true, 'a'), det('PERSON', true, 'b'), det('IBAN', true, 'c')]
    const prompt = buildExplainPrompt(dets)
    expect(prompt).toContain('email')
    expect(prompt).toContain('name')
    expect(prompt).toContain('iban')
  })

  it('sorts by count descending — highest count appears first in item list', () => {
    const dets = [
      det('EMAIL', true, 'e1'),
      det('EMAIL', true, 'e2'),
      det('EMAIL', true, 'e3'),
      det('PERSON', true, 'p1'),
    ]
    const prompt = buildExplainPrompt(dets)
    const emailIdx = prompt.indexOf('email')
    const nameIdx = prompt.indexOf('name')
    expect(emailIdx).toBeLessThan(nameIdx)
  })

  it('treats same PiiType on different pages as a combined count', () => {
    const dets = [
      { ...det('SSN', true, 'a'), pageIndex: 0 },
      { ...det('SSN', true, 'b'), pageIndex: 1 },
      { ...det('SSN', true, 'c'), pageIndex: 2 },
    ]
    const prompt = buildExplainPrompt(dets)
    expect(prompt).toContain('3 social security')
  })
})
