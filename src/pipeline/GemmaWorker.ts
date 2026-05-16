import type { Detection, PiiType } from '../types'

// ---------------------------------------------------------------------------
// GemmaWorker, main-thread facade for the gemma.worker.ts Web Worker.
//
// Catches context-sensitive PHI that the regex / NER / OCR layers miss:
// inline diagnoses without a label, medication mentions in prose,
// indirect health context ("my insulin pump"), genetic data references,
// and other HIPAA Safe Harbor catch-all (item 17) candidates that have no
// stable surface pattern.
//
// Two execution paths:
//
//   1. Ollama at localhost:11434 (preferred for the demo audience and
//      production users who install it). Faster, better quality, smaller
//      browser footprint. Probed at startup; if reachable the worker uses
//      Ollama for all subsequent calls.
//
//   2. WebLLM with Gemma 4 E2B Instruct (fallback when Ollama is absent).
//      Loads model weights from the MLC CDN on first use, caches them in
//      browser storage. No additional install for the user but the first
//      call is slow.
//
// Privacy posture: page text never leaves the browser process or
// localhost:11434. Model weights are read-only fetches from a model CDN
// (one-off on first WebLLM use, never accompanied by document data).
// ---------------------------------------------------------------------------

interface GemmaJob {
  id: number
  text: string
  pageIndex: number
  resolve: (detections: RawGemmaDetection[]) => void
  reject: (err: Error) => void
}

export interface RawGemmaDetection {
  text: string
  type: PiiType
  confidence: number
  ruleId: string
  reason: string
}

export type GemmaBackend = 'ollama' | 'webllm' | 'unavailable'

let _worker: Worker | null = null
let _jobCounter = 0
const _pendingJobs = new Map<number, GemmaJob>()
const _modelProgressSubs = new Set<(pct: number) => void>()
const _backendSubs = new Set<(backend: GemmaBackend) => void>()
// Once the worker has reported a backend, hold it. The worker probes once
// per worker lifetime; a later run can synchronously call getGemmaBackend()
// to learn the cached state instead of waiting for a re-probe message.
let _resolvedBackend: GemmaBackend | null = null

/**
 * Subscribe to model-load progress (0..1). Returns an unsubscribe function.
 * Multiple concurrent runs can subscribe; legacy `setGemmaModelProgressCallback`
 * is kept for backwards compat and behaves as a single-slot subscription.
 */
export function subscribeGemmaModelProgress(cb: (pct: number) => void): () => void {
  _modelProgressSubs.add(cb)
  return () => _modelProgressSubs.delete(cb)
}

export function subscribeGemmaBackend(cb: (backend: GemmaBackend) => void): () => void {
  _backendSubs.add(cb)
  // Replay the cached backend immediately so a late subscriber learns the
  // already-resolved state without waiting for a re-probe.
  if (_resolvedBackend !== null) {
    queueMicrotask(() => {
      if (_backendSubs.has(cb)) cb(_resolvedBackend!)
    })
  }
  return () => _backendSubs.delete(cb)
}

/** Returns the cached backend if the worker has already probed, else null. */
export function getGemmaBackend(): GemmaBackend | null {
  return _resolvedBackend
}

// ---------------------------------------------------------------------------
// Legacy single-slot APIs. Kept so existing callers (and tests) keep working.
// New code should prefer subscribeGemmaBackend / subscribeGemmaModelProgress.
// ---------------------------------------------------------------------------
let _modelProgressLegacy: ((pct: number) => void) | null = null
let _backendLegacy: ((backend: GemmaBackend) => void) | null = null

export function setGemmaModelProgressCallback(cb: ((pct: number) => void) | null): void {
  if (_modelProgressLegacy) _modelProgressSubs.delete(_modelProgressLegacy)
  _modelProgressLegacy = cb
  if (cb) _modelProgressSubs.add(cb)
}

