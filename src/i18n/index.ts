import { useState, useCallback } from 'react'
import type { Language } from '../types'

import en from './en.json'
import de from './de.json'
import fr from './fr.json'
import it from './it.json'
import es from './es.json'
import pt from './pt.json'
import nl from './nl.json'
import pl from './pl.json'
import ga from './ga.json'
import th from './th.json'

const LOCALES: Record<Language, Record<string, string>> = { en, de, fr, it, es, pt, nl, pl, ga, th }
const STORAGE_KEY = 'bounds:lang'
const VALID = new Set<Language>(['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ga', 'th'])

export function t(locale: Language, key: string, vars?: Record<string, string | number>): string {
  const dict = LOCALES[locale]
  let str = dict[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v))
    }
  }
  return str
}

function loadStoredLanguage(fallback: Language): Language {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && VALID.has(raw as Language)) return raw as Language
  } catch { /* private mode */ }
  return fallback
}

export function useLanguage(initial: Language = 'en') {
  const [language, setLanguageState] = useState<Language>(() => loadStoredLanguage(initial))
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode */ }
  }, [])
  const translate = useCallback(
    (key: string, vars?: Record<string, string | number>) => t(language, key, vars),
    [language],
  )
  return { language, setLanguage, t: translate }
}
