import { Download, Key, FileText, RefreshCw, RotateCcw, ClipboardList } from 'lucide-react'
import type { PipelineResult } from '../types'
import { downloadBlob } from '../utils/fileUtils'
import { PII_TYPE_LABELS } from '../utils/colors'

interface Props {
  result: PipelineResult
  onStartOver: () => void
  t: (key: string) => string
}

export function ExportPanel({ result, onStartOver, t }: Props) {
  const { redactedPdfBytes, keyFileBlob, rawKeyBlob, documentName, riskLevel, riskScore, detections } = result

  function downloadPdf() {
    downloadBlob(
      new Blob([redactedPdfBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      `${documentName}-redacted.pdf`,
    )
  }

  function downloadKeyFile() {
    downloadBlob(keyFileBlob, `${documentName}.bounds`)
  }

  function downloadRawKey() {
    downloadBlob(rawKeyBlob, `${documentName}.key`)
  }

  function downloadAuditReport() {
    const enabled = detections.filter((d) => d.enabled)
    const counts: Record<string, number> = {}
    for (const d of enabled) {
      const label = PII_TYPE_LABELS[d.type]
      counts[label] = (counts[label] ?? 0) + 1
    }
    const report = {
      document: documentName,
      redactedAt: new Date().toISOString(),
      riskLevel,
      riskScore,
      totalItemsRedacted: enabled.length,
      breakdown: Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count })),
      tool: 'Bounds, https://bounds.aqta.ai',
    }
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      `${documentName}-audit.json`,
    )
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold text-gray-900">{t('export_title')}</h2>
      </div>

      <div className="flex flex-col gap-3">
        {/* Redacted PDF */}
        <button
          onClick={downloadPdf}
          className="flex items-center gap-4 p-4 bg-brand-green text-white rounded-xl hover:opacity-90 transition-opacity text-left"
        >
          <div className="rounded-lg bg-white/10 p-2">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">{t('export_pdf_label')}</p>
            <p className="text-xs text-gray-300 mt-0.5">{t('export_pdf_hint')}</p>
          </div>
          <Download className="w-5 h-5 shrink-0 opacity-70" />
        </button>

        {/* .bounds encrypted map */}
        <button
          onClick={downloadKeyFile}
          className="flex items-center gap-4 p-4 bg-brand-grape/10 border border-brand-grape/25 rounded-xl hover:bg-brand-grape/15 transition-colors text-left"
        >
          <div className="rounded-lg bg-brand-grape/15 p-2">
            <RotateCcw className="w-5 h-5 text-brand-grape" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900">{t('export_map_label')}</p>
            <p className="text-xs text-brand-grape mt-0.5">{t('export_map_hint')}</p>
          </div>
          <Download className="w-5 h-5 shrink-0 text-brand-grape" />
        </button>

        {/* .key AES key */}
        <button
          onClick={downloadRawKey}
          className="flex items-center gap-4 p-4 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors text-left"
        >
          <div className="rounded-lg bg-amber-100 p-2">
            <Key className="w-5 h-5 text-amber-700" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-amber-900">{t('export_key_label')}</p>
            <p className="text-xs text-amber-600 mt-0.5">{t('export_key_hint')}</p>
          </div>
          <Download className="w-5 h-5 shrink-0 text-amber-500" />
        </button>

        {/* Audit report */}
        <button
          onClick={downloadAuditReport}
          className="flex items-center gap-4 p-4 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors text-left"
        >
          <div className="rounded-lg bg-gray-200 p-2">
            <ClipboardList className="w-5 h-5 text-gray-600" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900">{t('export_audit_label')}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t('export_audit_hint')}</p>
          </div>
          <Download className="w-5 h-5 shrink-0 text-gray-400" />
        </button>
      </div>

      {/* Security assurance */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500">
        <span className="font-semibold text-gray-700">Redactions are permanent.</span> Black boxes are burned into the PDF, they cannot be lifted or reversed by anyone without your <span className="font-mono">.key</span> file. The key uses AES-256-GCM encryption, which is mathematically infeasible to brute-force.
      </div>

      <div className="border-t pt-4">
        <button
          onClick={onStartOver}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t('start_over')}
        </button>
      </div>
    </div>
  )
}
