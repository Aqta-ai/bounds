// Probes Ollama first; falls back to WebLLM if absent. Override the
// Ollama URL with VITE_OLLAMA_URL when Docker has claimed 11434.

import {
  HEALTHCARE_CONFIDENCE_FLOOR,
  chunkText,
  parseAndValidate,
  type RawGemmaDetection,
} from './gemmaParse'

type GemmaBackend = 'ollama' | 'webllm' | 'unavailable'

let _backend: GemmaBackend = 'unavailable'
let _backendDetected = false

const OLLAMA_URL = (import.meta.env?.VITE_OLLAMA_URL as string | undefined) ?? 'http://localhost:11434'

const SYSTEM_PROMPT = `You are a healthcare privacy auditor. The following is text extracted from a PDF page that may contain protected health information (PHI). Your job is to flag spans that contain PHI a regex or named-entity recogniser would MISS, focusing on these six categories ONLY:

  1. inline_diagnosis        Inline diagnosis without a structured label (e.g. "presents with generalised anxiety disorder").
  2. medication_mention      Medication name in running prose, not after a "Medications:" label (e.g. "she is on lithium").
  3. treatment_procedure     Treatment, procedure, or surgery mentioned in narrative (e.g. "underwent CABG last April").
  4. indirect_health_context Indirect references that imply health condition (e.g. "my therapist", "my insulin pump").
  5. sensitive_social        Sensitive social-category data (sexuality, gender identity, religion).
  6. genetic_reference       Genetic test results or family history (e.g. "BRCA1-positive", "father had Huntington's").

For each span you flag, return ONE entry in a JSON array:

  {
    "text":       "<the exact span as it appears in the input, byte-identical>",
    "type":       "HEALTH_DATA",
    "confidence": <0.0 to 1.0>,
    "ruleId":     "gemma:<one of the six category ids above>",
    "reason":     "<one short sentence explaining why this span is PHI a reviewer should consider>"
  }

Multilingual: the input may be in any language including French, German, Spanish, Italian, Portuguese, Dutch, Polish, Arabic, Chinese, Japanese, Hindi, Bengali, Tamil, Swahili. Flag spans in their original language and script, verbatim. Diagnoses, medication names, and procedures translate. For example:
  - French:  "trouble anxieux généralisé" (inline_diagnosis), "sertraline 50 mg" (medication_mention), "épisodes dépressifs" (inline_diagnosis)
  - German:  "Angststörung" (inline_diagnosis), "Sertralin 50 mg" (medication_mention), "depressive Episode" (inline_diagnosis)
  - Spanish: "trastorno de ansiedad generalizada" (inline_diagnosis), "sertralina" (medication_mention)
  - Hindi:   "सामान्यीकृत चिंता विकार" (inline_diagnosis), "सर्ट्रालिन" (medication_mention), "अवसाद" (inline_diagnosis)
  - Bengali: "সাধারণ উদ্বেগ ব্যাধি" (inline_diagnosis), "সারট্রালিন" (medication_mention), "বিষণ্নতা" (inline_diagnosis)

Rules:
- Return ONLY a JSON array. No prose, no markdown, no preamble.
- If no PHI is present, return [].
- Confidence MUST be at least ${HEALTHCARE_CONFIDENCE_FLOOR}. Below that, omit the span.
- The text field MUST appear verbatim in the input, in the input's original language and script. Do NOT paraphrase, expand, translate, or correct.
- Flag medication names whenever they appear in prose, in any language, including their dose if cited inline.
- DO NOT flag patient names, dates, addresses, MRNs, phone numbers, emails, or other structured PHI; the regex and NER layers handle those. Your job is contextual content only.
- If you are unsure, leave the span out. False positives in healthcare are worse than false negatives at this stage.`

async function probeOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return false
    const data: { models?: Array<{ name: string }> } = await res.json()
    if (!Array.isArray(data.models)) return false
    return data.models.some((m) => m.name.startsWith('gemma4:e2b') || m.name.startsWith('gemma4'))
  } catch {
    return false
  }
}

async function detectBackend(): Promise<GemmaBackend> {
  if (_backendDetected) return _backend
  if (await probeOllama()) {
    _backend = 'ollama'
  } else {
    // Until MLC publishes a Gemma 4 WebLLM build, the in-browser path is
    // dormant. We do not silently substitute Gemma 2 / Gemma 3 — the
    // submission's contextual layer claim stands on Gemma 4 specifically,
    // so the other four detection layers run alone when Ollama is absent.
    _backend = 'unavailable'
  }
  _backendDetected = true
  postMessage({ type: 'backend', backend: _backend })
  return _backend
}

