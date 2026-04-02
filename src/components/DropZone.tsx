import { useRef, useState, useCallback } from 'react'
import { Upload, FileText, AlertCircle } from 'lucide-react'
import type { Language } from '../types'
import { LanguagePicker } from './LanguagePicker'

interface Props {
  onFiles: (files: File[]) => void
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

export function DropZone({ onFiles, language, onLanguageChange, t }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  // Counter-based drag tracking — avoids false dragLeave events when the pointer
  // moves over a child element inside the drop zone.
  const dragDepthRef = useRef(0)

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const candidates = Array.from(e.dataTransfer.files)
      const pdfs: File[] = []
      for (const f of candidates) {
        if (await hasPdfMagicBytes(f)) pdfs.push(f)
      }
      if (pdfs.length === 0) {
        setFileError(t('drop_error_pdf_only'))
        return
      }
      setFileError(null)
      onFiles(pdfs)
    },
    [onFiles, t],
  )

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const candidates = Array.from(e.target.files ?? [])
      const pdfs: File[] = []
      for (const f of candidates) {
        if (await hasPdfMagicBytes(f)) pdfs.push(f)
      }
      if (pdfs.length === 0) {
        setFileError(t('drop_error_pdf_only'))
        return
      }
      setFileError(null)
      e.target.value = ''
      onFiles(pdfs)
    },
    [onFiles, t],
  )

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xl mx-auto">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); dragDepthRef.current++; setDragging(true) }}
        onDragOver={(e) => { e.preventDefault() }}
        onDragLeave={() => { dragDepthRef.current--; if (dragDepthRef.current === 0) setDragging(false) }}
        onDrop={(e) => { dragDepthRef.current = 0; handleDrop(e) }}
        className={`w-full border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all focus:outline-none ${
          fileError
            ? 'border-brand-orange bg-orange-50'
            : dragging
              ? 'border-brand-green bg-green-50'
              : 'border-gray-300 hover:border-brand-green hover:bg-green-50 focus:border-brand-green focus:bg-green-50'
        }`}
      >
        <div className={`rounded-full p-3 transition-all ${fileError ? 'bg-orange-100' : dragging ? 'bg-brand-green' : 'bg-gray-100'}`}>
          {fileError ? (
            <AlertCircle className="w-6 h-6 text-brand-orange" />
          ) : dragging ? (
            <FileText className="w-6 h-6 text-white" />
          ) : (
            <Upload className="w-6 h-6 text-gray-500" />
          )}
        </div>
        <div className="text-center">
          <p className={`font-semibold text-sm ${fileError ? 'text-brand-orange' : 'text-gray-900'}`}>
            {fileError ?? t('drop_prompt')}
          </p>
          <p className="text-xs text-gray-500 mt-1">PDF only · drop multiple for batch</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={handleChange}
        />
      </button>

      <p className="text-xs text-gray-400 text-center">
        All AI runs locally via WebAssembly. No server, no uploads, ever.
      </p>

      <LanguagePicker value={language} onChange={onLanguageChange} label={t('language_label')} />
    </div>
  )
}
