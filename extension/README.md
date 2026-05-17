# Bounds Privacy Scanner — Chrome Extension

Intercepts PDF uploads on any website and warns you about sensitive data before it leaves your device.

## Load for demo (sideload — no Chrome Web Store needed)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. Done — the Bounds shield icon appears in your toolbar

## Demo flow

1. Open the Bounds web app and click **Try sample** to generate a clinical-note PDF locally, then save it from the export panel. (You can also use any PDF containing sensitive data.)
2. Go to any site with a file upload (Gmail, a patient portal, a bank portal, even a blank HTML file with `<input type="file">`)
3. Select the PDF
4. The Bounds overlay appears bottom-right with detected items before the upload proceeds
5. Click **Redact with Bounds** to open Bounds in a new tab and run the full pipeline

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
- The full Bounds pipeline (BERT NER, OCR, face detection, Gemma 4 contextual PHI) runs in the Bounds web app
