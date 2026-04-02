import type { RedactionOptions } from '../types'

// ---------------------------------------------------------------------------
// RedactionOptionsPanel
// Lets the user choose redaction color, label style, and watermark settings
// before the final PDF is generated.
// ---------------------------------------------------------------------------

interface ColorPreset {
  label: string
  r: number
  g: number
  b: number
  hex: string
}

const COLOR_PRESETS: ColorPreset[] = [
  { label: 'Black',     r: 0,    g: 0,    b: 0,    hex: '#000000' },
  { label: 'Dark Grey', r: 0.25, g: 0.25, b: 0.25, hex: '#404040' },
  { label: 'Navy',      r: 0.05, g: 0.1,  b: 0.4,  hex: '#0d1966' },
  { label: 'Dark Red',  r: 0.45, g: 0.05, b: 0.05, hex: '#730d0d' },
  { label: 'White',     r: 1,    g: 1,    b: 1,    hex: '#ffffff' },
  { label: 'Yellow',    r: 1,    g: 0.85, b: 0,    hex: '#ffd900' },
]

interface Props {
  options: RedactionOptions
  onChange: (options: RedactionOptions) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

export function RedactionOptionsPanel({ options, onChange, t }: Props) {
  const selectedHex = toHex(options.color)

  function setColor(preset: ColorPreset) {
    onChange({ ...options, color: { r: preset.r, g: preset.g, b: preset.b } })
  }

  function setLabelStyle(style: 'blank' | 'token') {
    onChange({ ...options, labelStyle: style })
  }

  function setWatermark(patch: Partial<RedactionOptions['watermark']>) {
    onChange({ ...options, watermark: { ...options.watermark, ...patch } })
  }

  function setFooter(patch: Partial<RedactionOptions['footer']>) {
    onChange({ ...options, footer: { ...options.footer, ...patch } })
  }

  function removeAnnotation(id: string) {
    onChange({ ...options, annotations: options.annotations.filter((a) => a.id !== id) })
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 flex flex-col gap-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        {t('options_title')}
      </p>

      {/* Redaction color */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-700">{t('options_color')}</span>
        <div className="flex items-center gap-2 flex-wrap">
          {COLOR_PRESETS.map((preset) => {
            const isSelected = selectedHex === preset.hex
            return (
              <button
                key={preset.hex}
                title={preset.label}
                onClick={() => setColor(preset)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  isSelected ? 'border-green-600 scale-110 shadow-md' : 'border-gray-300 hover:border-gray-500'
                }`}
                style={{ backgroundColor: preset.hex }}
              />
            )
          })}
          {/* Custom hex input */}
          <div className="flex flex-col items-center gap-0.5 ml-1">
            <input
              type="color"
              value={selectedHex}
              onChange={(e) => {
                const hex = e.target.value
                const r = parseInt(hex.slice(1, 3), 16) / 255
                const g = parseInt(hex.slice(3, 5), 16) / 255
                const b = parseInt(hex.slice(5, 7), 16) / 255
                onChange({ ...options, color: { r, g, b } })
              }}
              className="w-8 h-8 rounded cursor-pointer border border-gray-300"
              title={t('options_custom_title')}
            />
            <span className="text-[10px] text-gray-400 leading-none">{t('options_custom')}</span>
          </div>
        </div>
      </div>

      {/* Label style */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-700">{t('options_label_style')}</span>
        <div className="flex gap-2">
          {(['blank', 'token'] as const).map((style) => (
            <button
              key={style}
              onClick={() => setLabelStyle(style)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                options.labelStyle === style
                  ? 'bg-brand-green text-white border-brand-green'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-brand-green'
              }`}
            >
              {style === 'blank' ? t('options_label_blank') : t('options_label_token')}
            </button>
          ))}
        </div>
        {options.labelStyle === 'token' && (
          <p className="text-xs text-gray-400">
            {t('options_token_hint')}
          </p>
        )}
      </div>

      {/* Watermark */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            role="switch"
            aria-checked={options.watermark.enabled}
            onClick={() => setWatermark({ enabled: !options.watermark.enabled })}
            className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${
              options.watermark.enabled ? 'bg-green-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                options.watermark.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-sm font-medium text-gray-700">{t('options_watermark')}</span>
        </div>

        {options.watermark.enabled && (
          <div className="flex flex-col gap-2 pl-2 border-l-2 border-gray-200">
            <input
              type="text"
              value={options.watermark.text}
              onChange={(e) => setWatermark({ text: e.target.value })}
              placeholder={t('options_watermark_text')}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 w-full"
            />
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{t('options_watermark_opacity')}</span>
              <input
                type="range"
                min={0.05}
                max={0.5}
                step={0.05}
                value={options.watermark.opacity}
                onChange={(e) => setWatermark({ opacity: parseFloat(e.target.value) })}
                className="flex-1 min-w-0"
              />
              <span className="text-xs text-gray-400 w-8">
                {Math.round(options.watermark.opacity * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Legal footer */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            role="switch"
            aria-checked={options.footer.enabled}
            onClick={() => setFooter({ enabled: !options.footer.enabled })}
            className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${
              options.footer.enabled ? 'bg-green-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                options.footer.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-sm font-medium text-gray-700">{t('options_footer')}</span>
        </div>

        {options.footer.enabled && (
          <div className="pl-2 border-l-2 border-gray-200">
            <input
              type="text"
              value={options.footer.text}
              onChange={(e) => setFooter({ text: e.target.value })}
              placeholder={t('options_footer_text')}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 w-full"
            />
            <p className="text-xs text-gray-400 mt-1">{t('options_footer_hint')}</p>
          </div>
        )}
      </div>

      {/* Page notes — added by drawing on the PDF; listed here for review/removal */}
      {options.annotations.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">{t('options_page_notes', { count: options.annotations.length })}</span>
          <div className="flex flex-col gap-1.5">
            {options.annotations.map((ann) => (
              <div key={ann.id} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="text-xs font-semibold text-amber-700 shrink-0">p.{ann.page}</span>
                <span className="text-xs text-gray-700 flex-1 truncate">{ann.text}</span>
                <button
                  onClick={() => removeAnnotation(ann.id)}
                  className="text-gray-300 hover:text-red-500 text-base leading-none shrink-0"
                  aria-label={t('options_remove')}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function toHex(color: { r: number; g: number; b: number }): string {
  const toB = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${toB(color.r)}${toB(color.g)}${toB(color.b)}`
}
