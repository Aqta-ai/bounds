import { useState, useCallback } from 'react'
import { Unlock, RotateCcw, Key, AlertCircle, ArrowLeft, Download, Lock } from 'lucide-react'
import { KeyVaultService } from '../pipeline/KeyVaultService'
import { getPiiColor, PII_TYPE_LABELS } from '../utils/colors'
import type { RedactionMap } from '../types'

interface Props {
  t: (key: string) => string
  onBack: () => void
}

export function RestorePanel({ t, onBack }: Props) {
  const [boundsFile, setBoundsFile] = useState<File | null>(null)
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<RedactionMap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const classifyFile = useCallback((file: File) => {
    if (file.name.endsWith('.bounds')) setBoundsFile(file)
    else if (file.name.endsWith('.key')) setKeyFile(file)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      Array.from(e.dataTransfer.files).forEach(classifyFile)
    },
    [classifyFile],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      Array.from(e.target.files ?? []).forEach(classifyFile)
    },
    [classifyFile],
  )

  async function handleRestore() {
    if (!boundsFile || !keyFile) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const svc = new KeyVaultService()
      await svc.importRawKey(await keyFile.arrayBuffer())
      const map = await svc.decrypt(boundsFile)
      setResult(map)
    } catch {
      setError(t('restore_error_invalid'))
    } finally {
      setLoading(false)
    }
  }

  function downloadCsv() {
    if (!result) return
    const rows = [
      ['Type', 'Token', 'Original value'],
      ...result.detections.map((d) => [
        PII_TYPE_LABELS[d.type] ?? d.type,
        d.token,
        d.original,
      ]),
    ]
    const csv = rows
      .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${result.documentName}-restored.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const canRestore = boundsFile !== null && keyFile !== null && !loading

  return (
    <div className="flex flex-col gap-6 w-full max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label={t('restore_back')}
        >
          <ArrowLeft className="w-4 h-4 text-gray-500" />
        </button>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {t('export_restore_title')}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{t('restore_subtitle')}</p>
        </div>
      </div>

      {!result && (
        <>
          {/* Drop zone */}
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${
              dragging
                ? 'border-brand-grape bg-brand-grape/5'
                : 'border-gray-200 hover:border-gray-300 bg-gray-50'
            }`}
          >
            <input
              type="file"
              accept=".bounds,.key"
              multiple
              className="sr-only"
              onChange={onInputChange}
            />
            <Unlock className="w-8 h-8 text-gray-400" />
            <p className="text-sm text-gray-600 text-center">
              {t('export_restore_hint')}
            </p>
          </label>

          {/* File chips */}
          <div className="flex gap-3">
            <FileChip label={t('restore_acta_label')} file={boundsFile} icon="bounds" />
            <FileChip label={t('restore_key_label')} file={keyFile} icon="key" />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            onClick={handleRestore}
            disabled={!canRestore}
            className="flex items-center justify-center gap-2 p-3 rounded-xl font-semibold text-sm bg-brand-green text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Unlock className="w-4 h-4" />
            {loading ? '…' : t('export_restore_btn')}
          </button>
        </>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          {/* Clarification banner */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {t('restore_clarification')}
          </div>

          {/* Metadata card */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm flex flex-col gap-2">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 shrink-0">{t('restore_document')}</span>
              <span className="font-medium text-gray-900 truncate text-right">
                {result.documentName}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 shrink-0">{t('restore_redacted_at')}</span>
              <span className="font-medium text-gray-900">
                {new Date(result.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 shrink-0">{t('restore_items_count')}</span>
              <span className="font-medium text-gray-900">{result.detections.length}</span>
            </div>
          </div>

          {/* PII table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                {t('restore_result_title')}
              </span>
              <button
                onClick={downloadCsv}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {t('restore_download_csv')}
              </button>
            </div>
            <div className="grid grid-cols-[auto_1fr_1fr] text-xs text-gray-400 font-medium px-4 py-2 bg-gray-50 border-b border-gray-100">
              <span className="w-24">Type</span>
              <span>Token</span>
              <span>Original value</span>
            </div>
            <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {result.detections.map((d) => {
                const color = getPiiColor(d.type)
                return (
                  <div key={d.token} className="grid grid-cols-[auto_1fr_1fr] items-center gap-3 px-4 py-2.5">
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded w-24 text-center shrink-0 ${color.bg} ${color.text}`}
                    >
                      {PII_TYPE_LABELS[d.type] ?? d.type}
                    </span>
                    <span className="text-xs text-gray-400 font-mono truncate">{d.token}</span>
                    <span className="text-sm text-gray-900 font-medium truncate">
                      {d.original}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="border-t pt-4">
            <button
              onClick={() => {
                setResult(null)
                setBoundsFile(null)
                setKeyFile(null)
              }}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t('restore_back')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function FileChip({
  label,
  file,
  icon,
}: {
  label: string
  file: File | null
  icon: 'bounds' | 'key'
}) {
  const Icon = icon === 'bounds' ? RotateCcw : Key
  return (
    <div
      className={`flex-1 flex items-center gap-2 p-3 rounded-lg border text-sm transition-colors ${
        file
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-gray-200 bg-gray-50 text-gray-400'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium text-xs">{label}</p>
        <p className="text-xs truncate">{file ? file.name : '-'}</p>
      </div>
    </div>
  )
}
