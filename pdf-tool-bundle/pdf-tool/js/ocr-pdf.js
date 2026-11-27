import * as pdfjs from '../vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = id => document.getElementById(id);
const dialog = $('ocrDialog');
const picker = $('ocrPicker');
const run = $('ocrRun');
let file = null;

function status(message, error = false) {
  $('ocrStatus').textContent = message;
  $('ocrStatus').className = 'ocr-status' + (error ? ' error' : '');
}
function openOCR() {
  file = null;
  picker.value = '';
  $('ocrFileName').textContent = 'Choose a scanned PDF';
  $('ocrFileMeta').textContent = 'One PDF · processed locally in your browser';
  run.disabled = true;
  status('');
  dialog.hidden = false;
}
picker.addEventListener('change', () => {
  const selected = picker.files?.[0];
  picker.value = '';
  if (!selected) return;
  if (!/\.pdf$/i.test(selected.name) && selected.type !== 'application/pdf') {
    file = null;
    run.disabled = true;
    status('Please choose a PDF document.', true);
    return;
  }
  file = selected;
  $('ocrFileName').textContent = selected.name;
  $('ocrFileMeta').textContent = `${(selected.size / 1024 / 1024).toFixed(2)} MB · ready for OCR`;
  run.disabled = false;
  status('');
});
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function safeText(value) {
  return String(value || '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '').replace(/\s+/g, ' ').trim();
}
async function makeSearchablePDF(source) {
  if (!window.PDFLib?.PDFDocument || !window.PDFLib?.StandardFonts) {
    throw new Error('The PDF editing engine did not load. Refresh the page and try again.');
  }
  status('Opening your PDF…');
  const bytes = new Uint8Array(await source.arrayBuffer());
  const pdfLoading = pdfjs.getDocument({ data: bytes.slice() });
  let renderedPdf;
  let worker;
  try {
    renderedPdf = await pdfLoading.promise;
    const output = await window.PDFLib.PDFDocument.load(bytes);
    if (output.getPageCount() !== renderedPdf.numPages) throw new Error('The PDF pages could not be matched for OCR.');
    const font = await output.embedFont(window.PDFLib.StandardFonts.Helvetica);
    status('Loading English OCR engine… (first use may take a moment)');
    const module = await import('https://esm.sh/tesseract.js@6.0.1');
    const Tesseract = module.default || module;
    worker = await Tesseract.createWorker('eng', 1, {
      logger: message => {
        if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
          status(`Recognizing text… ${Math.round(message.progress * 100)}%`);
        }
      }
    });
    const scaleSetting = Number($('ocrQuality').value);
    const pages = output.getPages();
    let wordsAdded = 0;
    for (let pageNumber = 1; pageNumber <= renderedPdf.numPages; pageNumber++) {
      status(`Preparing page ${pageNumber} of ${renderedPdf.numPages}…`);
      const sourcePage = await renderedPdf.getPage(pageNumber);
      const baseViewport = sourcePage.getViewport({ scale: 1 });
      const renderScale = Math.min(scaleSetting * 1.5, 2400 / baseViewport.width);
      const viewport = sourcePage.getViewport({ scale: renderScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      if (canvas.width * canvas.height > 45000000) throw new Error(`Page ${pageNumber} is too large for OCR at this quality. Choose Standard quality.`);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Your browser could not create an OCR canvas.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await sourcePage.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
      status(`Recognizing page ${pageNumber} of ${renderedPdf.numPages}…`);
      const result = await worker.recognize(canvas);
      const words = result.data?.words || [];
      const pdfPage = pages[pageNumber - 1];
      const pageHeight = pdfPage.getHeight();
      for (const word of words) {
        const text = safeText(word.text);
        if (!text || (Number.isFinite(word.confidence) && word.confidence < 25)) continue;
        const box = word.bbox;
        if (!box || !Number.isFinite(box.x0) || !Number.isFinite(box.y1)) continue;
        const x = Math.max(0, box.x0 / renderScale);
        const y = Math.max(0, pageHeight - box.y1 / renderScale);
        const size = Math.max(5, Math.min(32, (box.y1 - box.y0) / renderScale * 0.82));
        try {
          pdfPage.drawText(text, { x, y, size, font, opacity: 0, lineHeight: size });
          wordsAdded++;
        } catch {
          // Skip glyphs that the embedded standard font cannot encode.
        }
      }
      canvas.width = 0;
      canvas.height = 0;
      sourcePage.cleanup?.();
    }
    if (!wordsAdded) throw new Error('No readable English text was detected. Try a clearer scan or higher quality.');
    status('Saving searchable PDF…');
    const saved = await output.save();
    return { blob: new Blob([saved], { type: 'application/pdf' }), pages: renderedPdf.numPages, words: wordsAdded };
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('This PDF is password-protected and cannot be processed.');
    throw error;
  } finally {
    try { await worker?.terminate(); } catch {}
    try { await renderedPdf?.destroy(); } catch {}
  }
}
run.addEventListener('click', async () => {
  if (!file || run.disabled) return;
  run.disabled = true;
  $('ocrCancel').disabled = true;
  $('ocrClose').disabled = true;
  try {
    const result = await makeSearchablePDF(file);
    const name = file.name.replace(/\.pdf$/i, '') || 'document';
    download(result.blob, `${name}-searchable.pdf`);
    status(`Done — recognized text on ${result.pages} page(s). Your searchable PDF download has started.`);
  } catch (error) {
    console.error(error);
    status(error.message || 'OCR could not complete. Please try another PDF.', true);
  } finally {
    run.disabled = !file;
    $('ocrCancel').disabled = false;
    $('ocrClose').disabled = false;
  }
});
function close() {
  dialog.hidden = true;
  file = null;
  picker.value = '';
  status('');
}
$('ocrClose').addEventListener('click', close);
$('ocrCancel').addEventListener('click', close);
dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !dialog.hidden) close(); });
window.AtlasPDFOpenOCR = openOCR;
