import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { canonicalizeJson } from '../lib/receiptSigning'

const SCRIPT = join(process.cwd(), 'scripts', 'bounds-verify.mjs')
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

function signed(body: Record<string, unknown>) {
  const kp = nacl.sign.keyPair()
  const unsigned = { ...body, public_key_b64: b64(kp.publicKey), public_key_fingerprint: b64(kp.publicKey).slice(0, 16), algorithm: 'Ed25519' }
  const sig = nacl.sign.detached(new TextEncoder().encode(canonicalizeJson(unsigned)), kp.secretKey)
  return { ...unsigned, signature_b64: b64(sig) }
}
const PASS_SCAN = { procedure: 'bounds-residual-scan/v1', pages_scanned: 2, redacted_pages: 1, spans_checked: 3, ocr_language: 'en',
  residual_text_scan: 'PASS', pdf_object_scan: 'PASS', rendered_ocr_scan: 'PASS', metadata_scan: 'PASS', residual_findings: 0, findings: [] }

function run(record: unknown, pdf?: Buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'bv-'))
  writeFileSync(join(dir, 'r.json'), JSON.stringify(record))
  const args = [SCRIPT, join(dir, 'r.json')]
  if (pdf) { writeFileSync(join(dir, 'out.pdf'), pdf); args.push(join(dir, 'out.pdf')) }
  args.push('--json')
  try { return { code: 0, out: JSON.parse(execFileSync('node', args, { encoding: 'utf8' })) } }
  catch (e: unknown) { const err = e as { status: number; stdout: string }; return { code: err.status, out: JSON.parse(err.stdout) } }
}

describe('bounds-verify, the standalone verifier', () => {
  const pdf = Buffer.from('%PDF-1.4 fake bytes for hashing')
  const base = { schema_version: 'bounds-redaction-receipt/v1', document: 'a.pdf', redactedAt: '2026-09-05T10:00:00Z',
    redacted_file_sha256: createHash('sha256').update(pdf).digest('hex'), verification: PASS_SCAN }

  it('passes a well-formed signed record bound to its file', () => {
    const { code, out } = run(signed(base), pdf)
    expect(code).toBe(0); expect(out.ok).toBe(true)
    expect(out.checks.map((c: { name: string; pass: boolean }) => [c.name, c.pass])).toEqual([['SCHEMA', true], ['SIGNATURE', true], ['FILE HASH', true], ['RESIDUAL', true]])
  })
  it('fails the signature when one field changes after signing', () => {
    const r = signed(base); (r as Record<string, unknown>).document = 'b.pdf'
    const { code, out } = run(r, pdf)
    expect(code).toBe(1); expect(out.checks.find((c: { name: string }) => c.name === 'SIGNATURE').pass).toBe(false)
  })
  it('fails the file hash when the PDF is not the one the record names', () => {
    const { code, out } = run(signed(base), Buffer.from('a different file'))
    expect(code).toBe(1); expect(out.checks.find((c: { name: string }) => c.name === 'FILE HASH').pass).toBe(false)
  })
  it('fails RESIDUAL when a scan is not PASS, and when the block is missing', () => {
    const bad = signed({ ...base, verification: { ...PASS_SCAN, rendered_ocr_scan: 'FAIL', residual_findings: 2 } })
    expect(run(bad, pdf).out.checks.find((c: { name: string }) => c.name === 'RESIDUAL').pass).toBe(false)
    const { verification: _v, ...noScan } = base; void _v
    expect(run(signed(noScan), pdf).out.checks.find((c: { name: string }) => c.name === 'RESIDUAL').pass).toBe(false)
  })
  it('skips the file hash but still verifies when no PDF is given', () => {
    const { code, out } = run(signed(base))
    expect(code).toBe(0); expect(out.checks.find((c: { name: string }) => c.name === 'FILE HASH').pass).toBeNull()
  })
})
