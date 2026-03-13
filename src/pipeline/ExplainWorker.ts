import type { Detection } from '../types'
import { PII_TYPE_LABELS } from '../utils/colors'

// ---------------------------------------------------------------------------
// ExplainWorker — main-thread facade for the explain.worker.ts Web Worker.
// Uses Xenova/flan-t5-small (text2text-generation) to produce a plain-English
// privacy risk summary from the list of PII detections.
// ---------------------------------------------------------------------------

type Job = {
  resolve: (text: string) => void
  reject: (err: Error) => void
}

let _worker: Worker | null = null
let _jobCounter = 0
const _pendingJobs = new Map<number, Job>()

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('../workers/explain.worker.ts', import.meta.url), { type: 'module' })
    _worker.onmessage = (e: MessageEvent<{ id?: number; text?: string; error?: string; ready?: boolean }>) => {
      // Ignore model-loading notifications
      if (e.data.ready !== undefined) return
      const { id, text, error } = e.data
      if (id === undefined) return
      const job = _pendingJobs.get(id)
      if (!job) return
      _pendingJobs.delete(id)
      if (error) {
        job.reject(new Error(error))
      } else {
        job.resolve(text ?? '')
      }
    }
    _worker.onerror = () => {
      for (const job of _pendingJobs.values()) job.reject(new Error('Explain worker crashed'))
      _pendingJobs.clear()
      _worker = null
    }
  }
  return _worker
}

export function buildExplainPrompt(detections: Detection[]): string {
  const enabled = detections.filter((d) => d.enabled)
  if (enabled.length === 0) return ''

  // Tally counts by human-readable label
  const counts = new Map<string, number>()
  for (const d of enabled) {
    const label = PII_TYPE_LABELS[d.type]
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n} ${label.toLowerCase()}${n > 1 ? 's' : ''}`)
    .join(', ')

  return `Summarize the privacy risk in a document containing: ${items}. Write exactly one plain English sentence starting with "This document".`
}

export function generateSummary(detections: Detection[]): Promise<string> {
  const prompt = buildExplainPrompt(detections)
  if (!prompt) return Promise.resolve('')

  return new Promise((resolve, reject) => {
    const id = ++_jobCounter
    _pendingJobs.set(id, { resolve, reject })
    try {
      getWorker().postMessage({ id, prompt })
    } catch (err) {
      _pendingJobs.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}
