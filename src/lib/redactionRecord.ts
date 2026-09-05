/**
 * The signed redaction record, built in one place so the single-file export
 * and the batch path produce the same object. Signed on this device with the
 * persistent Ed25519 key; bound to the SHA-256 of the redacted PDF; carries the
 * proof-of-removal scan (or null, stated as such, never omitted).
 */
import type { Detection, PipelineResult } from '../types'
import { PII_TYPE_LABELS } from '../utils/colors'
import { getSigningIdentity, sha256Hex, signReceipt } from './receiptSigning'
import type { ResidualScanResult } from '../pipeline/ResidualScan'

export const RECORD_SCHEMA = 'bounds-redaction-receipt/v1'

export async function buildSignedRecord(
  result: PipelineResult,
  scan: ResidualScanResult | null,
  privacySummary?: string,
): Promise<Record<string, unknown>> {
  const enabled = result.detections.filter((d: Detection) => d.enabled)
  const counts: Record<string, number> = {}
  for (const d of enabled) {
    const label = PII_TYPE_LABELS[d.type]
    counts[label] = (counts[label] ?? 0) + 1
  }
  const report = {
    schema_version: RECORD_SCHEMA,
    document: result.documentName,
    redacted_file_sha256: await sha256Hex(result.redactedPdfBytes as Uint8Array),
    redactedAt: new Date().toISOString(),
    preRedactionRisk: { level: result.preRedactionRiskLevel, score: result.preRedactionRiskScore },
    postRedactionResidualRisk: { level: result.residualRiskLevel, score: result.residualRiskScore },
    totalItemsRedacted: enabled.length,
    breakdown: Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count })),
    privacySummary: privacySummary ?? result.privacySummary ?? '',
    tool: 'Bounds',
    verification: scan,
  }
  return signReceipt(report, getSigningIdentity())
}

export async function buildSignedRecordJson(
  result: PipelineResult,
  scan: ResidualScanResult | null,
  privacySummary?: string,
): Promise<string> {
  return JSON.stringify(await buildSignedRecord(result, scan, privacySummary), null, 2)
}
