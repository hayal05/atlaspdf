import * as pdfjs from '../vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = id => document.getElementById(id);
const dialog = $('convertDialog');
const picker = $('convertPicker');
const list = $('convertFileList');
const run = $('convertRun');
let mode = 'word';
let files = [];
let previewPdf = null;
let previewPage = 1;
let previewToken = 0;

const imageTypes = new Set(['image/jpeg','image/png','image/webp','image/gif','image/bmp']);

function setStatus(message, error = false) {
  $('convertStatus').textContent = message;
  $('convertStatus').className = 'convert-status' + (error ? ' error' : '');
}
function openConverter(type) {
  mode = type;
  files = [];
  picker.value = '';
  picker.multiple = type === 'image';
  picker.accept = type === 'word'
    ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : (type === 'pdf-image' || type === 'pdf-word') ? '.pdf,application/pdf' : 'image/*';
  $('convertTitle').textContent = type === 'word' ? 'Word to PDF' : type === 'image' ? 'Image to PDF' : type === 'pdf-word' ? 'PDF to Word' : 'PDF to JPG';
  $('convertDescription').textContent = type === 'word'
    ? 'Select a .docx document and convert it into a PDF.'
    : type === 'image'
      ? 'Select JPG, PNG or other common images. Each image becomes a page in one PDF.'
      : type === 'pdf-word' ? 'Extract selectable text from a PDF and create an editable Word document. Scanned pages need OCR.' : 'Convert every page of a PDF into a separate JPG or PNG image. All pages are delivered together in a ZIP file.';
  $('convertDropTitle').textContent = type === 'word' ? 'Choose a Word document' : type === 'image' ? 'Choose images' : 'Choose a PDF';
  $('convertDropHint').textContent = type === 'word'
    ? 'DOCX files · one document at a time'
    : type === 'image'
      ? 'JPG, PNG, WEBP, GIF and BMP · multiple files'
      : 'PDF files · one document at a time';
  $('convertNote').hidden = type !== 'word' && type !== 'pdf-image' && type !== 'pdf-word';
  $('convertNote').textContent = type === 'word'
    ? 'Word conversion supports .docx files. Legacy .doc files are not supported.'
    : type === 'pdf-word' ? 'Works with selectable text. Scanned/image-only PDFs need OCR, which is not included in this tool.' : 'Your PDF is processed locally in your browser. Each page becomes a separate image in one ZIP archive.';
  $('pdfImageOptions').hidden = type !== 'pdf-image';
  list.hidden = type !== 'image';
  list.replaceChildren();
  run.textContent = type === 'word' ? 'Convert to PDF' : type === 'image' ? 'Create PDF' : type === 'pdf-word' ? 'Convert to Word' : 'Convert to images';
  run.disabled = true;
  setStatus('');
  dialog.hidden = false;
  const hasPdfPreview = type === 'pdf-image' || type === 'pdf-word';
  $('convertPreviewPanel').hidden = !hasPdfPreview;
  $('conversionWorkspaceGrid').classList.toggle('single-panel', !hasPdfPreview);
  document.body.classList.add('conversion-workspace-open');
  $('convertPreviewEmpty').hidden = false;
  $('convertPreviewCanvas').hidden = true;
  $('convertPreviewMeta').textContent = 'Upload a PDF to preview its pages';
  $('convertPageCount').textContent = '— / —';
  $('convertPrevPage').disabled = $('convertNextPage').disabled = true;
  $('convertPreviewEmpty').querySelector('strong').textContent = 'Your document preview will appear here';
  $('convertPreviewEmpty').querySelector('small').textContent = 'Choose a PDF to get started';
  if (previewPdf) { previewPdf.destroy(); previewPdf = null; }
}
function renderFiles() {
  list.replaceChildren();
  files.forEach((file, index) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = file.name;
    const controls = document.createElement('span');
    controls.className = 'convert-file-controls';
    for (const [label, delta] of [['↑ Move up',-1],['↓ Move down',1]]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-label', (delta < 0 ? 'Move up ' : 'Move down ') + file.name);
      button.disabled = index + delta < 0 || index + delta >= files.length;
      button.addEventListener('click', () => {
        [files[index], files[index + delta]] = [files[index + delta], files[index]];
        renderFiles();
      });
      controls.append(button);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '× Remove'; remove.setAttribute('aria-label','Remove '+file.name);
    remove.addEventListener('click', () => { files.splice(index,1); renderFiles(); run.disabled = !files.length; });
    controls.append(remove);
    item.append(name, controls); list.append(item);
  });
  run.disabled = !files.length;
  $('convertDropTitle').textContent = files.length ? 'Add more images' : 'Choose images';
}
picker.addEventListener('change', async () => {
  const selected = [...picker.files];
  if (mode === 'word') {
    const file = selected[0];
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { files=[]; run.disabled=true; setStatus('Please choose a modern Word .docx file. Legacy .doc files are not supported.',true); return; }
    files=[file]; run.disabled=false; $('convertDropTitle').textContent=file.name; setStatus('');
  } else if (mode === 'pdf-image' || mode === 'pdf-word') {
    const file = selected[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      files=[]; run.disabled=true; setStatus('Please choose a PDF document.',true); return;
    }
    files=[file]; run.disabled=false; $('convertDropTitle').textContent=file.name; setStatus('');
  } else {
    const valid = selected.filter(file => imageTypes.has(file.type));
    const rejected = selected.length - valid.length;
    files.push(...valid);
    renderFiles();
    setStatus(rejected ? `${rejected} unsupported file(s) skipped. Use JPG, PNG, WEBP, GIF or BMP.` : '');
  }
  picker.value = '';
  if ((mode === 'pdf-image' || mode === 'pdf-word') && files[0]) await loadPreview(files[0]);
});