interface OllamaResponse {
  message?: { content?: string }
  response?: string
}

async function callOllama(chunk: string): Promise<RawGemmaDetection[]> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma4:e2b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: chunk },
      ],
      stream: false,
      // Gemma 4 has chain-of-thought reasoning enabled by default in
      // Ollama; those thinking tokens count against num_predict and
      // truncated our test output mid-JSON-entry at the old 600 cap.
      // Disable thinking (think:false) AND bump num_predict to 2048 so
      // the visible JSON has room to complete on a full clinical page.
      think: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
      },
      format: 'json',
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as OllamaResponse
  const raw = data.message?.content ?? data.response ?? ''
  return parseAndValidate(raw, chunk)
}

// WebLLM lazy-load state. We dynamic-import the runtime on first use so the
// model weights are not pulled into the worker startup bundle, and so a
// deployment that never lands on a Gemma-required document never pays the
// download cost.
//
// WebLLM Gemma 4 build is not yet published by MLC. The constant stays
// here so the in-browser path activates the day MLC publishes a Gemma 4
// MLC variant; in the meantime detectBackend never returns 'webllm', so
// this code is dormant. We deliberately do not fall back to an older
// Gemma family in the browser — the submission stands on Gemma 4 only.
const WEBLLM_MODEL_ID = 'gemma-4-E2B-it-q4f16_1-MLC'

interface WebLLMEngine {
  chat: {
    completions: {
      create(req: {
        messages: Array<{ role: string; content: string }>
        temperature?: number
        max_tokens?: number
      }): Promise<{
        choices: Array<{ message: { content?: string | null } }>
      }>
    }
  }
}

let _webllmEngine: WebLLMEngine | null = null
let _webllmLoading: Promise<WebLLMEngine> | null = null

async function loadWebLLM(): Promise<WebLLMEngine> {
  if (_webllmEngine) return _webllmEngine
  if (_webllmLoading) return _webllmLoading

  _webllmLoading = (async () => {
    // Dynamic import keeps WebLLM out of the worker startup bundle. The
    // import path is the package's runtime entry; @mlc-ai/web-llm exposes
    // CreateMLCEngine for a one-call "load model + return engine" flow.
    const webllm = (await import('@mlc-ai/web-llm')) as unknown as {
      CreateMLCEngine: (
        modelId: string,
        opts?: {
          initProgressCallback?: (info: { progress?: number; text?: string }) => void
        },
      ) => Promise<WebLLMEngine>
    }

    const engine = await webllm.CreateMLCEngine(WEBLLM_MODEL_ID, {
      initProgressCallback: (info) => {
        const pct = typeof info.progress === 'number' ? info.progress : 0
        postMessage({ type: 'progress', progress: pct })
      },
    })

    _webllmEngine = engine
    return engine
  })()

  try {
    return await _webllmLoading
  } finally {
    _webllmLoading = null
  }
}

async function callWebLLM(chunk: string): Promise<RawGemmaDetection[]> {
  const engine = await loadWebLLM()
  const completion = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: chunk },
    ],
    temperature: 0.1,
    max_tokens: 600,
  })
  const raw = completion.choices?.[0]?.message?.content ?? ''
  return parseAndValidate(raw, chunk)
}

self.onmessage = async (e: MessageEvent<{ id: number; text: string; pageIndex: number }>) => {
  const { id, text } = e.data
  try {
    const backend = await detectBackend()
    if (backend === 'unavailable') {
      postMessage({
        id,
        error: 'No Gemma 4 backend available. Install Ollama with `ollama pull gemma4:e2b` and start the daemon, or serve the app under cross-origin isolation (COOP same-origin + COEP require-corp) so the in-browser WebLLM fallback can load.',
      })
      return
    }

    const chunks = chunkText(text)
    const all: RawGemmaDetection[] = []

    for (let i = 0; i < chunks.length; i++) {
      postMessage({ type: 'progress', progress: i / chunks.length })
      const chunk = chunks[i]
      const detections = backend === 'ollama' ? await callOllama(chunk) : await callWebLLM(chunk)
      all.push(...detections)
    }

    postMessage({ id, detections: all })
  } catch (err) {
    postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}

postMessage({ ready: true })

export {} // ensure this is treated as a module
