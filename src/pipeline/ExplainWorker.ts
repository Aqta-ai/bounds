import type { Detection } from '../types'
import { PII_TYPE_LABELS } from '../utils/colors'
import { getGemmaBackend } from './GemmaWorker'
import { buildPrivacySummary } from '../utils/summaryUtils'

// ---------------------------------------------------------------------------
// ExplainWorker — generates a plain-English privacy summary for the audit
// log. Until v0.3.0 this called Xenova/LaMini-Flan-T5-77M in a Web Worker
// (~80 MB second model). Replaced with Gemma 4 via Ollama so the same
// model that flags contextual PHI also writes the summary: single
// dependency, one trust story. If Gemma is unavailable the deterministic
// buildPrivacySummary template carries the audit log.
// ---------------------------------------------------------------------------

const OLLAMA_URL = (import.meta.env?.VITE_OLLAMA_URL as string | undefined) ?? 'http://localhost:11434'

export function buildExplainPrompt(detections: Detection[]): string {
  const enabled = detections.filter((d) => d.enabled)
  if (enabled.length === 0) return ''

  const counts = new Map<string, number>()
  for (const d of enabled) {
    const label = PII_TYPE_LABELS[d.type]
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n} ${label.toLowerCase()}${n > 1 ? 's' : ''}`)
    .join(', ')

  return `Summarise in one plain sentence what personal data was found and redacted in a document containing: ${items}. Start with "This document". Do not list every category, give the gist in fewer than 25 words.`
}

async function summariseViaGemma(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4:e2b',
      messages: [
        { role: 'system', content: 'You write one-sentence plain-English summaries of redaction findings for a healthcare audit log. No preamble, no lists, no markdown.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 120 },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}`)
  const data = await res.json() as { message?: { content?: string }; response?: string }
  const text = (data.message?.content ?? data.response ?? '').trim()
  return text.split('\n')[0].trim()
}

export async function generateSummary(detections: Detection[]): Promise<string> {
  const prompt = buildExplainPrompt(detections)
  if (!prompt) return ''

  if (getGemmaBackend() === 'ollama') {
    try {
      return await summariseViaGemma(prompt)
    } catch {
      // Fall through to deterministic on any error.
    }
  }
  return buildPrivacySummary(detections)
}
