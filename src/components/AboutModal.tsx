import { X, Github, Shield, Cpu, Lock } from 'lucide-react'

interface AboutModalProps {
  onClose: () => void
}

export function AboutModal({ onClose }: AboutModalProps) {
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
            <h2 className="font-bold text-base text-brand-green tracking-tight">bounds</h2>
            <p className="text-xs text-gray-400">v0.1.0</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-5">
          Redact personally identifiable information from PDFs entirely in your browser.
          No files are ever uploaded or shared.
        </p>

        <ul className="space-y-2.5 mb-6">
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <Shield className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>All AI inference runs locally via WebAssembly — zero network requests</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <Cpu className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>BERT multilingual NER model for names, combined with regex for structured PII</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-gray-600">
            <Lock className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <span>Redactions are reversible: AES-256 encrypted key file lets you restore original values</span>
          </li>
        </ul>

        <div className="border-t border-gray-100 pt-4 flex items-center justify-between">
          <span className="text-xs text-gray-400">Built by <span className="font-medium text-gray-600">Anya, Aqta</span> · MIT License</span>
          <a
            href="https://github.com/Aqta-ai/bounds"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
          >
            <Github className="w-3.5 h-3.5" />
            Source
          </a>
        </div>
      </div>
    </div>
  )
}
