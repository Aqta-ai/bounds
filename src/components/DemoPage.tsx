// /demo — autoplaying 30-second walkthrough.
//
// Eight scripted beats run in a loop: opening, regex blind spot, five
// detection layers, Gemma close-up, review panel, privacy proof, vault,
// closing. Each beat sets headline + body component. Cross-fade between
// beats; pause/restart controls so a viewer can stop on any frame.
//
// Self-contained: every body component is mocked locally so the demo
// runs without the redaction pipeline, the Tesseract model, or any
// network access. The route is mounted from main.tsx when the pathname
// is /demo.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, FileText, KeyRound, Lock, Pause, Play, RotateCcw, ShieldCheck,
  Sparkles, WifiOff,
} from 'lucide-react'

type Scene =
  | 'opening'
  | 'regex_blind'
  | 'five_layers'
  | 'gemma_closeup'
  | 'review'
  | 'privacy'
  | 'vault'
  | 'closing'

interface Beat {
  scene: Scene
  durationMs: number
  eyebrow: string
  headline: string
  subtitle?: string
}

const BEATS: Beat[] = [
  {
    scene: 'opening',
    durationMs: 4200,
    eyebrow: 'Bounds · A clinical note',
    headline: 'PHI hides in plain prose.',
    subtitle: 'Names a regex catches. Diagnoses it misses.',
  },
  {
    scene: 'regex_blind',
    durationMs: 4500,
    eyebrow: 'The blind spot',
    headline: 'Regex stops at the labels.',
    subtitle: '"presents with generalised anxiety disorder" sails through.',
  },
  {
    scene: 'five_layers',
    durationMs: 5200,
    eyebrow: 'Five detection layers · on-device',
    headline: 'Each one closes a gap the prior layer left.',
  },
  {
    scene: 'gemma_closeup',
    durationMs: 5000,
    eyebrow: 'Gemma 4 · contextual PHI',
    headline: 'Reads context regex can’t.',
    subtitle: 'Inline diagnosis. Medication in prose. Indirect health context.',
  },
  {
    scene: 'review',
    durationMs: 4500,
    eyebrow: 'The reviewer sees why',
    headline: 'Every Gemma hit ships with its reason.',
    subtitle: 'Toggle per item. Default off until you opt in.',
  },
  {
    scene: 'privacy',
    durationMs: 4200,
    eyebrow: 'Privacy proof · live',
    headline: 'Zero bytes uploaded.',
    subtitle: 'Open DevTools. The only outbound calls are model files on first run.',
  },
  {
    scene: 'vault',
    durationMs: 3800,
    eyebrow: 'Reversible',
    headline: 'AES-256-GCM vault, your key file.',
    subtitle: 'Restore the original any time. Lose the key, the redactions are permanent.',
  },
  {
    scene: 'closing',
    durationMs: 3000,
    eyebrow: 'Bounds',
    headline: 'On-device. Open source. Apache-2.0.',
  },
]

const TOTAL_MS = BEATS.reduce((s, b) => s + b.durationMs, 0)

// ── Scene bodies ──────────────────────────────────────────────────────────

function FadeIn({ children, delayMs = 0, runId }: { children: React.ReactNode; delayMs?: number; runId: number }) {
  return (
    <div
      key={`${runId}-${delayMs}`}
      className="opacity-0 animate-[fadeIn_0.6s_ease-out_forwards]"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  )
}

