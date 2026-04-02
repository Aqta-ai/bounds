import { Loader2, CheckCircle2, AlertCircle, Clock, Download, RefreshCw, FileText } from 'lucide-react'
import type { PipelineResult, RiskLevel } from '../types'
import { downloadBlob } from '../utils/fileUtils'

export interface BatchItem {
  id: string
  file: File
  status: 'queued' | 'processing' | 'done' | 'error'
  result?: PipelineResult
  errorMsg?: string
}

interface Props {
  items: BatchItem[]
  onStartOver: () => void
}

const RISK_COLORS: Record<RiskLevel, string> = {
  clean: 'text-emerald-600', low: 'text-green-600',
  medium: 'text-yellow-700', high: 'text-orange-600', critical: 'text-red-600',
}

function StatusIcon({ status }: { status: BatchItem['status'] }) {
  if (status === 'queued')     return <Clock className="w-4 h-4 text-gray-300 shrink-0" />
  if (status === 'processing') return <Loader2 className="w-4 h-4 text-brand-green shrink-0 animate-spin" />
  if (status === 'done')       return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
  return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
}

export function BatchPanel({ items, onStartOver }: Props) {
  const done = items.filter((i) => i.status === 'done')
  const failed = items.filter((i) => i.status === 'error')
  const processing = items.filter((i) => i.status === 'processing')
  const allFinished = items.every((i) => i.status === 'done' || i.status === 'error')

  const totalRedacted = done.reduce((n, i) => n + (i.result?.detections.filter((d) => d.enabled).length ?? 0), 0)

  function downloadResult(item: BatchItem) {
    if (!item.result) return
    const { redactedPdfBytes, documentName } = item.result
    downloadBlob(
      new Blob([redactedPdfBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      `${documentName}-redacted.pdf`,
    )
  }

  return (
    <div className="flex flex-col gap-5 w-full max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Batch Redaction</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {allFinished
              ? `${done.length}/${items.length} completed · ${totalRedacted} items redacted`
              : processing.length > 0
                ? `Processing file ${items.findIndex((i) => i.status === 'processing') + 1} of ${items.length}…`
                : `${items.length} files queued`}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {!allFinished && (
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className="bg-brand-green h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${Math.round(((done.length + failed.length) / items.length) * 100)}%` }}
          />
        </div>
      )}

      {/* Aggregate stats (visible when done) */}
      {allFinished && done.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-brand-green/8 border border-brand-green/20 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-brand-green">{done.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">files processed</p>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-gray-800">{totalRedacted}</p>
            <p className="text-xs text-gray-500 mt-0.5">items redacted</p>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-gray-800">{failed.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">errors</p>
          </div>
        </div>
      )}

      {/* Per-file list */}
      <div className="flex flex-col gap-2 rounded-2xl border border-gray-100 p-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
              item.status === 'done'
                ? 'bg-gray-50'
                : item.status === 'error'
                  ? 'bg-red-50'
                  : item.status === 'processing'
                    ? 'bg-brand-green/5'
                    : 'bg-white'
            }`}
          >
            <StatusIcon status={item.status} />
            <FileText className="w-4 h-4 text-gray-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{item.file.name}</p>
              {item.status === 'done' && item.result && (
                <p className={`text-xs mt-0.5 ${RISK_COLORS[item.result.residualRiskLevel]}`}>
                  {item.result.detections.filter((d) => d.enabled).length} items · residual risk: {item.result.residualRiskLevel}
                </p>
              )}
              {item.status === 'error' && (
                <p className="text-xs text-red-500 mt-0.5 truncate">{item.errorMsg ?? 'Processing failed'}</p>
              )}
            </div>
            {item.status === 'done' && item.result && (
              <button
                onClick={() => downloadResult(item)}
                className="shrink-0 flex items-center gap-1 text-xs text-brand-green hover:text-brand-green/80 font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                PDF
              </button>
            )}
          </div>
        ))}
      </div>

      {allFinished && (
        <div className="border-t pt-4">
          <button
            onClick={onStartOver}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Start over
          </button>
        </div>
      )}
    </div>
  )
}
