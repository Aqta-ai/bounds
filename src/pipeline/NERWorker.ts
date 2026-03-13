import type { Detection, Language, PiiType } from '../types'

// ---------------------------------------------------------------------------
// NERWorker — main-thread facade for the ner.worker.ts Web Worker.
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

// Types that are visible in the review panel but unchecked by default —
// too noisy or low-precision to redact without user confirmation.
const NER_DISABLED_BY_DEFAULT = new Set<PiiType>(['MISC', 'ORG'])

// Common false-positive PERSON entities from medical/insurance documents.
// The NER model (BERT multilingual) often mislabels date labels, visit types,
// and department names as PER — these are hard blocklist exclusions.
// These are form labels / greeting words — never a person's name.
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
])

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
  for (const raw of raws) {
    const type = nerLabelToPiiType(raw.type) ?? 'MISC'
    if (raw.confidence < 0.65) continue
    // Strip trailing punctuation before blocklist check so "Name:" matches "name"
    const normalised = raw.text.trim().toLowerCase().replace(/[:\-.,;]+$/, '')
    if (type === 'PERSON' && NOT_A_PERSON.has(normalised)) continue
    const n = (tokenCounters.get(type) ?? 0) + 1
    tokenCounters.set(type, n)
    const token = `[${type}_${String(n).padStart(3, '0')}]`
    results.push({
      id: `ner_${++_nerIdCounter}`,
      type,
      text: raw.text.trim(),
      token,
      pageIndex,
      confidence: raw.confidence,
      source: 'NER',
      enabled: !NER_DISABLED_BY_DEFAULT.has(type),
    })
  }
  return results
}
