#!/usr/bin/env node
/**
 * bounds-verify: check a Bounds redaction record without Bounds.
 *
 *   node scripts/bounds-verify.mjs record.json [redacted.pdf] [--json]
 *
 * Checks, each PASS or FAIL:
 *   SIGNATURE   Ed25519 over the canonical JSON of the record (signature_b64 removed),
 *               with the embedded public key; the fingerprint must match the key.
 *   SCHEMA      schema_version is bounds-redaction-receipt/v1 and the required fields exist.
 *   FILE HASH   SHA-256 of the PDF matches redacted_file_sha256 (only if a PDF is given).
 *   RESIDUAL    the signed verification block is present and every scan is PASS.
 *
 * Exit 0 when everything checked passes, 1 when anything fails, 2 on usage or read error.
 * No network, no account, no Bounds server. Only tweetnacl and Node's crypto.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'

const REQUIRED = ['schema_version', 'document', 'redacted_file_sha256', 'redactedAt', 'public_key_b64', 'signature_b64']

export function canonicalizeJson(obj) {
  const sortKeys = (val) => {
    if (val === null || typeof val !== 'object') return val
    if (Array.isArray(val)) return val.map(sortKeys)
    const sorted = {}
    for (const key of Object.keys(val).sort()) sorted[key] = sortKeys(val[key])
    return sorted
  }
  return JSON.stringify(sortKeys(obj))
}

export function verifyRecord(record, pdfBytes) {
  const checks = []
  const r = record && typeof record === 'object' ? record : {}

  const missing = REQUIRED.filter((k) => typeof r[k] !== 'string' || r[k].length === 0)
  checks.push({ name: 'SCHEMA', pass: r.schema_version === 'bounds-redaction-receipt/v1' && missing.length === 0,
    detail: r.schema_version !== 'bounds-redaction-receipt/v1' ? `unexpected schema_version ${JSON.stringify(r.schema_version)}` : missing.length ? `missing ${missing.join(', ')}` : 'bounds-redaction-receipt/v1' })

  let sigOk = false, sigDetail = 'not checked'
  try {
    const { signature_b64, ...body } = r
    const pub = Buffer.from(String(r.public_key_b64 ?? ''), 'base64')
    const sig = Buffer.from(String(signature_b64 ?? ''), 'base64')
    const fpOk = typeof r.public_key_fingerprint !== 'string' || String(r.public_key_b64).slice(0, 16) === r.public_key_fingerprint
    sigOk = fpOk && pub.length === 32 && sig.length === 64 && nacl.sign.detached.verify(new TextEncoder().encode(canonicalizeJson(body)), sig, pub)
    sigDetail = !fpOk ? 'fingerprint does not match the embedded key' : sigOk ? `Ed25519, key ${String(r.public_key_b64).slice(0, 16)}…` : 'signature does not verify over the canonical body'
  } catch (e) { sigDetail = `error: ${e.message}` }
  checks.push({ name: 'SIGNATURE', pass: sigOk, detail: sigDetail })

  if (pdfBytes) {
    const h = createHash('sha256').update(pdfBytes).digest('hex')
    checks.push({ name: 'FILE HASH', pass: h === r.redacted_file_sha256, detail: h === r.redacted_file_sha256 ? `sha256 ${h.slice(0, 16)}…` : 'PDF does not match redacted_file_sha256' })
  } else {
    checks.push({ name: 'FILE HASH', pass: null, detail: 'no PDF given; pass the redacted file to bind the record to it' })
  }

  const v = r.verification
  if (v && typeof v === 'object') {
    const scans = ['residual_text_scan', 'pdf_object_scan', 'rendered_ocr_scan', 'metadata_scan']
    const failed = scans.filter((k) => v[k] !== 'PASS')
    checks.push({ name: 'RESIDUAL', pass: failed.length === 0,
      detail: failed.length === 0 ? `${v.procedure ?? 'scan'}: ${v.redacted_pages ?? '?'} page(s) OCR'd, ${v.spans_checked ?? '?'} span(s), 0 findings` : `${failed.join(', ')} not PASS (${v.residual_findings ?? '?'} finding(s))` })
  } else {
    checks.push({ name: 'RESIDUAL', pass: false, detail: 'record carries no verification block; the output was not scanned' })
  }
  return { checks, ok: checks.every((c) => c.pass !== false) }
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'))
  const asJson = argv.includes('--json')
  if (args.length < 1) { process.stderr.write('usage: bounds-verify record.json [redacted.pdf] [--json]\n'); return 2 }
  let record, pdf
  try { record = JSON.parse(readFileSync(args[0], 'utf8')) } catch (e) { process.stderr.write(`cannot read record: ${e.message}\n`); return 2 }
  if (args[1]) { try { pdf = readFileSync(args[1]) } catch (e) { process.stderr.write(`cannot read PDF: ${e.message}\n`); return 2 } }
  const { checks, ok } = verifyRecord(record, pdf)
  if (asJson) process.stdout.write(JSON.stringify({ ok, checks }, null, 2) + '\n')
  else {
    for (const c of checks) process.stdout.write(`${c.name.padEnd(12)} ${c.pass === null ? 'SKIP' : c.pass ? 'PASS' : 'FAIL'}   ${c.detail}\n`)
    process.stdout.write(ok ? '\nThe record holds. Checked on this machine; nothing was contacted.\n' : '\nThe record does not hold.\n')
  }
  return ok ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)))
