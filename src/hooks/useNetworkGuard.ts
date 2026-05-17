import { useEffect, useState } from 'react'

export interface NetworkStats {
  requestCount: number
}

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

export function useNetworkGuard(): NetworkStats {
  const [requestCount, setRequestCount] = useState(0)

  useEffect(() => {
    // Snapshot at mount so same-origin bundle chunks and the SW precache
    // do not inflate the counter the privacy widget displays.
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
