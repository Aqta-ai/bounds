import { describe, it, expect } from 'vitest'
import { stemName, uint8ArrayToBase64, base64ToUint8Array } from '../utils/fileUtils'

// ---------------------------------------------------------------------------
// stemName
// ---------------------------------------------------------------------------
describe('stemName', () => {
  it('strips a simple extension', () => {
    expect(stemName('report.pdf')).toBe('report')
  })

  it('strips only the last extension when there are multiple dots', () => {
    expect(stemName('my.report.v2.pdf')).toBe('my.report.v2')
  })

  it('returns the filename unchanged when there is no extension', () => {
    expect(stemName('README')).toBe('README')
  })

  it('handles filenames starting with a dot (hidden files)', () => {
    // ".gitignore" has no extension in the stem sense — the dot is part of the name
    expect(stemName('.gitignore')).toBe('.gitignore')
  })

  it('strips .bounds extension', () => {
    expect(stemName('patient-record.bounds')).toBe('patient-record')
  })

  it('strips .key extension', () => {
    expect(stemName('patient-record.key')).toBe('patient-record')
  })

  it('handles empty string', () => {
    expect(stemName('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// uint8ArrayToBase64 / base64ToUint8Array
// ---------------------------------------------------------------------------
describe('base64 roundtrip', () => {
  it('encodes and decodes back to original bytes', () => {
    const original = new Uint8Array([104, 101, 108, 108, 111]) // "hello"
    const encoded = uint8ArrayToBase64(original)
    const decoded = base64ToUint8Array(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })

  it('encodes to a valid base64 string (no whitespace)', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128])
    const encoded = uint8ArrayToBase64(bytes)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('handles a single byte', () => {
    const bytes = new Uint8Array([42])
    const encoded = uint8ArrayToBase64(bytes)
    const decoded = base64ToUint8Array(encoded)
    expect(decoded[0]).toBe(42)
  })

  it('handles empty array', () => {
    const bytes = new Uint8Array([])
    const encoded = uint8ArrayToBase64(bytes)
    expect(encoded).toBe('')
    const decoded = base64ToUint8Array(encoded)
    expect(decoded.length).toBe(0)
  })

  it('32 random-ish bytes roundtrip (key-sized)', () => {
    const bytes = new Uint8Array(32).map((_, i) => (i * 37 + 13) % 256)
    const encoded = uint8ArrayToBase64(bytes)
    const decoded = base64ToUint8Array(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(bytes))
  })
})
