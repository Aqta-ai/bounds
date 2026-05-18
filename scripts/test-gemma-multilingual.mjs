#!/usr/bin/env node
// Quick multilingual probe: does Gemma 4 E2B flag contextual PHI in
// French, German, Spanish, Hindi, and Bengali clinical phrases?
// The rule we care about: the model must return spans verbatim from the
// source. If it does and the parser accepts them, the BERT-NER 10-language
// ceiling does not cap Gemma's contribution.
//
// Run: OLLAMA_URL=http://127.0.0.1:11435 node scripts/test-gemma-multilingual.mjs

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const MODEL = 'gemma4:e2b'
const CONFIDENCE_FLOOR = 0.75

const SYSTEM_PROMPT = `You are a healthcare privacy auditor. The following is text extracted from a PDF page that may contain protected health information (PHI). Your job is to flag spans that contain PHI a regex or named-entity recogniser would MISS, focusing on these six categories ONLY:

  1. inline_diagnosis        Inline diagnosis without a structured label.
  2. medication_mention      Medication name in running prose.
  3. treatment_procedure     Treatment, procedure, or surgery mentioned in narrative.
  4. indirect_health_context Indirect references that imply health condition.
  5. sensitive_social        Sensitive social-category data.
  6. genetic_reference       Genetic test results or family history.

For each span you flag, return ONE entry in a JSON array:
  { "text": "...", "type": "HEALTH_DATA", "confidence": 0.0-1.0,
    "ruleId": "gemma:<category>", "reason": "<short>" }

Multilingual: the input may be in any language including French, German, Spanish, Italian, Portuguese, Dutch, Polish, Arabic, Chinese, Japanese, Hindi, Bengali, Tamil, Swahili. Flag spans in their original language and script, verbatim. Diagnoses, medication names, and procedures translate. For example:
  - French:  "trouble anxieux généralisé" (inline_diagnosis), "sertraline 50 mg" (medication_mention), "épisodes dépressifs" (inline_diagnosis)
  - German:  "Angststörung" (inline_diagnosis), "Sertralin 50 mg" (medication_mention), "depressive Episode" (inline_diagnosis)
  - Spanish: "trastorno de ansiedad generalizada" (inline_diagnosis), "sertralina" (medication_mention)
  - Hindi:   "सामान्यीकृत चिंता विकार" (inline_diagnosis), "सर्ट्रालिन" (medication_mention), "अवसाद" (inline_diagnosis)
  - Bengali: "সাধারণ উদ্বেগ ব্যাধি" (inline_diagnosis), "সারট্রালিন" (medication_mention), "বিষণ্নতা" (inline_diagnosis)

Rules:
- Return ONLY a JSON array. No prose, no markdown.
- Confidence MUST be at least ${CONFIDENCE_FLOOR}.
- The text field MUST appear verbatim in the input, in the input's original language and script. Do NOT paraphrase, expand, translate, or correct.
- Flag medication names whenever they appear in prose, in any language, including their dose if cited inline.
- DO NOT flag names, dates, addresses, MRNs.
- If you are unsure, leave the span out.`

const CASES = [
  {
    lang: 'French',
    text: 'Le patient présente un trouble anxieux généralisé et prend de la sertraline 50 mg par jour. Antécédents de dépression légère.',
    expected: ['trouble anxieux généralisé', 'sertraline', 'dépression légère'],
  },
  {
    lang: 'German',
    text: 'Der Patient leidet an generalisierter Angststörung und nimmt täglich Sertralin 50 mg. Anamnese: leichte depressive Episoden.',
    expected: ['generalisierter Angststörung', 'Sertralin', 'depressive Episoden'],
  },
  {
    lang: 'Spanish',
    text: 'El paciente presenta trastorno de ansiedad generalizada y toma sertralina 50 mg al día. Antecedentes de episodios depresivos leves.',
    expected: ['trastorno de ansiedad generalizada', 'sertralina', 'episodios depresivos leves'],
  },
  {
    lang: 'Hindi (Devanagari)',
    text: 'रोगी को सामान्यीकृत चिंता विकार है और वह प्रतिदिन सर्ट्रालिन 50 मिलीग्राम ले रहा है। हल्के अवसाद का इतिहास।',
    expected: ['सामान्यीकृत चिंता विकार', 'सर्ट्रालिन', 'अवसाद'],
  },
  {
    lang: 'Bengali',
    text: 'রোগীর সাধারণ উদ্বেগ ব্যাধি রয়েছে এবং তিনি প্রতিদিন সারট্রালিন 50 মিলিগ্রাম গ্রহণ করছেন। হালকা বিষণ্নতার ইতিহাস।',
    expected: ['সাধারণ উদ্বেগ ব্যাধি', 'সারট্রালিন', 'বিষণ্নতা'],
  },
]

function parse(raw, source) {
  let parsed
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const sourceNfc = source.normalize('NFC')
  return parsed.filter((d) => {
    const text = typeof d.text === 'string' ? d.text.trim() : ''
    if (!text) return false
    if (d.type !== 'HEALTH_DATA') return false
    if (typeof d.confidence !== 'number' || d.confidence < CONFIDENCE_FLOOR) return false
    if (typeof d.ruleId !== 'string' || !d.ruleId.startsWith('gemma:')) return false
    if (typeof d.reason !== 'string' || !d.reason) return false
    return sourceNfc.includes(text.normalize('NFC'))
  })
}

async function run(text) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      stream: false,
      think: false,
      options: { temperature: 0.1, num_predict: 2048 },
      format: 'json',
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status} ${res.statusText}: ${await res.text()}`)
  const data = await res.json()
  return data.message?.content ?? data.response ?? ''
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Gemma 4 multilingual probe · ${MODEL}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  for (const c of CASES) {
    const t0 = Date.now()
    const raw = await run(c.text).catch((e) => `ERR ${e.message}`)
    const dets = parse(raw, c.text)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    const found = c.expected.filter((e) =>
      dets.some((d) => d.text.toLowerCase().includes(e.toLowerCase()) || e.toLowerCase().includes(d.text.toLowerCase()))
    )
    console.log()
    console.log(`── ${c.lang} (${elapsed}s)`)
    console.log(`  expected: ${c.expected.length}  ·  flagged: ${dets.length}  ·  matched: ${found.length}/${c.expected.length}`)
    for (const d of dets) {
      console.log(`    + "${d.text}"  [${d.ruleId.replace('gemma:', '')}, conf=${d.confidence.toFixed(2)}]`)
    }
    const missed = c.expected.filter((e) => !found.includes(e))
    for (const m of missed) console.log(`    - missed: ${m}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
