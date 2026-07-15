import type { Detection, Language, PiiType } from '../types'

// ---------------------------------------------------------------------------
// NERWorker - main-thread facade for the ner.worker.ts Web Worker.
// Manages a single Worker instance and queues jobs.
// ---------------------------------------------------------------------------

interface NERJob {
  id: number
  text: string
  pageIndex: number
  language: Language
  resolve: (detections: RawNERDetection[]) => void
  reject: (err: Error) => void
}

export interface RawNERDetection {
  text: string
  type: PiiType
  confidence: number
  start: number
  end: number
}

let _worker: Worker | null = null
let _jobCounter = 0
const _pendingJobs = new Map<number, NERJob>()
let _modelProgressCallback: ((pct: number) => void) | null = null

export function setNERModelProgressCallback(cb: ((pct: number) => void) | null): void {
  _modelProgressCallback = cb
}

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('../workers/ner.worker.ts', import.meta.url), { type: 'module' })
    _worker.onmessage = (e: MessageEvent<{ id: number; detections?: RawNERDetection[]; error?: string; ready?: boolean; type?: string; progress?: number }>) => {
      if (e.data.type === 'progress') {
        _modelProgressCallback?.(e.data.progress ?? 0)
        return
      }
      const { id, detections, error } = e.data
      if (e.data.ready) return // model loaded notification

      const job = _pendingJobs.get(id)
      if (!job) return
      _pendingJobs.delete(id)

      if (error) {
        job.reject(new Error(error))
      } else {
        job.resolve(detections ?? [])
      }
    }
    _worker.onerror = (e) => {
      // Reject all pending jobs on worker crash
      for (const job of _pendingJobs.values()) {
        job.reject(new Error(e.message))
      }
      _pendingJobs.clear()
      _worker = null
    }
  }
  return _worker
}

