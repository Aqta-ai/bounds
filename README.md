# bounds

[![Live App](https://img.shields.io/badge/Live_App-009E60?style=for-the-badge)](https://bounds.aqta.ai)
[![Demo](https://img.shields.io/badge/Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/-jConrg1GXo)

**Private PDF redaction. Everything runs in your browser. Nothing is uploaded.**

Bounds finds and redacts personal information in PDFs using on-device AI. No server, no account, no data leaves your machine. Works offline.

---

## Features

- **Hybrid AI detection** — BERT NER (104 languages) + regex patterns + Tesseract OCR for scans
- **Face detection** — flags photos in ID documents and scanned pages
- **Reversible redaction** — AES-256-GCM encrypted vault lets you restore original values with a key file
- **Works offline** — runs entirely in-browser via WebAssembly, works in airplane mode
- **Batch processing** — drop multiple PDFs at once
- **Audit trail** — timestamped JSON log with no document content
- **Multilingual UI** — EN, DE, FR, ES, IT, PT, NL, PL
- **Chrome extension** — redact from the browser toolbar

---

## Quick Start

```bash
npm install
npm run dev
```

On first use, the BERT NER model (~430 MB) downloads once and caches in the browser. Subsequent runs are instant.

```bash
npm run build       # Production build
npm test            # 176 unit tests
npm run preview     # Preview production build
```

---

## How It Works

1. **Upload** a PDF (or drop multiple)
2. **Review** AI-detected PII — names, addresses, emails, IBANs, dates of birth, health data, and more
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

Works on Vercel, Cloudflare Pages, Nginx, Docker. No backend required.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Licence

The source code is licensed under the [MIT Licence](LICENSE).

**Bounds** is the open-source community edition. **Bounds AI** is the proprietary enterprise edition with additional features, managed by Aqta Technologies Ltd.

"Bounds" and "Bounds AI" are trademarks of Aqta Technologies Ltd and are not covered by the MIT Licence. You may fork and modify the code, but you may not use the Bounds or Bounds AI name or logo to market a derivative product.

---

Built by [Anya Chueayen](https://github.com/anyapages) · [Aqta](https://aqta.ai)
