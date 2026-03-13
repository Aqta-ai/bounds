import { useEffect, useRef, useState } from 'react'
import type { Detection } from '../types'
import { getPiiColor } from '../utils/colors'

interface Props {
  pdfBuffer: ArrayBuffer
  pageIndex: number
  detections: Detection[]
  onToggle: (id: string) => void
  scale?: number
  redactionColor?: { r: number; g: number; b: number }
  previewUnavailableText?: string
}

// ---------------------------------------------------------------------------
// PDFPageViewer
// Renders a single PDF page onto a canvas (via pdfjs-dist) and overlays
// semi-transparent coloured boxes for each detection. Boxes are clickable
// to toggle individual redactions. 
// ---------------------------------------------------------------------------

export function PDFPageViewer({ pdfBuffer, pageIndex, detections, onToggle, scale = 1.5, redactionColor, previewUnavailableText = 'Preview unavailable' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [error, setError] = useState(false)

  // Cache the pdfjs document so it isn't re-parsed from scratch on every page navigation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null)
  const prevBufferRef = useRef<ArrayBuffer | null>(null)

  useEffect(() => {
    let cancelled = false
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
      } catch {
        if (!cancelled) setError(true)
      }
    }
    void render()
    return () => { cancelled = true }
  }, [pdfBuffer, pageIndex, scale])

  const pageDetections = detections.filter((d) => d.pageIndex === pageIndex && d.boundingBox.width > 0)

  return (
    <div className="relative inline-block border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      {error && (
        <div className="w-64 h-96 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
          {previewUnavailableText}
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: error ? 'none' : 'block', maxWidth: '100%' }} />

      {/* Overlay layer — absolutely positioned over the canvas */}
      {viewport && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ width: viewport.width, height: viewport.height }}
        >
          {pageDetections.map((det) => {
            const { x, y, width, height } = det.boundingBox
            const piiColor = getPiiColor(det.type)
            // When a custom redaction color is chosen, use it for enabled boxes
            const boxHex = redactionColor
              ? `rgb(${Math.round(redactionColor.r * 255)},${Math.round(redactionColor.g * 255)},${Math.round(redactionColor.b * 255)})`
              : piiColor.hex
            // pdfjs y=0 is bottom of page; CSS top=0 is top of div → flip y.
            // All bbox values are in PDF user-space (scale 1.0), so scale them
            // first, then flip into CSS top coordinate.
            const cssTop = viewport.height - (y + height) * scale
            return (
              <button
                key={det.id}
                onClick={() => onToggle(det.id)}
                title={`${det.text}, click to ${det.enabled ? 'un-redact' : 'redact'}`}
                className="absolute pointer-events-auto transition-opacity hover:opacity-90"
                style={{
                  left: x * scale,
                  top: cssTop,
                  width: width * scale,
                  height: height * scale,
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
