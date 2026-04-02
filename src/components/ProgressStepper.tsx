import { Check } from 'lucide-react'
import type { AppStep } from '../types'

interface Props {
  current: AppStep
  t: (key: string) => string
}

export function ProgressStepper({ current, t }: Props) {
  const steps = [t('step_upload'), t('step_analyse'), t('step_review'), t('step_export')]
  return (
    <div className="flex items-center gap-0">
      {steps.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                  done
                    ? 'bg-[#009B72] text-white'
                    : active
                      ? 'bg-[#009B72] text-white shadow-[0_0_0_4px_rgba(0,155,114,0.2)]'
                      : 'bg-white border-2 border-gray-300 text-gray-500'
                }`}
              >
                {done ? <Check className="w-4 h-4 stroke-[2.5]" /> : i + 1}
              </div>
              <span
                className={`mt-1 text-xs font-medium ${
                  active ? 'text-[#009B72]' : done ? 'text-[#009B72]' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-0.5 w-16 mx-1 mb-5 transition-all ${
                  i < current ? 'bg-[#009B72]' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
