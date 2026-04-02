# Bounds Privacy Scanner — Chrome Extension

Intercepts PDF uploads on any website and warns you about sensitive data before it leaves your device.

## Load for demo (sideload — no Chrome Web Store needed)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. Done — the Bounds shield icon appears in your toolbar

## Demo flow

1. Go to any site with a file upload (Gmail, GoCalma, a bank portal, even a blank HTML file with `<input type="file">`)
2. Select a PDF containing sensitive data (use `public/demo-patient-report.pdf`)
3. The Bounds overlay appears bottom-right with detected items before the upload proceeds
4. Click **Redact with Bounds** — opens bounds.aqta.ai in a new tab
5. Drag the PDF in and show the full redaction flow

## What it detects (regex, instant, no model)

- IBAN
- Credit card numbers
- Swiss AHV / AVS numbers
- US Social Security Numbers
- Email addresses
- Phone numbers
- Dates of birth
- Passport numbers

## Notes

- Works on text-layer PDFs (including our demo PDF)
- Compressed PDFs are skipped silently — never blocks an upload
- No data is sent anywhere — runs entirely in the content script
- The full Bounds pipeline (BERT NER, OCR, face detection) runs at bounds.aqta.ai
