import { describe, it, expect } from 'vitest'
import { findSpanBBox, findOcrWordBBox } from '../pipeline/PDFEngine'
import { computeCharOffsets, findPartialLeaks } from '../pipeline/geometry'
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
describe('findSpanBBox: exact single span match', () => {
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

describe('findSpanBBox: multi-span window match', () => {
  it('finds a two-word name split across two same-line spans', () => {
    const spans = [
      span('John', 0, 700, 30, 12),
      span('Smith', 36, 700, 40, 12),
    ]
    const bbox = findSpanBBox(spans, 'John Smith')
    expect(bbox).not.toBeNull()
    expect(bbox!.x).toBe(0) // union starts at first span
  })

  it('does not match spans on different lines (y diff > 4), falls back to word match', () => {
    const spans = [
      span('John', 0, 700, 30, 12),
      span('Smith', 36, 720, 40, 12), // 20px apart: different line
    ]
    // Multi-span window pass fails (different lines); pass 3 word fallback picks up "John" (≥3 chars)
    const bbox = findSpanBBox(spans, 'John Smith')
    expect(bbox).not.toBeNull()
  })
})

describe('findSpanBBox: word fallback (pass 3)', () => {
  it('finds a match via significant word (≥3 chars) when exact join fails', () => {
    const spans = [span('Representative', 50, 700)]
    // "Representat" is ≥4 chars: the needle is longer than any single span content
    // but the fallback should match on the word "representative"
    const bbox = findSpanBBox(spans, 'Representative Council')
    expect(bbox).not.toBeNull()
  })

  it('does not fall back for words shorter than 3 chars: returns null', () => {
    const spans = [span('or an if', 0, 700)]
    // Needle "A or if": no single span contains the full string,
    // and every word (A=1, or=2, if=2) is below the 3-char threshold, so pass 3 skips all.
    const bbox = findSpanBBox(spans, 'A or if')
    expect(bbox).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findOcrWordBBox
// ---------------------------------------------------------------------------
describe('findOcrWordBBox: pass 1: single word', () => {
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

describe('findOcrWordBBox: pass 2: consecutive window', () => {
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

describe('findOcrWordBBox: pass 3: part word fallback', () => {
  const PAGE_H = 1000
  const SCALE = 1.0

  it('matches on a significant sub-word (≥3 chars) when exact fails', () => {
    const words = [word('Meier-Schmid', 10, 0, 120, 14)]
    const bbox = findOcrWordBBox(words, 'Meier Schmid', PAGE_H, SCALE)
    expect(bbox).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Measured character offsets: boxes follow the glyphs, not an average width
// ---------------------------------------------------------------------------
describe('computeCharOffsets', () => {
  // A toy proportional font: "M" and "O" are wide, "i" and "l" are narrow, everything else 6.
  const glyph = (ch: string) => (ch === 'M' || ch === 'O' ? 12 : ch === 'i' || ch === 'l' ? 3 : 6)
  const measure = (s: string) => [...s].reduce((w, ch) => w + glyph(ch), 0)
  it('returns one boundary per character, scaled to the item width', () => {
    const off = computeCharOffsets('Mail', 48, measure)   // natural width 12+6+3+3 = 24, item is 48: scale 2
    expect(off).toEqual([0, 24, 36, 42, 48])
  })
  it('returns null when the font cannot be measured', () => {
    expect(computeCharOffsets('Mail', 48, () => 0)).toBeNull()
    expect(computeCharOffsets('', 48, measure)).toBeNull()
  })
  it('findSpanBBox uses the measured boundaries when present and the average otherwise', () => {
    const text = 'Patient: Maire O'
    const width = measure(text)
    const span = { text, x: 50, y: 700, width, height: 12, charOffsets: computeCharOffsets(text, width, measure)! }
    const measured = findSpanBBox([span], 'Maire')!
    expect(measured.x).toBeCloseTo(50 + measure('Patient: '), 5)
    expect(measured.width).toBeCloseTo(measure('Maire'), 5)
    const { charOffsets: _drop, ...plain } = span
    const averaged = findSpanBBox([plain], 'Maire')!
    expect(averaged.x).not.toBeCloseTo(measured.x, 0)   // the drift the measurement removes
  })
})

describe('findPartialLeaks', () => {
  const det = { id: 'd', type: 'PERSON' as const, text: 'Maire', token: '[NAME_001]', pageIndex: 0, confidence: 0.9, source: 'REGEX' as const, enabled: true,
    boundingBox: { x: 100, y: 700, width: 30, height: 12 } }
  const w = (text: string, x0: number, x1: number) => ({ text, x0, x1, y0: 390, y1: 426, confidence: 90 })
  it('flags a prefix touching the left edge and a suffix touching the right edge, on the same line only', () => {
    expect(findPartialLeaks([det], [w('M', 280, 293)], 3, 842)).toHaveLength(1)
    expect(findPartialLeaks([det], [w('re', 397, 420)], 3, 842)).toHaveLength(1)
    expect(findPartialLeaks([det], [{ ...w('M', 280, 293), y0: 100, y1: 130 }], 3, 842)).toHaveLength(0)
    expect(findPartialLeaks([det], [w('Patient:', 220, 293), w('Maire', 280, 400)], 3, 842)).toHaveLength(0)  // whole span is not "partial"
  })
})
