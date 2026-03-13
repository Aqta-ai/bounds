import { useRef, useState, useCallback } from 'react'
import { Upload, FileText, AlertCircle, Info } from 'lucide-react'
import type { Language } from '../types'
import { LanguagePicker } from './LanguagePicker'
import { PiiInfoPanel } from './PiiInfoPanel'

interface Props {
  onFile: (file: File) => void
  language: Language
  onLanguageChange: (lang: Language) => void
  t: (key: string) => string
}

async function hasPdfMagicBytes(file: File): Promise<boolean> {
  try {
    const slice = await file.slice(0, 4).arrayBuffer()
    const bytes = new Uint8Array(slice)
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  } catch {
    return false
  }
}

export function DropZone({ onFile, language, onLanguageChange, t }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (!file) return
      if (file.type !== 'application/pdf' || !(await hasPdfMagicBytes(file))) {
        setFileError(t('drop_error_pdf_only'))
        return
      }
      setFileError(null)
      onFile(file)
    },
    [onFile, t],
  )

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (file.type !== 'application/pdf' || !(await hasPdfMagicBytes(file))) {
        setFileError(t('drop_error_pdf_only'))
        return
      }
      setFileError(null)
      onFile(file)
    },
    [onFile, t],
  )

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xl mx-auto">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">{t('hero_headline')}</h1>
        <p className="text-sm text-gray-500 mt-2 max-w-md">{t('hero_sub')}</p>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`w-full border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-all ${
          fileError
            ? 'border-brand-orange bg-orange-50'
            : dragging
              ? 'border-brand-green bg-green-50'
              : 'border-gray-300 hover:border-brand-green hover:bg-green-50'
        }`}
      >
        <div className={`rounded-full p-4 transition-all ${fileError ? 'bg-orange-100' : dragging ? 'bg-brand-green' : 'bg-gray-100'}`}>
          {fileError ? (
            <AlertCircle className="w-8 h-8 text-brand-orange" />
          ) : dragging ? (
            <FileText className="w-8 h-8 text-white" />
          ) : (
            <Upload className="w-8 h-8 text-gray-500" />
          )}
        </div>
        <div className="text-center">
          <p className={`font-semibold ${fileError ? 'text-brand-orange' : 'text-gray-900'}`}>
            {fileError ?? t('drop_prompt')}
          </p>
          <p className="text-sm text-gray-500 mt-1">{t('drop_hint')}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleChange}
        />
      </button>

      <LanguagePicker value={language} onChange={onLanguageChange} label={t('language_label')} />

      <PiiInfoPanel
        title={t('pii_what_title')}
        intro={t('pii_what_intro')}
        contextNote={t('pii_what_context')}
        t={t}
      />

      {/* EU AI Act transparency notice */}
      <div className="w-full rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 flex gap-3">
        <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-gray-600 font-medium">{t('ai_model_info')}</p>
          <p className="text-xs text-gray-500">{t('ai_limitation')}</p>
        </div>
      </div>
    </div>
  )
}
