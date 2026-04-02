import { X, Github, Shield, Cpu, Lock, ScanText, FileText } from 'lucide-react'

interface AboutModalProps {
  onClose: () => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

export function AboutModal({ onClose, t }: AboutModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <img src="/logo.svg" alt="Bounds" className="w-8 h-8" />
          <div>
            <h2 className="font-black text-lg text-gray-900 tracking-tight leading-none">
              b<span className="text-brand-green">●</span>unds
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">v0.2.0</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-5">
          {t('about_tagline')}
        </p>

        <ul className="space-y-2.5 mb-6">
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <Shield className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>{t('about_zero_network')}</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <Cpu className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>{t('about_bert_stack')}</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <Lock className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>{t('about_reversible')}</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <ScanText className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>{t('about_annotations')}</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <FileText className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>{t('about_audit')}</span>
          </li>
        </ul>

        <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {['GDPR', 'FADP', 'HIPAA', 'AES-256-GCM', 'MIT Licence'].map((badge) => (
              <span key={badge} className="text-xs font-medium text-gray-500 border border-gray-200 rounded-full px-2.5 py-0.5">{badge}</span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{t('about_built_by')}</span>
            <a
              href="https://github.com/Aqta-ai/bounds"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              <Github className="w-3.5 h-3.5" />
              {t('about_source')}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
