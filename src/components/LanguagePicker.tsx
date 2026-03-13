import type { Language } from '../types'

const LANGUAGES: { code: Language; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'de', label: 'Deutsch', short: 'DE' },
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'it', label: 'Italiano', short: 'IT' },
  { code: 'es', label: 'Español', short: 'ES' },
]

interface Props {
  value: Language
  onChange: (lang: Language) => void
  label: string
}

export function LanguagePicker({ value, onChange, label }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => onChange(lang.code)}
            title={lang.label}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              value === lang.code
                ? 'bg-brand-green text-white border-brand-green shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:border-brand-green hover:text-brand-green'
            }`}
          >
            <span className="hidden sm:inline">{lang.label}</span>
            <span className="sm:hidden">{lang.short}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