async function loadPreview(file) {
  const token = ++previewToken;
  if (previewPdf) { try { await previewPdf.destroy(); } catch {} previewPdf = null; }
  $('convertPreviewEmpty').hidden = false;
  $('convertPreviewCanvas').hidden = true;
  $('convertPreviewEmpty').querySelector('strong').textContent = 'Preparing preview…';
  $('convertPreviewEmpty').querySelector('small').textContent = file.name;
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    if (token !== previewToken) { await pdf.destroy(); return; }
    previewPdf = pdf;
    previewPage = 1;
    $('convertPreviewMeta').textContent = file.name;
    await renderPreviewPage();
  } catch (error) {
    $('convertPreviewEmpty').hidden = false;
    $('convertPreviewEmpty').querySelector('strong').textContent = 'Preview unavailable';
    $('convertPreviewEmpty').querySelector('small').textContent = error?.name === 'PasswordException' ? 'This PDF is password-protected.' : 'The PDF could not be previewed.';
  }
}
async function renderPreviewPage() {
  if (!previewPdf) return;
  const page = await previewPdf.getPage(previewPage);
  const canvas = $('convertPreviewCanvas');
  const stage = canvas.parentElement;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min((stage.clientWidth - 48) / base.width, (stage.clientHeight - 48) / base.height, 1.5);
  const viewport = page.getViewport({ scale: Math.max(.2, scale) });
  const context = canvas.getContext('2d');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  $('convertPreviewEmpty').hidden = true;
  canvas.hidden = false;
  $('convertPageCount').textContent = `${previewPage} / ${previewPdf.numPages}`;
  $('convertPrevPage').disabled = previewPage <= 1;
  $('convertNextPage').disabled = previewPage >= previewPdf.numPages;
}
$('convertPrevPage').addEventListener('click', async () => { if (previewPdf && previewPage > 1) { previewPage--; await renderPreviewPage(); } });
$('convertNextPage').addEventListener('click', async () => { if (previewPdf && previewPage < previewPdf.numPages) { previewPage++; await renderPreviewPage(); } });
window.addEventListener('resize', () => { if (previewPdf && !dialog.hidden) renderPreviewPage(); });

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href=url; link.download=name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function imageBytes(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width=bitmap.width; canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d');
  ctx.drawImage(bitmap,0,0); bitmap.close();
  const jpeg = file.type === 'image/jpeg';
  const blob = await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Image could not be decoded')),jpeg?'image/jpeg':'image/png',0.94));
  return {bytes:new Uint8Array(await blob.arrayBuffer()),type:jpeg?'jpg':'png',width:canvas.width,height:canvas.height};
}
async function imagesToPdf() {
  const { PDFDocument } = window.PDFLib;
  const pdf=await PDFDocument.create();
  for(let i=0;i<files.length;i++) {
    setStatus(`Preparing image ${i+1} of ${files.length}…`);
    const image=await imageBytes(files[i]);
    const embedded=image.type==='jpg'?await pdf.embedJpg(image.bytes):await pdf.embedPng(image.bytes);
    const margin=24, maxWidth=595.28, maxHeight=841.89;
    const scale=Math.min((maxWidth-margin*2)/image.width,(maxHeight-margin*2)/image.height);
    const width=image.width*scale, height=image.height*scale;
    const page=pdf.addPage([Math.max(maxWidth,width+margin*2),Math.max(maxHeight,height+margin*2)]);
    page.drawImage(embedded,{x:(page.getWidth()-width)/2,y:(page.getHeight()-height)/2,width,height});
  }
  return new Blob([await pdf.save()],{type:'application/pdf'});
}
async function wordToPdf(file) {
  setStatus('Loading Word conversion tools…');
  const mammothModule=await import('https://esm.sh/mammoth@1.9.0');
  const html2pdfModule=await import('https://esm.sh/html2pdf.js@0.10.3');
  const mammoth=mammothModule.default || mammothModule;
  const html2pdf=html2pdfModule.default || html2pdfModule;
  setStatus('Reading Word document…');
  const result=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});
  if(!result.value.trim()) throw new Error('This Word document does not contain readable content.');
  const stage=document.createElement('article');
  stage.className='word-print-stage';
  stage.innerHTML=result.value;
  document.body.append(stage);
  try {
    setStatus('Rendering PDF…');
    const worker=html2pdf().set({
      margin:[12,14,12,14],
      filename:file.name.replace(/\.docx$/i,'')+'.pdf',
      image:{type:'jpeg',quality:0.96},
      html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},
      jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},
      pagebreak:{mode:['css','legacy']}
    }).from(stage).toPdf();
    const blob=await worker.outputPdf('blob');
    return blob;
  } finally { stage.remove(); }
}

