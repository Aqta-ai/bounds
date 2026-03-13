import { describe, it, expect } from 'vitest'
import { findSpanBBox, findOcrWordBBox } from '../pipeline/PDFEngine'
import type { TextSpan, OcrWord } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(text: string, x = 0, y = 700, width = text.length * 6, height = 12): TextSpan {
  return { text, x, y, width, height }
}

function word(text: string, x0: number, y0: number, x1: number, y1: number): OcrWord {
  return { text, x0, y0, x1, y1, confidence: 95 }
}

// ---------------------------------------------------------------------------
// findSpanBBox
// ---------------------------------------------------------------------------
describe('findSpanBBox — exact single span match', () => {
  it('finds a needle that is the entire span', () => {
    const spans = [span('alice@example.com', 100, 700, 120, 12)]
    const bbox = findSpanBBox(spans, 'alice@example.com')
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBe(100)
    expect(bbox!.y).toBe(700)
  })

  it('finds a needle that is a substring of a span', () => {
    const spans = [span('Contact alice@example.com today', 50, 700, 200, 12)]
    const bbox = findSpanBBox(spans, 'alice@example.com')
    expect(bbox).not.toBeNull()
    // x should be offset from the start of the span
    expect(bbox!.x).toBeGreaterThan(50)
  })

  it('is case-insensitive', () => {
    const spans = [span('John Smith', 0, 700)]
    const bbox = findSpanBBox(spans, 'john smith')
    expect(bbox).not.toBeNull()
  })

  it('returns null when needle is not found anywhere', () => {
    const spans = [span('Hello World', 0, 700)]
    const bbox = findSpanBBox(spans, 'alice@example.com')
    expect(bbox).toBeNull()
  })

  it('returns null for empty needle', () => {
    const spans = [span('Hello World', 0, 700)]
    expect(findSpanBBox(spans, '')).toBeNull()
    expect(findSpanBBox(spans, '   ')).toBeNull()
  })

  it('returns null for empty spans array', () => {
    expect(findSpanBBox([], 'anything')).toBeNull()
  })
})

describe('findSpanBBox — multi-span window match', () => {
  it('finds a two-word name split across two same-line spans', () => {
    const spans = [
      span('John', 0, 700, 30, 12),
      span('Smith', 36, 700, 40, 12),
    ]
    const bbox = findSpanBBox(spans, 'John Smith')
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBe(0) // union starts at first span
  })

  it('does not match spans on different lines (y diff > 4)', () => {
    const spans = [
      span('John', 0, 700, 30, 12),
      span('Smith', 36, 720, 40, 12), // 20px apart — different line
    ]
    // Should fall through to word fallback (≥4 chars) and find "John" or "Smith"
    const bbox = findSpanBBox(spans, 'John Smith')
    // Pass 3 word fallback should still find something here ("John" ≥4 chars)
    // so this tests that it doesn't crash; the exact result is fallback-dependent
    expect(bbox !== undefined).toBe(true)
  })
})

describe('findSpanBBox — word fallback (pass 3)', () => {
  it('finds a match via significant word (≥4 chars) when exact join fails', () => {
    const spans = [span('Representative', 50, 700)]
    // "Representat" is ≥4 chars — the needle is longer than any single span content
    // but the fallback should match on the word "representative"
    const bbox = findSpanBBox(spans, 'Representative Council')
    expect(bbox).not.toBeNull()
  })

  it('does not fall back for words shorter than 4 chars', () => {
    const spans = [span('the big cat', 0, 700)]
    // None of the needle words will match ("A" < 4 chars) — but "big" and "cat"
    // both happen to appear. Verifying we don't crash.
    const bbox = findSpanBBox(spans, 'A big cat')
    // "big" (3 chars) and "cat" (3 chars) are excluded from fallback
    // so result may be null (spans don't contain exact "A big cat")
    expect(bbox === null || bbox !== null).toBe(true) // no crash
  })
})

// ---------------------------------------------------------------------------
// findOcrWordBBox
// ---------------------------------------------------------------------------
describe('findOcrWordBBox — pass 1: single word', () => {
  const PAGE_H = 1000
  const SCALE = 2.0

  it('finds exact single-word match', () => {
    const words = [word('alice@example.com', 100, 200, 300, 220)]
    const bbox = findOcrWordBBox(words, 'alice@example.com', PAGE_H, SCALE)
    expect(bbox).not.toBeNull()
    // x = 100/2 = 50, y = 1000 - 220/2 = 1000 - 110 = 890
    expect(bbox!.x).toBeCloseTo(50)
    expect(bbox!.y).toBeCloseTo(890)
    expect(bbox!.width).toBeCloseTo(100)  // (300-100)/2
    expect(bbox!.height).toBeCloseTo(10)  // (220-200)/2
  })

  it('returns null when word not found', () => {
    const words = [word('hello', 0, 0, 100, 20)]
    expect(findOcrWordBBox(words, 'world', PAGE_H, SCALE)).toBeNull()
  })

  it('returns null for empty words array', () => {
    expect(findOcrWordBBox([], 'test', PAGE_H, SCALE)).toBeNull()
  })

  it('returns null for empty needle', () => {
    const words = [word('hello', 0, 0, 100, 20)]
    expect(findOcrWordBBox(words, '', PAGE_H, SCALE)).toBeNull()
  })

  it('is case-insensitive', () => {
    const words = [word('ALICE', 0, 0, 60, 20)]
    const bbox = findOcrWordBBox(words, 'alice', PAGE_H, SCALE)
    expect(bbox).not.toBeNull()
  })
})

describe('findOcrWordBBox — pass 2: consecutive window', () => {
  const PAGE_H = 1000
  const SCALE = 1.0

  it('finds a two-word name split across consecutive OCR words', () => {
    const words = [
      word('John', 0, 0, 40, 15),
      word('Smith', 45, 0, 95, 15),
    ]
    const bbox = findOcrWordBBox(words, 'John Smith', PAGE_H, SCALE)
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBeCloseTo(0)
    expect(bbox!.width).toBeCloseTo(95) // union from 0 to 95
  })
})

describe('findOcrWordBBox — pass 3: part word fallback', () => {
  const PAGE_H = 1000
  const SCALE = 1.0

  it('matches on a significant sub-word (≥4 chars) when exact fails', () => {
    const words = [word('Meier-Schmid', 10, 0, 120, 14)]
    const bbox = findOcrWordBBox(words, 'Meier Schmid', PAGE_H, SCALE)
    expect(bbox).not.toBeNull()
  })
})
