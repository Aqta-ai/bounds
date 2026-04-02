import { getPiiColor, PII_TYPE_LABELS } from '../utils/colors'
import type { Detection } from '../types'

interface Props {
  detection: Detection
  onToggle: (id: string) => void
}

export function RedactionBadge({ detection, onToggle }: Props) {
  const color = getPiiColor(detection.type)
  return (
    <button
      onClick={() => onToggle(detection.id)}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition-all ${
        detection.enabled
          ? `${color.bg} ${color.text} ${color.border}`
          : 'bg-gray-50 text-gray-400 border-gray-200 line-through'
      }`}
      title={`${PII_TYPE_LABELS[detection.type]}: "${detection.text}" · ${detection.ruleId ? detection.ruleId.replace(/_/g, ' ') : detection.source} · ${Math.round(detection.confidence * 100)}% confidence`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${detection.enabled ? '' : 'bg-gray-300'}`}
        style={detection.enabled ? { backgroundColor: color.hex } : undefined}
      />
      <span className="max-w-[12rem] truncate">{detection.text}</span>
      <span className="opacity-60 ml-0.5">{PII_TYPE_LABELS[detection.type]}</span>
    </button>
  )
}
