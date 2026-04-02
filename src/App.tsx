import { useState, useCallback, useRef } from 'react'
import { WifiOff, ArchiveRestore, Info, FlaskConical } from 'lucide-react'
import { AboutModal } from './components/AboutModal'
import { PrivacyModal } from './components/PrivacyModal'
import type { AppStep, Detection, DetectionResult, PiiType, PipelineResult, PipelineStep, RedactionOptions } from './types'
import { DEFAULT_REDACTION_OPTIONS } from './types'
import { useLanguage } from './i18n'
import { runDetection, buildRedactedPdf } from './pipeline/RedactionPipeline'
import { terminateNERWorker } from './pipeline/NERWorker'
import { terminateOCRWorker } from './pipeline/OCRWorker'
import { findSpanBBox } from './pipeline/PDFEngine'
import { generateSummary } from './pipeline/ExplainWorker'
import { buildPrivacySummary } from './utils/summaryUtils'
import { generateDemoPdf, generateOCRDemoPdf } from './utils/demoPdf'
import { DropZone } from './components/DropZone'
import { LoadingOverlay } from './components/LoadingOverlay'
import { RedactionReview } from './components/RedactionReview'
import { ExportPanel } from './components/ExportPanel'
import { RestorePanel } from './components/RestorePanel'
import { ProgressStepper } from './components/ProgressStepper'
import { BatchPanel } from './components/BatchPanel'
import type { BatchItem } from './components/BatchPanel'

