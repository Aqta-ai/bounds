import { useMemo } from 'react'
import type { Detection } from '../types'
import { getPiiColor, PII_TYPE_LABELS } from '../utils/colors'

interface Props {
  detections: Detection[]
}

export function PiiBreakdown({ detections }: Props) {
  const groups = useMemo(() => {
    const counts = new Map<string, { count: number; hex: string }>()
    for (const d of detections) {
      if (!d.enabled) continue
      const label = PII_TYPE_LABELS[d.type]
      const color = getPiiColor(d.type)
      const existing = counts.get(label)
      counts.set(label, { count: (existing?.count ?? 0) + 1, hex: color.hex })
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
  }, [detections])

  if (groups.length === 0) return null

  const max = groups[0][1].count

  return (
    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 border border-gray-200 rounded-xl">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Breakdown</p>
      {groups.map(([label, { count, hex }]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-28 shrink-0 truncate">{label}</span>
          <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(count / max) * 100}%`, backgroundColor: hex }}
            />
          </div>
          <span className="text-xs font-semibold text-gray-600 tabular-nums w-5 text-right">{count}</span>
        </div>
      ))}
    </div>
  )
}
