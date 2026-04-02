import { useEffect, useRef, useState } from 'react'
import type { BBox, Detection } from '../types'
import { getPiiColor } from '../utils/colors'

interface Props {
  pdfBuffer: ArrayBuffer
  pageIndex: number
  detections: Detection[]
  onToggle: (id: string) => void
  scale?: number
  redactionColor?: { r: number; g: number; b: number }
  previewUnavailableText?: string
  drawMode?: boolean
  onBoxDrawn?: (bbox: BBox) => void
  annotateMode?: boolean
  onAnnotationDrawn?: (bbox: BBox) => void
}

// ---------------------------------------------------------------------------
// PDFPageViewer
// Renders a single PDF page onto a canvas (via pdfjs-dist) and overlays
// semi-transparent coloured boxes for each detection. Boxes are clickable
// to toggle individual redactions. 
// ---------------------------------------------------------------------------

export function PDFPageViewer({ pdfBuffer, pageIndex, detections, onToggle, scale = 1.5, redactionColor, previewUnavailableText = 'Preview unavailable', drawMode = false, onBoxDrawn, annotateMode = false, onAnnotationDrawn }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  // Cache the pdfjs document so it isn't re-parsed from scratch on every page navigation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null)
  const prevBufferRef = useRef<ArrayBuffer | null>(null)

  // Draw-mode state
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const [drawRect, setDrawRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).toString()

        // Only reload the document when the buffer actually changes
        if (prevBufferRef.current !== pdfBuffer || !pdfDocRef.current) {
          pdfDocRef.current = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer.slice(0)) }).promise
          prevBufferRef.current = pdfBuffer
        }
        if (cancelled) return

        const page = await pdfDocRef.current.getPage(pageIndex + 1)
        if (cancelled) return

        const vp = page.getViewport({ scale })
        setViewport({ width: vp.width, height: vp.height })

        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = vp.width
        canvas.height = vp.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport: vp }).promise
        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) { setError(true); setLoading(false) }
      }
    }
    void render()
    return () => { cancelled = true }
  }, [pdfBuffer, pageIndex, scale])

  const pageDetections = detections.filter((d) => d.pageIndex === pageIndex && d.boundingBox.width > 0)

  // Use pointer capture so the drag keeps working even when the pointer
  // moves outside the element at speed — the correct approach for drag UX.
  function getRelativePointerPos(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawStartRef.current = getRelativePointerPos(e)
    setDrawRect(null)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawStartRef.current) return
    const pos = getRelativePointerPos(e)
    setDrawRect({
      left:   Math.min(drawStartRef.current.x, pos.x),
      top:    Math.min(drawStartRef.current.y, pos.y),
      width:  Math.abs(pos.x - drawStartRef.current.x),
      height: Math.abs(pos.y - drawStartRef.current.y),
    })
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawStartRef.current || !viewport) { drawStartRef.current = null; setDrawRect(null); return }
    const pos = getRelativePointerPos(e)
    const left   = Math.min(drawStartRef.current.x, pos.x)
    const top    = Math.min(drawStartRef.current.y, pos.y)
    const width  = Math.abs(pos.x - drawStartRef.current.x)
    const height = Math.abs(pos.y - drawStartRef.current.y)
    drawStartRef.current = null
    setDrawRect(null)
    if (width < 4 || height < 4) return
    // The overlay div may be CSS-scaled smaller than the natural canvas size.
    // Compute the ratio so drawn coordinates map correctly to PDF user-space.
    const displayRect = e.currentTarget.getBoundingClientRect()
    const cssToNatural = viewport.width / displayRect.width
    const bbox = {
      x:      left * cssToNatural / scale,
      y:      (viewport.height - (top + height) * cssToNatural) / scale,
      width:  width * cssToNatural / scale,
      height: height * cssToNatural / scale,
    }
    if (annotateMode) {
      onAnnotationDrawn?.(bbox)
    } else {
      onBoxDrawn?.(bbox)
    }
  }

  return (
    <div className="relative inline-block border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      {error && (
        <div className="w-64 h-96 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
          {previewUnavailableText}
        </div>
      )}
      {loading && !error && (
        <div className="w-full max-w-[500px] bg-white flex flex-col" style={{ aspectRatio: '1 / 1.414' }}>
          {/* Shimmer wrapper */}
          <div className="flex-1 flex flex-col gap-4 p-8 animate-pulse">
            {/* Heading block */}
            <div className="h-5 bg-gray-200 rounded w-2/3" />
            <div className="h-3 bg-gray-100 rounded w-1/3" />
            {/* Divider */}
            <div className="h-px bg-gray-100 w-full mt-1" />
            {/* Section rows */}
            {[0.85, 0.7, 0.9, 0.6, 0.8].map((w, i) => (
              <div key={i} className="flex gap-4 items-center">
                <div className="h-3 bg-gray-100 rounded w-20 shrink-0" />
                <div className="h-3 bg-gray-200 rounded" style={{ width: `${w * 100}%` }} />
              </div>
            ))}
            <div className="h-px bg-gray-100 w-full mt-2" />
            {[0.75, 0.65, 0.55, 0.8, 0.4].map((w, i) => (
              <div key={i} className="flex gap-4 items-center">
                <div className="h-3 bg-gray-100 rounded w-20 shrink-0" />
                <div className="h-3 bg-gray-200 rounded" style={{ width: `${w * 100}%` }} />
              </div>
            ))}
          </div>
          {/* Page indicator */}
          <div className="px-8 pb-4 flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-brand-green border-t-transparent animate-spin" />
            <span className="text-xs text-gray-400">Loading page {pageIndex + 1}…</span>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: (error || loading) ? 'none' : 'block', maxWidth: '100%' }} />

      {/* Draw / annotate mode capture layer */}
      {(drawMode || annotateMode) && viewport && (
        <div
          className="absolute inset-0 z-10 select-none"
          style={{ cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {drawRect && drawRect.width > 2 && drawRect.height > 2 && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: drawRect.left, top: drawRect.top,
                width: drawRect.width, height: drawRect.height,
                border: annotateMode ? '2px dashed #f59e0b' : '2px dashed #16a34a',
                backgroundColor: annotateMode ? 'rgba(245,158,11,0.10)' : 'rgba(22,163,74,0.10)',
                borderRadius: 2,
              }}
            />
          )}
        </div>
      )}

      {/* Overlay layer — absolutely positioned over the canvas.
          Uses percentage positions so boxes stay aligned when the canvas is
          CSS-scaled smaller than its natural pixel size (maxWidth: 100%). */}
      {viewport && (
        <div className="absolute inset-0 pointer-events-none">
          {pageDetections.map((det) => {
            const { x, y, width, height } = det.boundingBox
            const piiColor = getPiiColor(det.type)
            // When a custom redaction color is chosen, use it for enabled boxes
            const boxHex = redactionColor
              ? `rgb(${Math.round(redactionColor.r * 255)},${Math.round(redactionColor.g * 255)},${Math.round(redactionColor.b * 255)})`
              : piiColor.hex
            // pdfjs y=0 is bottom of page; CSS top=0 is top of div → flip y.
            // Express as percentages of the viewport so positions stay correct
            // when the canvas is CSS-scaled (maxWidth: 100%) to a smaller display size.
            const pctLeft   = (x * scale / viewport.width) * 100
            const pctTop    = ((viewport.height - (y + height) * scale) / viewport.height) * 100
            const pctWidth  = (width  * scale / viewport.width)  * 100
            const pctHeight = (height * scale / viewport.height) * 100
            return (
              <button
                key={det.id}
                onClick={() => onToggle(det.id)}
                title={`${det.text}, click to ${det.enabled ? 'un-redact' : 'redact'}`}
                className="absolute pointer-events-auto transition-opacity hover:opacity-90"
                style={{
                  left:   `${pctLeft}%`,
                  top:    `${pctTop}%`,
                  width:  `${pctWidth}%`,
                  height: `${pctHeight}%`,
                  backgroundColor: det.enabled ? boxHex : 'transparent',
                  opacity: det.enabled ? 1 : 0.25,
                  border: `2px solid ${piiColor.hex}`,
                  borderRadius: 2,
                  cursor: 'pointer',
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
