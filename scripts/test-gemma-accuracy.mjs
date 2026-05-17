#!/usr/bin/env node
// Accuracy harness for the Gemma 4 contextual PHI layer.
// Runs the real Ollama backend against the Calmara demo PDF text and scores
// the output against a manually curated ground-truth list of expected hits.
//
// Run: node scripts/test-gemma-accuracy.mjs

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const MODEL = 'gemma4:e2b'
const CONFIDENCE_FLOOR = 0.75

const SYSTEM_PROMPT = `You are a healthcare privacy auditor. The following is text extracted from a PDF page that may contain protected health information (PHI). Your job is to flag spans that contain PHI a regex or named-entity recogniser would MISS, focusing on these six categories ONLY:

  1. inline_diagnosis        Inline diagnosis without a structured label (e.g. "presents with generalised anxiety disorder").
  2. medication_mention      Medication name in running prose, not after a "Medications:" label (e.g. "she is on lithium").
  3. treatment_procedure     Treatment, procedure, or surgery mentioned in narrative (e.g. "underwent CABG last April").
  4. indirect_health_context Indirect references that imply health condition (e.g. "my therapist", "my insulin pump").
  5. sensitive_social        Sensitive social-category data (sexuality, gender identity, religion).
  6. genetic_reference       Genetic test results or family history (e.g. "BRCA1-positive", "father had Huntington's").

For each span you flag, return ONE entry in a JSON array:

  {
    "text":       "<the exact span as it appears in the input, byte-identical>",
    "type":       "HEALTH_DATA",
    "confidence": <0.0 to 1.0>,
    "ruleId":     "gemma:<one of the six category ids above>",
    "reason":     "<one short sentence explaining why this span is PHI a reviewer should consider>"
  }

Multilingual: the input may be in any language including French, German, Spanish, Italian, Portuguese, Dutch, Polish, Arabic, Chinese, Japanese, Hindi, Bengali, Tamil, Swahili. Flag spans in their original language and script, verbatim. Diagnoses, medication names, and procedures translate. For example:
  - French:  "trouble anxieux généralisé" (inline_diagnosis), "sertraline 50 mg" (medication_mention), "épisodes dépressifs" (inline_diagnosis)
  - German:  "Angststörung" (inline_diagnosis), "Sertralin 50 mg" (medication_mention), "depressive Episode" (inline_diagnosis)
  - Spanish: "trastorno de ansiedad generalizada" (inline_diagnosis), "sertralina" (medication_mention)
  - Hindi:   "सामान्यीकृत चिंता विकार" (inline_diagnosis), "सर्ट्रालिन" (medication_mention), "अवसाद" (inline_diagnosis)
  - Bengali: "সাধারণ উদ্বেগ ব্যাধি" (inline_diagnosis), "সারট্রালিন" (medication_mention), "বিষণ্নতা" (inline_diagnosis)

Rules:
- Return ONLY a JSON array. No prose, no markdown, no preamble.
- If no PHI is present, return [].
- Confidence MUST be at least ${CONFIDENCE_FLOOR}. Below that, omit the span.
- The text field MUST appear verbatim in the input, in the input's original language and script. Do NOT paraphrase, expand, translate, or correct.
- Flag medication names whenever they appear in prose, in any language, including their dose if cited inline.
- DO NOT flag patient names, dates, addresses, MRNs, phone numbers, emails, or other structured PHI; the regex and NER layers handle those. Your job is contextual content only.
- If you are unsure, leave the span out. False positives in healthcare are worse than false negatives at this stage.`

// Mirrors the PDF text the user sees when clicking "Try sample" in the app.
const DEMO_TEXT = `Calmara Mental Wellness Clinic
PATIENT CONSULTATION REPORT · For clinical use only

PATIENT INFORMATION
Full name:              Sophie Laurent
Date of birth:          14.03.1982
AHV / AVS number:       756.1234.5678.97
Address:                Bahnhofstrasse 42, 8001 Zurich, Switzerland
Mobile:                 +41 79 123 45 67
Email:                  sophie.laurent@gmail.com

INSURANCE & BILLING
Insurer:                Swica Krankenversicherung AG
Policy number:          SW-2026-887441
IBAN (reimbursement):   CH56 0483 5012 3456 7800 9

CONSULTATION: 2026-03-15
Attending:              Dr. Martin Frei, MD  (Psychiatry, License CH-BE-4421)

Patient Sophie Laurent presents with generalised anxiety disorder (ICD-10 F41.1)
and mild depressive episodes. Reports disrupted sleep patterns since January 2026.
No current suicidal ideation. PHQ-9 score: 11 (moderate depression).

Prescription:           Sertraline 50 mg daily (titrate to 100 mg after 4 weeks)
Follow-up:              2026-04-12 at 14:00, Calmara Clinic, Zurich

REFERRAL
Referred to:            Dr. Amara Osei, Certified CBT Therapist
Contact:                amara.osei@cbt-zuerich.ch  ·  +41 44 987 65 43
Urgency:                Routine (appointment within 4 weeks)

PREVIOUS TREATMENT HISTORY
Patient was previously treated by Dr. Clara Huber, Psychiatry, Bern (2023-2024).
Diagnosis at that time: Burnout syndrome (ICD-10 Z73.0). Patient responded well to CBT.
No prior hospitalisation. No known medication allergies.

CONSENT & SIGNATURES
I, Sophie Laurent (DOB 14.03.1982), consent to the processing of my health data
for the purpose of treatment and billing in accordance with the Swiss FADP.
`

