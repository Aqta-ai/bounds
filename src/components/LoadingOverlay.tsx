import { Loader2 } from 'lucide-react'
import type { PipelineStep } from '../types'

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
    case 'detecting_ner':   return 65 + (step.page / step.total) * 5
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

  const isDownloading = step.stage === 'loading_model'

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto py-12">
      <Loader2 className="w-10 h-10 text-brand-blue animate-spin" />
      <div className="text-center">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {isDownloading && (
          <p className="text-xs text-gray-400 mt-1">
            One-time download (~430 MB), this is the AI model that detects names and organisations.
            <br />
            Cached in your browser after this, so future scans start instantly.
          </p>
        )}
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className="bg-brand-blue h-2 rounded-full transition-all duration-500"
          style={{ width: `${isDownloading ? Math.round(step.modelProgress) : pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-400">
        {isDownloading ? `${Math.round(step.modelProgress)}%` : `${pct}%`}
      </p>
    </div>
  )
}