export function setGemmaBackendCallback(cb: ((backend: GemmaBackend) => void) | null): void {
  if (_backendLegacy) _backendSubs.delete(_backendLegacy)
  _backendLegacy = cb
  if (cb) {
    _backendSubs.add(cb)
    if (_resolvedBackend !== null) queueMicrotask(() => cb(_resolvedBackend!))
  }
}

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('../workers/gemma.worker.ts', import.meta.url), { type: 'module' })
    _worker.onmessage = (e: MessageEvent<{
      id?: number
      detections?: RawGemmaDetection[]
      error?: string
      ready?: boolean
      type?: string
      progress?: number
      backend?: GemmaBackend
    }>) => {
      if (e.data.type === 'progress') {
        const pct = e.data.progress ?? 0
        for (const sub of _modelProgressSubs) sub(pct)
        return
      }
      if (e.data.type === 'backend') {
        const backend = e.data.backend ?? 'unavailable'
        // Cache the first backend resolution; ignore subsequent duplicates
        // so a late race message cannot overwrite the settled value.
        if (_resolvedBackend === null) _resolvedBackend = backend
        for (const sub of _backendSubs) sub(_resolvedBackend)
        return
      }
      if (e.data.ready) return

      const id = e.data.id
      if (typeof id !== 'number') return
      const job = _pendingJobs.get(id)
      if (!job) return
      _pendingJobs.delete(id)

      if (e.data.error) {
        job.reject(new Error(e.data.error))
        return
      }
      job.resolve(e.data.detections ?? [])
    }
    _worker.onerror = (e: ErrorEvent) => {
      // Reject all pending jobs on worker crash.
      const err = new Error(`GemmaWorker crashed: ${e.message}`)
      for (const job of _pendingJobs.values()) {
        job.reject(err)
      }
      _pendingJobs.clear()
      _worker = null
    }
  }
  return _worker
}

/**
 * Run Gemma 4 health-PHI detection over a page's extracted text.
 *
 * Caller responsibility:
 *  - Pass clean per-page text (already extracted, regex-stripped of high-
 *    confidence matches to avoid sending duplicate work to the model).
 *  - Chunk pages longer than 1800 characters before calling; the worker
 *    re-chunks at 800-char paragraph boundaries internally but a very
 *    large page increases hallucination surface area.
 *
 * Returns RawGemmaDetection candidates with confidence already filtered
 * to >= 0.75 (the healthcare floor; raise via setGemmaConfidenceFloor if
 * a more conservative deployment is needed).
 *
 * Returns the job id alongside the promise so callers that need a timeout
 * can call cancelGemmaJob(id) to drop the pending job and prevent the
 * worker reply from being mis-routed to a new caller that reuses the
 * same job map slot.
 */
export interface GemmaJobHandle {
  jobId: number
  result: Promise<RawGemmaDetection[]>
}

export function detectHealthPhi(text: string, pageIndex: number): Promise<RawGemmaDetection[]> {
  return startGemmaJob(text, pageIndex).result
}

export function startGemmaJob(text: string, pageIndex: number): GemmaJobHandle {
  const id = ++_jobCounter
  const result = new Promise<RawGemmaDetection[]>((resolve, reject) => {
    const job: GemmaJob = { id, text, pageIndex, resolve, reject }
    _pendingJobs.set(id, job)
    getWorker().postMessage({ id, text, pageIndex })
  })
  return { jobId: id, result }
}

/**
 * Drop a pending job so a late worker reply is discarded silently rather
 * than being routed to a stale resolver. Safe to call on a job that has
 * already settled (no-op).
 */
export function cancelGemmaJob(jobId: number): void {
  _pendingJobs.delete(jobId)
}

/** Tear down the worker. Used by tests and on unmount. */
export function disposeGemmaWorker(): void {
  if (_worker) {
    _worker.terminate()
    _worker = null
  }
  _pendingJobs.clear()
  _resolvedBackend = null
}

/**
 * Convert raw Gemma detections to typed Detection records ready for
 * RedactionPipeline merging. The caller still needs to resolve bounding
 * boxes via findSpanBBox, generate the redaction token, and de-duplicate
 * against existing regex/NER detections at >= 0.90 confidence.
 *
 * Detections are emitted with source='GEMMA' and enabled=false so they
 * appear unchecked in the review panel (the user opts in per item).
 */
export function rawToDetection(raw: RawGemmaDetection, pageIndex: number, id: string, token: string): Detection {
  return {
    id,
    type: raw.type,
    text: raw.text,
    token,
    pageIndex,
    boundingBox: { x: 0, y: 0, width: 0, height: 0 }, // resolved later
    confidence: raw.confidence,
    source: 'GEMMA',
    enabled: false,
    ruleId: raw.ruleId,
    reason: raw.reason,
  }
}
