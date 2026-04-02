import { Loader2, ShieldCheck } from 'lucide-react'
import type { PipelineStep } from '../types'
import { useNetworkGuard } from '../hooks/useNetworkGuard'

interface Props {
  step: PipelineStep
  t: (key: string, vars?: Record<string, string | number>) => string
}

function progressLabel(step: PipelineStep, t: Props['t']): string {
  switch (step.stage) {
    case 'extracting':      return t('analyse_extracting')
    case 'detecting_regex': return t('analyse_regex')
    case 'loading_model':   return t('analyse_loading_model', { progress: Math.round(step.modelProgress) })
    case 'detecting_ner':   return t('analyse_ner', { page: step.page, total: step.total })
    case 'detecting_ocr':   return t('analyse_ocr', { page: step.page, total: step.total })
    case 'detecting_faces': return t('analyse_faces', { page: step.page, total: step.total })
    case 'redacting':       return t('analyse_redacting')
    case 'encrypting':      return t('analyse_encrypting')
    case 'summarizing':     return t('analyse_summarizing')
    default:                return t('analyse_loading')
  }
}

function progressValue(step: PipelineStep): number {
  switch (step.stage) {
    case 'extracting':      return step.progress * 0.15
    case 'detecting_regex': return 15 + step.progress * 0.15
    case 'loading_model':   return 50 + step.modelProgress * 0.15
    case 'detecting_ocr':   return 30 + (step.page / step.total) * 20
    case 'detecting_ner':   return 65 + (step.page / step.total) * 4
    case 'detecting_faces': return 69 + (step.page / step.total) * 2
    case 'redacting':       return 70 + step.progress * 0.2
    case 'encrypting':      return 90
    case 'summarizing':     return 93
    case 'done':            return 100
    default:                return 0
  }
}

export function LoadingOverlay({ step, t }: Props) {
  const pct = Math.round(progressValue(step))
  const label = progressLabel(step, t)
  const { requestCount } = useNetworkGuard()

  const isDownloading = step.stage === 'loading_model'

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto py-12">
      <Loader2 className="w-10 h-10 text-brand-blue animate-spin" />
      <div className="text-center">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {isDownloading ? (
          <div className="mt-1 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">
              {t('loading_model_mb', { downloaded: Math.round((step.modelProgress / 100) * 430) })}
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

      {/* Live privacy proof widget */}
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