export function App() {
  const { language, setLanguage, t } = useLanguage('en')
  const [step, setStep] = useState<AppStep>(0)
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>({ stage: 'idle' })
  const [detections, setDetections] = useState<Detection[]>([])
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [restoreMode, setRestoreMode] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [reviewAiSummary, setReviewAiSummary] = useState<string | null>(null)
  const [reviewAiSummaryLoading, setReviewAiSummaryLoading] = useState(false)
  const [sampleLoading, setSampleLoading] = useState<'text' | 'ocr' | null>(null)
  const processingRef = useRef(false)

  const handleFile = useCallback(
    async (file: File) => {
      if (processingRef.current) return
      processingRef.current = true
      setStep(1)
      setError(null)
      try {
        const buf = await file.arrayBuffer()
        setPdfBuffer(buf)
        const dr = await runDetection(buf, file.name, language, (s) => setPipelineStep(s))
        setDetections(dr.detections)
        setPageCount(dr.pageCount)
        setDetectionResult(dr)
        // Show deterministic summary immediately — no spinner needed
        setReviewAiSummary(buildPrivacySummary(dr.detections))
        setReviewAiSummaryLoading(false)
        // Flan-T5 still runs in background (for audit .json), but we don't block the UI on it
        generateSummary(dr.detections).catch(() => {})
        setStep(2)
      } catch (err) {
        terminateNERWorker()
        terminateOCRWorker()
        setError(err instanceof Error ? err.message : String(err))
        setStep(0)
        setPipelineStep({ stage: 'idle' })
      } finally {
        processingRef.current = false
      }
    },
    [language],
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      if (files.length === 1) {
        await handleFile(files[0])
        return
      }
      // Batch mode: process all files sequentially with default options
      setBatchMode(true)
      const items: BatchItem[] = files.map((f) => ({
        id: `${f.name}_${Date.now()}_${Math.random()}`,
        file: f,
        status: 'queued' as const,
      }))
      setBatchItems(items)
      for (const item of items) {
        setBatchItems((prev) => prev.map((it) => it.id === item.id ? { ...it, status: 'processing' } : it))
        try {
          const buf = await item.file.arrayBuffer()
          const dr = await runDetection(buf, item.file.name, language, () => {})
          const res = await buildRedactedPdf(buf, dr.detections, dr, DEFAULT_REDACTION_OPTIONS, () => {})
          setBatchItems((prev) => prev.map((it) => it.id === item.id ? { ...it, status: 'done', result: res } : it))
        } catch (err) {
          setBatchItems((prev) => prev.map((it) => it.id === item.id ? { ...it, status: 'error', errorMsg: err instanceof Error ? err.message : String(err) } : it))
        }
      }
    },
    [handleFile, language],
  )

  const handleToggle = useCallback((id: string) => {
    setDetections((prev) =>
      prev.map((d) => (d.id === id ? { ...d, enabled: !d.enabled } : d)),
    )
  }, [])

  const handleToggleAll = useCallback((enabled: boolean, ids?: string[]) => {
    if (ids) {
      const idSet = new Set(ids)
      setDetections((prev) => prev.map((d) => idSet.has(d.id) ? { ...d, enabled } : d))
    } else {
      setDetections((prev) => prev.map((d) => ({ ...d, enabled })))
    }
  }, [])

  const handleConfirmReview = useCallback(
    async (options: RedactionOptions) => {
      if (!pdfBuffer || !detectionResult) return
      setIsExporting(true)
      setError(null)
      try {
        const res = await buildRedactedPdf(
          pdfBuffer,
          detections,
          detectionResult,
          options,
          (s) => setPipelineStep(s),
        )
        setResult(res)
        setStep(3)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsExporting(false)
      }
    },
    [pdfBuffer, detections, detectionResult],
  )

  const handleAddDetection = useCallback((text: string, type: PiiType, pageIndex: number, bboxOverride?: { x: number; y: number; width: number; height: number }) => {
    if (!detectionResult) return
    const layout = detectionResult.layouts[pageIndex]
    const bbox = bboxOverride ?? (layout ? findSpanBBox(layout.spans, text) : null) ?? { x: 0, y: 0, width: 0, height: 0 }
    setDetections((prev) => {
      const nums = prev
        .filter((d) => d.type === type)
        .map((d) => { const m = d.token.match(/_(\d+)\]$/); return m ? parseInt(m[1], 10) : 0 })
      const nextNum = nums.length ? Math.max(...nums) + 1 : 1
      const token = `[${type}_${String(nextNum).padStart(3, '0')}]`
      const detection: Detection = {
        id: `manual_${Date.now()}`,
        type,
        text,
        token,
        pageIndex,
        boundingBox: bbox,
        confidence: 1.0,
        source: 'MANUAL',
        enabled: true,
      }
      return [...prev, detection]
    })
  }, [detectionResult])

  const handleStartOver = useCallback(() => {
    terminateNERWorker()
    terminateOCRWorker()
    processingRef.current = false
    setStep(0)
    setDetections([])
    setDetectionResult(null)
    setResult(null)
    setPdfBuffer(null)
    setPageCount(1)
    setError(null)
    setPipelineStep({ stage: 'idle' })
    setBatchMode(false)
    setBatchItems([])
    setReviewAiSummary(null)
    setReviewAiSummaryLoading(false)
    setSampleLoading(null)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-3.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Bounds" className="w-8 h-8" />
            <span className="font-black text-lg text-gray-900 tracking-tight leading-none">
              b<span className="text-brand-green">●</span>unds
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAbout(true)}
              className="flex items-center gap-1.5 bg-brand-green/10 border border-brand-green/20 text-brand-green text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-brand-green/20 transition-colors select-none"
              title="Click to learn how Bounds keeps your data private"
            >
              <WifiOff className="w-3 h-3" />
              100% local · no uploads
              <Info className="w-3 h-3 opacity-60" />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-6 gap-6">
        {!restoreMode && !batchMode && <ProgressStepper current={step} t={t} />}

        {error && (
          <div className="w-full max-w-xl bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === 0 && !restoreMode && !batchMode && (
          <div className="flex flex-col items-center gap-4 w-full">
            {/* Hero */}
            <div className="text-center max-w-lg">
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight leading-tight">
                Redact PDFs.<br />Nothing leaves your device.
              </h1>
              <p className="text-base font-medium text-brand-green mt-1">
                {t('hero_tagline')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                {['GDPR Art. 9', 'FADP Art. 5', 'HIPAA', 'AES-256-GCM', '104 languages'].map((badge) => (
                  <span key={badge} className="text-xs font-medium text-gray-400 border border-gray-200 rounded-full px-2.5 py-0.5">{badge}</span>
                ))}
              </div>
            </div>

            {/* Drop zone */}
            <DropZone
              onFiles={handleFiles}
              language={language}
              onLanguageChange={setLanguage}
              t={t}
            />

            {/* Demo + Restore — wraps on narrow screens */}
            <div className="flex flex-wrap items-center justify-center gap-2 w-full">
              <button
                disabled={sampleLoading !== null}
                onClick={async () => {
                  processingRef.current = false
                  setSampleLoading('text')
                  try {
                    const file = await generateDemoPdf()
                    await handleFiles([file])
                  } finally {
                    setSampleLoading(null)
                  }
                }}
                className="flex items-center justify-center gap-2 text-sm font-medium text-brand-green hover:text-brand-green/80 border border-brand-green/30 hover:border-brand-green/50 bg-brand-green/5 hover:bg-brand-green/10 px-4 py-2 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Text-layer PDF — demos NER detection"
              >
                {sampleLoading === 'text'
                  ? <span className="w-4 h-4 border-2 border-brand-green/30 border-t-brand-green rounded-full animate-spin" />
                  : <FlaskConical className="w-4 h-4" />}
                {t('demo_sample')}
              </button>
              <button
                disabled={sampleLoading !== null}
                onClick={async () => {
                  processingRef.current = false
                  setSampleLoading('ocr')
                  try {
                    const file = await generateOCRDemoPdf()
                    await handleFiles([file])
                  } finally {
                    setSampleLoading(null)
                  }
                }}
                className="flex items-center justify-center gap-2 text-sm font-medium text-brand-grape hover:text-brand-grape/80 border border-brand-grape/30 hover:border-brand-grape/50 bg-brand-grape/5 hover:bg-brand-grape/10 px-4 py-2 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Scanned image PDF — demos OCR pipeline"
              >
                {sampleLoading === 'ocr'
                  ? <span className="w-4 h-4 border-2 border-brand-grape/30 border-t-brand-grape rounded-full animate-spin" />
                  : <FlaskConical className="w-4 h-4 shrink-0" />}
                {t('demo_ocr_sample')}
              </button>
              <button
                onClick={() => setRestoreMode(true)}
                className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-xl transition-all"
              >
                <ArchiveRestore className="w-4 h-4 text-brand-grape" />
                {t('restore_link')}
              </button>
            </div>
          </div>
        )}

        {step === 0 && restoreMode && (
          <RestorePanel t={t} onBack={() => setRestoreMode(false)} />
        )}

        {batchMode && (
          <BatchPanel items={batchItems} onStartOver={handleStartOver} />
        )}

        {step === 1 && (
          <LoadingOverlay step={pipelineStep} t={t} />
        )}

        {step === 2 && isExporting && (
          <LoadingOverlay step={pipelineStep} t={t} />
        )}

        {step === 2 && !isExporting && pdfBuffer && (
          <RedactionReview
            detections={detections}
            pdfBuffer={pdfBuffer}
            pageCount={pageCount}
            ocrFailedPages={detectionResult?.ocrFailedPages}
            onToggle={handleToggle}
            onToggleAll={handleToggleAll}
            onConfirm={handleConfirmReview}
            onStartOver={handleStartOver}
            onAddDetection={handleAddDetection}
            isExporting={isExporting}
            aiSummary={reviewAiSummary}
            aiSummaryLoading={reviewAiSummaryLoading}
            t={t}
          />
        )}

        {step === 3 && result && (
          <ExportPanel result={result} onStartOver={handleStartOver} onGoBack={() => setStep(2)} t={t} />
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-100 bg-white px-6 py-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span className="text-xs font-semibold text-gray-400 tracking-tight">b<span className="text-brand-green">●</span>unds</span>
        <span className="text-gray-200">·</span>
        <button onClick={() => setShowAbout(true)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
          {t('footer_about')}
        </button>
        <span className="text-gray-200">·</span>
        <button onClick={() => setShowPrivacy(true)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
          {t('footer_privacy')}
        </button>
        <span className="text-gray-200">·</span>
        <a
          href="https://github.com/Aqta-ai/bounds"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          {t('footer_github')}
        </a>
        <span className="text-gray-200">·</span>
        <span className="text-xs text-gray-400">Built at</span>
        <img src="/genaizurich-logo.svg" alt="GenAI Zürich Hackathon 2026" className="h-3 opacity-40" />
      </footer>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} t={t} />}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </div>
  )
}
