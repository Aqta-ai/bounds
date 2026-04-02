import type { Detection } from '../types'

/**
 * Produces a sharp, context-aware privacy summary based on what was actually
 * detected. Reads like a privacy expert wrote it — specific types named,
 * most sensitive first, ends with a clear outcome statement.
 */
export function buildPrivacySummary(
  detections: Detection[],
  residualRisk?: 'clean' | 'low' | 'medium' | 'high' | 'critical',
): string {
  const enabled = detections.filter((d) => d.enabled)

  if (enabled.length === 0) {
    return 'No personal data detected. This document appears clean and is safe to share as-is.'
  }

  const types = new Set(enabled.map((d) => d.type))

  // ── Tier 1 — special-category / high-sensitivity ──
  const hasHealth      = types.has('HEALTH_DATA')
  const hasSSN         = types.has('SSN')
  const hasPassport    = types.has('PASSPORT')
  const hasIBAN        = types.has('IBAN')
  const hasCreditCard  = types.has('CREDIT_CARD')
  const hasID          = types.has('ID_NUMBER')

  // ── Tier 2 — personal identifiers ──
  const hasPerson  = types.has('PERSON')
  const hasDOB     = types.has('DATE_OF_BIRTH')
  const hasAddress = types.has('ADDRESS')

  // ── Tier 3 — contact ──
  const hasEmail = types.has('EMAIL')
  const hasPhone = types.has('PHONE')

  // Build an ordered label list — most sensitive first
  const parts: string[] = []

  if (hasHealth)     parts.push('special-category health records (GDPR Art. 9)')
  if (hasSSN)        parts.push('government-issued identification numbers')
  if (hasPassport)   parts.push('passport numbers')
  if (hasIBAN)       parts.push('financial account and IBAN details')
  if (hasCreditCard && !hasIBAN) parts.push('payment card data')
  if (hasID && !hasSSN && !hasPassport) parts.push('national identification numbers')
  if (hasPerson)     parts.push('full names')
  if (hasDOB)        parts.push('dates of birth')
  if (hasAddress)    parts.push('home addresses')
  if (hasEmail && hasPhone) parts.push('contact details')
  else if (hasEmail) parts.push('email addresses')
  else if (hasPhone) parts.push('phone numbers')

  // Compose the lead sentence
  let lead: string
  if (parts.length === 1) {
    lead = `This document contained ${parts[0]}`
  } else if (parts.length === 2) {
    lead = `This document contained ${parts[0]} and ${parts[1]}`
  } else {
    lead = `This document contained ${parts[0]}, alongside ${parts.slice(1, -1).join(', ')} and ${parts[parts.length - 1]}`
  }

  const count = enabled.length
  const isClean = !residualRisk || residualRisk === 'clean' || residualRisk === 'low'

  const outcome = isClean
    ? `All ${count} item${count !== 1 ? 's' : ''} permanently redacted. The text layer has been destroyed and replaced with flat images, so no data can be extracted, copied, or recovered without your .key file.`
    : `${count} item${count !== 1 ? 's' : ''} redacted. Review any unselected detections before sharing.`

  return `${lead}. ${outcome}`
}
