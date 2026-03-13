interface Props {
  value: number // 0–1
  onChange: (v: number) => void
  label: string
}

export function ConfidenceSlider({ value, onChange, label }: Props) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-gray-600 whitespace-nowrap">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="flex-1 accent-gray-900"
      />
      <span className="text-sm font-mono text-gray-700 w-10 text-right">
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}
