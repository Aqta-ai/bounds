# bounds 🔒

[![DEMO VIDEO](https://img.shields.io/badge/DEMO%20VIDEO-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=XHLaRmNPfCs)
[![YOUTUBE](https://img.shields.io/badge/YOUTUBE-000000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=XHLaRmNPfCs)
[![LIVE APP](https://img.shields.io/badge/LIVE%20APP-22863A?style=for-the-badge)](https://bounds.aqta.ai)
[![BOUNDS.AQTA.AI](https://img.shields.io/badge/BOUNDS-4A4A4A?style=for-the-badge)](https://bounds.aqta.ai)
![BUILT WITH](https://img.shields.io/badge/BUILT%20WITH-4A4A4A?style=for-the-badge)
[![BERT NER](https://img.shields.io/badge/BERT%20NER-E34F26?style=for-the-badge)](https://huggingface.co/Xenova/bert-base-NER)
[![PDF.JS](https://img.shields.io/badge/PDF.JS-6E40C9?style=for-the-badge)](https://mozilla.github.io/pdf.js/)
[![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-1A7F64?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)

**Mishandling a single medical PDF can expose you to GDPR fines up to €20M — or 4% of global revenue, whichever is higher. Bounds redacts entirely in your browser; your file never transits a vendor server.**

In Ireland, medical records ended up on TikTok. In France, hackers stole health data for over 15 million patients from GP software. Same pattern every time: unredacted data, too many systems, one weak link.

Every redaction tool wants you to upload patient data to their servers and find the PII yourself. That defeats the point.

Bounds finds PII automatically and never uploads your file. The key stays with you. Anyone with the PDF gets nothing without it.

---

## What it does ✨

- 🧠 Automatically detects names, addresses, IBANs, SSNs, emails, phone numbers, passports, dates of birth, and more
- 🌍 Supports EN, DE, FR, IT, ES documents
- 📷 OCR fallback for scanned/image-only PDFs (Tesseract.js)
- ⬛ Produces a redacted PDF with solid black boxes over all PII
- 🗝️ Generates an encrypted key file for **reversible** redaction — restore the original any time
- 📴 Works **offline** after first visit — service worker pre-caches the app shell and PDF engine
- 📋 Exports a local **audit log** (JSON) — timestamped record of what was redacted, by type, with no document content included

---

## Privacy by design 🛡️

Open DevTools → Network tab. You'll see **zero outbound requests** after the initial page load. All AI inference, PDF processing, and cryptography happen locally in your browser using WASM.

Bounds deliberately has no external LLM integration. This is not a limitation; it's the point. The moment a document is routed through an external model, your data becomes training material, a log entry, or a liability. Local BERT inference delivers ≥90% PII recall without any of that. Your documents stay yours. This design aligns with GDPR and HIPAA’s “minimum necessary” principle — documents never leave the device.

After detection, Bounds generates a plain-English **privacy risk summary** using a second local model (LaMini-Flan-T5, ~77MB, also cached in IndexedDB). No prompt leaves your device.

![Bounds demo](public/bounds-demo.gif)

---

## How reversible redaction works 🔄

After redacting, you download **four files**:

| File | Description |
|---|---|
| `document-redacted.pdf` | Safe to share — PII replaced with black boxes |
| `document.bounds` | Encrypted map of what was redacted (AES-256-GCM) |
| `document.key` | AES decryption key — **keep this secret** |
| `document-audit.json` | Local audit log — timestamped, type breakdown, no document content |

To restore the original: drag the redacted PDF, `.bounds`, and `.key` back into Bounds.

Both `.bounds` and `.key` are required to restore. The `.bounds` file contains only ciphertext , it is cryptographically useless without the `.key` file.

---

## Tech stack ⚡

| Component | Library | Licence |
|---|---|---|
| Multilingual NER (EN/DE/FR/IT/ES) | `@xenova/transformers` BERT-NER WASM | Apache 2.0 |
| PDF text extraction + bbox | `pdfjs-dist` | Apache 2.0 |
| PDF redaction (black boxes) | `pdf-lib` | MIT |
| OCR for scanned pages | `tesseract.js` | Apache 2.0 |
| Reversible encryption | Web Crypto API (built-in) | , |
| UI | React 18 + Tailwind CSS | MIT |

---

## Setup 🚀

```bash
cd bounds
npm install
npm run dev
# → http://localhost:5173
```

On first PDF load, Transformers.js downloads the multilingual BERT NER model (~430 MB, ONNX quantised) and caches it in your browser's IndexedDB. Subsequent runs are instant.

## Build

```bash
npm run build       # TypeScript + Vite production build → dist/
npm run type-check  # TypeScript type validation
npm run preview     # Preview the production build locally
```

## Testing

All 176 unit tests run fully offline — no browser, no network, no model downloads.

```bash
npm install
npm test
```

Expected output:

```
 ✓ src/__tests__/fileUtils.test.ts          (12 tests)
 ✓ src/__tests__/NERWorker.test.ts          (19 tests)
 ✓ src/__tests__/KeyVaultService.test.ts    (16 tests)
 ✓ src/__tests__/ExplainWorker.test.ts      (11 tests)
 ✓ src/__tests__/RegexDetector.test.ts      (75 tests)
 ✓ src/__tests__/PDFEngine.test.ts          (17 tests)
 ✓ src/__tests__/RedactionPipeline.test.ts  (26 tests)

 Test Files  7 passed (7)
      Tests  176 passed (176)
   Duration  ~700ms
```

| Suite | What it covers |
|---|---|
| `RegexDetector` | IBAN, email, credit card, SSN, Swiss AHV, IP, phone, DOB — locale variants and edge cases |
| `RedactionPipeline` | Risk score levels, category weights, disabled-detection exclusions |
| `NERWorker` | NER label → PII type mapping; detection gating on the `enabled` flag |
| `KeyVaultService` | AES-256-GCM encrypt/decrypt round-trip; key export/import; `buildMap` |
| `PDFEngine` | `findSpanBBox` 3-pass matching; `findOcrWordBBox` window and part-word fallback |
| `ExplainWorker` | `buildExplainPrompt` output structure |
| `fileUtils` | `stemName`; base64 encode/decode round-trip |

Watch mode (re-runs on save):

```bash
npm run test:watch
```

---

## Self-hosting 🏠

Bounds is a fully static app , the `dist/` folder produced by `npm run build` can be served from any static host with no backend required.

**Requirement:** the host must set these two HTTP headers (needed for `SharedArrayBuffer` used by WASM threads):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Deployment options:**

| Platform | Notes |
|---|---|
| Nginx / Apache | Add headers in server config , see [vercel.json](vercel.json) for reference |
| Vercel | Zero-config , headers already in `vercel.json` |
| Cloudflare Pages | Add headers via `_headers` file in `dist/` |
| Docker | Serve `dist/` with any static file server (e.g. `nginx:alpine`) |
| Self-hosted VM | `npm run build` → copy `dist/` → serve with nginx |

No database, no server-side processing, no environment variables needed. Drop the build output behind any CDN or web server and it works.

---

## Architecture 🏗️

See [architecture.png](architecture.png) for a full data-flow diagram, or [ARCHITECTURE.md](ARCHITECTURE.md) for a written breakdown.

```
Browser (local only)
│
├── React UI (4-step wizard)
│   DropZone → LoadingOverlay → RedactionReview → ExportPanel
│
├── RedactionPipeline (orchestrator)
│   ├── PDFEngine        , pdfjs-dist (extract text+bbox) + pdf-lib (write boxes)
│   ├── RegexDetector    , IBAN, SSN, email, phone, passport, DOB, IP (per-locale)
│   ├── NERWorker        , @xenova/transformers BERT in Web Worker
│   ├── OCRWorker        , tesseract.js WASM in Web Worker (scanned pages only)
│   └── KeyVaultService  , AES-256-GCM reversible redaction key file
│
└── No network calls after initial asset load
```

---

## Supported PII types 🔍

Detection uses a hybrid approach: a multilingual BERT NER model for contextual entities, combined with locale-aware regex for structured identifiers. The two layers deduplicate against each other.

**Universal , all languages**

| Type | Examples |
|---|---|
| `PERSON` | Full names, first/last names (NER) |
| `ORG` | Companies, institutions (NER) |
| `ADDRESS` | Street addresses, locations (NER + locale postcode) |
| `EMAIL` | Any RFC-valid email address |
| `PHONE` | International E.164 + local formats (30+ country codes) |
| `IBAN` | All ISO 13616 country codes (15–34 chars) |
| `CREDIT_CARD` | Visa, Mastercard, Amex, Discover, JCB |
| `IP_ADDRESS` | IPv4 and IPv6 |
| `DATE_OF_BIRTH` | DD/MM/YYYY, YYYY-MM-DD, DD.MM.YYYY |

**Locale-specific**

| Language | Type | Identifier |
|---|---|---|
| 🇬🇧 English | `ID_NUMBER` | UK National Insurance number |
| 🇺🇸 English | `SSN` | US Social Security Number |
| 🇬🇧 English | `ADDRESS` | UK postcode |
| 🇩🇪 German | `SSN` | Sozialversicherungsnummer |
| 🇩🇪 German | `ID_NUMBER` | Steueridentifikationsnummer |
| 🇨🇭 Swiss (DE/FR) | `SSN` | AHV / AVS number (756.XXXX.XXXX.XX) |
| 🇫🇷 French | `SSN` | Numéro INSEE (NIR) |
| 🇮🇹 Italian | `ID_NUMBER` | Codice Fiscale |
| 🇮🇹 Italian | `ID_NUMBER` | Partita IVA (VAT) |
| 🇪🇸 Spanish | `ID_NUMBER` | DNI / NIE |
| 🇪🇸 Spanish | `SSN` | Número de Seguridad Social |
| All | `PASSPORT` | ICAO machine-readable passport numbers |

---

## Roadmap

- [x] PWA / offline mode — service worker pre-caches model assets so Bounds works fully offline after first visit
- [ ] DOCX support
- [ ] Batch processing (multiple PDFs)

---

## Contributing 🤝

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, help channels, code of conduct, and how to get started.

---

## Acknowledgements 🙏

Thanks to **GenAI Zurich** and **GoCalma** for the inspiration.

---

*bounds is an open-source project by Anya, Aqta Technologies Ltd · MIT Licence*
