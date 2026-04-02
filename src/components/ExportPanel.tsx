import { useEffect, useRef, useState } from 'react'
import { Download, Key, FileText, RefreshCw, RotateCcw, ClipboardList, TrendingDown, PackageOpen, ShieldCheck, Star } from 'lucide-react'
import type { PipelineResult, RiskLevel } from '../types'
import { downloadBlob } from '../utils/fileUtils'
import { PII_TYPE_LABELS } from '../utils/colors'
import { buildZip } from '../utils/zipUtils'
import { buildPrivacySummary } from '../utils/summaryUtils'

interface Props {
  result: PipelineResult
  onStartOver: () => void
  onGoBack?: () => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const RISK_COLORS: Record<RiskLevel, { bar: string; text: string; label: string }> = {
  clean:    { bar: 'bg-emerald-500', text: 'text-emerald-600', label: 'Clean' },
  low:      { bar: 'bg-green-500',   text: 'text-green-600',   label: 'Low' },
  medium:   { bar: 'bg-yellow-500',  text: 'text-yellow-700',  label: 'Medium' },
  high:     { bar: 'bg-orange-500',  text: 'text-orange-600',  label: 'High' },
  critical: { bar: 'bg-red-500',     text: 'text-red-600',     label: 'Critical' },
}

const RISK_WIDTH: Record<RiskLevel, string> = {
  clean: 'w-0', low: 'w-1/5', medium: 'w-2/5', high: 'w-3/5', critical: 'w-full',
}

function RiskBar({ level, score, label }: { level: RiskLevel; score: number; label: string }) {
  const c = RISK_COLORS[level]
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-24 sm:w-32 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-500 ${c.bar} ${RISK_WIDTH[level]}`} />
      </div>
      <span className={`text-xs font-semibold w-16 text-right ${c.text}`}>
        {c.label} {score > 0 ? `(${score})` : ''}
      </span>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Renders page 1 of the redacted PDF onto a small canvas — gives judges a
// thumbnail confirmation that redaction boxes are visible before downloading.
// ---------------------------------------------------------------------------
function RedactedPreview({ pdfBytes }: { pdfBytes: Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).toString()
        const doc = await pdfjs.getDocument({ data: pdfBytes.slice(0) }).promise
        if (cancelled) return
        const page = await doc.getPage(1)
        if (cancelled) return
        const dpr = window.devicePixelRatio || 1
        const wrap = wrapRef.current
        if (!wrap) return
        const containerW = wrap.clientWidth || 480
        // Scale so the page fills the container width
        const unscaled = page.getViewport({ scale: 1 })
        const scale = (containerW / unscaled.width) * dpr
        const vp = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width  = vp.width
        canvas.height = vp.height
        canvas.style.width  = `${vp.width  / dpr}px`
        canvas.style.height = `${vp.height / dpr}px`
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void render()
    return () => { cancelled = true }
  }, [pdfBytes])

  if (failed) return null

  return (
    <div ref={wrapRef} className="w-full">
      {!ready && <div className="h-24 flex items-center justify-center text-xs text-gray-400">Loading…</div>}
      <canvas
        ref={canvasRef}
        style={{ display: ready ? 'block' : 'none', width: '100%', height: 'auto' }}
      />
    </div>
  )
}

export function ExportPanel({ result, onStartOver, onGoBack, t }: Props) {
  const {
    redactedPdfBytes, keyFileBlob, rawKeyBlob, documentName,
    preRedactionRiskLevel, preRedactionRiskScore,
    residualRiskLevel, residualRiskScore,
    detections,
  } = result

  const summary = buildPrivacySummary(detections, residualRiskLevel)
  // Sanitize filename: strip path traversal chars and characters invalid on Windows/macOS
  const safeName = documentName.replace(/[/\\:*?"<>|]/g, '_').replace(/\.pdf$/i, '').trim() || 'document'
  const unredactedCount = detections.filter((d) => !d.enabled).length
  const allRedacted = unredactedCount === 0

  // Entity type breakdown for the "what was redacted" summary
  const entityBreakdown = (() => {
    const counts: Record<string, number> = {}
    for (const d of detections.filter((d) => d.enabled)) {
      const label = PII_TYPE_LABELS[d.type]
      counts[label] = (counts[label] ?? 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  })()

  function buildAuditJson(): string {
    const enabled = detections.filter((d) => d.enabled)
    const counts: Record<string, number> = {}
    for (const d of enabled) {
      const label = PII_TYPE_LABELS[d.type]
      counts[label] = (counts[label] ?? 0) + 1
    }
    const report = {
      document: documentName,
      redactedAt: new Date().toISOString(),
      preRedactionRisk: { level: preRedactionRiskLevel, score: preRedactionRiskScore },
      postRedactionResidualRisk: { level: residualRiskLevel, score: residualRiskScore },
      totalItemsRedacted: enabled.length,
      breakdown: Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count })),
      privacySummary: summary,
      tool: 'Bounds, https://bounds.aqta.ai',
    }
    return JSON.stringify(report, null, 2)
  }

  function downloadPdf() {
    downloadBlob(
      new Blob([redactedPdfBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      `${safeName}-redacted.pdf`,
    )
  }

  function downloadKeyFile() { downloadBlob(keyFileBlob, `${safeName}.bounds`) }
  function downloadRawKey()  { downloadBlob(rawKeyBlob, `${safeName}.key`) }

  function downloadAuditReport() {
    downloadBlob(
      new Blob([buildAuditJson()], { type: 'application/json' }),
      `${safeName}-audit.json`,
    )
  }

  async function downloadAll() {
    const enc = new TextEncoder()
    const [boundsBytes, keyBytes] = await Promise.all([
      keyFileBlob.arrayBuffer().then((b) => new Uint8Array(b)),
      rawKeyBlob.arrayBuffer().then((b) => new Uint8Array(b)),
    ])
    const zip = buildZip([
      { name: `${safeName}-redacted.pdf`, data: redactedPdfBytes as Uint8Array },
      { name: `${safeName}.bounds`,       data: boundsBytes },
      { name: `${safeName}.key`,          data: keyBytes },
      { name: `${safeName}-audit.json`,   data: enc.encode(buildAuditJson()) },
    ])
    downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), `${safeName}-redacted.zip`)
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900">{t('export_title')}</h2>

      {/* Preview full-width above CTA */}
      <div className="rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
        <RedactedPreview pdfBytes={redactedPdfBytes as Uint8Array} />
      </div>

      {/* Download CTA + risk */}
      <div className="flex flex-col gap-2">
        <button
          onClick={downloadAll}
          className="w-full flex items-center justify-center gap-2 bg-brand-green text-white px-4 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm"
        >
          <PackageOpen className="w-4 h-4 shrink-0" />
          {t('export_download_all')}
        </button>
        {/* Risk inline */}
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <TrendingDown className="w-3 h-3 text-brand-green" />
            <span className="text-xs font-semibold text-gray-600">{t('export_risk_reduction')}</span>
          </div>
          <RiskBar level={preRedactionRiskLevel} score={preRedactionRiskScore} label={t('export_risk_before')} />
          {allRedacted ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-24 sm:w-32 shrink-0">{t('export_risk_after')}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full bg-emerald-500 w-0" />
              </div>
              <span className="text-xs font-semibold w-16 text-right text-emerald-600">{t('export_risk_clean')}</span>
            </div>
          ) : (
            <RiskBar level={residualRiskLevel} score={residualRiskScore} label={t('export_risk_kept', { count: unredactedCount })} />
          )}
          {/* Entity breakdown */}
          {entityBreakdown.length > 0 && (
            <p className="text-xs text-gray-500 pt-0.5 leading-relaxed">
              {entityBreakdown.map(([label, count], i) => (
                <span key={label}>{count} {label.toLowerCase()}{count !== 1 ? 's' : ''}{i < entityBreakdown.length - 1 ? ' · ' : ''}</span>
              ))}
              {' '}{t('export_redacted_suffix')}
              {unredactedCount > 0 ? ` · ${unredactedCount} ${t('export_kept_by_you')}` : ''}
            </p>
          )}
        </div>
      </div>

      {!allRedacted && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs text-amber-700 font-medium">
            {unredactedCount} {unredactedCount !== 1 ? t('export_unredacted_plural') : t('export_unredacted_singular')}
          </p>
          {onGoBack && (
            <button
              onClick={onGoBack}
              className="shrink-0 text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900 transition-colors"
            >
              {t('export_review_link')}
            </button>
          )}
        </div>
      )}

      {allRedacted && (
        <div className="rounded-xl border border-brand-green/20 bg-brand-green/5 px-3 py-2.5 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-green shrink-0 mt-0.5" />
          <p className="text-xs text-gray-700 leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Individual downloads — 2×2 grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {([
          { icon: <FileText className="w-4 h-4 text-brand-green" />, label: t('export_pdf_label'), hint: t('export_pdf_hint'), fn: downloadPdf },
          { icon: <RotateCcw className="w-4 h-4 text-brand-grape" />, label: t('export_map_label'), hint: t('export_map_hint'), fn: downloadKeyFile },
          { icon: <Key className="w-4 h-4 text-amber-500" />, label: t('export_key_label'), hint: t('export_key_hint'), fn: downloadRawKey },
          { icon: <ClipboardList className="w-4 h-4 text-gray-400" />, label: t('export_audit_label'), hint: t('export_audit_hint'), fn: downloadAuditReport },
        ] as const).map(({ icon, label, hint, fn }) => (
          <button key={label} onClick={fn} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors text-left">
            {icon}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{label}</p>
              <p className="text-xs text-gray-400 truncate">{hint}</p>
            </div>
            <Download className="w-3.5 h-3.5 shrink-0 text-gray-300" />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onStartOver}
          className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-300 py-2.5 rounded-xl transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t('start_over')}
        </button>
        <a
          href="https://github.com/Aqta-ai/bounds"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap"
        >
          <Star className="w-4 h-4" />
          {t('export_star')}
        </a>
      </div>
    </div>
  )
}
