import { useState, useCallback } from 'react'
import { WifiOff, ArchiveRestore, Info } from 'lucide-react'
import { AboutModal } from './components/AboutModal'
import type { AppStep, Detection, DetectionResult, PiiType, PipelineResult, PipelineStep, RedactionOptions } from './types'
import { useLanguage } from './i18n'
import { runDetection, buildRedactedPdf } from './pipeline/RedactionPipeline'
import { terminateNERWorker } from './pipeline/NERWorker'
import { terminateOCRWorker } from './pipeline/OCRWorker'
import { findSpanBBox } from './pipeline/PDFEngine'
import { DropZone } from './components/DropZone'
import { LoadingOverlay } from './components/LoadingOverlay'
import { RedactionReview } from './components/RedactionReview'
import { ExportPanel } from './components/ExportPanel'
import { RestorePanel } from './components/RestorePanel'
import { ProgressStepper } from './components/ProgressStepper'

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

  const handleFile = useCallback(
    async (file: File) => {
      setStep(1)
      setError(null)
      try {
        const buf = await file.arrayBuffer()
        setPdfBuffer(buf)
        const dr = await runDetection(buf, file.name, language, (s) => setPipelineStep(s))
        setDetections(dr.detections)
        setPageCount(dr.pageCount)
        setDetectionResult(dr)
        setStep(2)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStep(0)
        setPipelineStep({ stage: 'idle' })
      }
    },
    [language],
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

  const handleAddDetection = useCallback((text: string, type: PiiType, pageIndex: number) => {
    if (!detectionResult) return
    const layout = detectionResult.layouts[pageIndex]
    const bbox = (layout ? findSpanBBox(layout.spans, text) : null) ?? { x: 0, y: 0, width: 0, height: 0 }
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
    setStep(0)
    setDetections([])
    setDetectionResult(null)
    setResult(null)
    setPdfBuffer(null)
    setPageCount(1)
    setError(null)
    setPipelineStep({ stage: 'idle' })
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-3.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Bounds" className="w-8 h-8" />
            <span className="font-bold text-base text-brand-green tracking-tight">{t('app_title')}</span>
          </div>
          <div
            className="flex items-center gap-1.5 bg-brand-green/10 border border-brand-green/20 text-brand-green text-xs font-semibold px-3 py-1.5 rounded-full cursor-default select-none"
            title="No data leaves your device. All AI inference, PDF processing, and encryption run locally in your browser using WebAssembly."
          >
            <WifiOff className="w-3 h-3" />
            {t('privacy_badge')}
            <Info className="w-3 h-3 opacity-60" />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-10">
        {!restoreMode && <ProgressStepper current={step} />}

        {error && (
          <div className="w-full max-w-xl bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === 0 && !restoreMode && (
          <div className="flex flex-col items-center gap-4 w-full">
            <DropZone
              onFile={handleFile}
              language={language}
              onLanguageChange={setLanguage}
              t={t}
            />
            <button
              onClick={() => setRestoreMode(true)}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
            >
              <ArchiveRestore className="w-4 h-4" />
              {t('restore_link')}
            </button>
          </div>
        )}

        {step === 0 && restoreMode && (
          <RestorePanel t={t} onBack={() => setRestoreMode(false)} />
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
            t={t}
          />
        )}

        {step === 3 && result && (
          <ExportPanel result={result} onStartOver={handleStartOver} t={t} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-3 text-center">
        <p className="text-xs text-gray-400">
          Built by Anya, Aqta · MIT License{' · '}
          <button
            onClick={() => setShowAbout(true)}
            className="underline underline-offset-2 hover:text-gray-600 transition-colors"
          >
            About
          </button>
        </p>
      </footer>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  )
}
