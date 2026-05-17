import { useEffect, useState } from 'react'

export interface NetworkStats {
  /** Count of model-CDN fetches since the hook mounted. App bundle assets and
   * same-origin precache hits are excluded so the number reflects only the
   * legitimate one-off model downloads, not 100+ page bundle chunks. */
  requestCount: number
}

// Hostnames the AI pipeline legitimately fetches model weights / wasm from.
// Anything else cross-origin is suspicious. Same-origin entries are always
// excluded because they are bundle chunks, fonts, icons, or the SW precache.
const MODEL_CDN_HOSTS = [
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs.hf.co',
  'cas-bridge.xethub.hf.co',
  'mlc.ai',
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'tessdata.projectnaptha.com',
]

function isModelFetch(entry: PerformanceResourceTiming): boolean {
  let url: URL
  try {
    url = new URL(entry.name)
  } catch {
    return false
  }
  if (url.origin === location.origin) return false
  return MODEL_CDN_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
}

/**
 * Reads from the browser's native Performance Resource Timing API.
 * No monkey-patching — the browser records every network request itself.
 * Polls every 500 ms so the counter updates live during model downloads.
 *
 * The counter is taken from a baseline at mount so it does not include the
 * initial app bundle, fonts, icons, or any other same-origin precache hits.
 * Only cross-origin fetches to known model CDNs are surfaced — that is the
 * privacy claim we want to back up live ("the only network calls you see are
 * the AI models loading").
 */
export function useNetworkGuard(): NetworkStats {
  const [requestCount, setRequestCount] = useState(0)

  useEffect(() => {
    const baselineByUrl = new Set(
      (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .map((e) => e.name),
    )
    function update() {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      let count = 0
      for (const e of entries) {
        if (baselineByUrl.has(e.name)) continue
        if (isModelFetch(e)) count++
      }
      setRequestCount(count)
    }
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [])

  return { requestCount }
}
