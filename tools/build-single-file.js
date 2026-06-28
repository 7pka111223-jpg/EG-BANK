#!/usr/bin/env node
/* Bundles the whole app into ONE self-contained, offline HTML file.
 * Inlines styles.css, all vendored libraries, the base64 OCR assets, and app.js.
 *
 * Usage (from repo root):  node tools/build-single-file.js
 * Output:  cheque-extractor.standalone.html  (~14MB, just double-click it)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Prevent a stray "</script>" inside library code from closing the tag early.
const safeJs = (js) => js.replace(/<\/script/gi, '<\\/script');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let html = read('index.html');

// NOTE: replacement values are passed via a FUNCTION so that "$" sequences inside
// minified library code (e.g. $&, $', $`) are NOT treated as special replace patterns.

// 1) inline the stylesheet
html = html.replace(/<link rel="stylesheet" href="styles\.css"\s*\/?>/,
  () => '<style>\n' + read('styles.css') + '\n</style>');

// 2) inline every <script src="..."> in document order
const scripts = [
  'vendor/pdf.min.js',
  'vendor/tesseract.min.js',
  'vendor/xlsx.full.min.js',
  'vendor/embed/worker.js',
  'vendor/embed/core.js',
  'vendor/embed/ara.js',
  'vendor/embed/eng.js',
  'vendor/embed/pdfworker.js',
  'app.js',
];
for (const s of scripts) {
  const tag = new RegExp('<script src="' + esc(s) + '"></script>');
  if (!tag.test(html)) { console.error('Could not find script tag for ' + s); process.exit(1); }
  const inline = '<script>\n' + safeJs(read(s)) + '\n</script>';
  html = html.replace(tag, () => inline);
}

const out = 'cheque-extractor.standalone.html';
fs.writeFileSync(path.join(ROOT, out), html);
console.log('Wrote ' + out + '  (' + (fs.statSync(path.join(ROOT, out)).size / 1e6).toFixed(1) + ' MB)');
