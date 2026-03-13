import { useState, useMemo, useCallback } from 'react'
import { CheckSquare, Square, ChevronLeft, ChevronRight, Loader2, UploadCloud, ShieldCheck, Plus, X } from 'lucide-react'
import type { Detection, PiiType, RedactionOptions } from '../types'
import { DEFAULT_REDACTION_OPTIONS } from '../types'
import { RedactionBadge } from './RedactionBadge'
import { ConfidenceSlider } from './ConfidenceSlider'
import { PDFPageViewer } from './PDFPageViewer'
import { RedactionOptionsPanel } from './RedactionOptionsPanel'
import { RiskBadge } from './RiskBadge'
import { PiiBreakdown } from './PiiBreakdown'
import { PII_TYPE_LABELS } from '../utils/colors'
import { computeRisk } from '../pipeline/RedactionPipeline'

interface Props {
  detections: Detection[]
  pdfBuffer: ArrayBuffer
  pageCount: number
  ocrFailedPages?: number[]
  onToggle: (id: string) => void
  onToggleAll: (enabled: boolean, ids?: string[]) => void
  onConfirm: (options: RedactionOptions) => void
  onStartOver: () => void
  onAddDetection: (text: string, type: PiiType, pageIndex: number) => void
  isExporting?: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
}

/** Returns page indices (0-based) + null for ellipsis gaps. */
function paginationItems(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i)
  const delta = 2
  const range: number[] = []
  for (let i = Math.max(1, current - delta); i <= Math.min(total - 2, current + delta); i++) {
    range.push(i)
  }
  const items: (number | null)[] = [0]
  if (range[0] > 1) items.push(null)
  items.push(...range)
  if (range[range.length - 1] < total - 2) items.push(null)
  items.push(total - 1)
  return items
}

