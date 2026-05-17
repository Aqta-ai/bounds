import type { Detection, PiiType } from '../types'

// Main-thread facade for gemma.worker.ts.

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
// Cached once per worker lifetime so synchronous callers can read the
// settled backend without re-probing Ollama.
let _resolvedBackend: GemmaBackend | null = null

export function subscribeGemmaModelProgress(cb: (pct: number) => void): () => void {
  _modelProgressSubs.add(cb)
  return () => _modelProgressSubs.delete(cb)
}

export function subscribeGemmaBackend(cb: (backend: GemmaBackend) => void): () => void {
  _backendSubs.add(cb)
  if (_resolvedBackend !== null) {
    queueMicrotask(() => {
      if (_backendSubs.has(cb)) cb(_resolvedBackend!)
    })
  }
  return () => _backendSubs.delete(cb)
}

export function getGemmaBackend(): GemmaBackend | null {
  return _resolvedBackend
}

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
      // Clear _resolvedBackend on crash so the replacement worker re-probes
      // instead of routing through a dead reference.
      const err = new Error(`GemmaWorker crashed: ${e.message}`)
      for (const job of _pendingJobs.values()) {
        job.reject(err)
      }
      _pendingJobs.clear()
      _worker = null
      _resolvedBackend = null
    }
  }
  return _worker
}

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

export function cancelGemmaJob(jobId: number): void {
  _pendingJobs.delete(jobId)
}

export function disposeGemmaWorker(): void {
  if (_worker) {
    _worker.terminate()
    _worker = null
  }
  _pendingJobs.clear()
  _resolvedBackend = null
}

export function rawToDetection(raw: RawGemmaDetection, pageIndex: number, id: string, token: string): Detection {
  return {
    id,
    type: raw.type,
    text: raw.text,
    token,
    pageIndex,
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    confidence: raw.confidence,
    source: 'GEMMA',
    enabled: false,
    ruleId: raw.ruleId,
    reason: raw.reason,
  }
}
