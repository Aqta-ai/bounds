import * as ort from 'onnxruntime-web'
import type { Detection, PageLayout, PiiType } from '../types'
import { OCR_RENDER_SCALE } from './OCRWorker'

// ---------------------------------------------------------------------------
// FaceDetector — ONNX UltraFace-320 running via onnxruntime-web WASM.
//
// Zero new npm deps: onnxruntime-web is already bundled as a transitive dep
// of @xenova/transformers and pre-bundled by Vite (optimizeDeps.include).
//
// Model: version-RFB-320.onnx (~1.2 MB) served from /public/
// Input:  [1, 3, 240, 320] float32, normalised to [-1, 1] (per-channel)
// Output: scores [1, N, 2]  — [bg_prob, face_prob] per anchor
//         boxes  [1, N, 4]  — [xmin, ymin, xmax, ymax] normalised to [0,1]
//                             (already anchor-decoded inside the model)
// ---------------------------------------------------------------------------

const MODEL_URL = '/ultraface-320.onnx'
const INPUT_W = 320
const INPUT_H = 240
const SCORE_THRESHOLD = 0.7
const IOU_THRESHOLD = 0.3

let session: ort.InferenceSession | null = null
let sessionLoading: Promise<ort.InferenceSession> | null = null

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session
  if (sessionLoading) return sessionLoading
  sessionLoading = ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
  })
  session = await sessionLoading
  return session
}

export function isFaceDetectionSupported(): boolean {
  return true
}

/**
 * Detect faces in a rendered page blob and return Detection objects with
 * bounding boxes already in PDF user-space coordinates (bottom-left origin).
 */
export async function detectFaces(
  blob: Blob,
  layout: PageLayout,
  pageIndex: number,
  tokenCounters: Map<PiiType, number>,
): Promise<Detection[]> {
  try {
    const sess = await getSession()

    // Draw the full page blob into the 320×240 model input canvas
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = INPUT_W
    canvas.height = INPUT_H
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, INPUT_W, INPUT_H)
    bitmap.close()

    const { data } = ctx.getImageData(0, 0, INPUT_W, INPUT_H)

    // RGBA → CHW float32, normalise to [-1, 1]
    const pixels = INPUT_W * INPUT_H
    const input = new Float32Array(3 * pixels)
    for (let i = 0; i < pixels; i++) {
      input[i]             = data[i * 4]     / 127.5 - 1 // R
      input[pixels + i]    = data[i * 4 + 1] / 127.5 - 1 // G
      input[pixels * 2 + i] = data[i * 4 + 2] / 127.5 - 1 // B
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, INPUT_H, INPUT_W])
    const output = await sess.run({ input: tensor })

    const scores = output['scores'].data as Float32Array // [1, N, 2]
    const boxes  = output['boxes'].data  as Float32Array // [1, N, 4]
    const N = scores.length / 2

    // Collect anchors above threshold
    type Box = { score: number; xmin: number; ymin: number; xmax: number; ymax: number }
    const candidates: Box[] = []
    for (let i = 0; i < N; i++) {
      const score = scores[i * 2 + 1]
      if (score < SCORE_THRESHOLD) continue
      candidates.push({
        score,
        xmin: boxes[i * 4],
        ymin: boxes[i * 4 + 1],
        xmax: boxes[i * 4 + 2],
        ymax: boxes[i * 4 + 3],
      })
    }

    if (candidates.length === 0) return []

    // Sort by confidence, suppress overlapping boxes
    candidates.sort((a, b) => b.score - a.score)
    const kept = nms(candidates, IOU_THRESHOLD)

    // Convert normalised [0,1] model coords → PDF user-space (bottom-left origin)
    const scale = layout.ocrScale ?? OCR_RENDER_SCALE
    const detections: Detection[] = []

    for (let i = 0; i < kept.length; i++) {
      const { xmin, ymin, xmax, ymax } = kept[i]
      const pdfX = xmin * layout.width
      const pdfW = (xmax - xmin) * layout.width
      const pdfH = (ymax - ymin) * layout.height
      const pdfY = layout.height - ymax * layout.height

      // Reject degenerate or implausibly large boxes
      if (pdfW < 4 || pdfH < 4) continue
      if (pdfW > layout.width * 0.4 || pdfH > layout.height * 0.4) continue
      if (pdfW / pdfH < 0.4 || pdfW / pdfH > 2.5) continue

      const n = (tokenCounters.get('PERSON') ?? 0) + 1
      tokenCounters.set('PERSON', n)

      detections.push({
        id: `face_p${pageIndex}_${i}`,
        type: 'PERSON',
        text: '[photo]',
        token: `[PERSON_${String(n).padStart(3, '0')}]`,
        pageIndex,
        boundingBox: { x: pdfX, y: pdfY, width: pdfW, height: pdfH },
        confidence: kept[i].score,
        source: 'FACE',
        enabled: true,
        ruleId: 'face_detection',
      })
    }

    // scale is referenced via layout.ocrScale above — suppress unused-var lint
    void scale

    return detections
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Non-maximum suppression
// ---------------------------------------------------------------------------

type Box = { score: number; xmin: number; ymin: number; xmax: number; ymax: number }

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin))
  const iy = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin))
  const intersection = ix * iy
  const aArea = (a.xmax - a.xmin) * (a.ymax - a.ymin)
  const bArea = (b.xmax - b.xmin) * (b.ymax - b.ymin)
  return intersection / (aArea + bArea - intersection)
}

function nms(boxes: Box[], threshold: number): Box[] {
  const kept: Box[] = []
  const suppressed = new Set<number>()
  for (let i = 0; i < boxes.length; i++) {
    if (suppressed.has(i)) continue
    kept.push(boxes[i])
    for (let j = i + 1; j < boxes.length; j++) {
      if (!suppressed.has(j) && iou(boxes[i], boxes[j]) > threshold) {
        suppressed.add(j)
      }
    }
  }
  return kept
}
