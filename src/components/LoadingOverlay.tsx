import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import type { PipelineStep } from '../types'
import { useNetworkGuard } from '../hooks/useNetworkGuard'
import { subscribeGemmaBackend, type GemmaBackend } from '../pipeline/GemmaWorker'

interface Props {
  step: PipelineStep
  t: (key: string, vars?: Record<string, string | number>) => string
}

function progressLabel(step: PipelineStep, t: Props['t']): string {
  switch (step.stage) {
    case 'extracting':      return t('analyse_extracting')
    case 'detecting_regex': return t('analyse_regex')
    case 'loading_model':   return t('analyse_loading_model', {
      progress: Math.round(step.modelProgress),
      model: step.modelName ?? 'AI model',
    })
    case 'detecting_ner':   return t('analyse_ner', { page: step.page, total: step.total })
    case 'detecting_ocr':   return t('analyse_ocr', { page: step.page, total: step.total })
    case 'detecting_faces': return t('analyse_faces', { page: step.page, total: step.total })
    case 'detecting_gemma': return t('analyse_gemma', { page: step.page, total: step.total })
    case 'redacting':       return t('analyse_redacting')
    case 'encrypting':      return t('analyse_encrypting')
    case 'summarizing':     return t('analyse_summarizing')
    default:                return t('analyse_loading')
  }
}

// Pipeline timeline, monotonic 0–100:
//   0–10   extracting · 10–80 per-page detection · 80–95 redacting ·
//   95–97  encrypting · 97–100 summarising + done.
// loading_model overlays the first 3% of detection so a fresh model
// download does not make the bar jump backwards on first inference.
const DETECT_START = 10
const DETECT_END = 80
const DETECT_WIDTH = DETECT_END - DETECT_START
const SUB_STAGE_COUNT = 5

function perPage(page: number, total: number, subStage: number): number {
  if (!total || total <= 0) return DETECT_START
  const pageSlice = DETECT_WIDTH / total
  const sub = Math.max(0, Math.min(SUB_STAGE_COUNT, subStage))
  return DETECT_START + (page - 1) * pageSlice + (sub / SUB_STAGE_COUNT) * pageSlice
}

function progressValue(step: PipelineStep): number {
  switch (step.stage) {
    case 'extracting':      return step.progress * 0.10
    case 'loading_model':   return DETECT_START + (step.modelProgress / 100) * 3
    case 'detecting_ocr':   return perPage(step.page, step.total, 0)
    case 'detecting_regex': return perPage(step.page, step.total, 1)
    case 'detecting_ner':   return perPage(step.page, step.total, 2)
    case 'detecting_faces': return perPage(step.page, step.total, 3)
    case 'detecting_gemma': return perPage(step.page, step.total, 4)
    case 'redacting':       return 80 + step.progress * 0.15
    case 'encrypting':      return 95
    case 'summarizing':     return 97
    case 'done':            return 100
    default:                return 0
  }
}

export function LoadingOverlay({ step, t }: Props) {
  const pct = Math.round(progressValue(step))
  const label = progressLabel(step, t)
  const { requestCount } = useNetworkGuard()
  const [gemmaBackend, setGemmaBackend] = useState<GemmaBackend | null>(null)

  useEffect(() => {
    return subscribeGemmaBackend((backend) => setGemmaBackend(backend))
  }, [])

  const isDownloading = step.stage === 'loading_model'

  const gemmaBackendLabel =
    gemmaBackend === 'ollama' ? 'Gemma 4 · Ollama'
    : gemmaBackend === 'webllm' ? 'Gemma 4 · WebLLM'
    : null

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto py-12">
      <Loader2 className="w-10 h-10 text-brand-blue animate-spin" />
      <div className="text-center">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {isDownloading ? (
          <div className="mt-1 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">
              {t('loading_model_mb', {
                downloaded: Math.round((step.modelProgress / 100) * (step.modelSizeMB ?? 430)),
                total: step.modelSizeMB ?? 430,
              })}
            </p>
            <p className="text-xs text-gray-400">
              {t('loading_model_local')}
            </p>
          </div>
        ) : null}
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className="bg-brand-blue h-2 rounded-full transition-all duration-500"
          style={{ width: `${isDownloading ? Math.round(step.modelProgress) : pct}%` }}
        />
      </div>
      {!isDownloading && (
        <p className="text-xs text-gray-400">{pct}%</p>
      )}

      {gemmaBackendLabel && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-green border border-brand-green/30 bg-brand-green/5 rounded-full px-2.5 py-0.5">
          <Sparkles className="w-3 h-3" aria-hidden />
          {gemmaBackendLabel}
        </span>
      )}

      <div className="w-full border border-brand-green/30 bg-brand-green/5 rounded-xl px-4 py-3 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-xs font-semibold text-brand-green">{t('loading_never_leaves')}</p>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>
              {t('loading_doc_uploads')} <span className="font-semibold text-brand-green">0 bytes</span>
            </span>
            <span>
              {t('loading_network_requests')} <span className="font-semibold text-gray-700">{requestCount}</span>
              {requestCount > 0 && <span className="text-gray-400"> {t('loading_ai_model_only')}</span>}
            </span>
          </div>
          <p className="text-[10px] text-gray-400 leading-tight">
            {t('loading_verify_hint')}
          </p>
        </div>
      </div>
    </div>
  )
}