// Ground truth: contextual PHI shapes Gemma is responsible for catching.
// These are spans that regex and NER systematically miss but that a HIPAA
// Safe Harbor #17 auditor would flag. Names, dates, addresses, IBANs, etc
// belong to other layers and are intentionally NOT in this list.
const EXPECTED = [
  // inline diagnosis (no structured label)
  { phrase: 'generalised anxiety disorder', category: 'inline_diagnosis' },
  { phrase: 'mild depressive episodes',      category: 'inline_diagnosis' },
  { phrase: 'Burnout syndrome',              category: 'inline_diagnosis' },
  { phrase: 'moderate depression',           category: 'inline_diagnosis' },
  // medication in prose
  { phrase: 'Sertraline 50 mg',              category: 'medication_mention' },
  // treatment / procedure
  { phrase: 'CBT',                            category: 'treatment_procedure' },
  // indirect health context
  { phrase: 'disrupted sleep patterns',      category: 'indirect_health_context' },
  { phrase: 'No current suicidal ideation',  category: 'indirect_health_context' },
  { phrase: 'PHQ-9 score',                   category: 'indirect_health_context' },
  { phrase: 'medication allergies',          category: 'indirect_health_context' },
]

function parseAndValidate(raw, sourceChunk) {
  let parsed
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const sourceNfc = sourceChunk.normalize('NFC')
  const out = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    const type = item.type === 'HEALTH_DATA' ? 'HEALTH_DATA' : null
    const confidence = typeof item.confidence === 'number' ? item.confidence : 0
    const ruleId = typeof item.ruleId === 'string' ? item.ruleId : ''
    const reason = typeof item.reason === 'string' ? item.reason : ''
    if (!text || !type) continue
    if (confidence < CONFIDENCE_FLOOR) continue
    if (!ruleId.startsWith('gemma:')) continue
    if (!reason) continue
    if (!sourceNfc.includes(text.normalize('NFC'))) continue
    out.push({ text, type, confidence, ruleId, reason })
  }
  return out
}

async function runGemma(chunk) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: chunk },
      ],
      stream: false,
      think: false,
      options: { temperature: 0.1, num_predict: 2048 },
      format: 'json',
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  return data.message?.content ?? data.response ?? ''
}

function scoreDetections(detections, expected) {
  const hits = []
  const misses = []
  for (const exp of expected) {
    const lc = exp.phrase.toLowerCase()
    const match = detections.find((d) => d.text.toLowerCase().includes(lc) || lc.includes(d.text.toLowerCase()))
    if (match) {
      const categoryMatch = match.ruleId === `gemma:${exp.category}`
      hits.push({ ...exp, detected: match, categoryMatch })
    } else {
      misses.push(exp)
    }
  }
  return { hits, misses }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Bounds × Gemma 4 — contextual PHI accuracy harness`)
  console.log(`Model: ${MODEL}  ·  Floor: ${CONFIDENCE_FLOOR}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const t0 = Date.now()
  let raw
  try {
    raw = await runGemma(DEMO_TEXT)
  } catch (err) {
    console.error('FAIL — could not reach Ollama:', err.message)
    process.exit(1)
  }
  const elapsedMs = Date.now() - t0

  const detections = parseAndValidate(raw, DEMO_TEXT)
  const { hits, misses } = scoreDetections(detections, EXPECTED)

  const recall = hits.length / EXPECTED.length
  // Precision: how many of Gemma's emissions matched a ground-truth phrase?
  // We treat any hit that overlaps a ground-truth phrase as a true positive
  // regardless of category, since contextual PHI is a fuzzy taxonomy.
  const truePos = new Set()
  for (const d of detections) {
    const dlc = d.text.toLowerCase()
    if (EXPECTED.some((e) => dlc.includes(e.phrase.toLowerCase()) || e.phrase.toLowerCase().includes(dlc))) {
      truePos.add(d.text)
    }
  }
  const precision = detections.length === 0 ? 0 : truePos.size / detections.length
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const categoryAccuracy = hits.length === 0 ? 0 : hits.filter((h) => h.categoryMatch).length / hits.length

  console.log()
  console.log(`Latency: ${(elapsedMs / 1000).toFixed(1)}s`)
  console.log(`Total emissions: ${detections.length}`)
  console.log(`Precision (no hallucinations):  ${(precision * 100).toFixed(0)}%`)
  console.log(`Recall (caught expected PHI):   ${(recall * 100).toFixed(0)}%  (${hits.length}/${EXPECTED.length})`)
  console.log(`F1:                             ${(f1 * 100).toFixed(0)}%`)
  console.log(`Category accuracy on hits:      ${(categoryAccuracy * 100).toFixed(0)}%`)
  console.log()

  console.log('── HITS ────────────────────────────────────────────')
  for (const h of hits) {
    const cat = h.categoryMatch ? 'OK' : `WRONG (got ${h.detected.ruleId.replace('gemma:', '')})`
    console.log(`  + ${h.phrase.padEnd(38)} ${cat}`)
  }

  if (misses.length > 0) {
    console.log()
    console.log('── MISSES (model did not flag) ─────────────────────')
    for (const m of misses) {
      console.log(`  - ${m.phrase}  (${m.category})`)
    }
  }

  if (detections.length > 0) {
    console.log()
    console.log('── RAW DETECTIONS ──────────────────────────────────')
    for (const d of detections) {
      console.log(`  · "${d.text}"  [${d.ruleId.replace('gemma:', '')}, conf=${d.confidence.toFixed(2)}]`)
      console.log(`    ${d.reason}`)
    }
  }

  // Exit non-zero only if recall is truly catastrophic
  if (recall < 0.3) {
    console.log()
    console.log('WARN: recall under 30%% — investigate model or prompt drift')
    process.exit(2)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
