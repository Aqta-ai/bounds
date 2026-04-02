import type { RiskLevel } from '../types'

interface Props {
  level: RiskLevel
  score?: number
  className?: string
  t?: (key: string) => string
}

const LEVEL_CONFIG: Record<RiskLevel, {
  label: string
  description: string
  bg: string
  text: string
  border: string
  dot: string
  pulse: boolean
}> = {
  clean: {
    label: 'Clean',
    description: 'risk_clean_desc',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    pulse: false,
  },
  low: {
    label: 'Low Risk',
    description: 'risk_low_desc',
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    border: 'border-yellow-200',
    dot: 'bg-yellow-400',
    pulse: false,
  },
  medium: {
    label: 'Medium Risk',
    description: 'risk_medium_desc',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    dot: 'bg-orange-400',
    pulse: false,
  },
  high: {
    label: 'High Risk',
    description: 'risk_high_desc',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-500',
    pulse: true,
  },
  critical: {
    label: 'Critical',
    description: 'risk_critical_desc',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    dot: 'bg-rose-600',
    pulse: true,
  },
}

export function RiskBadge({ level, score, className = '', t }: Props) {
  const cfg = LEVEL_CONFIG[level]
  const label = t ? t(`risk_${level}`) : cfg.label
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${cfg.bg} ${cfg.border} ${className}`}>
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {cfg.pulse && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.dot}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dot}`} />
      </span>
      <div className="min-w-0">
        <p className={`text-xs font-bold leading-none ${cfg.text}`}>{label}</p>
        <p className={`text-xs mt-0.5 opacity-80 ${cfg.text}`}>{t ? t(`risk_${level}_desc`) : cfg.description}</p>
      </div>
      {score !== undefined && score > 0 && (
        <span className={`ml-auto text-xs font-semibold tabular-nums opacity-60 ${cfg.text}`}>
          {score}
        </span>
      )}
    </div>
  )
}
