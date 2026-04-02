import type { Detection, Language, PiiType } from '../types'

// ---------------------------------------------------------------------------
// Pattern definitions
// Each pattern: { type, regex, confidence }
// ---------------------------------------------------------------------------

interface PatternDef {
  type: PiiType
  regex: RegExp
  confidence: number
  /** If false, the detection is visible in the review panel but unchecked by default. */
  defaultEnabled?: boolean
  /**
   * When set, use this capture group index as the matched text instead of match[0].
   * Use this to forward-match "Label: Value" and extract only the Value part,
   * avoiding variable-length lookbehinds which are unreliable in V8 for large alternations.
   */
  captureGroup?: number
  /** Human-readable rule name shown in the explainability panel, e.g. 'Email address'. */
  ruleName?: string
}

const UNIVERSAL_PATTERNS: PatternDef[] = [
  // IBAN — ISO 13616 (15–34 chars)
  {
    type: 'IBAN',
    regex: /\b[A-Z]{2}\d{2}[\s]?(?:[A-Z0-9]{4}[\s]?){1,7}[A-Z0-9]{1,4}\b/g,
    confidence: 0.99,
    ruleName: 'IBAN (bank account)',
  },
  // Email — standard RFC 5321 local part + domain; also covers mailto: links
  {
    type: 'EMAIL',
    regex: /(?:mailto:)?[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}(?=[^@A-Za-z0-9]|$)/g,
    confidence: 0.99,
    ruleName: 'Email address',
  },
  // Credit card — matches both compact (4111111111111111) and spaced/dashed (4111 1111 1111 1111)
  // Covers Visa (4), Mastercard (51-55), Amex (34/37), Discover (6011/65), UnionPay (2131/1800/35)
  {
    type: 'CREDIT_CARD',
    regex: /\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|3(?:0[0-5]|[68][0-9])[0-9]|6(?:011|5[0-9]{2})|(?:2131|1800|35[0-9]{2}))[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{3,4}\b/g,
    confidence: 0.98,
    ruleName: 'Credit card number',
  },
  // URLs — http/https/ftp or www-prefixed; strips trailing punctuation that is not part of the URL
  {
    type: 'URL',
    regex: /\b(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]*[^\s<>"{}|\\^`[\].,;!?)'"]|\bwww\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+(?:\/[^\s<>"{}|\\^`[\].,;!?)'"]*)?/g,
    confidence: 0.90,
    ruleName: 'URL / web address',
  },
  // IPv4
  {
    type: 'IP_ADDRESS',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.95,
    ruleName: 'IPv4 address',
  },
  // IPv6
  {
    type: 'IP_ADDRESS',
    regex: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    confidence: 0.95,
    ruleName: 'IPv6 address',
  },
  // Swiss AHV/AVS number — distinctive 756 prefix, covers dotted and spaced formats
  {
    type: 'SSN',
    regex: /\b756[\s.]?\d{4}[\s.]?\d{4}[\s.]?\d{2}\b/g,
    confidence: 0.99,
    ruleName: 'Swiss AHV/AVS number',
  },
  // Swiss company UID (CHE-XXX.XXX.XXX) — registered with SECO
  {
    type: 'ID_NUMBER',
    regex: /\bCHE[-\s]?\d{3}[.\s]?\d{3}[.\s]?\d{3}\b/g,
    confidence: 0.97,
    ruleName: 'Swiss company UID (CHE)',
  },
  // International phone — requires literal + prefix to avoid false positives on IDs/IBANs
  {
    type: 'PHONE',
    regex: /\+\d[\d\s.\-()/]{5,18}\d\b/g,
    confidence: 0.92,
    ruleName: 'International phone',
  },
  // European local phone — starts with 0 (not 00 international access), requires proper digit groups
  // e.g. 044 123 45 67, 079 555 01 72 — rejects single-digit table values and currency amounts
  {
    type: 'PHONE',
    regex: /(?<![€$£])(?<!(?:CHF|EUR|USD|GBP|Fr\.?)\s{0,3})\b0(?!0)\d{1,3}(?:[\s\-]\d{2,4}){2,4}(?!\.\d)(?!\s*(?:CHF|EUR|USD|GBP|Fr\.?))\b/g,
    confidence: 0.88,
    ruleName: 'Local phone number',
  },
  // Dates (DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, written months: Jan 01 1980)
  // defaultEnabled: false — invoice/service dates shouldn't be redacted by default;
  // the label-context DOB pattern handles true dates-of-birth at higher confidence.
  {
    type: 'DATE_OF_BIRTH',
    regex: /\b(?:\d{1,2}[./\-]\d{1,2}[./\-]\d{4}|\d{4}[.\-/]\d{2}[.\-/]\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi,
    confidence: 0.70,
    defaultEnabled: false,
  },
  // Passport numbers — most country formats: 1-2 uppercase letters + 6-9 digits
  // defaultEnabled: false — too many false positives on product codes / reference numbers;
  // the label-context passport pattern handles real passports at 0.94 confidence.
  {
    type: 'PASSPORT',
    regex: /\b[A-Z]{1,2}\d{6,9}\b/g,
    confidence: 0.72,
    defaultEnabled: false,
  },
  // Structured ID / insurance / medical record numbers with prefixes
  // e.g. INS-CH-550-229-104, MRN-001-234, POL-123456, BAG-CHE-XXX
  // Requires at least one digit in the body to avoid matching hyphenated English words
  // like NON-DISCLOSURE or TRADE-SECRET.
  {
    type: 'ID_NUMBER',
    regex: /\b[A-Z]{2,5}-(?:[A-Z]{2,4}-)?[A-Z]*\d[\dA-Z]*(?:-[\dA-Z]{2,})*\b/g,
    confidence: 0.85,
  },
  // Medical record numbers: MRN, MR, Patient ID followed by alphanumeric code
  {
    type: 'ID_NUMBER',
    regex: /\b(?:MRN|MR\.?|Patient\s+(?:ID|No\.?|Number))\s*[:\-]?\s*[A-Z0-9][\w\-]{2,15}\b/gi,
    confidence: 0.92,
  },
  // Titled person names: Dr., Prof., Mr., Mrs., Ms., Herr, Frau, Dott., Pt. (patient/provider abbrev)
  // Middle part allows initials (e.g. "N." in "Dr. N. Keller") via [A-Z][a-zA-Z.]*
  {
    type: 'PERSON',
    regex: /\b(?:Dr|Prof|Mr|Mrs|Ms|Herr|Frau|Dott|Dra|Pt)\.?\s+(?:[A-Z\u00C0-\u024F][a-zA-Z\u00C0-\u024F.]*\s+){0,2}[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+\b/g,
    confidence: 0.93,
  },
  // Salutation greeting: "Dear Marco Bianchi," / "Dear Ms. Smith,"
  // Matches the FULL "Dear [name]" string (no lookbehind) so findSpanBBox resolves
  // to the salutation line, not the first occurrence of the bare name on the page.
  // The comma lookahead keeps generic "Dear Customer," out — a comma after the name
  // is essentially mandatory in formal salutations.
  {
    type: 'PERSON',
    regex: /\bDear\s+(?:(?:Mr|Mrs|Ms|Dr|Prof|Herr|Frau|Sig|Mme)\.?\s+)?[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,25}(?:\s+[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,25})*(?=\s*,)/g,
    confidence: 0.93,
  },

  // ---------------------------------------------------------------------------
  // Standalone address patterns — no label required
  // Anchored on street-type keywords to keep false-positive rate low.
  // ---------------------------------------------------------------------------

  // DACH compound street names (DE/CH/AT): "Seestrasse 88", "Bahnhofstraße 12b", "Hauptplatz 3"
  // Street type is fused to the street name as a suffix (German morphology).
  {
    type: 'ADDRESS',
    regex: /\b[A-ZÄÖÜ][a-zäöüß]{2,30}(?:straße|strasse|gasse|weg|platz|allee|ring|damm|ufer|graben|chaussee|steig|pfad|berg|hof|markt|anger|zeile)\s+\d+[a-zA-Z]?\b/g,
    confidence: 0.88,
  },

  // Dutch/Belgian compound street names: "Keizersgracht 88", "Prinsenlaan 12"
  {
    type: 'ADDRESS',
    regex: /\b[A-Z][a-z]{2,30}(?:straat|laan|weg|plein|gracht|kade|dijk|singel|dreef|steenweg)\s+\d+[a-zA-Z]?\b/g,
    confidence: 0.87,
  },

  // Romance-language streets — keyword as separate word, number either side:
  //   FR: "Rue de la Paix 12", "12 Rue de la Paix"
  //   IT: "Via Roma 88", "Corso Vittorio 4"
  //   ES/PT: "Calle Mayor 88", "Rua Augusta 12"
  {
    type: 'ADDRESS',
    regex: /\b(?:\d+[a-zA-Z]?\s+)?(?:Rue|Avenue|Boulevard|All[eé]e|Place|Impasse|Chemin|Route|Via|Corso|Piazza|Viale|Vicolo|Calle|Avenida|Plaza|Paseo|Rua|Travessa)\s+(?:(?:de\s+(?:la\s+|le\s+|les\s+|l[ae]\s+)?|del(?:la|le|gli|gli)?\s+|des?\s+|du\s+|d[ou]\s+)\s*)?[A-ZÄÖÜ\u00C0-\u00D6\u00D8-\u00DE][A-Za-z\u00C0-\u024F\s]{1,35}(?:\s+\d+[a-zA-Z]?)?\b/g,
    confidence: 0.83,
  },

  // English number-first format: "88 Baker Street", "12 Downing Street", "221B Baker Street"
  {
    type: 'ADDRESS',
    regex: /\b\d+[a-zA-Z]?\s+[A-Z][a-zA-Z]{1,20}(?:\s+[A-Z][a-zA-Z]{1,20}){0,2}\s+(?:Street|Avenue|Road|Lane|Drive|Way|Place|Court|Close|Crescent|Terrace|Gardens|Broadway|Mews|Row|Walk|Green|Hill|Rise|Square|Circus|Grove|Vale|Mount|Park)\b/g,
    confidence: 0.85,
  },

  // Postcode + city + ISO country code — locale-independent, catches address continuation
  // lines like "6900 Lugano, CH" or "75001 Paris, FR" that appear below a label line.
  // 4-digit (CH/AT/BE/NL) and 5-digit (DE/FR/IT/ES) postcodes.
  {
    type: 'ADDRESS',
    regex: /\b[1-9]\d{3,4}\s+[A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F\s\-]{1,30},\s*[A-Z]{2}\b/g,
    confidence: 0.90,
  },
  // Address continuation: "2, 8001 Zürich, Switzerland" — house number + postcode + city + spelled-out country.
  // Fires when the street name is in a separate PDF span from the number and city/country tail.
  {
    type: 'ADDRESS',
    regex: /\b\d{1,5}[a-zA-Z]?,\s*[1-9]\d{3,4}\s+[A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F\-]{1,25}(?:,\s*[A-Z][a-zA-Z]{2,20})?\b/g,
    confidence: 0.85,
  },
  // Postcode + city alone on its own line (no ISO code): "8001 Zürich", "75001 Paris"
  // Negative lookahead rejects calendar years (19xx/20xx) used in education/work history
  {
    type: 'ADDRESS',
    regex: /\b(?!(?:19|20)\d{2}\b)[1-9]\d{3,4}\s+[A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F]{2,25}\b/g,
    confidence: 0.80,
  },
  // European ID card date of birth: DD.MM.YYYY with birth-year range 1900–2019.
  // This format (dot-separated day.month.year) is highly distinctive and almost
  // exclusively used for dates of birth on EU/CH identity documents.
  // Fallback for when the "DATE OF BIRTH" label and value are in separate PDF columns
  // and get interleaved with adjacent labels during text extraction.
  // defaultEnabled: false — standalone dates still too noisy even with year range filter.
  {
    type: 'DATE_OF_BIRTH',
    regex: /\b(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(19\d{2}|200\d|201\d)\b/g,
    confidence: 0.92,
    defaultEnabled: false,
    ruleName: 'Date of birth (DD.MM.YYYY)',
  },
]

// ---------------------------------------------------------------------------
// Label-context patterns
// Use lookbehind so only the VALUE after the field label is matched and redacted,
// not the label itself. These fire on form-style text like:
//   "Full name John Smith"  or  "Date of birth: 01.05.1980"
// ---------------------------------------------------------------------------

const LABEL_CONTEXT_PATTERNS: PatternDef[] = [
  // Person name after common field labels (case-insensitive so "Name:" and "name:" both match)
  // Value pattern allows: optional prefix abbrev (PT., Dr.), optional initials (A., N.),
  // then at least one full name component — covers "Lara Meier", "PT. A. Rossi", "N. Keller"
  // Keyword-based person label detection — instead of enumerating every label variant,
  // match any form field whose label CONTAINS a person-indicating keyword.
  // Handles "Name:", "Full name:", "Insured person:", "Policy holder:", "Patient name:",
  // "Attending physician:", "Referring doctor:", etc. automatically across all languages.
  //
  // Pattern: up to 3 prefix words + person-keyword + required colon/dash + captured name
  // captureGroup: 1 extracts only the name value, not the label.
  //
  // Keywords split into two patterns to avoid alternation explosion:
  //   (1) identity/role nouns: name, person, patient, holder, recipient, …
  //   (2) medical professional titles: physician, doctor, arzt, médecin, …
  {
    type: 'PERSON',
    regex: /\b(?:\w+\s+){0,3}(?:name|names|person|patient|holder|recipient|subscriber|insured|beneficiary|claimant|inhaber|empfänger|versicherte[rn]?|personne|assur[eé]e?|bénéficiaire|paziente|beneficiario|asegurado|titular)\s*[:\-]\s{0,10}((?:[A-Z\u00C0-\u024F]{1,3}\.\s+)?(?:[A-Z\u00C0-\u024F]\.\s+)*[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?(?:\s+[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?){0,2})/gi,
    captureGroup: 1,
    confidence: 0.96,
  },
  {
    type: 'PERSON',
    regex: /\b(?:\w+\s+){0,3}(?:physician|doctor|practitioner|provider|surgeon|specialist|consultant|arzt|ärztin|medico|médecin|soignant|dottore|médico|signature)\s*[:\-]\s{0,10}((?:[A-Z\u00C0-\u024F]{1,3}\.\s+)?(?:[A-Z\u00C0-\u024F]\.\s+)*[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?(?:\s+[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?){0,2})/gi,
    captureGroup: 1,
    confidence: 0.96,
  },
  // Emergency contact / next of kin / guardian — these labels never appear in prose so
  // "contact" alone is too broad; matching the full phrase is precise enough.
  {
    type: 'PERSON',
    regex: /\b(?:emergency\s+contact|next\s+of\s+kin|guardian|legal\s+guardian|authorised\s+representative|authorized\s+representative|notfallkontakt|personne\s+[àa]\s+contacter|contatto\s+d'emergenza|contacto\s+de\s+emergencia)\s*[:\-]\s{0,15}((?:[A-Z\u00C0-\u024F]{1,3}\.\s+)?(?:[A-Z\u00C0-\u024F]\.\s+)*[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?(?:\s+[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?){0,2})/gi,
    captureGroup: 1,
    confidence: 0.97,
    ruleName: 'Emergency contact name',
  },
  // No-colon fallback: handles PDFs where the colon is a visual separator not present in the text layer.
  // Strictly Title Case (no i flag) to avoid false positives on plain sentences.
  {
    type: 'PERSON',
    regex: /\b(?:\w+\s+){0,3}(?:person|patient|insured|name|holder|recipient|subscriber|beneficiary|claimant)\s{1,20}([A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?(?:\s+[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20}(?:-[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]{1,20})?){0,2})/g,
    captureGroup: 1,
    confidence: 0.88,
  },
  // Credit card after explicit label — catches spaced/dashed formats like "4111 1111 1111 1111"
  {
    type: 'CREDIT_CARD',
    regex: /(?<=(?:credit\s+card|card\s+(?:on\s+file|number|no\.?)|carte\s+(?:de\s+cr[eé]dit|bancaire)|tarjeta|kartennummer)\s*[:\-]?\s{0,10})[\d]{4}[- ]?[\d]{4}[- ]?[\d]{4}[- ]?[\d]{3,4}/gi,
    confidence: 0.97,
    ruleName: 'Credit card (labelled)',
  },
  // Date of birth after DOB label — matches all common date formats including ISO 8601
  //   DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY: "02.11.1958", "02/11/1958"
  //   YYYY-MM-DD (ISO 8601):                "1958-11-02"
  {
    type: 'DATE_OF_BIRTH',
    regex: /(?<=(?:date\s+of\s+birth|d\.?\s*o\.?\s*b\.?|birth\s+date|birthdate|born\s+on|born|date\s+de\s+naissance|geburtsdatum|data\s+di\s+nascita|fecha\s+de\s+nacimiento)\s*[:\-]?\s{0,20})(?:\d{4}[-\/\.]\d{2}[-\/\.]\d{2}|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/gi,
    confidence: 0.96,
  },
  // Insurance / policy / membership numbers after labels
  // NOTE: "insurance" and "ins" require an explicit keyword (no., number, #, id…) to avoid
  // matching the word that follows "insurance" in org names like "Insurance Office".
  {
    type: 'ID_NUMBER',
    regex: /(?<=(?:insurance\s*(?:no\.?|number|#|id|card|nr\.)|policy\s*(?:no\.?|number|#)?|ins\.?\s*(?:no\.?|number|#|nr\.)|membership\s*(?:no\.?|number|#)?|health\s+(?:plan|card)\s*(?:no\.?|id)?|coverage\s*(?:no\.?|number|#)?|assurance\s*(?:no\.?|number)|versicherungs(?:nummer|nr\.?)?|assicurazione\s*n\.?|n[oº]?\s+assur(?:ance)?)\s*[:\-]?\s{0,20})[A-Z0-9][\w.\-]{2,30}/gi,
    confidence: 0.96,
  },
  // Passport / travel document after explicit label
  {
    type: 'PASSPORT',
    regex: /(?<=(?:passport\s*(?:no\.?|number|#)?|travel\s+document\s*(?:no\.?|#)?|document\s*(?:no\.?|number|#|nr\.?)|doc\.?\s*(?:no\.?|number|#)|reisepass(?:nummer|nr\.?)?)\s*[:\-]?\s{0,20})[A-Z0-9][\w\-]{5,15}/gi,
    confidence: 0.97,
  },
  // National / government ID after label
  {
    type: 'ID_NUMBER',
    regex: /(?<=(?:(?:national\s+)?id(?:entity|entification)?\s*(?:no\.?|number|#|card)?|ausweis(?:nummer|nr\.?)?|carta\s+d'identit[àa]|dni|nie|permis\s+de\s+s[ée]jour\s*n\.?)\s*[:\-]?\s{0,20})[A-Z0-9][\w.\-]{4,25}/gi,
    confidence: 0.96,
  },
  // Postal address after a field label — handles:
  //   US/UK:        "88 Baker Street, London"  (number first)
  //   EU name-first: "Seestrasse 88, 8002 Zurich"  (DE/CH/AT/NL)
  //   FR/IT number-first: "12 Rue de la Paix, 75001 Paris"
  // Labels covered: EN / DE / FR / IT / ES / PT / NL
  {
    type: 'ADDRESS',
    regex: /(?<=(?:(?:home\s+|postal\s+|mailing\s+|billing\s+|shipping\s+|full\s+)?address|street|residence|domicile|wohnort|wohnanschrift|anschrift|postanschrift|lieferanschrift|rechnungsanschrift|adresse|adresse\s+postale|adresse\s+de\s+r[eé]sidence|indirizzo(?:\s+di\s+residenza)?|direcci[oó]n(?:\s+postal)?|domicilio|morada|endere[cç]o|adres|woonadres|postadres)\s*[:\-]?\s{0,20})(?:\d+[a-zA-Z]?\s+[A-Za-z\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F ,.\-]{4,80}|[A-Za-z\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F .\-]{2,50}\s*\d+[a-zA-Z]?(?:[,\s]+[A-Za-z0-9\u00C0-\u024F ,.\-]{2,50})?)/g,
    confidence: 0.95,
  },
  // Place of birth after label — catches "PLACE OF BIRTH Geneva" on ID cards
  {
    type: 'ADDRESS',
    regex: /\bPLACE\s+OF\s+BIRTH[\s\n]{1,20}([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\s\-]{1,30})\b/g,
    captureGroup: 1,
    confidence: 0.90,
    ruleName: 'ID card place of birth',
  },
  // ---------------------------------------------------------------------------
  // Swiss / EU ID card fields — ALL-CAPS labels without colon separator
  // e.g. "SURNAME FONTAINE" / "GIVEN NAMES Léa Marie" / "DATE OF BIRTH 04.07.1989"
  // captureGroup: 1 extracts only the value, not the label.
  // ---------------------------------------------------------------------------
  {
    type: 'PERSON',
    regex: /\bSURNAME[\s\n]{1,20}([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\-]{1,30}(?:\s+[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\-]{1,30})?)\b/g,
    captureGroup: 1,
    confidence: 0.97,
    ruleName: 'ID card surname',
  },
  {
    type: 'PERSON',
    regex: /\bGIVEN\s+NAMES?[\s\n]{1,20}([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\-]{1,30}(?:\s+[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\-]{1,30})*)/g,
    captureGroup: 1,
    confidence: 0.97,
    ruleName: 'ID card given names',
  },
  {
    type: 'DATE_OF_BIRTH',
    regex: /\bDATE\s+OF\s+BIRTH[\s\n]{1,20}(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})\b/g,
    captureGroup: 1,
    confidence: 0.98,
    defaultEnabled: true,
    ruleName: 'ID card date of birth',
  },
  // MRZ name line — ISO 7501 format: DOCTYPE+SURNAME<<GIVENNAME<GIVENNAME
  // Whole-line match (for redacting the MRZ zone itself)
  {
    type: 'PERSON',
    regex: /\b[A-Z]{1,2}[A-Z]{2,30}<<[A-Z<]{5,30}\b/g,
    confidence: 0.96,
    ruleName: 'MRZ name line',
  },
  // MRZ surname extraction — captures JUST the surname component so name propagation
  // can find and redact the surname wherever it appears in the main body text.
  // Format: [doc-type 1-2 chars][SURNAME]<<... → captureGroup 1 = SURNAME
  {
    type: 'PERSON',
    regex: /\b[A-Z]{1,2}([A-Z]{3,25})<<[A-Z<]{5,}\b/g,
    captureGroup: 1,
    confidence: 0.97,
    ruleName: 'MRZ surname extraction',
  },
  // MRZ given names extraction — captures first given name from MRZ
  // Format: SURNAME<<GIVENNAME<... → captureGroup 1 = GIVENNAME
  {
    type: 'PERSON',
    regex: /\b[A-Z]{2,30}<<([A-Z]{2,20})(?:<[A-Z<]*)?\b/g,
    captureGroup: 1,
    confidence: 0.95,
    ruleName: 'MRZ given name extraction',
  },
  // MRZ data line — document number + nationality + DOB + expiry + optional check digits
  {
    type: 'ID_NUMBER',
    regex: /\b[A-Z0-9]{8,12}[A-Z]{3}\d{6,7}[A-Z0-9<]{8,}\b/g,
    confidence: 0.93,
    ruleName: 'MRZ data line',
  },
]

// ---------------------------------------------------------------------------
// Health / clinical data triggers — defaultEnabled: false
// Detected and shown in the review panel but NOT checked by default so that
// direct identifiers are always redacted and clinical fields remain opt-in.
// Uses lookbehind to match only the value (not the label) in form-style text.
// ---------------------------------------------------------------------------

const HEALTH_TRIGGER_PATTERNS: PatternDef[] = [
  // ICD-10 / ICD-11 diagnostic codes (e.g. J18.9, I21.0, F32.1, Z12.11)
  // Pattern: letter in ICD chapter range + exactly 2 digits + optional decimal + 1-2 digits
  // defaultEnabled: true — diagnosis codes are highly sensitive health data that should
  // be redacted by default, particularly in mental health and clinical records.
  {
    type: 'HEALTH_DATA',
    regex: /\b[A-TV-Z]\d{2}(?:\.\d{1,2})?\b/g,
    confidence: 0.93,
    defaultEnabled: true,
  },
  // Diagnosis / reason for visit — up to 6 words after the label
  {
    type: 'HEALTH_DATA',
    regex: /(?<=(?:diagnosis|preliminary\s+diagnosis|admitting\s+diagnosis|discharge\s+diagnosis|reason\s+for\s+(?:visit|admission|consult(?:ation)?)|chief\s+complaint|presenting\s+(?:complaint|condition|problem)|motif\s+(?:de\s+)?(?:consultation|admission)|aufnahmegrund|aufnahmediagnose|motivo\s+(?:di\s+ricovero|de\s+ingreso|de\s+consulta))\s*[:\-]?\s{0,20})(?:\S+\s+){0,5}\S+/gi,
    confidence: 0.92,
    defaultEnabled: true,
  },
  // Current medications / prescriptions — up to 8 words (e.g. "Metoprolol 50mg twice daily")
  // defaultEnabled: true — prescriptions are among the most sensitive health data,
  // especially in mental health contexts (e.g. psychiatric medication, dosages).
  {
    type: 'HEALTH_DATA',
    regex: /(?<=(?:medications?|current\s+medications?|prescriptions?|current\s+treatment|medikamente|aktuelle\s+medikation|médicaments?\s+(?:actuels?|en\s+cours)|farmaci\s+(?:correnti|in\s+uso)|medicamentos?\s+actuales?)\s*[:\-]?\s{0,20})(?:\S+\s+){0,7}\S+/gi,
    confidence: 0.91,
    defaultEnabled: true,
  },
  // Known allergies — up to 5 words
  {
    type: 'HEALTH_DATA',
    regex: /(?<=(?:(?:known\s+|drug\s+|food\s+)?allergies?|allergi(?:es?|en)|allergie[s]?|allergien)\s*[:\-]?\s{0,20})(?:\S+\s+){0,4}\S+/gi,
    confidence: 0.92,
    defaultEnabled: false,
  },
  // Blood type / blood group
  {
    type: 'HEALTH_DATA',
    regex: /(?<=(?:blood\s+(?:type|group)|blutgruppe|groupe\s+sanguin|gruppo\s+sanguigno|grupo\s+sangu[íi]neo)\s*[:\-]?\s{0,10})[ABO]{1,2}[+-](?:\s*(?:pos(?:itive)?|neg(?:ative)?))?/gi,
    confidence: 0.92,
    defaultEnabled: false,
  },
]

// ---------------------------------------------------------------------------
// Sensitive content — non-PII markings, proprietary/IP language, legal clauses
// defaultEnabled: false — shown in review but unchecked by default
// ---------------------------------------------------------------------------

const SENSITIVE_CONTENT_PATTERNS: PatternDef[] = [
  // Document classification markings
  {
    type: 'CONFIDENTIAL',
    regex: /\b(?:STRICTLY\s+CONFIDENTIAL|HIGHLY\s+CONFIDENTIAL|CONFIDENTIAL|TOP\s+SECRET|SECRET|RESTRICTED|INTERNAL\s+USE\s+ONLY|FOR\s+INTERNAL\s+USE|NOT\s+FOR\s+DISTRIBUTION|DO\s+NOT\s+DISTRIBUTE|PRIVILEGED\s+AND\s+CONFIDENTIAL|DRAFT\s*[-–]\s*CONFIDENTIAL)\b/gi,
    confidence: 0.92,
    defaultEnabled: false,
  },
  // Proprietary / intellectual property markers
  {
    type: 'PROPRIETARY',
    regex: /\b(?:TRADE\s+SECRET[S]?|PROPRIETARY(?:\s+(?:INFORMATION|AND\s+CONFIDENTIAL))?|PATENT\s+PENDING|PATENT\s+APPLIED(?:\s+FOR)?|ALL\s+RIGHTS\s+RESERVED|INTELLECTUAL\s+PROPERTY|COMMERCIALLY\s+SENSITIVE)\b/gi,
    confidence: 0.88,
    defaultEnabled: false,
  },
  // Legal / privilege clauses
  {
    type: 'LEGAL_CLAUSE',
    regex: /\b(?:WITHOUT\s+PREJUDICE(?:\s+AND\s+SUBJECT\s+TO\s+CONTRACT)?|SUBJECT\s+TO\s+CONTRACT|NON[-\s]DISCLOSURE|ATTORNEY[-\s]CLIENT\s+PRIVILEGE[D]?|ATTORNEY\s+WORK\s+PRODUCT|FOR\s+SETTLEMENT\s+PURPOSES\s+ONLY|LEGAL\s+PROFESSIONAL\s+PRIVILEGE|LITIGATION\s+PRIVILEGE|WITHOUT\s+RECOURSE)\b/gi,
    confidence: 0.90,
    defaultEnabled: false,
  },
]

const LOCALE_PATTERNS: Record<Language, PatternDef[]> = {
  en: [
    // US SSN — area 001-899 (not 000 or 666), group 01-99 (not 00), serial 0001-9999 (not 0000)
    { type: 'SSN', regex: /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g, confidence: 0.95 },
    // UK NI number
    { type: 'ID_NUMBER', regex: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, confidence: 0.95 },
    // UK postcode
    { type: 'ADDRESS', regex: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi, confidence: 0.80 },
  ],
  de: [
    // German Sozialversicherungsnummer (12 digits)
    { type: 'SSN', regex: /\b\d{2}\s?\d{6}\s?[A-Z]\s?\d{3}\b/g, confidence: 0.92 },
    // German postcode + city: "10115 Berlin", "80331 München" — high confidence pair
    { type: 'ADDRESS', regex: /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]{2,25}(?:\s+[A-ZÄÖÜ][a-zäöüß]{2,20})?\b/g, confidence: 0.82 },
    // Swiss/Austrian postcode + city: "8002 Zürich", "1010 Wien", "3011 Bern"
    { type: 'ADDRESS', regex: /\b[1-9]\d{3}\s+[A-ZÄÖÜ][a-zäöüß]{2,25}\b/g, confidence: 0.80 },
    // Bare Swiss/Austrian postcode — opt-in fallback
    { type: 'ADDRESS', regex: /\b[1-9]\d{3}\b/g, confidence: 0.55, defaultEnabled: false },
    // German Steueridentifikationsnummer
    { type: 'ID_NUMBER', regex: /\b[1-9]\d{10}\b/g, confidence: 0.80 },
    // Swiss AHV/AVS number (756.XXXX.XXXX.XX)
    { type: 'SSN', regex: /\b756\.\d{4}\.\d{4}\.\d{2}\b/g, confidence: 0.99 },
    // Swiss AHV without dots (7560000000000)
    { type: 'SSN', regex: /\b756\d{10}\b/g, confidence: 0.97 },
    // Country code suffix often appearing after city in EU addresses: "8002 Zurich, CH"
    { type: 'ADDRESS', regex: /\b[1-9]\d{3}\s+[A-ZÄÖÜ][a-zäöüß]{2,25},\s*[A-Z]{2}\b/g, confidence: 0.90 },
  ],
  fr: [
    // French INSEE (NIR) number
    { type: 'SSN', regex: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, confidence: 0.93 },
    // French postcode + city: "75001 Paris", "69001 Lyon"
    { type: 'ADDRESS', regex: /\b(?:0[1-9]|[1-8]\d|9[0-5])\d{3}\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜ][a-zàâéèêëîïôùûü\-]{2,25}\b/g, confidence: 0.82 },
    // Belgian/Swiss/Luxembourg postcode + city: "1000 Bruxelles", "1200 Genève"
    { type: 'ADDRESS', regex: /\b[1-9]\d{3}\s+[A-ZÀÂÉÈÊËÎÏÔÙÛÜ][a-zàâéèêëîïôùûü\-]{2,25}\b/g, confidence: 0.78 },
    // Bare French postcode — opt-in fallback
    { type: 'ADDRESS', regex: /\b(?:0[1-9]|[1-8]\d|9[0-5])\d{3}\b/g, confidence: 0.60, defaultEnabled: false },
    // Swiss AHV/AVS number (also used in French-speaking Switzerland)
    { type: 'SSN', regex: /\b756\.\d{4}\.\d{4}\.\d{2}\b/g, confidence: 0.99 },
  ],
  it: [
    // Italian Codice Fiscale
    { type: 'ID_NUMBER', regex: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, confidence: 0.96 },
    // Italian CAP + city: "00100 Roma", "20121 Milano"
    { type: 'ADDRESS', regex: /\b\d{5}\s+[A-ZÀÈÉÌÍÎÒÓÙÚ][a-zàèéìíîòóùú\s]{2,25}\b/g, confidence: 0.80 },
    // Bare CAP — opt-in fallback
    { type: 'ADDRESS', regex: /\b\d{5}\b/g, confidence: 0.60, defaultEnabled: false },
    // Italian VAT (P.IVA)
    { type: 'ID_NUMBER', regex: /\b(?:IT\s?)?\d{11}\b/g, confidence: 0.75 },
  ],
  es: [
    // Spanish DNI/NIE
    { type: 'ID_NUMBER', regex: /\b(?:[0-9]{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/gi, confidence: 0.95 },
    // Spanish CP + city: "28013 Madrid", "08001 Barcelona"
    { type: 'ADDRESS', regex: /\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ\s]{2,25}\b/g, confidence: 0.82 },
    // Bare CP — opt-in fallback
    { type: 'ADDRESS', regex: /\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\b/g, confidence: 0.60, defaultEnabled: false },
    // Spanish Social Security (12 digits)
    { type: 'SSN', regex: /\b\d{2}[-\s]?\d{8}[-\s]?\d{2}\b/g, confidence: 0.85 },
  ],
  pt: [
    // Portuguese NIF (9 digits, starts 1-3 or 5-9)
    { type: 'ID_NUMBER', regex: /\b[1-3]\d{8}\b|\b[5-9]\d{8}\b/g, confidence: 0.85 },
    // Portuguese postcode: 1000-001
    { type: 'ADDRESS', regex: /\b\d{4}-\d{3}\b/g, confidence: 0.82 },
    // Portuguese NISS (social security): 11 digits
    { type: 'SSN', regex: /\b\d{11}\b/g, confidence: 0.70, defaultEnabled: false },
  ],
  nl: [
    // Dutch BSN (burgerservicenummer): 9 digits with 11-check — pattern only
    { type: 'ID_NUMBER', regex: /\b\d{9}\b/g, confidence: 0.72, defaultEnabled: false },
    // Dutch postcode: 1234 AB
    { type: 'ADDRESS', regex: /\b\d{4}\s?[A-Z]{2}\b/gi, confidence: 0.88 },
  ],
  pl: [
    // Polish PESEL: 11 digits
    { type: 'SSN', regex: /\b\d{11}\b/g, confidence: 0.75, defaultEnabled: false },
    // Polish NIP (tax): 10 digits, often written XXX-XXX-XX-XX
    { type: 'ID_NUMBER', regex: /\b\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}\b/g, confidence: 0.85 },
    // Polish postcode: 00-000
    { type: 'ADDRESS', regex: /\b\d{2}-\d{3}\b/g, confidence: 0.85 },
  ],
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exclusion helpers
// ---------------------------------------------------------------------------

// Medical scoring systems / code-system identifiers — these look like structured
// IDs but are NOT patient identifiers (e.g. "ICD-10", "PHQ-9", "GAD-7").
// Matched against the full detected text to prevent false ID_NUMBER detections.
const MEDICAL_SCALE_EXCLUSION = /^(?:ICD-(?:\d+(?:\.\d+)?|[IVX]+)|PHQ-\d+|GAD-\d+|DSM-(?:[IVX]+|\d+)|HAM-[AD]\d*|PCL-\d+|AUDIT-?\d*|CAGE(?:-AID)?|MADRS|PANSS|BPRS|MINI|Y-BOCS|OCI-R|SCID|MoCA|MMSE|GCS|NIHSS|APACHE-?\d*)$/i

let _idCounter = 0

export function resetRegexIdCounter(): void {
  _idCounter = 0
}

function makeId(): string {
  return `regex_${++_idCounter}`
}

function tokenLabel(type: PiiType, counters: Map<PiiType, number>): string {
  const n = (counters.get(type) ?? 0) + 1
  counters.set(type, n)
  return `[${type}_${String(n).padStart(3, '0')}]`
}

/**
 * Find all regex-based PII in a flat text string.
 * Returns detections WITHOUT bounding boxes — those are added later by PDFEngine.
 */
export function detectRegex(
  text: string,
  pageIndex: number,
  language: Language,
  tokenCounters: Map<PiiType, number>,
): Omit<Detection, 'boundingBox'>[] {
  const patterns = [...LABEL_CONTEXT_PATTERNS, ...(LOCALE_PATTERNS[language] ?? []), ...UNIVERSAL_PATTERNS, ...HEALTH_TRIGGER_PATTERNS, ...SENSITIVE_CONTENT_PATTERNS]
  const results: Omit<Detection, 'boundingBox'>[] = []
  // Maps dedup key → index in results, so a later high-priority pattern can upgrade
  // a defaultEnabled:false detection to defaultEnabled:true at the same position.
  const seenIdx = new Map<string, number>()

  for (const { type, regex, confidence, defaultEnabled = true, captureGroup, ruleName } of patterns) {
    // Reset regex lastIndex (global flag)
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const matchText = (captureGroup != null ? match[captureGroup] : match[0])?.trim() ?? ''
      if (matchText.length < 2) continue

      // Bug #1 fix: ID_NUMBER from label-context patterns can match purely-alphabetic
      // word fragments (e.g. "number" from "Policy number:", "ENTIAL" from a split
      // "CONFIDENTIAL"). Real policy/insurance/membership IDs always contain digits.
      if (type === 'ID_NUMBER' && !/\d/.test(matchText)) continue

      // Bug #2 fix: medical scoring system names (ICD-10, PHQ-9, GAD-7 …) are code
      // system identifiers, not patient IDs — exclude from ID_NUMBER detections.
      if (type === 'ID_NUMBER' && MEDICAL_SCALE_EXCLUSION.test(matchText)) continue

      // Address strings shorter than 4 chars are noise / OCR artefacts — skip.
      if (type === 'ADDRESS' && matchText.length < 4) continue

      // Deduplicate by position+text, not text alone — the same name can appear
      // multiple times on a page (e.g. "Name: Marco Bianchi" and "Dear Marco Bianchi,")
      // and each occurrence needs its own detection so all bounding boxes get redacted.
      const key = `${pageIndex}:${match.index}:${matchText}`
      const existingIdx = seenIdx.get(key)
      if (existingIdx !== undefined) {
        // A later higher-priority pattern can upgrade a defaultEnabled:false detection
        // to defaultEnabled:true (e.g. birth-year DOB pattern overriding the generic
        // date catch-all that has defaultEnabled:false).
        if (defaultEnabled && !results[existingIdx].enabled) {
          results[existingIdx] = { ...results[existingIdx], enabled: true, confidence: Math.max(results[existingIdx].confidence, confidence) }
        }
        continue
      }
      seenIdx.set(key, results.length)

      results.push({
        id: makeId(),
        type,
        text: matchText,
        token: tokenLabel(type, tokenCounters),
        pageIndex,
        confidence,
        source: 'REGEX',
        enabled: defaultEnabled,
        ruleId: ruleName ?? type.toLowerCase(),
      })
    }
  }

  // Bug #3 fix: IBAN digit-groups are re-matched as local phone numbers (e.g.
  // the "0483 5012 3456 7800" portion of "CH91 0483 5012 3456 7800 00").
  // Remove any PHONE detection whose normalised digit string is a substring of
  // an IBAN or CREDIT_CARD detection on the same page.
  const highValueDigits = new Set(
    results
      .filter((d) => d.type === 'IBAN' || d.type === 'CREDIT_CARD')
      .map((d) => d.text.replace(/\D/g, '')),
  )
  if (highValueDigits.size > 0) {
    return results.filter((d) => {
      if (d.type !== 'PHONE') return true
      const phoneDigits = d.text.replace(/\D/g, '')
      for (const ibanDigits of highValueDigits) {
        if (ibanDigits.includes(phoneDigits)) return false
      }
      return true
    })
  }

  return results
}

