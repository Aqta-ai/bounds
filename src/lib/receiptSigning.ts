// On-device Ed25519 signing for Bounds redaction receipts.
//
// The browser generates a persistent Ed25519 keypair once (localStorage) and
// signs each exported audit report with it. The public key travels inside the
// receipt, so any third party can verify the signature offline: it proves the
// receipt was not altered after signing. It does NOT prove a particular
// workspace or user identity unless a verifier has separately pinned that
// public key. Different devices mint different keys.
//
// Signature base: canonical JSON (keys sorted recursively) of every field
// except signature_b64. Any Ed25519 implementation reproduces the check.

import nacl from 'tweetnacl'

const STORAGE_KEY = 'bounds.receipt.signingKey.v1'
const encoder = new TextEncoder()

export interface SigningIdentity {
  keypair: nacl.SignKeyPair
  publicKeyB64: string
  fingerprint: string
}

export function uint8ToBase64(arr: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(arr).toString('base64')
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s)
}

export function base64ToUint8(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(str, 'base64')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  return new Uint8Array(atob(str).split('').map((c) => c.charCodeAt(0)))
}

export function canonicalizeJson(obj: unknown): string {
  const sortKeys = (val: unknown): unknown => {
    if (val === null || typeof val !== 'object') return val
    if (Array.isArray(val)) return val.map(sortKeys)
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(val as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((val as Record<string, unknown>)[key])
    }
    return sorted
  }
  return JSON.stringify(sortKeys(obj))
}

function persist(secretKey: Uint8Array): void {
  try {
    localStorage.setItem(STORAGE_KEY, uint8ToBase64(secretKey))
  } catch {
    // Private mode or storage disabled: the key lives for this session only.
  }
}

/** Persistent per-browser signing identity. The secret key never leaves the device. */
export function getSigningIdentity(): SigningIdentity {
  let keypair: nacl.SignKeyPair | null = null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) keypair = nacl.sign.keyPair.fromSecretKey(base64ToUint8(stored))
  } catch {
    keypair = null
  }
  if (!keypair) {
    keypair = nacl.sign.keyPair()
    persist(keypair.secretKey)
  }
  const publicKeyB64 = uint8ToBase64(keypair.publicKey)
  return { keypair, publicKeyB64, fingerprint: publicKeyB64.slice(0, 16) }
}

/** SHA-256 as lowercase hex. Binds a receipt to the exact redacted PDF bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function signReceipt<T extends Record<string, unknown>>(
  body: T,
  identity: SigningIdentity,
): T & { public_key_b64: string; public_key_fingerprint: string; algorithm: string; signature_b64: string } {
  const unsigned = {
    ...body,
    public_key_b64: identity.publicKeyB64,
    public_key_fingerprint: identity.fingerprint,
    algorithm: 'Ed25519',
  }
  const sig = nacl.sign.detached(new Uint8Array(encoder.encode(canonicalizeJson(unsigned))), identity.keypair.secretKey)
  return { ...unsigned, signature_b64: uint8ToBase64(sig) }
}

/** Verify offline: fingerprint must match the embedded key; signature must validate over the canonical body. */
export function verifyReceipt(receipt: unknown): boolean {
  if (typeof receipt !== 'object' || receipt === null) return false
  const r = receipt as Record<string, unknown>
  const sig = r.signature_b64
  const pub = r.public_key_b64
  const fp = r.public_key_fingerprint
  if (typeof sig !== 'string' || typeof pub !== 'string') return false
  if (typeof fp === 'string' && pub.slice(0, 16) !== fp) return false
  const { signature_b64: _omit, ...body } = r
  void _omit
  try {
    return nacl.sign.detached.verify(
      new Uint8Array(encoder.encode(canonicalizeJson(body))),
      new Uint8Array(base64ToUint8(sig)),
      new Uint8Array(base64ToUint8(pub)),
    )
  } catch {
    return false
  }
}
