// Explain Web Worker — runs Xenova/flan-t5-small (text2text-generation) locally.
// Generates a plain-English privacy risk summary from a structured prompt.

import { pipeline, env } from '@xenova/transformers'

env.allowRemoteModels = true
env.allowLocalModels = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(env as any).backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(env as any).backends.onnx.wasm.numThreads = 1

type Text2TextPipeline = Awaited<ReturnType<typeof pipeline<'text2text-generation'>>>

let _pipe: Text2TextPipeline | null = null

async function loadPipeline(): Promise<Text2TextPipeline> {
  if (_pipe) return _pipe
  _pipe = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-77M', {
    progress_callback: (p: { status: string; progress?: number }) => {
      self.postMessage({ type: 'progress', status: p.status, progress: p.progress ?? 0 })
    },
  })
  self.postMessage({ ready: true })
  return _pipe
}

// Pre-load on worker startup so the model is cached by the time the user uploads a PDF
loadPipeline().catch((err: unknown) => {
  self.postMessage({ ready: false, error: String(err) })
})

self.onmessage = async (e: MessageEvent<{ id: number; prompt: string }>) => {
  const { id, prompt } = e.data
  try {
    const pipe = await loadPipeline()
    const result = await pipe(prompt, { max_new_tokens: 80 })
    const output = Array.isArray(result)
      ? String((result[0] as { generated_text?: unknown }).generated_text ?? '')
      : ''
    self.postMessage({ id, text: output })
  } catch (err: unknown) {
    self.postMessage({ id, error: String(err) })
  }
}
