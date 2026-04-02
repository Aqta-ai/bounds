# bounds 🔒

[![DEMO v2.0](https://img.shields.io/badge/DEMO%20v2.0-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/-jConrg1GXo)
[![DEMO v1.0](https://img.shields.io/badge/DEMO%20v1.0-CC0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=XHLaRmNPfCs)
[![LIVE APP](https://img.shields.io/badge/LIVE%20APP-22863A?style=for-the-badge)](https://bounds.aqta.ai)
![BUILT WITH](https://img.shields.io/badge/BUILT%20WITH-4A4A4A?style=for-the-badge)
[![BERT NER](https://img.shields.io/badge/BERT%20NER-E34F26?style=for-the-badge)](https://huggingface.co/Xenova/bert-base-multilingual-cased-ner-hrl)
[![PDF.JS](https://img.shields.io/badge/PDF.JS-6E40C9?style=for-the-badge)](https://mozilla.github.io/pdf.js/)
[![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-1A7F64?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)

**Privacy-first PDF redaction using hybrid AI. Zero uploads. Reversible encryption.**

Healthcare is the #1 targeted sector in the EU (ENISA 2023). Every day, people upload sensitive documents to cloud platforms: medical records to AI assistants, bank statements to financial apps. One breach = everything exposed.

On 27 March, the European Commission confirmed a breach. 350 gigabytes. Confidential documents. Contracts. Cloud infrastructure.

The files were on a server. That was enough.

In Switzerland, a data breach doesn't just fine your company. It fines you up to CHF 250,000, personally.

**Bounds has no server. Nothing to breach.**

Every redaction tool on the market makes you upload your file to process it. You find the sensitive information yourself, then trust them with your unredacted document. The right answer to a privacy problem is never "trust us".

---

## Why Bounds

Every existing redaction tool is built on a broken premise: send us your sensitive document, we'll make it safe. That's not privacy. That's a new exposure point.

GDPR Art. 9, Swiss FADP Art. 5, and HIPAA all require that sensitive data not leave your infrastructure without a legal basis. Most redaction workflows violate this before the first click.

Bounds flips the model. The AI runs in your browser. The encryption runs in your browser. Nothing is transmitted. There is no server to breach, no vendor to audit, no data processor agreement to sign.

**The name is the product promise:**

- _bounds_ as boundary: your data stays within the bounds of your device. It never goes "out of bounds" to a server.
- _bounds_ as redaction: drawing a box (a bound) around sensitive information, limiting what can be seen.

---

## Try It Now (2 Minutes) 

1. Open [bounds.aqta.ai](https://bounds.aqta.ai)
2. Open DevTools → Network tab
3. Upload any PDF with personal information
4. Watch: Zero network requests after initial load
5. Review AI-detected PII + generative risk summary
6. Export redacted PDF + encrypted vault + key
7. Restore: Drag the `.bounds` and `.key` files back to reveal original values

---

## What It Does 

- 🧠 **Hybrid AI detection:** BERT NER + Flan-T5 generative AI, all local
- 👤 **Face detection:** TinyFaceDetector flags photos in scanned documents
- 🌍 **Multilingual UI:** 8 languages (EN, DE, FR, ES, IT, PT, NL, PL)
- 🔄 **Reversible redaction:** AES-256-GCM vault, restore original any time
- ✈️ **Works fully offline:** No network needed after first use
- 🏥 **Healthcare-ready:** no data egress means no Art. 28 DPA or HIPAA BAA required with Bounds
- 📋 **Audit trail:** Timestamped JSON log (no document content)
- 📦 **Batch processing:** Drop multiple PDFs to redact in one pass
- 🧩 **Chrome extension:** Redact directly from the browser toolbar

---

## Reversible Redaction 

Traditional redaction is destructive. Bounds encrypts the redaction map with AES-256-GCM.

After redacting, you download **four files**:

| File | Description |
|---|---|
| `document-redacted.pdf` | Safe to share: PII replaced with black boxes |
| `document.bounds` | Encrypted map of what was redacted |
| `document.key` | AES decryption key: **keep this secret** |
| `document-audit.json` | Timestamped audit log (no document content) |

To restore: drag the `.bounds` and `.key` files into the Restore panel to reveal original values. The redacted PDF is permanent: Bounds restores the values, not the file.

**Why it matters:** Legal discovery, clinical audits, and compliance reviews need the original. Traditional tools force you to keep two copies with no access control. Bounds gives you one redacted copy + encrypted restore path.

---

## GenAI Integration 

Bounds is a privacy-enabling layer for safe GenAI workflows. You cannot safely send unredacted documents to external LLMs without violating GDPR/HIPAA.

**Generative AI components:**
1. **BERT NER multilingual** (430MB): `bert-base-multilingual-cased-ner-hrl`, discriminative AI for PII detection across 9 languages
2. **LaMini-Flan-T5-77M** (77MB): Generative AI for risk summaries
   - Produces: "This document contains sensitive medical information including 3 patient names, 2 addresses, and 1 social security number"
   - See: `src/workers/explain.worker.ts`

---

## Privacy by Design 

Open DevTools → Network tab. You'll see **zero outbound requests** after the initial page load. All AI inference, PDF processing, and cryptography happen locally using WASM.

Bounds deliberately has no external LLM integration. The moment a document is routed through an external model, your data becomes training material. Local BERT inference delivers ≥90% PII recall without any of that.

---

## Supported PII Types 

**Universal (all languages):**
- `PERSON`: Full names (NER)
- `ORG`: Companies, institutions (NER)
- `ADDRESS`: Street addresses (NER + locale postcode)
- `EMAIL`, `PHONE`, `IBAN`, `CREDIT_CARD`, `IP_ADDRESS`, `DATE_OF_BIRTH`

**Locale-specific:**
- 🇬🇧 UK National Insurance, UK postcode
- 🇺🇸 US Social Security Number
- 🇩🇪 Sozialversicherungsnummer, Steueridentifikationsnummer
- 🇨🇭 Swiss AHV / AVS number
- 🇫🇷 Numéro INSEE (NIR)
- 🇮🇹 Codice Fiscale, Partita IVA
- 🇪🇸 DNI / NIE, Número de Seguridad Social
- 🇵🇹 NIF / NISS
- 🇳🇱 BSN (Burgerservicenummer)
- All: ICAO passport numbers

**NER model:** `bert-base-multilingual-cased-ner-hrl`: fine-tuned on 9 languages (EN, DE, FR, ES, IT, PT, NL, ZH, AR)

---

## Setup 🚀

```bash
cd bounds
npm install
npm run dev
# → http://localhost:5173
```

On first PDF load, the BERT NER model (~430 MB) downloads and caches in the browser Cache API. Subsequent runs are instant.

## Build & Test

```bash
npm run build       # Production build → dist/
npm test            # Unit tests
npm run preview     # Preview production build
```

---

## Tech Stack 

| Component | Library |
|---|---|
| **AI Models** | `@xenova/transformers` (BERT NER + Flan-T5) |
| **PDF Processing** | `pdfjs-dist`, `pdf-lib`, `tesseract.js` |
| **Security** | Web Crypto API (AES-256-GCM) |
| **UI** | React 18 + Tailwind CSS |

All MIT/Apache 2.0 licensed.

---

## Architecture 

See [architecture.png](architecture.png) or [ARCHITECTURE.md](ARCHITECTURE.md) for details.

```
Browser (local only)
│
├── React UI (4-step wizard)
├── RedactionPipeline (orchestrator)
│   ├── PDFEngine (pdfjs-dist + pdf-lib)
│   ├── RegexDetector (locale-aware patterns)
│   ├── NERWorker (BERT in Web Worker)
│   ├── OCRWorker (tesseract.js for scanned pages)
│   ├── FaceDetector (TinyFaceDetector via @vladmandic/face-api, universal)
│   ├── ExplainWorker (Flan-T5 risk summary)
│   └── KeyVaultService (AES-256-GCM)
│
└── No network calls after initial load
```

---

## Self-Hosting 

Bounds is fully static. Serve `dist/` from any host with these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Works on Vercel, Cloudflare Pages, Nginx, Apache, Docker. No database or backend required.

---

## Contributing 

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Acknowledgements 🙏

Originally built for the **GenAI Zürich Hackathon 2026** at Volkshaus Zürich. Thank you to the organisers and the GoCalma team for the challenge that inspired this.

---

*Bounds is an open-source project by Aqta Technologies Ltd · MIT Licence · [bounds.aqta.ai](https://bounds.aqta.ai)*
