import { X, WifiOff, HardDrive, Eye, Code, Cookie, ShieldCheck } from 'lucide-react'

interface Props {
  onClose: () => void
}

export function PrivacyModal({ onClose }: Props) {
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

        <div className="flex items-center gap-2.5 mb-1">
          <ShieldCheck className="w-5 h-5 text-brand-green" />
          <h2 className="font-bold text-gray-900 text-lg">Privacy policy</h2>
        </div>
        <p className="text-xs text-gray-400 mb-5">Effective 1 April 2026 · bounds.aqta.ai</p>

        <div className="space-y-4 mb-6">
          <div className="flex items-start gap-3">
            <WifiOff className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">No data ever leaves your device</p>
              <p className="text-xs text-gray-500 mt-0.5">All PDF processing, AI inference, and encryption happens entirely inside your browser. We have no server that receives your files - not even metadata.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Eye className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">No analytics, no tracking</p>
              <p className="text-xs text-gray-500 mt-0.5">We do not use Google Analytics, Mixpanel, or any other tracking service. We do not know how many people use Bounds or what documents they process.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Cookie className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">No cookies</p>
              <p className="text-xs text-gray-500 mt-0.5">Bounds sets no cookies. Your language preference is stored in <code className="text-xs bg-gray-100 px-1 rounded">localStorage</code> on your device only - never sent anywhere.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <HardDrive className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">What stays on your device</p>
              <p className="text-xs text-gray-500 mt-0.5">AI models (BERT, Tesseract) are cached in your browser's IndexedDB after the first load. You can clear them any time via browser settings. No personal data is ever cached.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Code className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">Open source and auditable</p>
              <p className="text-xs text-gray-500 mt-0.5">Every claim above is verifiable. Open DevTools, go to Network, and upload a PDF — you will see zero outgoing requests. The full source is on GitHub under MIT licence.</p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 flex items-center justify-between">
          <span className="text-xs text-gray-400">Bounds · <a href="mailto:hello@aqta.ai" className="text-brand-green hover:underline">hello@aqta.ai</a></span>
          <a
            href="https://github.com/Aqta-ai/bounds"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            View source
          </a>
        </div>
      </div>
    </div>
  )
}