export function detectNER(
  text: string,
  pageIndex: number,
  language: Language,
): Promise<RawNERDetection[]> {
  return new Promise((resolve, reject) => {
    const id = ++_jobCounter
    const job: NERJob = { id, text, pageIndex, language, resolve, reject }
    _pendingJobs.set(id, job)
    try {
      getWorker().postMessage({ id, text, language })
    } catch (err) {
      _pendingJobs.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export function terminateNERWorker(): void {
  _worker?.terminate()
  _worker = null
  _pendingJobs.clear()
}

// Map HuggingFace entity labels → PiiType
export function nerLabelToPiiType(label: string): PiiType | null {
  const l = label.toUpperCase().replace(/^[BI]-/, '')
  if (l === 'PER' || l === 'PERSON') return 'PERSON'
  if (l === 'LOC' || l === 'LOCATION') return 'ADDRESS'
  if (l === 'ORG') return 'ORG'
  if (l === 'MISC') return 'MISC'
  return null
}

// Types that are visible in the review panel but unchecked by default -
// too noisy or low-precision to redact without user confirmation.
const NER_DISABLED_BY_DEFAULT = new Set<PiiType>(['MISC', 'ORG'])

// Common false-positive PERSON entities from medical/insurance documents.
// The NER model (BERT multilingual) often mislabels date labels, visit types,
// and department names as PER - these are hard blocklist exclusions.
// These are form labels / greeting words - never a person's name.
// The actual name that follows them is caught by LABEL_CONTEXT_PATTERNS (regex)
// or the salutation pattern, not by NER.
const NOT_A_PERSON = new Set([
  // greeting triggers
  'dear', 'to', 'attn', 'attention',
  // form field labels
  'name', 'full name', 'patient name', 'insured person', 'recipient',
  'first name', 'last name', 'surname', 'forename',
  // clinical / admin labels
  'visit date', 'visit type', 'date', 'date of birth', 'dob',
  'department', 'diagnosis', 'outpatient', 'inpatient',
  'referring physician', 'coverage', 'policy', 'claim', 'claim no',
  'insurance', 'supplemental', 'national id', 'address', 'phone',
  // ID card field labels (Swiss/EU) - all-caps labels that NER may misclassify as PER
  'ahv', 'avs', 'ahv/avs', 'avs/ahv', 'valid until', 'place of birth',
  'nationality', 'document no', 'document no.', 'given names', 'given name',
  'date of birth', 'identity card', 'carte d\'identité', 'ausweiskarte',
])

// ID card label prefixes - NER sometimes captures label text + name as one span.
// If a PERSON detection starts with one of these uppercase keywords, strip the prefix.
// Matches "VALID UNTIL NA Léa Marie" → extract "Léa Marie" if pattern found.
const ID_LABEL_PREFIX_RE = /^(?:VALID\s+UNTIL|PLACE\s+OF\s+BIRTH|DATE\s+OF\s+BIRTH|GIVEN\s+NAMES?|SURNAME|NATIONALITY|AHV|AVS|DOCUMENT\s+NO\.?|NA|NO\.?)\s+/i

// Leading honorifics that BERT sometimes folds into the PER span (e.g. it captured
// "Dr Michael Byrne The" as one entity in live testing). Stripped conservatively -
// the titled name itself is also caught by the regex detector's titled-person rule.
const PERSON_TITLE_PREFIX_RE = /^(?:Dr|Prof|Mr|Mrs|Ms|Miss|Mx|Herr|Frau|Dott|Dra|Dre|Pt|Sig|Mme)\.?\s+/i

// Trailing non-name words NER over-captures from the following sentence - articles,
// determiners and prepositions that can never be part of a surname. Only these known
// stopwords are stripped, so real particles (de, van, von, O', Mc, Mac) are preserved.
const TRAILING_STOPWORD_RE = /\s+(?:The|A|An|Of|And|Or|To|For|In|On|At|With|By)$/

// Name-particle tokens that legitimately sit between two split PERSON spans. The BERT
// tokeniser breaks "O'Donnell", "Mc Donald" and "van der Berg" across separate spans,
// so a run separated only by one of these (or by whitespace / apostrophe / hyphen)
// is re-joined into a single detection.
const NAME_PARTICLE = new Set([
  'o', 'mc', 'mac', 'de', 'del', 'della', 'da', 'di', 'van', 'von',
  'der', 'den', 'le', 'la', 'du', 'st', 'san', 'santa', 'd',
])

// Max char gap between two adjacent PERSON spans still treated as the same name.
// Covers a single space, apostrophe or hyphen, or "O " + "' Brien" style splits.
const PERSON_MERGE_MAX_GAP = 3

function isPersonLabel(label: string): boolean {
  return nerLabelToPiiType(label) === 'PERSON'
}

// Reconstruct the joined surface form when the worker did not supply the source text
// (unit-test path). With source text present, mergePersonSpans slices the original
// instead, which is always exact.
function joinPersonText(a: string, b: string, gap: number): string {
  if (b.startsWith("'") || b.startsWith('’')) return a + b
  if (a.endsWith("'") || a.endsWith('’')) return a + b
  if (gap <= 0) return a + b
  return a + ' ' + b
}

// Decide whether span `b` continues the name in span `a`. Uses the exact characters
// between the two spans when source text is available; otherwise falls back to the
// char-offset gap plus a name-particle check.
function canJoinPersonSpans(a: RawNERDetection, b: RawNERDetection, sourceText?: string): boolean {
  const gap = b.start - a.end
  if (gap < 0) return false // overlapping / out of order - leave alone
  if (sourceText != null) {
    const between = sourceText.slice(a.end, b.start)
    // Only whitespace, apostrophe or hyphen may separate two halves of one name.
    if (!/^[\s'’-]*$/.test(between)) return false
    return between.length <= PERSON_MERGE_MAX_GAP
  }
  if (gap === 0) return true
  if (gap > PERSON_MERGE_MAX_GAP) return false
  const aLast = a.text.split(/\s+/).pop()?.toLowerCase().replace(/['’.]/g, '') ?? ''
  const bFirst = b.text.split(/\s+/)[0]?.toLowerCase().replace(/['’.]/g, '') ?? ''
  // A one-char gap is a plain space between name tokens; wider gaps must be a particle.
  if (gap === 1) return true
  return NAME_PARTICLE.has(aLast) || NAME_PARTICLE.has(bFirst)
}

// Join adjacent PERSON spans that the tokeniser split apart (apostrophe / Mc / Mac /
// O' / de / van names) back into one detection. Preserves char offsets so downstream
// bbox resolution stays correct. Non-PERSON spans pass through untouched.
export function mergePersonSpans(raws: RawNERDetection[], sourceText?: string): RawNERDetection[] {
  if (raws.length < 2) return raws
  const sorted = [...raws].sort((x, y) => x.start - y.start)
  const out: RawNERDetection[] = []
  for (const raw of sorted) {
    const prev = out[out.length - 1]
    if (
      prev &&
      isPersonLabel(prev.type) &&
      isPersonLabel(raw.type) &&
      canJoinPersonSpans(prev, raw, sourceText)
    ) {
      const start = prev.start
      const end = Math.max(prev.end, raw.end)
      const text = sourceText != null
        ? sourceText.slice(start, end)
        : joinPersonText(prev.text, raw.text, raw.start - prev.end)
      out[out.length - 1] = {
        text,
        type: prev.type,
        confidence: Math.min(prev.confidence, raw.confidence),
        start,
        end,
      }
    } else {
      out.push({ ...raw })
    }
  }
  return out
}

// Build Detection objects from raw NER results (without bboxes yet)
let _nerIdCounter = 0

export function resetNerIdCounter(): void {
  _nerIdCounter = 0
}

export function buildNERDetections(
  raws: RawNERDetection[],
  pageIndex: number,
  tokenCounters: Map<PiiType, number>,
): Omit<Detection, 'boundingBox'>[] {
  const results: Omit<Detection, 'boundingBox'>[] = []
  // Re-join name spans the tokeniser split apart (e.g. "Sarah" + "O'Donnell") before
  // any per-span processing. Idempotent, so it is safe even when the worker already
  // merged using the source text.
  const mergedRaws = mergePersonSpans(raws)
  for (const raw of mergedRaws) {
    const type = nerLabelToPiiType(raw.type) ?? 'MISC'
    if (raw.confidence < 0.65) continue
    // Strip trailing punctuation before blocklist check so "Name:" matches "name"
    let text = raw.text.trim()
    // Strip ID card label prefixes that NER sometimes captures as part of a name span
    // e.g. "VALID UNTIL NA Léa Marie" → "Léa Marie"
    if (type === 'PERSON') {
      let stripped = text.replace(ID_LABEL_PREFIX_RE, '')
      // Keep stripping until no more prefix is found (handles "VALID UNTIL NA Léa Marie")
      while (stripped !== text) { text = stripped; stripped = text.replace(ID_LABEL_PREFIX_RE, '') }
      text = text.trim()
      // Strip a leading honorific NER sometimes folds in ("Dr Michael Byrne" → "Michael Byrne")
      let titleStripped = text.replace(PERSON_TITLE_PREFIX_RE, '')
      while (titleStripped !== text && /\s/.test(titleStripped)) { text = titleStripped; titleStripped = text.replace(PERSON_TITLE_PREFIX_RE, '') }
      text = text.trim()
      // Strip trailing field-label words that NER over-captures from adjacent columns
      // e.g. "Sophie Laurent Date" → "Sophie Laurent", "Jean Dubois No" → "Jean Dubois"
      text = text.replace(/\s+(?:Date|DOB|No\.?|Nr\.?|Id|Phone|Email|Address|Born|Signature|Patient|Name|Ref)\.?\s*$/i, '').trim()
      // Strip trailing bare digits or date fragments (e.g. "Marie 12" → "Marie")
      text = text.replace(/\s+\d[\d.\-\/]*$/, '').trim()
      // Strip a trailing article / determiner / preposition dragged in from the next
      // sentence ("Michael Byrne The" → "Michael Byrne"). Only when a multi-word name
      // remains, so a trailing initial like "Sammy A" is never eaten.
      let prevText = ''
      while (prevText !== text) {
        prevText = text
        const candidate = text.replace(TRAILING_STOPWORD_RE, '').trim()
        if (candidate !== text && /\s/.test(candidate)) text = candidate
      }
    }
    if (text.length < 2) continue
    const normalised = text.toLowerCase().replace(/[:\-.,;]+$/, '')
    if (type === 'PERSON' && NOT_A_PERSON.has(normalised)) continue
    const n = (tokenCounters.get(type) ?? 0) + 1
    tokenCounters.set(type, n)
    const token = `[${type}_${String(n).padStart(3, '0')}]`
    results.push({
      id: `ner_${++_nerIdCounter}`,
      type,
      text,
      token,
      pageIndex,
      confidence: raw.confidence,
      source: 'NER',
      enabled: !NER_DISABLED_BY_DEFAULT.has(type),
      ruleId: 'ner_bert',
    })
  }
  return results
}
