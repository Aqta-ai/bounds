import type { Language } from '../types'

const LANGUAGES: { code: Language; label: string; short: string }[] = [
  { code: 'en', label: 'English',    short: 'EN' },
  { code: 'de', label: 'Deutsch',    short: 'DE' },
  { code: 'fr', label: 'Français',   short: 'FR' },
  { code: 'it', label: 'Italiano',   short: 'IT' },
  { code: 'es', label: 'Español',    short: 'ES' },
  { code: 'pt', label: 'Português',  short: 'PT' },
  { code: 'nl', label: 'Nederlands', short: 'NL' },
  { code: 'pl', label: 'Polski',     short: 'PL' },
]

interface Props {
  value: Language
  onChange: (lang: Language) => void
  label: string
}

export function LanguagePicker({ value, onChange, label }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="hidden sm:inline text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{label}</span>
      <div className="flex flex-wrap justify-center gap-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => onChange(lang.code)}
            title={lang.label}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide transition-all ${
              value === lang.code
                ? 'bg-brand-green text-white shadow-sm'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
            }`}
          >
            {lang.short}
          </button>
        ))}
      </div>
    </div>
  )
}
