import * as protectPdfjs from '../vendor/pdf.min.mjs';
protectPdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const dialog = $('protectDialog');
const picker = $('protectPicker');
let file = null;
let qpdfPromise = null;
let protectPreviewPdf = null, protectPreviewPage = 1, protectPreviewToken = 0;

function status(message, error = false) {
  $('protectStatus').textContent = message;
  $('protectStatus').className = 'protect-status' + (error ? ' error' : '');
}
function strength(value) {
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  const pct = value ? Math.max(8, score * 20) : 0;
  $('protectStrengthBar').style.width = pct + '%';
  $('protectStrengthBar').style.background = score <= 2 ? '#d97706' : score <= 3 ? '#2874b9' : '#15945f';
  $('protectStrengthText').textContent = !value ? 'Use a long, unique password. There is no password recovery.' : score <= 2 ? 'Weak password — add length and a mix of characters.' : score <= 3 ? 'Fair password — a longer passphrase is safer.' : 'Strong password.';
}
function updateRun() {
  const password = $('protectPassword').value;
  $('protectRun').disabled = !file || password.length < 8 || password !== $('protectConfirm').value;
}
$('protectPassword').addEventListener('input',()=>{strength($('protectPassword').value);updateRun();});
$('protectConfirm').addEventListener('input',updateRun);
picker.addEventListener('change',async()=>{
  const selected=picker.files?.[0];picker.value='';if(!selected)return;
  protectPreviewToken++;if(protectPreviewPdf){protectPreviewPdf.destroy();protectPreviewPdf=null;}
  $('protectPreviewEmpty').hidden=false;$('protectPreviewCanvas').hidden=true;$('protectPreviewMeta').textContent=selected.name;$('protectPageCount').textContent='— / —';$('protectPrevPage').disabled=$('protectNextPage').disabled=true;
  if(selected.type!=='application/pdf'&&!/\.pdf$/i.test(selected.name)){file=null;$('protectFileName').textContent='Choose a PDF file';$('protectFileMeta').textContent='Please select a PDF document';status('Please choose a PDF file.',true);updateRun();return;}
  file=selected;$('protectFileName').textContent=selected.name;$('protectFileMeta').textContent=(selected.size/1048576).toFixed(2)+' MB · ready to encrypt';status('PDF selected. Set and confirm your password.');updateRun();await loadProtectPreview(selected);
});
async function loadQpdf(){
  if(!qpdfPromise){
    qpdfPromise=import('https://cdn.jsdelivr.net/npm/qpdf-wasm-esm-embedded@1.1.1/qpdf.mjs').then(async module=>{
      const factory=module.default;
      if(typeof factory!=='function')throw new Error('The PDF encryption engine could not be initialized.');
      return factory({print:()=>{},printErr:()=>{}});
    }).catch(error=>{qpdfPromise=null;throw error;});
  }
  return qpdfPromise;
}
function randomOwnerPassword(){
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function download(bytes,name){const blob=new Blob([bytes],{type:'application/pdf'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function loadProtectPreview(selected){
  const token=++protectPreviewToken;
  if(protectPreviewPdf){try{await protectPreviewPdf.destroy();}catch{}protectPreviewPdf=null;}
  $('protectPreviewEmpty').hidden=false;$('protectPreviewCanvas').hidden=true;
  $('protectPreviewEmpty').querySelector('strong').textContent='Preparing preview…';
  $('protectPreviewEmpty').querySelector('small').textContent=selected.name;
  try{
    const pdf=await protectPdfjs.getDocument({data:new Uint8Array(await selected.arrayBuffer())}).promise;
    if(token!==protectPreviewToken){await pdf.destroy();return;}
    protectPreviewPdf=pdf;protectPreviewPage=1;$('protectPreviewMeta').textContent=selected.name;await renderProtectPreviewPage();
  }catch(error){
    $('protectPreviewEmpty').hidden=false;
    $('protectPreviewEmpty').querySelector('strong').textContent='Preview unavailable';
    $('protectPreviewEmpty').querySelector('small').textContent=error?.name==='PasswordException'?'This PDF is password-protected.':'The PDF could not be previewed.';
  }
}
async function renderProtectPreviewPage(){
  if(!protectPreviewPdf)return;
  const page=await protectPreviewPdf.getPage(protectPreviewPage);
  const canvas=$('protectPreviewCanvas'),stage=canvas.parentElement,base=page.getViewport({scale:1});
  const scale=Math.min((stage.clientWidth-48)/base.width,(stage.clientHeight-48)/base.height,1.5);
  const viewport=page.getViewport({scale:Math.max(.2,scale)});
  const context=canvas.getContext('2d');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:context,viewport}).promise;
  $('protectPreviewEmpty').hidden=true;canvas.hidden=false;
  $('protectPageCount').textContent=`${protectPreviewPage} / ${protectPreviewPdf.numPages}`;
  $('protectPrevPage').disabled=protectPreviewPage<=1;$('protectNextPage').disabled=protectPreviewPage>=protectPreviewPdf.numPages;
}
$('protectPrevPage').addEventListener('click',async()=>{if(protectPreviewPdf&&protectPreviewPage>1){protectPreviewPage--;await renderProtectPreviewPage();}});
$('protectNextPage').addEventListener('click',async()=>{if(protectPreviewPdf&&protectPreviewPage<protectPreviewPdf.numPages){protectPreviewPage++;await renderProtectPreviewPage();}});
window.addEventListener('resize',()=>{if(protectPreviewPdf&&!dialog.hidden)renderProtectPreviewPage();});
function openProtect(){
  file=null;picker.value='';$('protectFileName').textContent='Choose a PDF file';$('protectFileMeta').textContent='One PDF · processed locally on your device';
  $('protectPassword').value='';$('protectConfirm').value='';strength('');status('');updateRun();dialog.hidden=false;document.body.classList.add('protect-workspace-open');$('protectPreviewPanel').hidden=false;$('protectPreviewEmpty').hidden=false;$('protectPreviewCanvas').hidden=true;$('protectPreviewMeta').textContent='Upload a PDF to preview its pages';$('protectPageCount').textContent='— / —';$('protectPrevPage').disabled=$('protectNextPage').disabled=true;
}
function closeProtect(){dialog.hidden=true;file=null;picker.value='';$('protectPassword').value='';$('protectConfirm').value='';status('');updateRun();document.body.classList.remove('protect-workspace-open');protectPreviewToken++;if(protectPreviewPdf){protectPreviewPdf.destroy();protectPreviewPdf=null;}}
$('protectClose').addEventListener('click',closeProtect);$('protectCancel').addEventListener('click',closeProtect);$('protectBack').addEventListener('click',closeProtect);

document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)closeProtect();});
$('protectRun').addEventListener('click',async()=>{
  if(!file||$('protectRun').disabled)return;
  const password=$('protectPassword').value;
  $('protectRun').disabled=true;$('protectCancel').disabled=true;$('protectClose').disabled=true;
  let qpdf,inputPath='/atlaspdf-input.pdf',outputPath='/atlaspdf-protected.pdf';
  try{
    status('Loading secure PDF encryption engine…');qpdf=await loadQpdf();
    status('Encrypting with AES-256…');
    const bytes=new Uint8Array(await file.arrayBuffer());
    try{qpdf.FS.unlink(inputPath);}catch{}
    try{qpdf.FS.unlink(outputPath);}catch{}
    qpdf.FS.writeFile(inputPath,bytes);
    const ownerPassword=randomOwnerPassword();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const code=qpdf.callMain(['--encrypt',password,ownerPassword,'256','--',inputPath,outputPath]);
    if(code!==0&&code!==3)throw new Error('The PDF encryption engine could not protect this file. Check that the PDF is valid and not already password-locked.');
    const protectedBytes=qpdf.FS.readFile(outputPath);
    if(!protectedBytes?.length)throw new Error('The encryption engine did not return a protected PDF.');
    const outputName=file.name.replace(/\.pdf$/i,'')+'-protected.pdf';
    download(new Uint8Array(protectedBytes),outputName);
    status('AES-256 protected PDF created. Your download has started.');
    $('protectPassword').value='';$('protectConfirm').value='';strength('');
  }catch(error){console.error(error);status(error?.message||'Could not protect this PDF. Please try another file.',true);}
  finally{
    if(qpdf){try{qpdf.FS.unlink(inputPath);}catch{}try{qpdf.FS.unlink(outputPath);}catch{}}
    $('protectRun').disabled=!file||$('protectPassword').value.length<8||$('protectPassword').value!==$('protectConfirm').value;
    $('protectCancel').disabled=false;$('protectClose').disabled=false;
  }
});
window.AtlasPDFOpenProtect=openProtect;
