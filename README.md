# أداة استخراج بيانات الشيكات البنكية (عربي) — Arabic Bank-Cheque Data Extractor

أداة HTML تعمل **بالكامل دون إنترنت** وبدون أي تثبيت أو خادم خلفي، تقرأ ملف PDF يحتوي
على شيكات بنكية ممسوحة ضوئيًا (كل شيك في صفحتين: وجه + ظهر) وتستخرج البيانات منها رسوميًا
عبر التعرّف الضوئي على الحروف (OCR)، ثم تتيح مراجعتها وتصحيحها وتصديرها إلى Excel أو CSV.

> ملف الـ PDF يُقرأ كصور (رسوميًا) — لذلك يعمل حتى لو كانت طبقة النص داخل الـ PDF غير صالحة
> أو غير موجودة (شيكات ممسوحة ضوئيًا).

---

## 🚀 كيفية التشغيل (لا يتطلب تثبيت)

**الطريقة الأبسط:** افتح ملف **`index.html`** بالنقر المزدوج في متصفح حديث
(Google Chrome / Microsoft Edge / Firefox). هذا كل شيء — كل المكتبات ونماذج التعرّف
مضمّنة محليًا داخل المجلد، ولا يتم أي اتصال بالإنترنت إطلاقًا.

**إن لم يعمل النقر المزدوج في متصفحك** (بعض المتصفحات تقيّد تشغيل العمال من `file://`)،
شغّل خادمًا محليًا بسيطًا داخل مجلد المشروع (لا يحتاج تثبيت أي شيء إن كان Python مثبتًا):

```bash
# داخل مجلد المشروع
python3 -m http.server 8000
# ثم افتح في المتصفح:  http://localhost:8000/index.html
```

للتسهيل يوجد سكربتان جاهزان: `serve.sh` (ماك/لينكس) و `serve.bat` (ويندوز).

---

## 📋 خطوات الاستخدام

1. **اختر ملف الـ PDF** (سحب وإفلات أو بالنقر). تدعم الأداة ملفات كبيرة (≈200 شيك وأكثر).
2. (اختياري) افتح **الإعدادات المتقدمة** لضبط: عدد صفحات الشيك، صفحة الوجه، لغة التعرّف،
   دقة الصورة، نمط التقسيم (PSM)، عدد العمليات المتوازية، ومعالجة الصورة.
3. اضغط **بدء استخراج البيانات** وراقب شريط التقدّم (يمكن الإيقاف المؤقت أو الإلغاء).
4. **راجع وصحّح** البيانات في الجدول. اضغط على أي صف (رقم الصف 🔍 أو الصورة المصغّرة)
   لعرض صورة الشيك مكبّرة، مع:
   - تعديل الحقول مباشرة،
   - **أداة "إعادة قراءة منطقة محددة"**: اسحب مستطيلًا حول حقل على الصورة، اختر الحقل
     المستهدف (مع خيار "أرقام فقط")، فتُعاد قراءته بدقة أعلى.
   - علِّم الشيك كـ **«مُدقّق»** بعد مراجعته.
5. **صدّر** النتائج إلى **Excel (.xlsx)** أو **CSV** (بترميز UTF-8 يدعم العربية في Excel).

---

## 🧾 الحقول المستخرجة

| الحقل | ملاحظات الاستخراج |
|------|-------------------|
| اسم البنك | مطابقة ذكية مع قائمة البنوك المصرية المعروفة |
| كود البنك (أول 4 أرقام) | أول 4 أرقام من رقم الحساب المكتشف |
| رقم الشيك | رقم من 6–9 خانات (غالبًا أعلى الشيك أو في سطر MICR) |
| رقم الحساب | أطول سلسلة أرقام مكتشفة |
| اسم الساحب | أقرب سطر عربي لاسم الساحب/العميل |
| المبلغ | الرقم المجاور لكلمات العملة (جنيه/ج.م/EGP) أو خانة المبلغ |
| التاريخ | نمط يوم/شهر/سنة (أرقام عربية أو لاتينية) |

