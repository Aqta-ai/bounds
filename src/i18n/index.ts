import { useState, useCallback } from 'react'
import type { Language } from '../types'

import en from './en.json'
import de from './de.json'
import fr from './fr.json'
import it from './it.json'
import es from './es.json'

const LOCALES: Record<Language, Record<string, string>> = { en, de, fr, it, es }

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

export function useLanguage(initial: Language = 'en') {
  const [language, setLanguage] = useState<Language>(initial)
  const translate = useCallback(
    (key: string, vars?: Record<string, string | number>) => t(language, key, vars),
    [language],
  )
  return { language, setLanguage, t: translate }
}
