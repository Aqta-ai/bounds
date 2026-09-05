import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { Language } from '../types'

const LANGUAGES: { code: Language; label: string; short: string; tess: string; sizeMB: number }[] = [
  { code: 'en', label: 'English',    short: 'EN', tess: 'eng', sizeMB: 4  },
  { code: 'de', label: 'Deutsch',    short: 'DE', tess: 'deu', sizeMB: 4  },
  { code: 'fr', label: 'Français',   short: 'FR', tess: 'fra', sizeMB: 4  },
  { code: 'it', label: 'Italiano',   short: 'IT', tess: 'ita', sizeMB: 3  },
  { code: 'es', label: 'Español',    short: 'ES', tess: 'spa', sizeMB: 4  },
  { code: 'pt', label: 'Português',  short: 'PT', tess: 'por', sizeMB: 3  },
  { code: 'nl', label: 'Nederlands', short: 'NL', tess: 'nld', sizeMB: 4  },
  { code: 'pl', label: 'Polski',     short: 'PL', tess: 'pol', sizeMB: 4  },
  { code: 'ga', label: 'Gaeilge',    short: 'GA', tess: 'gle', sizeMB: 3  },
  { code: 'th', label: 'ไทย',         short: 'TH', tess: 'tha', sizeMB: 6  },
]

const TESSDATA_CDN = 'https://tessdata.projectnaptha.com/4.0.0/'
const STORAGE_KEY = 'bounds:offlinePacks'

type PackStatus = 'bundled' | 'cached' | 'downloading' | 'failed'

function loadCachedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveCachedSet(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
  } catch { /* private mode: ignore */ }
}

interface Props {
  value: Language
  onChange: (lang: Language) => void
  label: string
}

export function LanguagePicker({ value, onChange, label }: Props) {
  const [cached, setCached] = useState<Set<string>>(() => loadCachedSet())
  const [status, setStatus] = useState<PackStatus>('bundled')

  // English is bundled locally; every other pack is lazy-fetched from the
  // tessdata CDN on first selection, then cached by the service worker so
  // it works offline forever after.
  useEffect(() => {
    if (value === 'en') { setStatus('bundled'); return }
    if (cached.has(value)) { setStatus('cached'); return }

    setStatus('downloading')
    const ctrl = new AbortController()
    const def = LANGUAGES.find((l) => l.code === value)
    if (!def) return
    fetch(`${TESSDATA_CDN}${def.tess}.traineddata.gz`, { signal: ctrl.signal, mode: 'cors' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer() })
      .then(() => {
        const next = new Set(cached).add(value)
        setCached(next)
        saveCachedSet(next)
        setStatus('cached')
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setStatus('failed')
      })

    return () => ctrl.abort()
  }, [value, cached])

  const activeDef = LANGUAGES.find((l) => l.code === value)

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="hidden sm:inline text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{label}</span>
        <div className="flex flex-wrap justify-center gap-1">
          {LANGUAGES.map((lang) => {
            const isActive = value === lang.code
            const isCached = lang.code === 'en' || cached.has(lang.code)
            return (
              <button
                key={lang.code}
                onClick={() => onChange(lang.code)}
                title={`${lang.label}${isCached ? ' · offline ready' : ` · ${lang.sizeMB} MB on first use`}`}
                className={`relative px-3 min-h-[32px] rounded-md text-xs font-semibold tracking-wide transition-all ${
                  isActive
                    ? 'bg-brand-green text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                }`}
              >
                {lang.short}
                {isCached && !isActive && (
                  <span aria-hidden className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-brand-green" />
                )}
              </button>
            )
          })}
        </div>
      </div>
      {activeDef && status !== 'bundled' && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500" role="status" aria-live="polite">
          {status === 'downloading' && (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-brand-green" aria-hidden />
              {activeDef.label} pack downloading ({activeDef.sizeMB} MB)…
            </>
          )}
          {status === 'cached' && (
            <>
              <Check className="w-3 h-3 text-brand-green" aria-hidden />
              {activeDef.label} pack ready offline
            </>
          )}
          {status === 'failed' && (
            <span className="text-amber-600">
              {activeDef.label} pack download failed (will retry next time)
            </span>
          )}
        </span>
      )}
    </div>
  )
}
