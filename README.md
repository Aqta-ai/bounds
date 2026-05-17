# bounds

[![Demo](https://img.shields.io/badge/Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/-jConrg1GXo)
[![Gemma 4 inside](https://img.shields.io/badge/Gemma%204-inside-4A6B62?style=for-the-badge)](https://github.com/Aqta-ai/bounds-gemma)
[![Apache--2.0 engine](https://img.shields.io/badge/Engine-Apache--2.0-blue?style=for-the-badge)](https://github.com/Aqta-ai/bounds-gemma)

**Private PDF redaction. Everything runs in your browser. Nothing is uploaded.**

Bounds finds and redacts personal information in PDFs using on-device AI. No server, no account, no document content leaves your machine. Works offline after first load.

> **Now with Gemma 4 contextual PHI.** Bounds ships a fifth detection layer powered by Google's Gemma 4 E2B running entirely in your browser (via WebLLM) or locally via Ollama. It catches the protected-health-information shapes that regex and named-entity recognition systematically miss — inline diagnoses, medication mentions, treatment narratives, indirect health context, sensitive social data, and genetic references. The HIPAA Safe Harbor #17 catch-all gap, closed without sending document bytes anywhere.
>
> The Gemma 4 pipeline is open-sourced as a standalone toolkit at [Aqta-ai/bounds-gemma](https://github.com/Aqta-ai/bounds-gemma) (Apache-2.0). You can install it via `npm i bounds-gemma` and run the same contextual PHI detection against your own pipelines.

---

## Features

- **Five detection layers** — regex patterns, BERT NER (104 languages), Tesseract OCR for scans, face detection, **and Gemma 4 contextual PHI**
- **Gemma 4 in your browser** — `gemma-4-E2B-it-q4f16_1-MLC` via [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm), falls back to Ollama (`gemma4:e2b`) when available locally
- **Reversible redaction** — AES-256-GCM encrypted vault lets you restore original values with a key file
- **Works offline** — runs entirely in-browser via WebAssembly + WebGPU, works in airplane mode
- **Batch processing** — drop multiple PDFs at once
- **Audit trail** — timestamped JSON log with no document content
- **Multilingual UI** — EN, DE, FR, ES, IT, PT, NL, PL
- **Chrome extension** — redact from the browser toolbar

---

## Why Gemma 4

The HIPAA Safe Harbor de-identification standard lists eighteen identifier categories. The first sixteen are structured — phone numbers, social-security numbers, medical-record numbers, dates of birth — and regex + NER handle them well. Identifier #17 is *"any other unique identifying number, characteristic, or code"*, and the surrounding clinical narrative is where it lives: a sentence that names a diagnosis without a label, a paragraph that mentions a medication in passing, an aside about a "therapist" or "insulin pump" that re-identifies the patient.

Bounds uses Gemma 4 E2B (effective 2B-active parameter, int4 quantised, ~1.5 GB on disk) as the contextual layer over the other four detectors. Three guardrails make it safe for healthcare:

1. **In-corpus verification** — every Gemma-emitted span must be a byte-identical substring of the page text after Unicode NFC normalisation. Model hallucinations and paraphrases are dropped silently.
2. **Confidence floor of 0.75** — tuned for healthcare; below this, candidates are omitted before reaching the review panel.
3. **Default-off in the review UI** — every Gemma detection arrives with `enabled: false`. The reviewer opts in per item.

Document text never leaves the browser process. The only outbound traffic on first use is a one-time model fetch from the MLC CDN (or zero, if you have Ollama running locally).

For the architecture in detail, the [bounds-gemma](https://github.com/Aqta-ai/bounds-gemma) repo has the worker, parser, system prompt, tests, and a runnable Ollama smoke-test example.

---

## Quick Start

```bash
npm install
npm run dev
```

On first use, the BERT NER model (~430 MB) downloads once and caches in the browser. The Gemma 4 E2B WebLLM model (~1.5 GB) downloads when you first enable contextual PHI in the settings panel. Subsequent runs are instant.

```bash
npm run build       # Production build
npm test            # Unit tests
npm run preview     # Preview production build
```

---

## How It Works

1. **Upload** a PDF (or drop multiple)
2. **Review** AI-detected PII — names, addresses, emails, IBANs, dates of birth, health data, and more. Gemma 4's contextual detections appear with their reason text and default-off, ready for you to opt in per item.
3. **Export** four files:

| File | Purpose |
|---|---|
| `*-redacted.pdf` | Safe to share — PII permanently replaced with flat images |
| `*.bounds` | Encrypted redaction map |
| `*.key` | AES decryption key — keep this secret |
| `*-audit.json` | Timestamped audit log |

To restore original values, drag the `.bounds` and `.key` files into the Restore panel.

---

## Self-Hosting

Bounds is fully static. Serve `dist/` from any host with these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Works on Vercel, Cloudflare Pages, Nginx, Docker. No backend required. The WebGPU + cross-origin-isolation requirements enable in-browser Gemma 4 inference; Ollama running locally on the user's machine works as a fallback.

---

## Related projects

- **[Aqta-ai/bounds-gemma](https://github.com/Aqta-ai/bounds-gemma)** — the Gemma 4 contextual PHI pipeline as a standalone Apache-2.0 toolkit. Worker, parser, system prompt, unit tests, runnable smoke-test example. `npm i bounds-gemma`.
- **[bounds.pro](https://bounds.pro)** — the proprietary enterprise edition with workspace, multi-tenant, audit, and encrypted vault management.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Licence

The source code is licensed under the [Apache-2.0 Licence](LICENSE). See [NOTICE](NOTICE) for third-party attributions (Google Gemma 4, HIPAA Safe Harbor categories).

**Bounds** is the open-source community edition. **Bounds Pro** is the proprietary enterprise edition with additional features, managed by Aqta Technologies Ltd.

"Bounds" and "Bounds Pro" are trademarks of Aqta Technologies Ltd and are not covered by the Apache-2.0 Licence. You may fork and modify the code, but you may not use the Bounds or Bounds Pro name or logo to market a derivative product.