// Mock clinical-note card. Highlights animate in based on `mode`.
function ClinicalNote({ mode, runId }: { mode: 'plain' | 'regex' | 'gemma'; runId: number }) {
  return (
    <div className="w-full max-w-md mx-auto bg-white border border-gray-200 rounded-2xl shadow-sm p-5 text-left font-mono text-[12px] leading-relaxed text-gray-700">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Calmara Mental Wellness Clinic</div>
      <div className="text-gray-900 font-semibold mb-1.5">PATIENT CONSULTATION REPORT</div>
      <div className="flex flex-col gap-0.5">
        <div>
          Full name:&nbsp;&nbsp;
          <span className={`transition-colors ${mode !== 'plain' ? 'bg-rose-100 text-rose-700 px-1 rounded' : ''}`}>
            Sophie Laurent
          </span>
        </div>
        <div>
          Email:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
          <span className={`transition-colors ${mode !== 'plain' ? 'bg-emerald-100 text-emerald-700 px-1 rounded' : ''}`}>
            sophie.laurent@gmail.com
          </span>
        </div>
        <div>
          Mobile:&nbsp;&nbsp;&nbsp;&nbsp;
          <span className={`transition-colors ${mode !== 'plain' ? 'bg-emerald-100 text-emerald-700 px-1 rounded' : ''}`}>
            +41 79 123 45 67
          </span>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-gray-100 text-[12px] leading-relaxed">
        Patient presents with{' '}
        <span
          key={`gemma-hl-${runId}-${mode}`}
          className={`transition-all ${mode === 'gemma' ? 'bg-amber-100 text-amber-800 px-1 rounded shadow-[0_0_0_3px_rgba(245,158,11,0.15)]' : ''}`}
        >
          generalised anxiety disorder
        </span>{' '}
        (ICD-10 F41.1) and mild depressive episodes.
      </div>
      {mode === 'regex' && (
        <FadeIn runId={runId}>
          <div className="mt-3 text-[11px] text-rose-600 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Regex caught 3 items. The diagnosis stays in.
          </div>
        </FadeIn>
      )}
      {mode === 'gemma' && (
        <FadeIn runId={runId}>
          <div className="mt-3 text-[11px] text-amber-700 font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            Gemma 4 flagged the diagnosis. Inline, contextual, 99% confidence.
          </div>
        </FadeIn>
      )}
    </div>
  )
}

