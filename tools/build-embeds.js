#!/usr/bin/env node
/* Rebuilds the vendor/ folder from pinned npm packages.
 *
 * Usage (from repo root):
 *   npm install --no-save \
 *     pdfjs-dist@3.11.174 tesseract.js@5.1.1 tesseract.js-core@5.1.1 \
 *     xlsx@0.18.5 @tesseract.js-data/ara@1.0.0 @tesseract.js-data/eng@1.0.0
 *   node tools/build-embeds.js
 *
 * Why embeds? Browsers block fetch()/Worker over file://, so OCR can't load its
 * worker/core/traineddata that way. We base64-embed those binaries into <script>
 * files (loaded as window.__ASSET_*) and turn them into blob URLs at runtime, which
 * works from file:// (double-click) AND from a local server, with zero network.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const VENDOR = path.join(ROOT, 'vendor');
const EMBED = path.join(VENDOR, 'embed');
fs.mkdirSync(EMBED, { recursive: true });

function need(p){ if (!fs.existsSync(p)) { console.error('Missing: ' + p + '\nDid you run the npm install line above?'); process.exit(1); } return p; }
function copy(src, dstName){ fs.copyFileSync(need(src), path.join(VENDOR, dstName)); console.log('copied  ', dstName); }
function embed(globalName, src, outName){
  const b64 = fs.readFileSync(need(src)).toString('base64');
  fs.writeFileSync(path.join(EMBED, outName), `window.${globalName}=${JSON.stringify(b64)};\n`);
  console.log('embedded', ('embed/' + outName).padEnd(20), (b64.length / 1e6).toFixed(2) + 'MB');
}

// Main libraries — loaded directly via <script src> (works under file://)
copy(path.join(NM, 'pdfjs-dist/legacy/build/pdf.min.js'), 'pdf.min.js');
copy(path.join(NM, 'tesseract.js/dist/tesseract.min.js'), 'tesseract.min.js');
copy(path.join(NM, 'xlsx/dist/xlsx.full.min.js'), 'xlsx.full.min.js');

// Binary assets — base64-embedded as window.__ASSET_*
embed('__ASSET_WORKER',    path.join(NM, 'tesseract.js/dist/worker.min.js'), 'worker.js');
embed('__ASSET_CORE',      path.join(NM, 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'core.js');
embed('__ASSET_PDFWORKER', path.join(NM, 'pdfjs-dist/legacy/build/pdf.worker.min.js'), 'pdfworker.js');
// best_int = compact, high-quality LSTM models (OEM 1)
embed('__ASSET_ARA',       path.join(NM, '@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz'), 'ara.js');
embed('__ASSET_ENG',       path.join(NM, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'eng.js');

console.log('\nDone. vendor/ rebuilt.');
