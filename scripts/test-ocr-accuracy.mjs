#!/usr/bin/env node
// OCR accuracy harness for Tesseract.js v5 against a synthetic clinical
// note rendered at the same 3.0x scale (~216 DPI) the consumer app uses.
//
// Steps:
//   1. Read a pre-rendered PNG from /tmp/bounds-ocr-test/test.png
//      (build with: python3 scripts/test-ocr-render.py)
//   2. Run Tesseract.js with the LSTM core on it
//   3. Compute case-sensitive word-level recall against ground truth.
//
// Word accuracy is reported because the consumer redaction pipeline
// operates on Tesseract's word boxes, so a missed token equals a
// missed bounding box equals a missed redaction.
//
// Run: node scripts/test-ocr-accuracy.mjs

import fs from 'node:fs/promises'
import path from 'node:path'
import { createWorker } from 'tesseract.js'

const ROOT = path.dirname(new URL(import.meta.url).pathname)
const TEST_DIR = '/tmp/bounds-ocr-test'

const GROUND_TRUTH = (await fs.readFile(path.join(TEST_DIR, 'ground-truth.txt'), 'utf8')).trim()
const IMAGES = [
  ['clean (best case)',                path.join(TEST_DIR, 'test-clean.png')],
  ['noisy (rotated 2deg + JPEG q55)',  path.join(TEST_DIR, 'test-noisy.png')],
]

// Tokenise on whitespace; preserve case + punctuation glued to tokens so
// "Sophie" vs "sophie" matters and "Sertraline 50 mg" yields three tokens.
function tokenise(text) {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

async function runOne(label, imagePath) {
  const imgBuf = await fs.readFile(imagePath)
  const truth = tokenise(GROUND_TRUTH)

  const t0 = Date.now()
  const worker = await createWorker('eng', 1)
  await worker.setParameters({ preserve_interword_spaces: '1' })
  const { data } = await worker.recognize(imgBuf)
  await worker.terminate()
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  const ocr = tokenise(data.text)
  let matched = 0
  const usedOcr = new Set()
  for (const t of truth) {
    const idx = ocr.findIndex((o, i) => o === t && !usedOcr.has(i))
    if (idx !== -1) { matched++; usedOcr.add(idx) }
  }
  const wordAcc = matched / truth.length
  const meanConf = data.confidence ?? 0
  const missed = []
  const ocrCopy = [...ocr]
  for (const t of truth) {
    const i = ocrCopy.indexOf(t)
    if (i === -1) missed.push(t)
    else ocrCopy.splice(i, 1)
  }
  console.log(`── ${label}`)
  console.log(`   latency ${elapsed}s · Tesseract confidence ${meanConf.toFixed(1)}% · exact word match ${matched}/${truth.length} (${(wordAcc * 100).toFixed(1)}%)`)
  if (missed.length) console.log(`   missed: ${missed.slice(0, 8).join(' · ')}${missed.length > 8 ? ` · +${missed.length - 8} more` : ''}`)
  console.log()
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Bounds × Tesseract.js — OCR accuracy harness')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Ground truth: ${tokenise(GROUND_TRUTH).length} tokens`)
  console.log()
  for (const [label, p] of IMAGES) await runOne(label, p)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