// Animated stack of five detection layers populating left-to-right.
function FiveLayers({ runId }: { runId: number }) {
  const layers = [
    { label: 'Regex',        sub: 'emails, IBANs, phone', color: 'bg-emerald-50  border-emerald-300  text-emerald-700' },
    { label: 'BERT NER',     sub: 'names, orgs, places',  color: 'bg-blue-50     border-blue-300     text-blue-700' },
    { label: 'Tesseract',    sub: 'scanned-page OCR',     color: 'bg-violet-50   border-violet-300   text-violet-700' },
    { label: 'UltraFace',    sub: 'faces in images',      color: 'bg-orange-50   border-orange-300   text-orange-700' },
    { label: 'Gemma 4',      sub: 'contextual PHI',       color: 'bg-amber-50    border-amber-400    text-amber-800' },
  ]
  return (
    <div className="w-full max-w-md mx-auto grid grid-cols-5 gap-2">
      {layers.map((l, i) => (
        <div
          key={`${runId}-${i}`}
          className={`opacity-0 animate-[fadeInUp_0.5s_ease-out_forwards] rounded-xl border ${l.color} px-2 py-3 text-center`}
          style={{ animationDelay: `${300 + i * 600}ms` }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wide">{l.label}</div>
          <div className="text-[10px] opacity-70 mt-1 leading-tight">{l.sub}</div>
        </div>
      ))}
    </div>
  )
}

// Mock review-panel row that mirrors RedactionBadge styling.
function ReviewRow({ runId }: { runId: number }) {
  return (
    <div className="w-full max-w-md mx-auto bg-white border border-gray-200 rounded-2xl p-4 text-left flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Health / Clinical Data (4)</p>
        <span className="text-[11px] text-gray-300 lowercase">Pattern · Gemma 4</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border bg-rose-100 text-rose-700 border-rose-300">
          <Sparkles className="w-3 h-3" />
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          generalised anxiety disorder
          <span className="opacity-60 ml-0.5">Health</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border bg-rose-100 text-rose-700 border-rose-300">
          <Sparkles className="w-3 h-3" />
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          Sertraline 50 mg
          <span className="opacity-60 ml-0.5">Health</span>
        </span>
      </div>
      <FadeIn runId={runId} delayMs={800}>
        <ul className="pl-2 border-l-2 border-amber-400/50 flex flex-col gap-0.5">
          <li className="text-[11px] text-gray-500 leading-snug">
            <span className="font-medium text-gray-700">generalised anxiety disorder</span>
            <span className="text-gray-400"> &mdash; inline diagnosis without a structured label</span>
          </li>
          <li className="text-[11px] text-gray-500 leading-snug">
            <span className="font-medium text-gray-700">Sertraline 50 mg</span>
            <span className="text-gray-400"> &mdash; medication mention in narrative</span>
          </li>
        </ul>
      </FadeIn>
    </div>
  )
}

// Mock DevTools network panel proving zero document uploads.
function PrivacyProof({ runId }: { runId: number }) {
  const rows = [
    { name: 'index.html',             type: 'document', size: '2.0 kB',  status: 200, color: 'text-gray-500' },
    { name: 'main-DS6uIaot.js',       type: 'script',   size: '443 kB',  status: 200, color: 'text-gray-500' },
    { name: 'gemma-4-E2B (cached)',   type: 'fetch',    size: '0 B',     status: 200, color: 'text-emerald-600' },
  ]
  return (
    <div className="w-full max-w-md mx-auto bg-gray-900 text-gray-200 rounded-2xl border border-gray-700 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="ml-2 font-mono text-gray-400">Network · 3 requests</span>
        </div>
        <span className="font-mono text-gray-500">All same-origin or cached</span>
      </div>
      <div className="font-mono text-[11px]">
        <div className="grid grid-cols-[1fr,72px,72px,52px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
          <span>Name</span><span>Type</span><span>Size</span><span>Status</span>
        </div>
        {rows.map((r, i) => (
          <FadeIn key={`${runId}-${i}`} runId={runId} delayMs={200 + i * 350}>
            <div className={`grid grid-cols-[1fr,72px,72px,52px] gap-2 px-3 py-1.5 ${r.color} hover:bg-gray-800/50`}>
              <span className="truncate">{r.name}</span>
              <span>{r.type}</span>
              <span>{r.size}</span>
              <span>{r.status}</span>
            </div>
          </FadeIn>
        ))}
      </div>
      <FadeIn runId={runId} delayMs={1700}>
        <div className="px-3 py-2 bg-emerald-900/40 border-t border-emerald-700/50 text-[11px] text-emerald-300 font-mono">
          POST requests with document bodies: <span className="font-semibold">0</span>
        </div>
      </FadeIn>
    </div>
  )
}

function VaultScene({ runId }: { runId: number }) {
  return (
    <div className="w-full max-w-md mx-auto flex items-center justify-center gap-6">
      <FadeIn runId={runId} delayMs={200}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-20 rounded-lg border-2 border-gray-300 bg-white flex items-center justify-center shadow-sm">
            <FileText className="w-7 h-7 text-gray-300" strokeWidth={1.5} />
          </div>
          <span className="text-[10px] uppercase text-gray-400 tracking-wider">Original</span>
        </div>
      </FadeIn>
      <FadeIn runId={runId} delayMs={700}>
        <ArrowRight className="w-5 h-5 text-gray-400" />
      </FadeIn>
      <FadeIn runId={runId} delayMs={1100}>
        <div className="flex flex-col items-center gap-2">
          <div className="relative w-16 h-20 rounded-lg bg-gray-900 flex items-center justify-center shadow-md">
            <Lock className="w-7 h-7 text-brand-green" strokeWidth={1.5} />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-brand-green flex items-center justify-center">
              <KeyRound className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
          <span className="text-[10px] uppercase text-brand-green tracking-wider font-semibold">Vault + Key</span>
        </div>
      </FadeIn>
    </div>
  )
}

// ── Scene switch ─────────────────────────────────────────────────────────

function SceneBody({ scene, runId }: { scene: Scene; runId: number }) {
  switch (scene) {
    case 'opening':       return <ClinicalNote mode="plain"  runId={runId} />
    case 'regex_blind':   return <ClinicalNote mode="regex"  runId={runId} />
    case 'five_layers':   return <FiveLayers runId={runId} />
    case 'gemma_closeup': return <ClinicalNote mode="gemma"  runId={runId} />
    case 'review':        return <ReviewRow  runId={runId} />
    case 'privacy':       return <PrivacyProof runId={runId} />
    case 'vault':         return <VaultScene runId={runId} />
    case 'closing':
      return (
        <div className="w-full max-w-md mx-auto flex flex-col items-center gap-4">
          <FadeIn runId={runId}>
            <img src="/logo.svg" alt="Bounds" className="w-16 h-16" />
          </FadeIn>
          <FadeIn runId={runId} delayMs={400}>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ShieldCheck className="w-4 h-4 text-brand-green" />
              <span>Zero document uploads</span>
            </div>
          </FadeIn>
          <FadeIn runId={runId} delayMs={800}>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Gemma 4 contextual PHI</span>
            </div>
          </FadeIn>
          <FadeIn runId={runId} delayMs={1200}>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <WifiOff className="w-4 h-4 text-brand-blue" />
              <span>Apache-2.0 engine</span>
            </div>
          </FadeIn>
        </div>
      )
  }
}

// ── Progress bar (segments per beat, animated fill) ───────────────────────

function ProgressBar({ index, paused, runId }: { index: number; paused: boolean; runId: number }) {
  return (
    <div className="w-full max-w-md mx-auto flex gap-1 mb-6">
      {BEATS.map((b, i) => {
        const fillState =
          i < index ? 'full' :
          i === index ? 'active' :
          'empty'
        return (
          <div key={`${runId}-${i}`} className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full bg-brand-green ${
                fillState === 'full'   ? 'w-full' :
                fillState === 'active' ? '' :
                'w-0'
              }`}
              style={fillState === 'active' ? {
                animation: `progressFill ${b.durationMs}ms linear forwards`,
                animationPlayState: paused ? 'paused' : 'running',
              } : undefined}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export function DemoPage() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  // Forces remount of every animated child so the loop restarts cleanly.
  const [runId, setRunId] = useState(0)
  const startedAtRef = useRef<number>(0)

  useEffect(() => {
    if (paused) return
    startedAtRef.current = performance.now()
    const t = setTimeout(() => {
      setIndex((i) => {
        const next = (i + 1) % BEATS.length
        if (next === 0) setRunId((r) => r + 1)
        return next
      })
    }, BEATS[index].durationMs)
    return () => clearTimeout(t)
  }, [index, paused, runId])

  const togglePause = useCallback(() => setPaused((p) => !p), [])
  const restart = useCallback(() => {
    setIndex(0)
    setRunId((r) => r + 1)
    setPaused(false)
  }, [])

  const beat = BEATS[index]
  const totalSec = Math.round(TOTAL_MS / 1000)

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-white to-gray-50">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        @keyframes progressFill { from { width: 0%; } to { width: 100%; } }
      `}</style>

      <header className="bg-white border-b border-gray-100 px-6 py-3.5">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 no-underline">
            <img src="/logo.svg" alt="Bounds" className="w-7 h-7" />
            <span className="font-black text-base text-gray-900 tracking-tight">
              b<span className="text-brand-green">●</span>unds
            </span>
          </a>
          <span className="text-[11px] uppercase tracking-wider text-gray-400">~{totalSec}s walkthrough</span>
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-8">
        <ProgressBar index={index} paused={paused} runId={runId} />

        <div className="text-center max-w-lg flex flex-col items-center gap-2">
          <span
            key={`eyebrow-${runId}-${index}`}
            className="inline-block opacity-0 animate-[fadeIn_0.5s_ease-out_forwards] text-[11px] font-semibold uppercase tracking-wider text-brand-green"
          >
            {beat.eyebrow}
          </span>
          <h1
            key={`headline-${runId}-${index}`}
            className="opacity-0 animate-[fadeIn_0.55s_ease-out_0.1s_forwards] text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight leading-tight"
          >
            {beat.headline}
          </h1>
          {beat.subtitle && (
            <p
              key={`sub-${runId}-${index}`}
              className="opacity-0 animate-[fadeIn_0.6s_ease-out_0.25s_forwards] text-sm text-gray-500 max-w-md"
            >
              {beat.subtitle}
            </p>
          )}
        </div>

        <div
          key={`scene-${runId}-${index}`}
          className="w-full opacity-0 animate-[fadeIn_0.6s_ease-out_0.15s_forwards]"
        >
          <SceneBody scene={beat.scene} runId={runId * 100 + index} />
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={togglePause}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-full transition-colors"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? 'Play' : 'Pause'}
          </button>
          <button
            onClick={restart}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-full transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restart
          </button>
          <a
            href="/"
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:opacity-80 px-3 py-1.5 rounded-full transition-opacity"
          >
            Try it
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </section>

      <footer className="px-6 py-4 text-center text-[11px] text-gray-400">
        Bounds &middot; on-device PDF redaction &middot; Apache-2.0
      </footer>
    </main>
  )
}
