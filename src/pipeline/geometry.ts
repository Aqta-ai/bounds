/**
 * Redaction geometry shared by the engine (which draws boxes) and the residual
 * scan (which checks them), so the two cannot disagree about where a box is.
 */
import type { Detection, OcrWord } from '../types'

/** Padding, in PDF units, added on every side of a detection's box when it is drawn. */
export const REDACTION_BOX_PAD = 2

/** Strip everything that OCR or extraction can legitimately change: case, spacing, punctuation. */
export function normaliseForMatch(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Cumulative x offset of every character boundary in a text item, in PDF units
 * from the item's origin: offsets[i] is where character i starts, and
 * offsets[text.length] is the item's width. Measured with the page font and
 * scaled so the total matches the width pdf.js reports, which absorbs uniform
 * character and word spacing. Returns null when the font cannot be measured,
 * in which case callers fall back to an average character width.
 */
export function computeCharOffsets(
  text: string,
  itemWidth: number,
  measure: (s: string) => number,
): number[] | null {
  if (!text || !(itemWidth > 0)) return null
  const full = measure(text)
  if (!Number.isFinite(full) || full <= 0) return null
  const k = itemWidth / full
  const offsets = new Array<number>(text.length + 1)
  offsets[0] = 0
  for (let i = 1; i < text.length; i++) offsets[i] = measure(text.slice(0, i)) * k
  offsets[text.length] = itemWidth
  return offsets
}

export interface PartialLeak {
  detection: Detection
  side: 'left' | 'right'
}

/**
 * A whole glyph left standing next to a box is the failure a whole-span search
 * cannot see: "M" beside a box that covers "aire" reads back as one letter, not
 * as the name. So every OCR word that sits on the box's line and touches or
 * overlaps one of its edges is compared with the redacted span: a word that
 * ends at the left edge and is a proper prefix of the span, or starts at the
 * right edge and is a proper suffix of it, is a leak. Neighbouring words that
 * merely sit next to the box ("Patient:", "DOB") fail the prefix test and are
 * ignored. Boxes are in PDF units (origin bottom-left); words are in image
 * pixels at `scale` (origin top-left).
 */
export function findPartialLeaks(
  detections: Detection[],
  words: OcrWord[],
  scale: number,
  pageHeight: number,
): PartialLeak[] {
  const out: PartialLeak[] = []
  for (const det of detections) {
    const { x, y, width, height } = det.boundingBox
    if (!(width > 0) || !(height > 0)) continue
    const span = normaliseForMatch(det.text)
    if (!span) continue
    const bx0 = (x - REDACTION_BOX_PAD) * scale
    const bx1 = (x + width + REDACTION_BOX_PAD) * scale
    const by0 = (pageHeight - y - height - REDACTION_BOX_PAD) * scale
    const by1 = (pageHeight - y + REDACTION_BOX_PAD) * scale
    const bh = by1 - by0
    const gap = Math.max(2, bh * 0.3)
    for (const w of words) {
      const nw = normaliseForMatch(w.text)
      if (!nw || nw.length >= span.length) continue
      const vOverlap = Math.min(w.y1, by1) - Math.max(w.y0, by0)
      if (vOverlap < 0.5 * Math.min(w.y1 - w.y0, bh)) continue
      const touchesLeft = w.x1 > bx0 - gap && w.x0 < bx0
      const touchesRight = w.x0 < bx1 + gap && w.x1 > bx1
      if (touchesLeft && span.startsWith(nw)) out.push({ detection: det, side: 'left' })
      else if (touchesRight && span.endsWith(nw)) out.push({ detection: det, side: 'right' })
    }
  }
  return out
}
