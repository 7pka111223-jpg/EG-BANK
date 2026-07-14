# EG-BANK — Arabic Bank-Cheque Data Extractor

Fully **offline** HTML tool (Arabic UI, RTL) that reads scanned bank-cheque
PDFs (2 pages per cheque: front + back), extracts fields graphically via OCR
(Tesseract), lets the user review/correct them, and exports to Excel/CSV.

## Layout
- `index.html` + `app.js` + `styles.css` — the app (open `index.html` directly,
  or `serve.sh` / `serve.bat` for a local server when `file://` workers are blocked)
- `cheque-extractor.standalone.html` — the entire app in one self-contained file;
  regenerate it with `node tools/build-single-file.js` after any app change
- `vendor/` — embedded libraries (`pdf.min.js`, `tesseract.min.js`,
  `xlsx.full.min.js`) and OCR models under `vendor/embed/`
- `tools/build-embeds.js` — regenerates the vendor embeds

## Rules
- Absolutely no network calls: PDFs are read as images locally; all libraries
  and OCR models ship in `vendor/`. Vendor any new dependency.
- The PDF is treated graphically (scanned cheques often lack a text layer) —
  do not rely on the PDF text layer.
- The UI is Arabic/RTL; keep labels in Arabic and layouts RTL-safe.
- After editing the app, rebuild and commit `cheque-extractor.standalone.html`
  so the single-file distribution stays in sync.
