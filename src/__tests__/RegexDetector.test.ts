import { describe, it, expect, beforeEach } from 'vitest'
import { detectRegex, resetRegexIdCounter } from '../pipeline/RegexDetector'
import type { PiiType } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function counters() {
  return new Map<PiiType, number>()
}

function detect(text: string, lang: Parameters<typeof detectRegex>[2] = 'en') {
  return detectRegex(text, 0, lang, counters()).map((d) => ({
    text: d.text,
    type: d.type,
    enabled: d.enabled,
    source: d.source,
    confidence: d.confidence,
  }))
}

function hasMatch(results: ReturnType<typeof detect>, type: PiiType, textIncludes: string) {
  return results.some((r) => r.type === type && r.text.includes(textIncludes))
}

beforeEach(() => resetRegexIdCounter())

// ---------------------------------------------------------------------------
// IBAN
// ---------------------------------------------------------------------------
describe('IBAN detection', () => {
  it('detects a standard CH IBAN', () => {
    expect(hasMatch(detect('Account: CH56 0480 5000 0012 3456 7'), 'IBAN', 'CH56')).toBe(true)
  })

  it('detects a DE IBAN', () => {
    expect(hasMatch(detect('IBAN: DE89 3704 0044 0532 0130 00'), 'IBAN', 'DE89')).toBe(true)
  })

  it('detects a GB IBAN', () => {
    expect(hasMatch(detect('IBAN GB29NWBK60161331926819'), 'IBAN', 'GB29')).toBe(true)
  })

  it('is enabled by default', () => {
    const match = detect('CH56 0480 5000 0012 3456 7').find((d) => d.type === 'IBAN')
    expect(match?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
describe('Email detection', () => {
  it('detects a plain email', () => {
    expect(hasMatch(detect('Contact john.doe@example.com for info'), 'EMAIL', 'john.doe@example.com')).toBe(true)
  })

  it('detects an email with + alias', () => {
    expect(hasMatch(detect('Email: alice+work@company.org'), 'EMAIL', 'alice+work@company.org')).toBe(true)
  })

  it('does not match a bare domain without @', () => {
    const r = detect('visit our website at example.com')
    expect(r.filter((d) => d.type === 'EMAIL')).toHaveLength(0)
  })

  it('is enabled by default', () => {
    const match = detect('a@b.com').find((d) => d.type === 'EMAIL')
    expect(match?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Credit card
// ---------------------------------------------------------------------------
describe('Credit card detection', () => {
  it('detects a Visa number', () => {
    expect(hasMatch(detect('Card: 4111111111111111'), 'CREDIT_CARD', '4111111111111111')).toBe(true)
  })

  it('detects a Mastercard number', () => {
    expect(hasMatch(detect('Card: 5500005555555559'), 'CREDIT_CARD', '5500005555555559')).toBe(true)
  })

  it('detects an Amex number', () => {
    expect(hasMatch(detect('Amex: 378282246310005'), 'CREDIT_CARD', '378282246310005')).toBe(true)
  })

  it('is enabled by default', () => {
    const match = detect('4111111111111111').find((d) => d.type === 'CREDIT_CARD')
    expect(match?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// US SSN (en locale)
// ---------------------------------------------------------------------------
describe('SSN detection (en)', () => {
  it('detects US SSN with dashes', () => {
    expect(hasMatch(detect('SSN: 123-45-6789'), 'SSN', '123-45-6789')).toBe(true)
  })

  it('detects US SSN with spaces', () => {
    expect(hasMatch(detect('Number 123 45 6789'), 'SSN', '123 45 6789')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Swiss AHV (de locale)
// ---------------------------------------------------------------------------
describe('Swiss AHV/AVS detection (de)', () => {
  it('detects dotted AHV format', () => {
    expect(hasMatch(detect('AHV: 756.1234.5678.90', 'de'), 'SSN', '756.1234.5678.90')).toBe(true)
  })

  it('detects compact AHV format', () => {
    expect(hasMatch(detect('AHV-Nr: 7561234567890', 'de'), 'SSN', '7561234567890')).toBe(true)
  })

  it('detects spaced AHV via universal pattern', () => {
    expect(hasMatch(detect('756 1234 5678 90', 'de'), 'SSN', '756')).toBe(true)
  })

  it('is enabled by default', () => {
    const match = detect('756.1234.5678.90', 'de').find((d) => d.type === 'SSN' && d.text.includes('756'))
    expect(match?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// IP address
// ---------------------------------------------------------------------------
describe('IP address detection', () => {
  it('detects IPv4', () => {
    expect(hasMatch(detect('Server 192.168.1.100 is down'), 'IP_ADDRESS', '192.168.1.100')).toBe(true)
  })

  it('detects max-value IPv4', () => {
    expect(hasMatch(detect('IP: 255.255.255.255'), 'IP_ADDRESS', '255.255.255.255')).toBe(true)
  })

  it('does not match an invalid IPv4 (octet > 255)', () => {
    // 999.168.1.1 — should not be matched as IP_ADDRESS
    const r = detect('server 999.168.1.1 online')
    expect(r.filter((d) => d.type === 'IP_ADDRESS' && d.text === '999.168.1.1')).toHaveLength(0)
  })

  it('detects IPv6', () => {
    expect(hasMatch(detect('addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334'), 'IP_ADDRESS', '2001')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------
describe('Phone detection', () => {
  it('detects international phone with + prefix', () => {
    expect(hasMatch(detect('Call +41 79 555 01 72'), 'PHONE', '+41')).toBe(true)
  })

  it('detects European local phone (044 format)', () => {
    expect(hasMatch(detect('Tel: 044 123 45 67'), 'PHONE', '044 123 45 67')).toBe(true)
  })

  it('detects Swiss mobile (079 format)', () => {
    expect(hasMatch(detect('Mobile: 079 555 01 72'), 'PHONE', '079')).toBe(true)
  })

  it('does not match currency amounts as phone (CHF 079 is not a phone)', () => {
    const r = detect('CHF 079.50')
    // Should not match as PHONE
    const phones = r.filter((d) => d.type === 'PHONE' && d.text.includes('079'))
    expect(phones).toHaveLength(0)
  })

  it('does not match international dialing prefix (00) as local phone', () => {
    const r = detect('Dial 0041 79 555 01 72')
    // 0041 starts with "00" — should not match local phone pattern
    const phones = r.filter((d) => d.type === 'PHONE' && d.text.startsWith('00'))
    expect(phones).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Date of birth
// ---------------------------------------------------------------------------
describe('Date of birth detection', () => {
  it('detects DD.MM.YYYY format (standalone, disabled by default)', () => {
    const r = detect('Born: 01.05.1980')
    const match = r.find((d) => d.type === 'DATE_OF_BIRTH' && d.text.includes('01.05.1980'))
    expect(match).toBeTruthy()
  })

  it('standalone date is disabled by default', () => {
    const match = detect('01.05.1980').find((d) => d.type === 'DATE_OF_BIRTH')
    // Should be found but defaultEnabled = false
    if (match) expect(match.enabled).toBe(false)
  })

  it('detects label-context DOB with higher confidence', () => {
    const r = detect('Date of birth: 23/04/1975')
    const match = r.find((d) => d.type === 'DATE_OF_BIRTH' && d.text.includes('23'))
    expect(match).toBeTruthy()
    expect(match!.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('label-context DOB is enabled by default', () => {
    const match = detect('Date of birth: 01.05.1980').find(
      (d) => d.type === 'DATE_OF_BIRTH' && d.confidence >= 0.9,
    )
    expect(match?.enabled).toBe(true)
  })

  it('detects YYYY-MM-DD ISO format', () => {
    expect(hasMatch(detect('Born 1975-04-23'), 'DATE_OF_BIRTH', '1975-04-23')).toBe(true)
  })

  it('detects written month format', () => {
    expect(hasMatch(detect('born 5 Mar 1990'), 'DATE_OF_BIRTH', 'Mar')).toBe(true)
  })

  it('detects German "Geburtsdatum" label', () => {
    const r = detect('Geburtsdatum: 12.08.1985', 'de')
    const match = r.find((d) => d.type === 'DATE_OF_BIRTH' && d.text.includes('12'))
    expect(match).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Passport
// ---------------------------------------------------------------------------
describe('Passport detection', () => {
  it('standalone passport pattern is disabled by default (noisy)', () => {
    // No label — standalone alphanumeric that looks like a passport number
    const match = detect('Reference A1234567 filed').find((d) => d.type === 'PASSPORT')
    if (match) expect(match.enabled).toBe(false)
  })

  it('detects passport after explicit label with higher confidence', () => {
    const r = detect('Passport No.: A1234567B')
    const match = r.find((d) => d.type === 'PASSPORT' && d.confidence >= 0.9)
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(true)
  })

  it('detects "Reisepass" label (German)', () => {
    const r = detect('Reisepass: C1234567', 'de')
    const match = r.find((d) => d.type === 'PASSPORT')
    expect(match).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Person / titled names
// ---------------------------------------------------------------------------
describe('Person / titled name detection', () => {
  it('detects "Dr. Jane Smith"', () => {
    expect(hasMatch(detect('Attending: Dr. Jane Smith'), 'PERSON', 'Dr')).toBe(true)
  })

  it('detects "Prof. Hans Müller"', () => {
    expect(hasMatch(detect('Signed by Prof. Hans Müller'), 'PERSON', 'Prof')).toBe(true)
  })

  it('detects "Mr. John Doe"', () => {
    expect(hasMatch(detect('Dear Mr. John Doe'), 'PERSON', 'Mr')).toBe(true)
  })

  it('detects label-context name (Full name: ...)', () => {
    const r = detect('Full name: Alice Meier')
    expect(hasMatch(r, 'PERSON', 'Alice')).toBe(true)
  })

  it('detects label-context name (Patient: ...)', () => {
    const r = detect('Patient: Marco Rossi')
    expect(hasMatch(r, 'PERSON', 'Marco')).toBe(true)
  })

  it('label-context person is enabled by default', () => {
    const match = detect('Full name: Alice Meier').find((d) => d.type === 'PERSON')
    expect(match?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Address (label-context)
// ---------------------------------------------------------------------------
describe('Address detection', () => {
  it('detects address after "Address:" label', () => {
    const r = detect('Address: 12 Main Street, Zurich')
    expect(hasMatch(r, 'ADDRESS', '12 Main')).toBe(true)
  })

  it('detects address after "Street:" label', () => {
    const r = detect('Street: 45 Oak Avenue')
    expect(hasMatch(r, 'ADDRESS', '45 Oak')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Health data — defaultEnabled: false
// ---------------------------------------------------------------------------
describe('Health data detection', () => {
  it('detects ICD-10 code and auto-enables it', () => {
    const match = detect('Diagnosis: J18.9').find((d) => d.type === 'HEALTH_DATA')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(true)
  })

  it('detects blood type but does NOT auto-enable it', () => {
    const match = detect('Blood type: A+').find((d) => d.type === 'HEALTH_DATA')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(false)
  })

  it('detects "Allergies:" label value', () => {
    const match = detect('Allergies: Penicillin').find((d) => d.type === 'HEALTH_DATA')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(false)
  })

  it('detects medications label value', () => {
    const match = detect('Medications: Metoprolol 50mg').find((d) => d.type === 'HEALTH_DATA')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(true)
  })

  it('detects diagnosis label value', () => {
    const match = detect('Diagnosis: Acute myocardial infarction').find((d) => d.type === 'HEALTH_DATA')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(true)
  })

  it('detects blood group (B-)', () => {
    const match = detect('Blood group: B-').find((d) => d.type === 'HEALTH_DATA')
    expect(match).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Confidential / proprietary / legal markers — defaultEnabled: false
// ---------------------------------------------------------------------------
describe('Sensitive content detection', () => {
  it('detects CONFIDENTIAL marker but does NOT auto-enable it', () => {
    const match = detect('STRICTLY CONFIDENTIAL').find((d) => d.type === 'CONFIDENTIAL')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(false)
  })

  it('detects TRADE SECRET but does NOT auto-enable it', () => {
    const match = detect('This document contains TRADE SECRETS.').find((d) => d.type === 'PROPRIETARY')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(false)
  })

  it('detects WITHOUT PREJUDICE', () => {
    const match = detect('WITHOUT PREJUDICE AND SUBJECT TO CONTRACT').find((d) => d.type === 'LEGAL_CLAUSE')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(false)
  })

  it('detects NON-DISCLOSURE', () => {
    const match = detect('NON-DISCLOSURE AGREEMENT').find((d) => d.type === 'LEGAL_CLAUSE')
    expect(match).toBeTruthy()
    expect(match!.enabled).toBe(false)
  })

  it('detects PATENT PENDING', () => {
    const match = detect('Patent Pending for this invention').find((d) => d.type === 'PROPRIETARY')
    expect(match).toBeTruthy()
  })

  it('detects INTERNAL USE ONLY', () => {
    const match = detect('INTERNAL USE ONLY').find((d) => d.type === 'CONFIDENTIAL')
    expect(match).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Locale-specific patterns
// ---------------------------------------------------------------------------
describe('Locale: German (de)', () => {
  it('detects German Sozialversicherungsnummer (12 digits)', () => {
    expect(hasMatch(detect('SV-Nr.: 65 070893 R 123', 'de'), 'SSN', '65')).toBe(true)
  })

  it('detects German Steueridentifikationsnummer (11 digits starting with 1-9)', () => {
    expect(hasMatch(detect('Steuer-ID: 86095742719', 'de'), 'ID_NUMBER', '86095742719')).toBe(true)
  })
})

describe('Locale: French (fr)', () => {
  it('detects French INSEE (NIR) number', () => {
    // INSEE: 1 55 02 75 116 068 91
    expect(hasMatch(detect('NIR: 1 55 02 75 116 068 91', 'fr'), 'SSN', '1 55')).toBe(true)
  })
})

describe('Locale: Italian (it)', () => {
  it('detects Italian Codice Fiscale', () => {
    expect(hasMatch(detect('CF: RSSMRA85M01H501Z', 'it'), 'ID_NUMBER', 'RSSMRA85M01H501Z')).toBe(true)
  })
})

describe('Locale: Spanish (es)', () => {
  it('detects Spanish DNI', () => {
    expect(hasMatch(detect('DNI: 12345678Z', 'es'), 'ID_NUMBER', '12345678Z')).toBe(true)
  })

  it('detects Spanish NIE', () => {
    expect(hasMatch(detect('NIE: X1234567L', 'es'), 'ID_NUMBER', 'X1234567L')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ID numbers
// ---------------------------------------------------------------------------
describe('ID number detection', () => {
  it('detects structured ID with prefix (INS-CH-XXX)', () => {
    expect(hasMatch(detect('ID: INS-CH-550-229-104'), 'ID_NUMBER', 'INS-CH')).toBe(true)
  })

  it('detects MRN pattern', () => {
    expect(hasMatch(detect('MRN: A1234567'), 'ID_NUMBER', 'A1234567')).toBe(true)
  })

  it('detects insurance number after label', () => {
    const r = detect('Insurance No. 123456789ABC')
    expect(hasMatch(r, 'ID_NUMBER', '123456789ABC')).toBe(true)
  })

  it('detects national ID after label', () => {
    const r = detect('National ID: AB12345678')
    expect(hasMatch(r, 'ID_NUMBER', 'AB12345678')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------
describe('Deduplication', () => {
  it('produces one detection per occurrence so every instance gets its own bbox', () => {
    // Each occurrence needs its own detection so both positions get a redaction box.
    const emails = detect('john.doe@example.com john.doe@example.com').filter(
      (d) => d.type === 'EMAIL' && d.text === 'john.doe@example.com',
    )
    expect(emails).toHaveLength(2)
  })

  it('does not deduplicate across different text values', () => {
    const emails = detect('alice@example.com bob@example.com').filter((d) => d.type === 'EMAIL')
    expect(emails).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Source tagging
// ---------------------------------------------------------------------------
describe('Source tagging', () => {
  it('marks all detections as REGEX source', () => {
    const r = detect('john.doe@example.com 123-45-6789')
    expect(r.every((d) => d.source === 'REGEX')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Token numbering and resetRegexIdCounter
// ---------------------------------------------------------------------------
describe('Token numbering', () => {
  it('token counter increments within a type', () => {
    const c = new Map<PiiType, number>()
    const r = detectRegex('a@x.com b@y.com', 0, 'en', c)
    const emails = r.filter((d) => d.type === 'EMAIL')
    expect(emails[0].token).toBe('[EMAIL_001]')
    expect(emails[1].token).toBe('[EMAIL_002]')
  })

  it('different types have independent counters', () => {
    const c = new Map<PiiType, number>()
    const r = detectRegex('a@x.com CH56 0480 5000 0012 3456 7', 0, 'en', c)
    const email = r.find((d) => d.type === 'EMAIL')
    const iban = r.find((d) => d.type === 'IBAN')
    expect(email?.token).toBe('[EMAIL_001]')
    expect(iban?.token).toBe('[IBAN_001]')
  })
})

// ---------------------------------------------------------------------------
// False positive avoidance
// ---------------------------------------------------------------------------
describe('False positive avoidance', () => {
  it('does not match 000-00-0000 as SSN (all-zero area/group/serial are invalid)', () => {
    const r = detect('Table ref 000-00-0000')
    expect(r.filter((d) => d.type === 'SSN')).toHaveLength(0)
  })

  it('does not match a bare domain as email', () => {
    const r = detect('See bounds.aqta.ai for details')
    expect(r.filter((d) => d.type === 'EMAIL')).toHaveLength(0)
  })

  it('does not match "Insurance Company Ltd" as an ID number', () => {
    // The word "insurance" alone (without no./number keyword) must not trigger ID_NUMBER
    const r = detect('Issued by Insurance Company Ltd on behalf of the patient')
    const ids = r.filter((d) => d.type === 'ID_NUMBER' && d.text.toLowerCase().includes('insurance company'))
    expect(ids).toHaveLength(0)
  })
})
