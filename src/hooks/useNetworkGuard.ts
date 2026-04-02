import { useEffect, useState } from 'react'

export interface NetworkStats {
  requestCount: number
}

/**
 * Reads from the browser's native Performance Resource Timing API.
 * No monkey-patching — the browser records every network request itself.
 * Polls every 500 ms so the counter updates live during model downloads.
 */
export function useNetworkGuard(): NetworkStats {
  const [requestCount, setRequestCount] = useState(0)

  useEffect(() => {
    function update() {
      setRequestCount(performance.getEntriesByType('resource').length)
    }
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [])

  return { requestCount }
}
