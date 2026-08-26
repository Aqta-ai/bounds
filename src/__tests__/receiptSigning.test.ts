import { describe, it, expect } from 'vitest'
import { getSigningIdentity, signReceipt, verifyReceipt, sha256Hex } from '../lib/receiptSigning'

describe('receiptSigning', () => {
  it('signs a receipt that verifies offline against the embedded public key', () => {
    const identity = getSigningIdentity()
    const receipt = signReceipt({ schema_version: 'bounds-redaction-receipt/v1', document: 'a.pdf', totalItemsRedacted: 3 }, identity)
    expect(receipt.algorithm).toBe('Ed25519')
    expect(receipt.public_key_fingerprint).toBe(receipt.public_key_b64.slice(0, 16))
    expect(verifyReceipt(receipt)).toBe(true)
    expect(verifyReceipt(JSON.parse(JSON.stringify(receipt)))).toBe(true)
  })

  it('fails when any signed field changes', () => {
    const receipt = signReceipt({ document: 'a.pdf', totalItemsRedacted: 3 }, getSigningIdentity())
    expect(verifyReceipt({ ...receipt, totalItemsRedacted: 2 })).toBe(false)
    expect(verifyReceipt({ ...receipt, document: 'b.pdf' })).toBe(false)
  })

  it('fails when the public key is swapped for another valid key', () => {
    const receipt = signReceipt({ document: 'a.pdf' }, getSigningIdentity())
    const other = signReceipt({ document: 'a.pdf' }, { ...getSigningIdentity(), ...freshIdentity() })
    expect(verifyReceipt({ ...receipt, public_key_b64: other.public_key_b64, public_key_fingerprint: other.public_key_fingerprint })).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(verifyReceipt(null)).toBe(false)
    expect(verifyReceipt({})).toBe(false)
    expect(verifyReceipt({ signature_b64: 'x', public_key_b64: 'y' })).toBe(false)
  })

  it('hashes bytes to 64 lowercase hex characters', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('bounds'))
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })
})

function freshIdentity() {
  // Second, independent keypair for the key-swap case.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nacl = require('tweetnacl') as typeof import('tweetnacl')
  const keypair = nacl.sign.keyPair()
  const publicKeyB64 = Buffer.from(keypair.publicKey).toString('base64')
  return { keypair, publicKeyB64, fingerprint: publicKeyB64.slice(0, 16) }
}