---

## ⚠️ دقة التعرّف — اقرأ هذا

التعرّف الضوئي يتم **محليًا داخل المتصفح** (محرك Tesseract). لذلك:

- الحقول **المطبوعة** (اسم البنك، الأرقام المطبوعة) تُقرأ بدقة جيدة عادةً.
- الحقول **المكتوبة بخط اليد** (مبلغ/اسم/تاريخ أحيانًا) قد لا تُقرأ بدقة — هذا قيد متأصل في
  التعرّف الضوئي دون إنترنت.
- الأرقام **الهندية العربية (٠١٢٣…)** أصعب على المحرك من الأرقام اللاتينية (0123…).

👉 لذلك **شاشة المراجعة والتصحيح جزء أساسي** من سير العمل وليست اختيارية. استخدم أداة
«إعادة قراءة منطقة محددة» (خيار «أرقام فقط») لتصحيح الحقول الرقمية بسرعة، وعلّم الشيكات
كـ «مُدقّقة» قبل التصدير.

**الأداء:** نحو ~200 شيك يستغرق دقائق قليلة حسب جهازك ودقة المسح. زِد «عدد العمليات
المتوازية» على الأجهزة القوية، أو قلّل «دقة الصورة» لتسريع المعالجة.

---

## 🔒 الخصوصية

كل المعالجة تتم على جهازك داخل المتصفح. **لا تغادر أي بيانات أو صور جهازك**، ولا يوجد أي
اتصال بالشبكة (يمكنك التأكد بفصل الإنترنت تمامًا — ستعمل الأداة كالمعتاد).

---

## 🛠️ For developers

### Tech stack (all vendored locally, no CDN)
- **PDF.js** `3.11.174` (legacy UMD) — renders each PDF page to a canvas.
- **Tesseract.js** `5.1.1` + **tesseract.js-core** `5.1.1` (WASM, LSTM) — in-browser OCR.
- **SheetJS (xlsx)** `0.18.5` — `.xlsx` export.
- Arabic/English **traineddata** — `@tesseract.js-data/ara` & `eng` (`4.0.0_best_int`, compact LSTM).

### Project structure
```
index.html              # UI (RTL, Arabic)
styles.css
app.js                  # PDF render, OCR worker pool, extraction, review UI, export
vendor/
  pdf.min.js  tesseract.min.js  xlsx.full.min.js   # libs (loaded via <script src>)
  embed/                 # base64 binary assets (window.__ASSET_*) → blob URLs at runtime
    worker.js core.js ara.js eng.js pdfworker.js
tools/build-embeds.js   # rebuilds vendor/ from npm packages
```

### Why the `embed/` folder?
Browsers block `fetch()` and Web Workers over `file://`. To make OCR work by simply
double-clicking `index.html`, the OCR worker, the WASM core, and the traineddata are
base64-embedded into `<script>` files and turned into **blob URLs** at runtime. A tiny shim
inside the OCR worker serves the core (via `importScripts`) and the traineddata (via a
`fetch` override) from memory — so **no network and no server are ever required**. The same
code path also works when served over http.

### Rebuilding `vendor/` (e.g. to swap OCR models)
```bash
npm install --no-save \
  pdfjs-dist@3.11.174 tesseract.js@5.1.1 tesseract.js-core@5.1.1 \
  xlsx@0.18.5 @tesseract.js-data/ara@1.0.0 @tesseract.js-data/eng@1.0.0
node tools/build-embeds.js
```
To trade accuracy for speed/size, point the `ara`/`eng` embeds in `tools/build-embeds.js`
at a different model folder (`4.0.0` standard, or fast/best variants).

### Browser notes
- Needs a modern browser with **WebAssembly SIMD** (Chrome/Edge/Firefox of the last few years).
- Works fully offline; verified end-to-end in headless Chromium from both `file://` and http.
