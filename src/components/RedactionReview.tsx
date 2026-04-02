import { useState, useMemo, useCallback } from 'react'
import { CheckSquare, Square, ChevronLeft, ChevronRight, Loader2, UploadCloud, ShieldCheck, Plus, X, Sparkles, Pencil, MessageSquarePlus } from 'lucide-react'
import type { Annotation, BBox, Detection, PiiType, RedactionOptions } from '../types'
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
  onAddDetection: (text: string, type: PiiType, pageIndex: number, bboxOverride?: BBox) => void
  isExporting?: boolean
  aiSummary?: string | null
  aiSummaryLoading?: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
}

// ---------------------------------------------------------------------------
// Confidence histogram — mini bar chart showing how detections are distributed
// across confidence levels. Makes it clear why moving the slider in the 50–90%
// range often doesn't change the count (most detections cluster at >90%).
// ---------------------------------------------------------------------------
function ConfidenceHistogram({ detections, threshold }: { detections: Detection[]; threshold: number }) {
  const BUCKETS = 10
  const counts = new Array<number>(BUCKETS).fill(0)
  for (const d of detections) {
    const bucket = Math.min(BUCKETS - 1, Math.floor(d.confidence * BUCKETS))
    counts[bucket]++
  }
  const max = Math.max(...counts, 1)
  return (
    <div className="flex items-end gap-px h-6" title="Detection confidence distribution">
      {counts.map((count, i) => {
        const bucketMin = i / BUCKETS
        const active = bucketMin >= threshold
        const pct = Math.round((count / max) * 100)
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-all ${active ? 'bg-brand-green/60' : 'bg-gray-200'}`}
            style={{ height: `${Math.max(pct, count > 0 ? 15 : 0)}%` }}
            title={`${Math.round(bucketMin * 100)}–${Math.round((i + 1) / BUCKETS * 100)}%: ${count}`}
          />
        )
      })}
    </div>
  )
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
  aiSummary,
  aiSummaryLoading = false,
  t,
}: Props) {
  const [threshold, setThreshold] = useState(0.7)
  const [activePage, setActivePage] = useState(0)
  const [options, setOptions] = useState<RedactionOptions>(DEFAULT_REDACTION_OPTIONS)
  const [showManual, setShowManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const [manualType, setManualType] = useState<PiiType>('MISC')
  const [manualPage, setManualPage] = useState(0)
  const [drawMode, setDrawMode] = useState(false)
  const [pendingBox, setPendingBox] = useState<{ bbox: BBox; pageIndex: number } | null>(null)
  const [pendingBoxType, setPendingBoxType] = useState<PiiType>('MISC')
  const [pendingBoxLabel, setPendingBoxLabel] = useState('')
  const [annotateMode, setAnnotateMode] = useState(false)
  const [pendingAnnotation, setPendingAnnotation] = useState<{ bbox: BBox; pageIndex: number } | null>(null)
  const [pendingAnnotationText, setPendingAnnotationText] = useState('')

  const handleManualAdd = useCallback(() => {
    if (!manualText.trim()) return
    onAddDetection(manualText.trim(), manualType, manualPage)
    setManualText('')
    setShowManual(false)
  }, [manualText, manualType, manualPage, onAddDetection])

  const handleBoxDrawn = useCallback((bbox: BBox) => {
    setDrawMode(false)
    setPendingBox({ bbox, pageIndex: activePage })
    setPendingBoxLabel('')
  }, [activePage])

  const handlePendingBoxConfirm = useCallback(() => {
    if (!pendingBox) return
    onAddDetection(pendingBoxLabel.trim() || `drawn_${pendingBoxType.toLowerCase()}`, pendingBoxType, pendingBox.pageIndex, pendingBox.bbox)
    setPendingBox(null)
    setPendingBoxLabel('')
  }, [pendingBox, pendingBoxLabel, pendingBoxType, onAddDetection])

  const handleAnnotationDrawn = useCallback((bbox: BBox) => {
    setAnnotateMode(false)
    setPendingAnnotation({ bbox, pageIndex: activePage })
    setPendingAnnotationText('')
  }, [activePage])

  const handleAnnotationConfirm = useCallback(() => {
    if (!pendingAnnotation || !pendingAnnotationText.trim()) return
    const ann: Annotation = {
      id: `ann_${Date.now()}`,
      page: pendingAnnotation.pageIndex + 1,
      text: pendingAnnotationText.trim(),
      bbox: pendingAnnotation.bbox,
    }
    setOptions((prev) => ({ ...prev, annotations: [...prev.annotations, ann] }))
    setPendingAnnotation(null)
    setPendingAnnotationText('')
  }, [pendingAnnotation, pendingAnnotationText])

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
                  {t('review_add')}
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
          <span className="font-semibold">{t('review_ocr_warning')}</span>{' '}
          {ocrFailedPages.length > 1 ? t('review_ocr_failed_pages_plural') : t('review_ocr_failed_pages')}{' '}
          {ocrFailedPages.join(', ')}.{' '}
          {t('review_ocr_add_hint')}
        </div>
      )}

      {/* Controls bar */}
      <div className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-2">
        <ConfidenceSlider value={threshold} onChange={setThreshold} label={t('review_confidence')} />
        {/* Confidence histogram — shows why mid-range slider moves may not change count */}
        <ConfidenceHistogram detections={detections} threshold={threshold} />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{enabledCount}</span>
            <span className="text-gray-400"> {t('review_of')} </span>
            <span className="font-semibold text-gray-900">{visible.length}</span>
            <span className="text-gray-500"> {t('review_selected')}</span>
          </span>
          <button
            onClick={() => onToggleAll(!allEnabled, visible.map((d) => d.id))}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            {allEnabled ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {t('review_toggle_all')}
          </button>
        </div>
      </div>

      {/* AI privacy summary — Flan-T5 generated, streamed in as ready */}
      {(aiSummary || aiSummaryLoading) && (
        <div className="rounded-xl border border-brand-green/25 bg-brand-green/5 px-4 py-3 flex gap-3 items-start">
          <Sparkles className="w-4 h-4 text-brand-green shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-brand-green uppercase tracking-wide mb-1">{t('review_privacy_analysis')}</p>
            {aiSummaryLoading && !aiSummary ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('review_generating_summary')}
              </div>
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">{aiSummary}</p>
            )}
          </div>
        </div>
      )}

      {/* Two-column layout: PDF viewer left, badge list + options right */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">

        {/* Left: live PDF page viewer */}
        <div className="flex flex-col gap-2 min-w-0">
          {/* Draw mode toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setDrawMode((m) => !m); setAnnotateMode(false); setPendingBox(null) }}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                drawMode
                  ? 'bg-brand-green text-white border-brand-green'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-brand-green hover:text-brand-green'
              }`}
            >
              <Pencil className="w-3 h-3" />
              {drawMode ? t('review_draw_mode_active') : t('review_redact_box')}
            </button>
            <button
              onClick={() => { setAnnotateMode((m) => !m); setDrawMode(false); setPendingAnnotation(null) }}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                annotateMode
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-amber-400 hover:text-amber-600'
              }`}
            >
              <MessageSquarePlus className="w-3 h-3" />
              {annotateMode ? t('review_draw_mode_active') : t('review_add_note_btn')}
            </button>
            {(drawMode || annotateMode) && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${
                annotateMode
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-brand-green/10 text-brand-green'
              }`}>
                {t('review_draw_hint')}
              </span>
            )}
          </div>
          <PDFPageViewer
            pdfBuffer={pdfBuffer}
            pageIndex={activePage}
            detections={visible}
            onToggle={onToggle}
            scale={1.2}
            redactionColor={options.color}
            previewUnavailableText={t('preview_unavailable')}
            drawMode={drawMode}
            onBoxDrawn={handleBoxDrawn}
            annotateMode={annotateMode}
            onAnnotationDrawn={handleAnnotationDrawn}
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
                    className={`w-8 h-8 rounded text-xs font-semibold transition-colors ${
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
        <div className="flex-1 w-full flex flex-col gap-3">
          <div className="max-h-[50vh] lg:max-h-[380px] overflow-y-auto pr-1 flex flex-col gap-3">
            {grouped.length > 0 ? (
              grouped.map(([typeLabel, dets]) => {
                const sources = [...new Set(dets.map((d) => d.source))]
                const sourceLabel = sources.map((s) =>
                  s === 'NER' ? t('review_source_ner') : s === 'REGEX' ? t('review_source_regex') : s === 'MANUAL' ? t('review_source_manual') : t('review_source_ocr')
                ).join(' · ')
                return (
                <div key={typeLabel}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {typeLabel} ({dets.length})
                    </p>
                    <span className="text-xs text-gray-300 font-normal lowercase">{sourceLabel}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dets.map((d) => (
                      <RedactionBadge key={d.id} detection={d} onToggle={onToggle} />
                    ))}
                  </div>
                </div>
                )
              })
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">
                {pagesWithDetections.length > 0
                  ? t('review_no_detections_page', { page: activePage + 1 })
                  : t('review_no_detections_threshold')}
              </p>
            )}
          </div>

          {/* Pending drawn box — confirm type before adding */}
          {pendingBox && (
            <div className="border border-brand-green/25 bg-brand-green/5 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-brand-green uppercase tracking-wide">{t('review_confirm_box')}</span>
                <button onClick={() => setPendingBox(null)}>
                  <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
              <input
                type="text"
                value={pendingBoxLabel}
                onChange={(e) => setPendingBoxLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePendingBoxConfirm()}
                placeholder={t('review_box_label_placeholder')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-green/30 bg-white"
                autoFocus
              />
              <div className="flex gap-2">
                <select
                  value={pendingBoxType}
                  onChange={(e) => setPendingBoxType(e.target.value as PiiType)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-green/30 bg-white"
                >
                  {Object.entries(PII_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button
                  onClick={handlePendingBoxConfirm}
                  className="px-4 py-2 bg-brand-green text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
                >
                  {t('review_add')}
                </button>
              </div>
            </div>
          )}

          {/* Pending annotation — type note text before confirming */}
          {pendingAnnotation && (
            <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">{t('review_note_on_page', { page: pendingAnnotation.pageIndex + 1 })}</span>
                <button onClick={() => setPendingAnnotation(null)}>
                  <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
              <textarea
                value={pendingAnnotationText}
                onChange={(e) => setPendingAnnotationText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnnotationConfirm() } }}
                placeholder={t('review_note_placeholder')}
                rows={2}
                className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-none"
                autoFocus
              />
              <button
                onClick={handleAnnotationConfirm}
                disabled={!pendingAnnotationText.trim()}
                className="w-full px-4 py-2 bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors"
              >
                {t('review_add_note_pdf')}
              </button>
            </div>
          )}

          {/* Manual redaction add */}
          <div className="border border-gray-200 rounded-xl p-3">
            {!showManual ? (
              <button
                onClick={() => { setShowManual(true); setManualPage(activePage) }}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-brand-green hover:bg-brand-green/5 border border-brand-green/30 hover:border-brand-green/60 rounded-lg py-2 px-3 transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
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
                    {t('review_add')}
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
