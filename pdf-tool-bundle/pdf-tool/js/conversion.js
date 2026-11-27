const $ = id => document.getElementById(id);
const dialog = $('convertDialog');
const picker = $('convertPicker');
const list = $('convertFileList');
const run = $('convertRun');
let mode = 'word';
let files = [];

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
  picker.accept = type === 'word' ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'image/*';
  $('convertTitle').textContent = type === 'word' ? 'Word to PDF' : 'Image to PDF';
  $('convertDescription').textContent = type === 'word'
    ? 'Select a .docx document and convert it into a PDF.'
    : 'Select JPG, PNG or other common images. Each image becomes a page in one PDF.';
  $('convertDropTitle').textContent = type === 'word' ? 'Choose a Word document' : 'Choose images';
  $('convertDropHint').textContent = type === 'word' ? 'DOCX files · one document at a time' : 'JPG, PNG, WEBP, GIF and BMP · multiple files';
  $('convertNote').hidden = type !== 'word';
  list.hidden = type !== 'image';
  list.replaceChildren();
  run.textContent = type === 'word' ? 'Convert to PDF' : 'Create PDF';
  run.disabled = true;
  setStatus('');
  dialog.hidden = false;
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
picker.addEventListener('change', () => {
  const selected = [...picker.files];
  if (mode === 'word') {
    const file = selected[0];
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { files=[]; run.disabled=true; setStatus('Please choose a modern Word .docx file. Legacy .doc files are not supported.',true); return; }
    files=[file]; run.disabled=false; $('convertDropTitle').textContent=file.name; setStatus('');
  } else {
    const valid = selected.filter(file => imageTypes.has(file.type));
    const rejected = selected.length - valid.length;
    files.push(...valid);
    renderFiles();
    setStatus(rejected ? `${rejected} unsupported file(s) skipped. Use JPG, PNG, WEBP, GIF or BMP.` : '');
  }
  picker.value = '';
});
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
run.addEventListener('click', async () => {
  if(!files.length || run.disabled) return;
  run.disabled=true; $('convertCancel').disabled=true; $('convertClose').disabled=true;
  try {
    const file=files[0];
    const blob=mode==='word'?await wordToPdf(file):await imagesToPdf();
    const name=mode==='word'?file.name.replace(/\.docx$/i,'')+'.pdf':'images-to-pdf.pdf';
    downloadBlob(blob,name);
    setStatus('PDF created. Your download has started.');
  } catch(error) {
    console.error(error);
    setStatus(error.message || 'Could not convert these files. Please try again.',true);
  } finally {
    run.disabled=false; $('convertCancel').disabled=false; $('convertClose').disabled=false;
  }
});
function closeDialog(){ dialog.hidden=true; files=[]; picker.value=''; setStatus(''); }
$('convertClose').addEventListener('click',closeDialog);
$('convertCancel').addEventListener('click',closeDialog);
dialog.addEventListener('click',event=>{if(event.target===dialog)closeDialog();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)closeDialog();});
window.AtlasPDFOpenConverter=openConverter;