export function RedactionReview({
  detections,
  pdfBuffer,
  pageCount,
  ocrFailedPages = [],
  onToggle,
  onToggleAll,
  onConfirm,
  onStartOver,
  onAddDetection,
  isExporting = false,
  t,
}: Props) {
  const [threshold, setThreshold] = useState(0.5)
  const [activePage, setActivePage] = useState(0)
  const [options, setOptions] = useState<RedactionOptions>(DEFAULT_REDACTION_OPTIONS)
  const [showManual, setShowManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const [manualType, setManualType] = useState<PiiType>('MISC')
  const [manualPage, setManualPage] = useState(0)

  const handleManualAdd = useCallback(() => {
    if (!manualText.trim()) return
    onAddDetection(manualText.trim(), manualType, manualPage)
    setManualText('')
    setShowManual(false)
  }, [manualText, manualType, manualPage, onAddDetection])

  const visible = useMemo(
    () => detections.filter((d) => d.confidence >= threshold),
    [detections, threshold],
  )

  const allEnabled = visible.every((d) => d.enabled)

  const pagesWithDetections = useMemo(() => {
    const s = new Set(visible.map((d) => d.pageIndex))
    return [...s].sort((a, b) => a - b)
  }, [visible])

  const pageDetections = useMemo(
    () => visible.filter((d) => d.pageIndex === activePage),
    [visible, activePage],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, Detection[]>()
    for (const d of pageDetections) {
      const key = PII_TYPE_LABELS[d.type]
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [pageDetections])

  const enabledCount = visible.filter((d) => d.enabled).length
  const { riskLevel, riskScore } = useMemo(() => computeRisk(visible), [visible])
  const isCleanDocument = detections.length === 0

  // For clean docs: allow proceeding with 0 redactions (produces a clean export)
  const handleConfirmClean = useCallback(() => {
    onConfirm(DEFAULT_REDACTION_OPTIONS)
  }, [onConfirm])

  // ── Zero-detections "clean document" screen ──────────────────────────────
  if (isCleanDocument) {
    return (
      <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto py-12 text-center">
        <div className="rounded-full bg-emerald-100 p-5">
          <ShieldCheck className="w-10 h-10 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('review_clean_title')}</h2>
          <p className="text-sm text-gray-500 mt-1.5">{t('review_clean_subtitle')}</p>
        </div>
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={handleConfirmClean}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 bg-brand-green text-white px-5 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm disabled:opacity-50"
          >
            {isExporting && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('review_clean_confirm')}
          </button>
          <button
            onClick={onStartOver}
            className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors py-2"
          >
            <UploadCloud className="w-4 h-4" />
            {t('review_upload_new')}
          </button>
        </div>
        {/* Let user manually add something even on a "clean" doc */}
        <div className="w-full border border-dashed border-gray-200 rounded-xl p-3">
          {!showManual ? (
            <button
              onClick={() => setShowManual(true)}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 py-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              '{t('review_add_manually_hint')}'
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('review_add_manually_label')}</span>
                <button onClick={() => { setShowManual(false); setManualText('') }}>
                  <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
              <input
                type="text"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
                placeholder={t('review_add_manually_placeholder')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                autoFocus
              />
              <div className="flex gap-2">
                <select
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value as PiiType)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-green/30 bg-white"
                >
                  {Object.entries(PII_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button
                  onClick={handleManualAdd}
                  disabled={!manualText.trim()}
                  className="px-4 py-2 bg-brand-green text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('review_title')}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t('review_subtitle')}</p>
        </div>
        <button
          onClick={onStartOver}
          disabled={isExporting}
          className="shrink-0 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-3 py-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <UploadCloud className="w-4 h-4" />
          {t('review_upload_new')}
        </button>
      </div>

      {/* OCR failure warning */}
      {ocrFailedPages.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Scanned page detected,</span>{' '}
          OCR could not extract text from page{ocrFailedPages.length > 1 ? 's' : ''}{' '}
          {ocrFailedPages.join(', ')}. PII in embedded images may be missed.
          Use <span className="font-semibold">Add manually</span> to mark any sensitive fields below.
        </div>
      )}

      {/* Controls bar */}
      <div className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-2">
        <ConfidenceSlider value={threshold} onChange={setThreshold} label={t('review_confidence')} />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">{t('review_count', { n: visible.length })}</span>
          <button
            onClick={() => onToggleAll(!allEnabled, visible.map((d) => d.id))}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            {allEnabled ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {t('review_toggle_all')}
          </button>
        </div>
      </div>

      {/* Two-column layout: PDF viewer left, badge list + options right */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">

        {/* Left: live PDF page viewer */}
        <div className="flex flex-col gap-2 min-w-0">
          <PDFPageViewer
            pdfBuffer={pdfBuffer}
            pageIndex={activePage}
            detections={visible}
            onToggle={onToggle}
            scale={1.2}
            redactionColor={options.color}
            previewUnavailableText={t('preview_unavailable')}
          />

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={() => setActivePage((p) => Math.max(0, p - 1))}
                disabled={activePage === 0}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {paginationItems(activePage, pageCount).map((item, idx) =>
                item === null ? (
                  <span key={`ellipsis-${idx}`} className="w-7 text-center text-xs text-gray-400 select-none">…</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setActivePage(item)}
                    className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${
                      item === activePage
                        ? 'bg-brand-green text-white'
                        : pagesWithDetections.includes(item)
                          ? 'bg-brand-green/15 text-brand-green hover:bg-brand-green/25'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {item + 1}
                  </button>
                )
              )}
              <button
                onClick={() => setActivePage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={activePage === pageCount - 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Right: detection list + options panel */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="max-h-[380px] overflow-y-auto pr-1 flex flex-col gap-3">
            {grouped.length > 0 ? (
              grouped.map(([typeLabel, dets]) => (
                <div key={typeLabel}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    {typeLabel} ({dets.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {dets.map((d) => (
                      <RedactionBadge key={d.id} detection={d} onToggle={onToggle} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">
                {pagesWithDetections.length > 0
                  ? t('review_no_detections_page', { page: activePage + 1 })
                  : t('review_no_detections_threshold')}
              </p>
            )}
          </div>

          {/* Manual redaction add */}
          <div className="border border-dashed border-gray-200 rounded-xl p-3">
            {!showManual ? (
              <button
                onClick={() => { setShowManual(true); setManualPage(activePage) }}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 py-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('review_add_manually_hint')}
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('review_add_manually_label')}</span>
                  <button onClick={() => { setShowManual(false); setManualText('') }}>
                    <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                  </button>
                </div>
                <input
                  type="text"
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
                  placeholder={t('review_add_manually_placeholder')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                  autoFocus
                />
                <div className="flex gap-2">
                  <select
                    value={manualType}
                    onChange={(e) => setManualType(e.target.value as PiiType)}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-green/30 bg-white"
                  >
                    {Object.entries(PII_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleManualAdd}
                    disabled={!manualText.trim()}
                    className="px-4 py-2 bg-brand-green text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    Add
                  </button>
                </div>
                {pageCount > 1 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{t('review_on_page')}</span>
                    <select
                      value={manualPage}
                      onChange={(e) => setManualPage(Number(e.target.value))}
                      className="border border-gray-200 rounded px-2 py-1 focus:outline-none bg-white text-xs"
                    >
                      {Array.from({ length: pageCount }, (_, i) => (
                        <option key={i} value={i}>{t('review_page_label')} {i + 1}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PII breakdown + risk score */}
          <PiiBreakdown detections={visible} />
          <RiskBadge level={riskLevel} score={riskScore} t={t} />

          {/* Redaction options */}
          <RedactionOptionsPanel options={options} onChange={setOptions} t={t} />

          {/* Apply redaction button — anchored below options */}
          <button
            onClick={() => onConfirm(options)}
            disabled={isExporting || enabledCount === 0}
            className="w-full flex items-center justify-center gap-2 bg-brand-green text-white px-5 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('review_confirm')} ({enabledCount})
          </button>
        </div>
      </div>
    </div>
  )
}