async function pdfToWord(file) {
  setStatus('Reading PDF text…');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let pdf;
  try {
    pdf = await loadingTask.promise;
    const docxModule = await import('https://esm.sh/docx@9.5.1');
    const children = [];
    let extractedCharacters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      setStatus(`Extracting text from page ${pageNumber} of ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = [];
      let current = [];
      let lastY = null;
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = item.transform?.[5] ?? 0;
        if (lastY !== null && Math.abs(y - lastY) > 3 && current.length) {
          lines.push(current);
          current = [];
        }
        current.push(item);
        lastY = y;
        extractedCharacters += item.str.length;
        if (item.hasEOL) { lines.push(current); current = []; lastY = null; }
      }
      if (current.length) lines.push(current);
      if (pageNumber > 1) children.push(new docxModule.Paragraph({ children: [new docxModule.PageBreak()] }));
      for (const line of lines) {
        line.sort((a,b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0));
        const text = line.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
        if (text) children.push(new docxModule.Paragraph({ children: [new docxModule.TextRun({ text, font: 'Arial', size: 22 })], spacing: { after: 100 } }));
      }
      page.cleanup?.();
    }
    if (!extractedCharacters || !children.length) {
      throw new Error('No selectable text was found. This may be a scanned PDF; use OCR to convert image-only pages.');
    }
    setStatus('Building editable Word document…');
    const document = new docxModule.Document({
      creator: 'AtlasPDF',
      title: file.name.replace(/\.pdf$/i, ''),
      sections: [{ properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }]
    });
    return await docxModule.Packer.toBlob(document);
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('This PDF is password-protected and cannot be converted.');
    throw error;
  } finally {
    try { await pdf?.destroy(); } catch {}
  }
}

async function pdfToImages(file) {
  const format = $('pdfImageFormat').value;
  const scale = Number($('pdfImageScale').value);
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  setStatus('Reading PDF…');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let documentPdf;
  try {
    documentPdf = await loadingTask.promise;
    const zipModule = await import('https://esm.sh/jszip@3.10.1');
    const JSZip = zipModule.default || zipModule;
    const zip = new JSZip();
    for (let pageNumber = 1; pageNumber <= documentPdf.numPages; pageNumber++) {
      setStatus(`Rendering page ${pageNumber} of ${documentPdf.numPages}…`);
      const page = await documentPdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      if (width > 16000 || height > 16000 || width * height > 100000000) {
        throw new Error(`Page ${pageNumber} is too large at this resolution. Choose a lower resolution and try again.`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Your browser could not create an image canvas.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error(`Page ${pageNumber} could not be exported as an image.`)), mime, 0.92);
      });
      zip.file(`page-${String(pageNumber).padStart(3, '0')}.${format}`, blob);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();
    }
    setStatus('Packing images into a ZIP file…');
    const archive = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
      metadata => setStatus(`Creating ZIP archive… ${Math.round(metadata.percent)}%`)
    );
    const baseName = file.name.replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'document';
    downloadBlob(archive, `${baseName}-${format}-pages.zip`);
    return documentPdf.numPages;
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('This PDF is password-protected and cannot be opened for conversion.');
    throw error;
  } finally {
    try { await documentPdf?.destroy(); } catch {}
  }
}
run.addEventListener('click', async () => {
  if(!files.length || run.disabled) return;
  run.disabled=true; $('convertCancel').disabled=true; $('convertClose').disabled=true;
  try {
    const file=files[0];
    if (mode === 'pdf-image') {
      const pages = await pdfToImages(file);
      setStatus(`${pages} page image${pages === 1 ? '' : 's'} created. Your ZIP download has started.`);
    } else if (mode === 'pdf-word') {
      const blob = await pdfToWord(file);
      downloadBlob(blob, file.name.replace(/\.pdf$/i, '') + '.docx');
      setStatus('Editable Word document created. Your download has started.');
    } else {
      const blob=mode==='word'?await wordToPdf(file):await imagesToPdf();
      const name=mode==='word'?file.name.replace(/\.docx$/i,'')+'.pdf':'images-to-pdf.pdf';
      downloadBlob(blob,name);
      setStatus('PDF created. Your download has started.');
    }
  } catch(error) {
    console.error(error);
    setStatus(error.message || 'Could not convert this document. Please try again.',true);
  } finally {
    run.disabled=false; $('convertCancel').disabled=false; $('convertClose').disabled=false;
  }
});
function closeDialog(){ dialog.hidden=true; files=[]; picker.value=''; setStatus(''); document.body.classList.remove('conversion-workspace-open'); previewToken++; if (previewPdf) { previewPdf.destroy(); previewPdf = null; } }
$('convertClose').addEventListener('click',closeDialog);
$('convertBack').addEventListener('click',closeDialog);
$('convertCancel').addEventListener('click',closeDialog);

document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)closeDialog();});
window.AtlasPDFOpenConverter=openConverter;
