// NER Web Worker — runs @xenova/transformers BERT NER model in isolation.
// The model is downloaded once and cached in browser IndexedDB by Transformers.js.

import { pipeline, env } from '@xenova/transformers'

// Allow remote model downloads (cached after first load)
env.allowRemoteModels = true
env.allowLocalModels = false

type TokenClassificationPipeline = Awaited<ReturnType<typeof pipeline<'token-classification'>>>

let _nerPipeline: TokenClassificationPipeline | null = null

async function loadPipeline(): Promise<TokenClassificationPipeline> {
  if (_nerPipeline) return _nerPipeline
  _nerPipeline = await pipeline(
    'token-classification',
    'Xenova/bert-base-multilingual-cased-ner-hrl',
    {
      // @ts-expect-error aggregation_strategy is valid at runtime but missing from @xenova/transformers types
      aggregation_strategy: 'simple',
      progress_callback: (progress: { status: string; progress?: number }) => {
        self.postMessage({ type: 'progress', status: progress.status, progress: progress.progress ?? 0 })
      },
    },
  )
  self.postMessage({ ready: true })
  return _nerPipeline
}

// Pre-load on worker startup
loadPipeline().catch((err: unknown) => {
  self.postMessage({ ready: false, error: String(err) })
})

self.onmessage = async (e: MessageEvent<{ id: number; text: string; language: string }>) => {
  const { id, text } = e.data
  try {
    const nerPipeline = await loadPipeline()
    // Chunk text at word boundaries to stay within BERT's 512-token limit (~1800 chars safe).
    // Track each chunk's start offset in the original string for correct entity positions.
    const chunks = chunkText(text, 1800)
    const allEntities: {
      entity_group: string
      score: number
      word: string
      start: number
      end: number
    }[] = []
    for (const { text: chunkStr, startOffset } of chunks) {
      // @ts-expect-error aggregation_strategy is valid at runtime but missing from @xenova/transformers types
      const result = await nerPipeline(chunkStr, { aggregation_strategy: 'simple' })
      const entities = Array.isArray(result) ? result : [result]
      for (const ent of entities) {
        if (ent && typeof ent === 'object' && 'entity_group' in ent) {
          allEntities.push({
            entity_group: String((ent as { entity_group: unknown }).entity_group),
            score: Number((ent as { score: unknown }).score ?? 0),
            word: String((ent as { word: unknown }).word ?? ''),
            start: Number((ent as { start: unknown }).start ?? 0) + startOffset,
            end: Number((ent as { end: unknown }).end ?? 0) + startOffset,
          })
        }
      }
    }
    const detections = allEntities.map((ent) => ({
      text: ent.word,
      type: ent.entity_group,
      confidence: ent.score,
      start: ent.start,
      end: ent.end,
    }))
    self.postMessage({ id, detections })
  } catch (err: unknown) {
    self.postMessage({ id, error: String(err) })
  }
}

/**
 * Split text into chunks at word/whitespace boundaries so BERT never receives
 * a chunk that starts or ends mid-word. Returns each chunk with its byte-exact
 * start offset in the original string so entity positions can be remapped.
 */
function chunkText(text: string, maxLen: number): Array<{ text: string; startOffset: number }> {
  if (text.length <= maxLen) return [{ text, startOffset: 0 }]
  const chunks: Array<{ text: string; startOffset: number }> = []
  let i = 0
  while (i < text.length) {
    let end = i + maxLen
    if (end >= text.length) {
      chunks.push({ text: text.slice(i), startOffset: i })
      break
    }
    // Walk back from end to find a whitespace boundary
    let boundary = end
    while (boundary > i && !/\s/.test(text[boundary])) {
      boundary--
    }
    if (boundary === i) boundary = end // no whitespace found — hard split
    chunks.push({ text: text.slice(i, boundary), startOffset: i })
    // Skip whitespace between chunks so offsets stay accurate
    i = boundary
    while (i < text.length && /\s/.test(text[i])) i++
  }
  return chunks
}
