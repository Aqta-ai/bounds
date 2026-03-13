import type { Detection, RedactionMap } from '../types'
import { uint8ArrayToBase64, base64ToUint8Array } from '../utils/fileUtils'

// ---------------------------------------------------------------------------
// KeyVaultService
// Implements reversible redaction using the browser's built-in Web Crypto API.
// No external crypto libraries required.
//
// Output:
//   .bounds file — { iv: base64, ciphertext: base64, version: 1 }
//                  Contains the encrypted RedactionMap (safe to share)
//   .key file    — raw 32-byte AES-256 key (must stay secret)
// ---------------------------------------------------------------------------

interface EncryptedVault {
  // ── Plaintext metadata (safe to read, contains no PII) ──────────────────
  _bounds: string            // always "Bounds Redaction Vault v1"
  _howToRestore: string      // human-readable instruction
  document: string           // original filename
  redactedAt: string         // ISO timestamp
  redactedItemCount: number  // total number of tokens replaced
  // PII type counts, e.g. { PERSON: 3, IBAN: 1, EMAIL: 2 }
  // Values are counts only — no original text is stored in plaintext.
  summary: Record<string, number>
  // ── Encrypted payload (requires matching .key file to read) ─────────────
  version: number
  iv: string
  ciphertext: string
}

export class KeyVaultService {
  private key: CryptoKey | null = null

  /** Generate a fresh AES-256-GCM key for this session. */
  async generateKey(): Promise<void> {
    this.key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,  // extractable so we can export it to .key file
      ['encrypt', 'decrypt'],
    )
  }

  /** Import an existing raw key (used during restoration). */
  async importRawKey(rawBytes: ArrayBuffer): Promise<void> {
    this.key = await crypto.subtle.importKey(
      'raw',
      rawBytes,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
  }

  /** Export the raw key bytes for the .key download file. */
  async exportKeyBlob(): Promise<Blob> {
    if (!this.key) throw new Error('No key — call generateKey() first')
    const rawBytes = await crypto.subtle.exportKey('raw', this.key)
    return new Blob([rawBytes], { type: 'application/octet-stream' })
  }

  /** Encrypt the redaction map → .bounds Blob. */
  async encrypt(map: RedactionMap): Promise<Blob> {
    if (!this.key) throw new Error('No key — call generateKey() first')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(JSON.stringify(map))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encoded,
    )

    // Build a plaintext summary — counts only, no actual PII values.
    const summary: Record<string, number> = {}
    for (const d of map.detections) {
      summary[d.type] = (summary[d.type] ?? 0) + 1
    }

    const vault: EncryptedVault = {
      _bounds: 'Bounds Redaction Vault v1',
      _howToRestore: 'Open Bounds, drag this file + the matching .key file onto the app to restore original values.',
      document: map.documentName,
      redactedAt: map.createdAt,
      redactedItemCount: map.detections.length,
      summary,
      version: 1,
      iv: uint8ArrayToBase64(iv),
      ciphertext: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    }
    return new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' })
  }

  /** Decrypt a .bounds blob (needs the raw key to have been imported first). */
  async decrypt(vaultBlob: Blob): Promise<RedactionMap> {
    if (!this.key) throw new Error('No key — call importRawKey() first')
    const text = await vaultBlob.text()
    const vault: EncryptedVault = JSON.parse(text) as EncryptedVault
    if (vault.version !== 1) throw new Error(`Unsupported vault version: ${vault.version}`)
    const iv = base64ToUint8Array(vault.iv)
    const ciphertext = base64ToUint8Array(vault.ciphertext)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as Uint8Array<ArrayBuffer> },
      this.key,
      ciphertext as unknown as Uint8Array<ArrayBuffer>,
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as RedactionMap
  }

  /** Build a RedactionMap from detections. */
  static buildMap(
    detections: Detection[],
    documentHash: string,
    documentName: string,
  ): RedactionMap {
    // Deduplicate by token (same token can appear on multiple pages)
    const seen = new Set<string>()
    const entries: RedactionMap['detections'] = []
    for (const d of detections) {
      if (d.enabled && !seen.has(d.token)) {
        seen.add(d.token)
        entries.push({ token: d.token, original: d.text, type: d.type })
      }
    }
    return {
      documentHash,
      documentName,
      createdAt: new Date().toISOString(),
      version: 1,
      detections: entries,
    }
  }
}
