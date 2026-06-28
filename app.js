/* ==========================================================================
   أداة استخراج بيانات الشيكات البنكية — منطق التطبيق
   Offline Arabic bank-cheque data extractor.
   Pure client-side: PDF.js (render) + Tesseract.js (OCR) + SheetJS (xlsx).
   ========================================================================== */
'use strict';
(function () {

  // ---------------------------------------------------------------- vendor paths
  // OCR worker/core/traineddata are delivered as base64 <script> assets (window.__ASSET_*)
  // and turned into blob URLs at runtime, so everything works from file:// with no server.
  const ASSET_LANG = { ara: () => window.__ASSET_ARA, eng: () => window.__ASSET_ENG };

  // ---------------------------------------------------------------- field schema
  const FIELDS = ['bankName', 'bankCode', 'chequeNo', 'accountNo', 'drawer', 'amount', 'date'];
  const HEADERS = [
    ['اسم البنك', 'bankName'], ['كود البنك', 'bankCode'], ['رقم الشيك', 'chequeNo'],
    ['رقم الحساب', 'accountNo'], ['اسم الساحب', 'drawer'], ['المبلغ', 'amount'], ['التاريخ', 'date'],
  ];

  // ---------------------------------------------------------------- DOM helpers
  const $ = (s) => document.querySelector(s);
  const el = {};
  ['fileInput','dropZone','pdfInfo','pagesPerCheque','facePosition','ocrLang','targetWidth','psm',
   'concurrency','preGray','preThresh','preInvertAuto','startBtn','resetBtn','uploadCard','progressCard',
   'progressBar','progressText','pauseBtn','cancelBtn','resultsCard','counts','searchBox','onlyUnverified',
   'exportCsvBtn','exportXlsxBtn','resultsBody','resultsTable','engineStatus','detailModal','detailTitle',
   'closeModal','detailCanvas','selectCanvas','reocrBtn','reocrTarget','reocrDigits','rawText','prevCheque',
   'nextCheque','detailPos','toast'
  ].forEach((id) => el[id] = document.getElementById(id));

  // ---------------------------------------------------------------- state
  let pdfDoc = null, pdfName = 'cheques', results = [], workers = [];
  let cancelFlag = false, pauseFlag = false, processing = false, enginLangs = '';
  let settings = {};
  let detailIndex = -1, detailFullCanvas = null, sel = null;

  // ====================================================================== utils
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function b64ToU8(b64){
    const s = atob(b64 || ''), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  function blobUrlFromB64(b64, type){ return URL.createObjectURL(new Blob([b64ToU8(b64)], { type: type || 'application/octet-stream' })); }
  const AR_IND = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
                   '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
  const toWestern = (s) => (s || '').replace(/[٠-٩۰-۹]/g, (d) => AR_IND[d] || d);
  function normAr(s) {
    return (s || '')
      .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '')  // harakat
      .replace(/ـ/g, '')                                          // tatweel
      .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ').trim();
  }
  const arabicLen = (s) => ((s || '').match(/[؀-ۿ]/g) || []).length;
  const cleanSp = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const cleanName = (s) => cleanSp((s || '').replace(/^[\s_.،:|()\-–]+/, '').replace(/[\s_.،:|()\-–]+$/, ''));
  const num = (s) => parseFloat(String(s || '').replace(/[^\d.]/g, '')) || 0;
  function escAttr(s){ return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function toast(msg, ms = 2600){ el.toast.textContent = msg; el.toast.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.toast.classList.add('hidden'), ms); }
  function downloadBlob(blob, name){
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 800);
  }
  const baseName = () => (pdfName || 'cheques').replace(/\.pdf$/i, '');

  // ====================================================================== banks
  const STOP = new Set(['بنك','البنك','ال','و','بنوك','مصرف','المصرف']);
  function buildBank(ar, latin){
    const norm = normAr(ar);
    const tokens = norm.split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
    return { ar, norm, tokens, latin: latin || [] };
  }
  const BANKS = [
    buildBank('البنك الأهلي المصري', ['NBE','NATIONAL BANK OF EGYPT']),
    buildBank('بنك مصر', ['BANQUE MISR','BANK MISR']),
    buildBank('البنك التجاري الدولي', ['CIB','COMMERCIAL INTERNATIONAL']),
    buildBank('بنك القاهرة', ['BANQUE DU CAIRE','BANQUE MISR CAIRE']),
    buildBank('البنك العربي الأفريقي الدولي', ['AAIB','ARAB AFRICAN']),
    buildBank('بنك الإسكندرية', ['ALEXBANK','BANK OF ALEXANDRIA','INTESA']),
    buildBank('بنك قطر الوطني الأهلي', ['QNB','QNB ALAHLI']),
    buildBank('البنك الزراعي المصري', ['AGRICULTURAL BANK OF EGYPT','ABE']),
    buildBank('بنك التعمير والإسكان', ['HOUSING AND DEVELOPMENT','HDB']),
    buildBank('بنك الاستثمار العربي', ['ARAB INVESTMENT BANK']),
    buildBank('بنك أبوظبي الأول', ['FAB','FIRST ABU DHABI']),
    buildBank('بنك الإمارات دبي الوطني', ['EMIRATES NBD','ENBD']),
    buildBank('بنك فيصل الإسلامي المصري', ['FAISAL ISLAMIC']),
    buildBank('بنك البركة مصر', ['AL BARAKA','ALBARAKA']),
    buildBank('المصرف المتحد', ['UNITED BANK']),
    buildBank('بنك التنمية الصناعية', ['INDUSTRIAL DEVELOPMENT BANK','IDB']),
    buildBank('بنك الكويت الوطني', ['NBK','NATIONAL BANK OF KUWAIT']),
    buildBank('بنك عوده', ['BANK AUDI']),
    buildBank('بنك كريدي أجريكول مصر', ['CREDIT AGRICOLE']),
    buildBank('بنك المشرق', ['MASHREQ']),
    buildBank('بنك أبوظبي التجاري', ['ADCB']),
    buildBank('بنك إتش إس بي سي مصر', ['HSBC']),
    buildBank('بنك التجاري وفا بنك', ['ATTIJARIWAFA']),
    buildBank('البنك المصري لتنمية الصادرات', ['EXPORT DEVELOPMENT BANK','EBE']),
    buildBank('الشركة المصرفية العربية الدولية', ['SAIB']),
    buildBank('المصرف العربي الدولي', ['ARAB INTERNATIONAL BANK','AIB']),
    buildBank('بنك ناصر الاجتماعي', ['NASSER SOCIAL BANK']),
    buildBank('بنك نكست', ['NXT BANK','NEXT BANK']),
    buildBank('البنك العقاري المصري العربي', ['EGYPTIAN ARAB LAND BANK']),
  ];
  function matchBank(normText, orig){
    const up = (orig || '').toUpperCase();
    let best = null, bestScore = 0;
    for (const b of BANKS){
      let s = 0;
      if (b.norm && normText.includes(b.norm)) s += 10;
      for (const t of b.tokens) if (normText.includes(t)) s += (t.length >= 4 ? 2 : 1);
      for (const l of b.latin) if (l && up.includes(l)) s += 3;
      if (s > bestScore){ bestScore = s; best = b; }
    }
    return bestScore >= 2 ? { bank: best, score: bestScore } : null;
  }

  // ====================================================================== OCR engine
  function setEngine(text, cls){ el.engineStatus.textContent = text;
    el.engineStatus.className = 'engine-status' + (cls ? ' ' + cls : ''); }

  // Runs INSIDE the tesseract web worker: serve the core (importScripts) and the
  // traineddata (fetch) from in-memory base64 injected as self.__coreB64 / self.__data,
  // so no file:// fetch is ever attempted.
  function workerShim(){
    function u8(b){ var s = atob(b), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
    var oi = self.importScripts.bind(self);
    self.importScripts = function(){
      for (var i = 0; i < arguments.length; i++){
        var u = arguments[i];
        if (typeof u === 'string' && u.indexOf('tesseract-core') >= 0)
          oi(URL.createObjectURL(new Blob([u8(self.__coreB64)], { type: 'text/javascript' })));
        else oi(u);
      }
    };
    var of = self.fetch ? self.fetch.bind(self) : null;
    self.fetch = function(url, opts){
      var u = typeof url === 'string' ? url : (url && url.url) || '';
      var m = u.match(/([a-zA-Z]{3,})\.traineddata/);
      if (m && self.__data && self.__data[m[1]]) return Promise.resolve(new Response(u8(self.__data[m[1]])));
      return of ? of(url, opts) : Promise.reject(new Error('fetch blocked: ' + u));
    };
  }

  let _workerBlobURL = null, _workerBlobLangs = '';
  function buildWorkerBlobURL(langs){
    if (_workerBlobURL && _workerBlobLangs === langs) return _workerBlobURL;
    if (_workerBlobURL){ try { URL.revokeObjectURL(_workerBlobURL); } catch (e) {} }
    const data = {};
    for (const l of langs.split('+')) if (ASSET_LANG[l]) data[l] = ASSET_LANG[l]();
    const workerText = new TextDecoder().decode(b64ToU8(window.__ASSET_WORKER));
    const preamble =
      'self.__coreB64=' + JSON.stringify(window.__ASSET_CORE) + ';' +
      'self.__data=' + JSON.stringify(data) + ';' +
      '(' + workerShim.toString() + ')();';
    _workerBlobURL = URL.createObjectURL(new Blob([preamble, workerText], { type: 'text/javascript' }));
    _workerBlobLangs = langs;
    return _workerBlobURL;
  }

  function setupPdfWorker(){
    if (!window.pdfjsLib) return;
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrlFromB64(window.__ASSET_PDFWORKER, 'text/javascript'); }
    catch (e) { /* pdf.js will fall back to a main-thread worker */ }
  }

  async function terminateWorkers(){
    const ws = workers; workers = [];
    for (const w of ws){ try { await w.terminate(); } catch (e) {} }
  }

  async function initEngine(langs, concurrency){
    if (workers.length && enginLangs === langs && workers.length === concurrency) return;
    await terminateWorkers();
    enginLangs = langs;
    setEngine('… تهيئة محرك التعرّف الضوئي');
    const workerUrl = buildWorkerBlobURL(langs);
    for (let i = 0; i < concurrency; i++){
      const w = await Tesseract.createWorker(langs, 1, {
        workerPath: workerUrl, workerBlobURL: false,
        corePath: 'embedded/tesseract-core', langPath: 'embedded', gzip: true,
        cacheMethod: 'none', logger: () => {},
      });
      workers.push(w);
    }
    setEngine('✅ المحرك جاهز (' + langs + ')', 'ok');
  }

  // ====================================================================== PDF render
  async function renderPage(pageNo, targetWidth){
    const page = await pdfDoc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    let scale = targetWidth / base.width;
    scale = Math.min(Math.max(scale, 1), 5);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    try { page.cleanup(); } catch (e) {}
    return canvas;
  }

  // ====================================================================== preprocess
  function preprocess(canvas, opts){
    if (!opts.gray && !opts.thresh) return canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data, total = canvas.width * canvas.height;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4){
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = g; hist[g]++;
    }
    if (opts.thresh){
      let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
      let sumB = 0, wB = 0, maxVar = 0, thr = 127;
      for (let t = 0; t < 256; t++){
        wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
        if (v > maxVar){ maxVar = v; thr = t; }
      }
      let below = 0; for (let t = 0; t <= thr; t++) below += hist[t];
      const darkBg = opts.invertAuto && (below / total > 0.6);
      for (let i = 0; i < d.length; i += 4){
        let v = d[i] > thr ? 255 : 0; if (darkBg) v = 255 - v;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function makeThumb(canvas, w = 240){
    const r = w / canvas.width, h = Math.max(1, Math.round(canvas.height * r));
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    t.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return t.toDataURL('image/jpeg', 0.6);
  }

  function cropCanvas(src, rect){
    const x = Math.max(0, Math.min(rect.x, src.width));
    const y = Math.max(0, Math.min(rect.y, src.height));
    const w = Math.max(1, Math.min(rect.w, src.width - x));
    const h = Math.max(1, Math.min(rect.h, src.height - y));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
    return c;
  }

  // ====================================================================== extraction
  function collectWordsLines(data){
    let words = [], lines = [];
    if (Array.isArray(data.words) && data.words.length) words = data.words;
    if (Array.isArray(data.lines) && data.lines.length) lines = data.lines;
    if ((!words.length || !lines.length) && Array.isArray(data.blocks)){
      for (const b of data.blocks || [])
        for (const p of (b.paragraphs || []))
          for (const ln of (p.lines || [])){
            lines.push(ln);
            for (const w of (ln.words || [])) words.push(w);
          }
    }
    return { words, lines };
  }

  function lineModels(lines, fullText){
    if (lines && lines.length)
      return lines.map((l) => ({ raw: l.text || '', t: toWestern(l.text || ''), bbox: l.bbox || null }));
    return toWestern(fullText || '').split(/\n+/).map((t) => ({ raw: t, t, bbox: null }));
  }

  function findDate(wtext, lns){
    const re = /\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4}\b/;
    for (const l of lns) if (/تاريخ|تحرير/.test(l.raw)){ const m = l.t.match(re); if (m) return m[0].replace(/\s+/g, ''); }
    const g = /\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4}\b/g;
    let m, c = []; while ((m = g.exec(wtext))) c.push(m[0].replace(/\s+/g, ''));
    return c.find((x) => /\d{4}/.test(x)) || c[0] || '';
  }

  function cleanAmount(s){ return String(s || '').replace(/\s+/g, '').replace(/\/(\d{1,2})$/, '.$1').replace(/[,](?=\d{3}\b)/g, ','); }
  function findAmount(wtext, lns){
    const cur = /جنيه|ج\.?\s?م|£|EGP|قرش|مليم/i;
    for (const l of lns){
      if (cur.test(l.raw) || /فقط|المبلغ|والمبلغ/.test(l.raw)){
        const m = l.t.match(/\d[\d.,\/ ]{0,18}\d|\d+/);
        if (m && /\d/.test(m[0])) return cleanAmount(m[0]);
      }
    }
    const all = [...wtext.matchAll(/\d[\d.,\/]{1,15}/g)].map((x) => x[0]).filter((s) => /[.,\/]\d{1,2}\b/.test(s));
    if (all.length){ all.sort((a, b) => num(b) - num(a)); return cleanAmount(all[0]); }
    return '';
  }

  function collectNumbers(words, wtext){
    const nums = [];
    if (words && words.length){
      for (const w of words){
        const t = toWestern(w.text || '').replace(/\D/g, '');
        if (t.length >= 4) nums.push({ val: t, len: t.length, y: w.bbox ? w.bbox.y0 : null, conf: w.confidence || 0 });
      }
    }
    if (!nums.length) for (const m of wtext.matchAll(/\d{4,}/g)) nums.push({ val: m[0], len: m[0].length, y: null, conf: 0 });
    return nums;
  }

  function assignNumbers(nums, out){
    if (!nums.length) return;
    const byLen = [...nums].sort((a, b) => b.len - a.len);
    const acct = byLen[0];
    const chequeCands = nums.filter((n) => n.len >= 6 && n.len <= 9 && n.val !== acct.val);
    let cheque = null;
    if (chequeCands.length){
      if (chequeCands.some((n) => n.y != null)) chequeCands.sort((a, b) => (a.y ?? 1e9) - (b.y ?? 1e9));
      else chequeCands.sort((a, b) => a.len - b.len);
      cheque = chequeCands[0];
    }
    if (acct) out.accountNo = acct.val;
    if (cheque) out.chequeNo = cheque.val;
  }

  function findDrawer(lns, bankName){
    const bn = normAr(bankName || '');
    const bad = /بنك|فرع|تاريخ|المبلغ|جنيه|شيك|حساب|رقم|ادفع|لأمر|فقط|توقيع|قرش|EGP|مصرف|تحرير/;
    for (let i = 0; i < lns.length; i++){
      if (/الساحب|اسم العميل|اسم صاحب/.test(lns[i].raw)){
        const same = lns[i].raw.replace(/.*?(الساحب|العميل|الحساب)\s*[:：]?/, '').trim();
        if (arabicLen(same) >= 4 && !bad.test(same)) return cleanName(same);
        const nx = lns[i + 1]; if (nx && arabicLen(nx.raw) >= 4 && !bad.test(nx.raw)) return cleanName(nx.raw);
      }
    }
    let best = '', bestLen = 0;
    for (const l of lns){
      const r = (l.raw || '').trim(), al = arabicLen(r);
      if (al >= 6 && !bad.test(r) && normAr(r) !== bn && al > bestLen){ bestLen = al; best = r; }
    }
    return cleanName(best);
  }

  function extractFields(data){
    const rawText = data.text || '';
    const { words, lines } = collectWordsLines(data);
    const lns = lineModels(lines, rawText);
    const wtext = toWestern(rawText);
    const normText = normAr(rawText);
    const out = { bankName:'', bankCode:'', chequeNo:'', accountNo:'', drawer:'', amount:'', date:'' };
    const conf = {};

    const bm = matchBank(normText, rawText);
    if (bm){ out.bankName = bm.bank.ar; conf.bankName = Math.min(0.9, 0.4 + bm.score / 20); }

    out.date = findDate(wtext, lns);
    out.amount = findAmount(wtext, lns);
    assignNumbers(collectNumbers(words, wtext), out);
    if (out.accountNo){ const dg = out.accountNo.replace(/\D/g, ''); if (dg.length >= 4) out.bankCode = dg.slice(0, 4); }
    out.drawer = findDrawer(lns, out.bankName);

    // crude confidence from overall OCR confidence
    const oc = (data.confidence || 0) / 100;
    for (const f of FIELDS) if (conf[f] == null) conf[f] = out[f] ? oc : 0;
    return { fields: out, rawText, conf };
  }

  // ====================================================================== pipeline
  function readSettings(){
    settings = {
      pagesPerCheque: parseInt(el.pagesPerCheque.value, 10) || 2,
      facePosition: el.facePosition.value,
      langs: el.ocrLang.value,
      targetWidth: parseInt(el.targetWidth.value, 10) || 1800,
      psm: el.psm.value,
      concurrency: Math.max(1, parseInt(el.concurrency.value, 10) || 2),
      pre: { gray: el.preGray.checked, thresh: el.preThresh.checked, invertAuto: el.preInvertAuto.checked },
    };
  }

  function facePageList(){
    const ppc = settings.pagesPerCheque, total = pdfDoc.numPages, pages = [];
    for (let start = 1; start <= total; start += ppc){
      const face = settings.facePosition === 'second' ? start + 1 : start;
      if (face <= total) pages.push(face);
    }
    return pages;
  }

  function showProgress(done, total){
    const pct = total ? Math.round((done / total) * 100) : 0;
    el.progressBar.style.width = pct + '%';
    el.progressText.textContent = `${done} / ${total} شيك (${pct}%)`;
  }

  async function processAll(){
    processing = true; cancelFlag = false; pauseFlag = false; results = [];
    const facePages = facePageList();
    facePages.forEach(() => results.push(null));
    showProgress(0, facePages.length);

    for (const w of workers){
      try { await w.setParameters({ tessedit_pageseg_mode: String(settings.psm), preserve_interword_spaces: '1' }); } catch (e) {}
    }

    let next = 0, done = 0, renderLock = Promise.resolve();
    async function loop(worker){
      while (true){
        if (cancelFlag) return;
        const i = next++; if (i >= facePages.length) return;
        let canvas;
        const prev = renderLock; let release; renderLock = new Promise((r) => (release = r));
        try { await prev; canvas = await renderPage(facePages[i], settings.targetWidth); }
        catch (e){ release(); results[i] = errorRow(i, facePages[i]); done++; showProgress(done, facePages.length); continue; }
        release();
        if (cancelFlag){ canvas.width = canvas.height = 0; return; }
        const pre = preprocess(canvas, settings.pre);
        let data;
        try { const r = await worker.recognize(pre, {}, { text: true, blocks: true }); data = r.data; }
        catch (e){ data = { text: '', blocks: [], confidence: 0 }; }
        const ex = extractFields(data);
        const thumb = makeThumb(canvas);
        results[i] = Object.assign({ idx: i + 1, pageNo: facePages[i], thumb, rawText: ex.rawText, conf: ex.conf, verified: false }, ex.fields);
        canvas.width = canvas.height = 0;
        done++; showProgress(done, facePages.length);
        while (pauseFlag && !cancelFlag) await sleep(200);
      }
    }
    await Promise.all(workers.map((w) => loop(w)));
    processing = false;
    return !cancelFlag;
  }

  function errorRow(i, pageNo){
    return Object.assign({ idx: i + 1, pageNo, thumb: '', rawText: '(تعذّرت معالجة هذه الصفحة)', conf: {}, verified: false },
      { bankName:'', bankCode:'', chequeNo:'', accountNo:'', drawer:'', amount:'', date:'' });
  }

  // ====================================================================== results table
  function rowMatches(r, q){
    q = q.toLowerCase();
    return FIELDS.some((f) => String(r[f] || '').toLowerCase().includes(q)) || String(r.idx).includes(q);
  }
  function fieldCell(i, f){
    const r = results[i], v = r[f] ?? '';
    const low = r.conf && r.conf[f] != null && r.conf[f] < 0.5 ? ' lowconf' : '';
    return `<td><input class="cell-input${low}" data-i="${i}" data-f="${f}" value="${escAttr(v)}"></td>`;
  }
  function renderTable(){
    const q = (el.searchBox.value || '').trim();
    const onlyUnv = el.onlyUnverified.checked;
    const frag = document.createDocumentFragment();
    let shown = 0;
    results.forEach((r, i) => {
      if (!r) return;
      if (onlyUnv && r.verified) return;
      if (q && !rowMatches(r, q)) return;
      shown++;
      const tr = document.createElement('tr');
      tr.className = r.verified ? 'verified' : 'unverified';
      tr.dataset.i = i;
      tr.innerHTML = `<td class="rownum" title="عرض التفاصيل">${r.idx} 🔍</td>` +
        `<td>${r.thumb ? `<img class="thumb" src="${r.thumb}" alt="" title="عرض التفاصيل">` : '—'}</td>` +
        fieldCell(i,'bankName') + fieldCell(i,'bankCode') + fieldCell(i,'chequeNo') +
        fieldCell(i,'accountNo') + fieldCell(i,'drawer') + fieldCell(i,'amount') + fieldCell(i,'date') +
        `<td class="center"><input type="checkbox" class="vchk" data-i="${i}" ${r.verified ? 'checked' : ''}></td>`;
      frag.appendChild(tr);
    });
    el.resultsBody.innerHTML = '';
    el.resultsBody.appendChild(frag);
    updateCounts(shown);
  }
  function updateCounts(shown){
    const tot = results.filter(Boolean).length;
    const ver = results.filter((r) => r && r.verified).length;
    el.counts.innerHTML = `إجمالي: <b>${tot}</b> · مُدقّق: <b>${ver}</b> · معروض: <b>${shown}</b>`;
  }

  // ====================================================================== detail modal
  async function openDetail(i){
    if (!results[i]) return;
    detailIndex = i; sel = null; el.reocrBtn.disabled = true;
    const r = results[i];
    el.detailTitle.textContent = `الشيك رقم ${r.idx} (صفحة ${r.pageNo})`;
    el.detailPos.textContent = `${r.idx} / ${results.filter(Boolean).length}`;
    el.detailModal.querySelectorAll('[data-f]').forEach((inp) => {
      const f = inp.dataset.f;
      if (inp.type === 'checkbox') inp.checked = !!r[f];
      else inp.value = r[f] ?? '';
    });
    el.rawText.textContent = r.rawText || '';
    el.detailModal.classList.remove('hidden');
    // render full page image
    try {
      detailFullCanvas = await renderPage(r.pageNo, Math.max(settings.targetWidth || 1800, 1800));
      const dc = el.detailCanvas;
      dc.width = detailFullCanvas.width; dc.height = detailFullCanvas.height;
      dc.getContext('2d').drawImage(detailFullCanvas, 0, 0);
      syncSelectLayer();
    } catch (e){ detailFullCanvas = null; }
  }
  function closeDetail(){ el.detailModal.classList.add('hidden'); detailFullCanvas = null; sel = null; }
  function syncSelectLayer(){
    const dc = el.detailCanvas, sc = el.selectCanvas;
    const rect = dc.getBoundingClientRect();
    sc.width = rect.width; sc.height = rect.height;
    sc.style.width = rect.width + 'px'; sc.style.height = rect.height + 'px';
    sc.getContext('2d').clearRect(0, 0, sc.width, sc.height);
  }

  // selection on overlay (CSS px) → mapped to full-res canvas px when cropping
  function initSelection(){
    const sc = el.selectCanvas; let drag = null;
    const pos = (e) => { const r = sc.getBoundingClientRect();
      return { x: (e.touches ? e.touches[0].clientX : e.clientX) - r.left,
               y: (e.touches ? e.touches[0].clientY : e.clientY) - r.top }; };
    const down = (e) => { if (!detailFullCanvas) return; e.preventDefault(); drag = pos(e); };
    const move = (e) => { if (!drag) return; const p = pos(e); drawSel(drag, p); };
    const up = (e) => { if (!drag) return; const p = pos(e);
      const x = Math.min(drag.x, p.x), y = Math.min(drag.y, p.y), w = Math.abs(p.x - drag.x), h = Math.abs(p.y - drag.y);
      drag = null;
      if (w < 6 || h < 6){ sel = null; el.reocrBtn.disabled = true; el.selectCanvas.getContext('2d').clearRect(0,0,9999,9999); return; }
      const k = detailFullCanvas.width / el.selectCanvas.width;
      sel = { x: x * k, y: y * k, w: w * k, h: h * k };
      el.reocrBtn.disabled = false;
    };
    sc.addEventListener('mousedown', down); sc.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    sc.addEventListener('touchstart', down, { passive: false }); sc.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', up);
  }
  function drawSel(a, b){
    const sc = el.selectCanvas, ctx = sc.getContext('2d');
    ctx.clearRect(0, 0, sc.width, sc.height);
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.fillStyle = 'rgba(37,99,235,.12)';
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }

  async function doReocr(){
    if (!sel || !detailFullCanvas || !workers[0]) return;
    const target = el.reocrTarget.value;
    const digits = el.reocrDigits.checked;
    el.reocrBtn.disabled = true; el.reocrBtn.textContent = '… جارٍ القراءة';
    try {
      const crop = preprocess(cropCanvas(detailFullCanvas, sel), settings.pre);
      const w = workers[0];
      await w.setParameters({ tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: digits ? '0123456789٠١٢٣٤٥٦٧٨٩/.-,' : '' });
      const { data } = await w.recognize(crop, {}, { text: true });
      await w.setParameters({ tessedit_pageseg_mode: String(settings.psm), tessedit_char_whitelist: '' });
      let text = cleanSp(data.text || '');
      if (digits) text = toWestern(text).replace(/[^\d./-]/g, '');
      const field = target || (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f) || '';
      if (field){
        const inp = el.detailModal.querySelector(`[data-f="${field}"]`);
        if (inp && inp.type !== 'checkbox'){ inp.value = text; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        toast('تم وضع النص في حقل: ' + (HEADERS.find((h) => h[1] === field)?.[0] || field));
      } else {
        navigator.clipboard?.writeText(text);
        toast('النتيجة: ' + (text || '(فارغ)') + ' — اختر حقلًا مستهدفًا');
      }
    } catch (e){ toast('تعذّرت إعادة القراءة'); }
    el.reocrBtn.textContent = '🔍 إعادة قراءة المنطقة المحددة';
    el.reocrBtn.disabled = false;
  }

  function navDetail(dir){
    const valid = []; results.forEach((r, i) => { if (r) valid.push(i); });
    const pos = valid.indexOf(detailIndex);
    const np = pos + dir;
    if (np >= 0 && np < valid.length) openDetail(valid[np]);
  }

  // ====================================================================== export
  function exportRows(){
    const rows = [['م', ...HEADERS.map((h) => h[0]), 'الصفحة', 'مدقق']];
    results.forEach((r) => { if (!r) return;
      rows.push([r.idx, ...HEADERS.map((h) => r[h[1]] ?? ''), r.pageNo, r.verified ? 'نعم' : 'لا']); });
    return rows;
  }
  function exportCSV(){
    const csvCell = (v) => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = '﻿' + exportRows().map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), baseName() + '.csv');
    toast('تم تصدير CSV');
  }
  function exportXLSX(){
    if (!window.XLSX){ toast('مكتبة Excel غير محمّلة'); return; }
    const ws = XLSX.utils.aoa_to_sheet(exportRows());
    ws['!cols'] = [{ wch: 5 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 7 }];
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'الشيكات');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(new Blob([out], { type: 'application/octet-stream' }), baseName() + '.xlsx');
    toast('تم تصدير Excel');
  }

  // ====================================================================== file loading
  async function loadPdf(file){
    if (!file || file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)){ toast('يرجى اختيار ملف PDF'); return; }
    pdfName = file.name;
    try {
      const buf = await file.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    } catch (e){ toast('تعذّر فتح ملف PDF'); return; }
    const ppc = parseInt(el.pagesPerCheque.value, 10) || 2;
    const est = Math.ceil(pdfDoc.numPages / ppc);
    el.pdfInfo.classList.remove('hidden');
    el.pdfInfo.innerHTML = `📄 <b>${escAttr(pdfName)}</b> — عدد الصفحات: <b>${pdfDoc.numPages}</b> — عدد الشيكات المتوقّع: <b>${est}</b>`;
    el.startBtn.disabled = false;
    el.resetBtn.classList.remove('hidden');
    setEngine('جاهز للبدء');
  }

  function resetAll(){
    cancelFlag = true; pdfDoc = null; results = []; detailIndex = -1;
    el.fileInput.value = '';
    el.pdfInfo.classList.add('hidden');
    el.resultsCard.classList.add('hidden');
    el.progressCard.classList.add('hidden');
    el.startBtn.disabled = true;
    el.resetBtn.classList.add('hidden');
    closeDetail();
    setEngine('في انتظار الملف');
  }

  async function start(){
    if (!pdfDoc || processing) return;
    readSettings();
    el.startBtn.disabled = true; el.uploadCard.querySelector('.actions').classList.add('hidden');
    el.progressCard.classList.remove('hidden');
    el.resultsCard.classList.add('hidden');
    try { await initEngine(settings.langs, settings.concurrency); }
    catch (e){ setEngine('⚠️ فشل تحميل المحرك', 'err'); toast('تعذّر تهيئة محرك التعرّف — راجع ملف README');
      el.startBtn.disabled = false; el.uploadCard.querySelector('.actions').classList.remove('hidden'); return; }
    const ok = await processAll();
    el.progressCard.classList.add('hidden');
    el.uploadCard.querySelector('.actions').classList.remove('hidden');
    el.startBtn.disabled = false;
    if (ok || results.some(Boolean)){
      el.resultsCard.classList.remove('hidden');
      renderTable();
      el.resultsCard.scrollIntoView({ behavior: 'smooth' });
      if (ok) toast('اكتملت المعالجة — راجِع البيانات وصحّحها');
    }
  }

  // ====================================================================== wiring
  function wire(){
    setupPdfWorker();
    // default concurrency = min(hardwareConcurrency, 4)
    const hc = Math.min(4, Math.max(1, navigator.hardwareConcurrency || 2));
    el.concurrency.value = String(hc >= 2 ? Math.min(hc, 4) : 1);

    el.dropZone.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', (e) => loadPdf(e.target.files[0]));
    ['dragenter','dragover'].forEach((ev) => el.dropZone.addEventListener(ev, (e) => { e.preventDefault(); el.dropZone.classList.add('drag'); }));
    ['dragleave','drop'].forEach((ev) => el.dropZone.addEventListener(ev, (e) => { e.preventDefault(); el.dropZone.classList.remove('drag'); }));
    el.dropZone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadPdf(f); });

    el.startBtn.addEventListener('click', start);
    el.resetBtn.addEventListener('click', resetAll);
    el.pauseBtn.addEventListener('click', () => { pauseFlag = !pauseFlag;
      el.pauseBtn.textContent = pauseFlag ? '▶️ استئناف' : '⏸️ إيقاف مؤقت'; });
    el.cancelBtn.addEventListener('click', () => { cancelFlag = true; });

    el.searchBox.addEventListener('input', renderTable);
    el.onlyUnverified.addEventListener('change', renderTable);
    el.exportCsvBtn.addEventListener('click', exportCSV);
    el.exportXlsxBtn.addEventListener('click', exportXLSX);

    // table edits (delegated)
    el.resultsBody.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('cell-input')){ const i = +t.dataset.i; if (results[i]) results[i][t.dataset.f] = t.value; }
    });
    el.resultsBody.addEventListener('change', (e) => {
      const t = e.target;
      if (t.classList.contains('vchk')){ const i = +t.dataset.i; if (results[i]){ results[i].verified = t.checked;
        const tr = t.closest('tr'); tr.className = t.checked ? 'verified' : 'unverified'; updateCounts(el.resultsBody.children.length); } }
    });
    el.resultsBody.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const tr = e.target.closest('tr'); if (tr) openDetail(+tr.dataset.i);
    });

    // modal
    el.closeModal.addEventListener('click', closeDetail);
    el.detailModal.addEventListener('click', (e) => { if (e.target === el.detailModal) closeDetail(); });
    el.prevCheque.addEventListener('click', () => navDetail(-1));
    el.nextCheque.addEventListener('click', () => navDetail(1));
    el.reocrBtn.addEventListener('click', doReocr);
    el.detailModal.addEventListener('input', (e) => {
      const t = e.target; const f = t.dataset && t.dataset.f; if (!f || detailIndex < 0) return;
      const r = results[detailIndex]; if (!r) return;
      if (t.type === 'checkbox') r.verified = t.checked; else r[f] = t.value;
    });
    window.addEventListener('resize', () => { if (!el.detailModal.classList.contains('hidden')) syncSelectLayer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.detailModal.classList.contains('hidden')) closeDetail(); });

    initSelection();
    setEngine('في انتظار الملف');
  }

  wire();
  if (!window.pdfjsLib || !window.Tesseract || !window.XLSX){
    setEngine('⚠️ تعذّر تحميل المكتبات المحلية', 'err');
  } else if (!window.__ASSET_CORE || !window.__ASSET_WORKER || !window.__ASSET_ARA){
    setEngine('⚠️ ملفات محرك التعرّف ناقصة (vendor/embed)', 'err');
  }
})();
