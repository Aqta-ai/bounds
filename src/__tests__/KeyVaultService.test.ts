import { describe, it, expect } from 'vitest'
import { KeyVaultService } from '../pipeline/KeyVaultService'
import type { Detection, PiiType } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: 'test_1',
    type: 'EMAIL',
    text: 'alice@example.com',
    token: '[EMAIL_001]',
    pageIndex: 0,
    boundingBox: { x: 10, y: 20, width: 100, height: 12 },
    confidence: 0.99,
    source: 'REGEX',
    enabled: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildMap
// ---------------------------------------------------------------------------
describe('KeyVaultService.buildMap', () => {
  it('includes enabled detections', () => {
    const dets = [makeDetection({ enabled: true })]
    const map = KeyVaultService.buildMap(dets, 'hash123', 'report')
    expect(map.detections).toHaveLength(1)
    expect(map.detections[0].token).toBe('[EMAIL_001]')
    expect(map.detections[0].original).toBe('alice@example.com')
  })

  it('excludes disabled detections', () => {
    const dets = [makeDetection({ enabled: false })]
    const map = KeyVaultService.buildMap(dets, 'hash', 'doc')
    expect(map.detections).toHaveLength(0)
  })

  it('deduplicates by token (same token on multiple pages)', () => {
    const dets = [
      makeDetection({ id: 'a', pageIndex: 0 }),
      makeDetection({ id: 'b', pageIndex: 1 }), // same token [EMAIL_001]
    ]
    const map = KeyVaultService.buildMap(dets, 'hash', 'doc')
    expect(map.detections).toHaveLength(1)
  })

  it('preserves distinct tokens as separate entries', () => {
    const dets = [
      makeDetection({ id: 'a', token: '[EMAIL_001]', text: 'a@x.com' }),
      makeDetection({ id: 'b', token: '[EMAIL_002]', text: 'b@x.com' }),
    ]
    const map = KeyVaultService.buildMap(dets, 'hash', 'doc')
    expect(map.detections).toHaveLength(2)
  })

  it('sets documentHash and documentName', () => {
    const map = KeyVaultService.buildMap([], 'abc123', 'my-document')
    expect(map.documentHash).toBe('abc123')
    expect(map.documentName).toBe('my-document')
  })

  it('sets version to 1', () => {
    const map = KeyVaultService.buildMap([], 'h', 'n')
    expect(map.version).toBe(1)
  })

  it('sets createdAt to a valid ISO timestamp', () => {
    const before = Date.now()
    const map = KeyVaultService.buildMap([], 'h', 'n')
    const after = Date.now()
    const ts = new Date(map.createdAt).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

// ---------------------------------------------------------------------------
// generateKey / encrypt / decrypt roundtrip
// ---------------------------------------------------------------------------
describe('KeyVaultService encrypt/decrypt roundtrip', () => {
  it('decrypts what was encrypted and recovers original map', async () => {
    const svc = new KeyVaultService()
    await svc.generateKey()

    const map = KeyVaultService.buildMap(
      [makeDetection()],
      'deadbeef',
      'test-doc',
    )
    const vaultBlob = await svc.encrypt(map)
    const recovered = await svc.decrypt(vaultBlob)

    expect(recovered.documentHash).toBe('deadbeef')
    expect(recovered.documentName).toBe('test-doc')
    expect(recovered.detections).toHaveLength(1)
    expect(recovered.detections[0].original).toBe('alice@example.com')
    expect(recovered.detections[0].token).toBe('[EMAIL_001]')
    expect(recovered.detections[0].type).toBe('EMAIL' as PiiType)
  })

  it('roundtrip preserves multiple detections in order', async () => {
    const svc = new KeyVaultService()
    await svc.generateKey()

    const dets = [
      makeDetection({ id: 'a', token: '[EMAIL_001]', text: 'a@x.com', type: 'EMAIL' }),
      makeDetection({ id: 'b', token: '[PERSON_001]', text: 'Jane Doe', type: 'PERSON' }),
    ]
    const map = KeyVaultService.buildMap(dets, 'h', 'n')
    const blob = await svc.encrypt(map)
    const result = await svc.decrypt(blob)

    expect(result.detections).toHaveLength(2)
    expect(result.detections[0].type).toBe('EMAIL')
    expect(result.detections[1].type).toBe('PERSON')
  })

  it('vault blob is valid JSON', async () => {
    const svc = new KeyVaultService()
    await svc.generateKey()
    const blob = await svc.encrypt(KeyVaultService.buildMap([], 'h', 'n'))
    const text = await blob.text()
    expect(() => JSON.parse(text)).not.toThrow()
  })

  it('vault JSON contains plaintext metadata but not original PII values', async () => {
    const svc = new KeyVaultService()
    await svc.generateKey()
    const dets = [makeDetection({ text: 'secret@example.com' })]
    const blob = await svc.encrypt(KeyVaultService.buildMap(dets, 'h', 'n'))
    const text = await blob.text()

    // plaintext metadata present
    expect(text).toContain('Bounds Redaction Vault v1')
    expect(text).toContain('redactedItemCount')
    // original PII value must NOT appear in plaintext
    expect(text).not.toContain('secret@example.com')
  })

  it('throws if decrypt is called without a key', async () => {
    const svc = new KeyVaultService()
    const fakeBlob = new Blob(['{}'])
    await expect(svc.decrypt(fakeBlob)).rejects.toThrow()
  })

  it('throws if encrypted with one key and decrypted with a different key', async () => {
    const enc = new KeyVaultService()
    await enc.generateKey()
    const blob = await enc.encrypt(KeyVaultService.buildMap([], 'h', 'n'))

    const dec = new KeyVaultService()
    await dec.generateKey() // different key
    await expect(dec.decrypt(blob)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// exportKeyBlob / importRawKey roundtrip
// ---------------------------------------------------------------------------
describe('KeyVaultService key export/import roundtrip', () => {
  it('exported key can be re-imported and used to decrypt', async () => {
    const original = new KeyVaultService()
    await original.generateKey()

    const map = KeyVaultService.buildMap([makeDetection()], 'h', 'n')
    const vaultBlob = await original.encrypt(map)
    const keyBlob = await original.exportKeyBlob()

    const restored = new KeyVaultService()
    await restored.importRawKey(await keyBlob.arrayBuffer())
    const recovered = await restored.decrypt(vaultBlob)

    expect(recovered.detections[0].original).toBe('alice@example.com')
  })

  it('exported key blob is 32 bytes (AES-256)', async () => {
    const svc = new KeyVaultService()
    await svc.generateKey()
    const blob = await svc.exportKeyBlob()
    expect(blob.size).toBe(32)
  })

  it('throws exportKeyBlob if no key generated', async () => {
    const svc = new KeyVaultService()
    await expect(svc.exportKeyBlob()).rejects.toThrow('No key')
  })
})
