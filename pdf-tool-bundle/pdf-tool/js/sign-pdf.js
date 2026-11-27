import * as signPdfjs from '../vendor/pdf.min.mjs';
signPdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const dialog = $('signDialog');
const picker = $('signPicker');
const canvas = $('signCanvas');
const ctx = canvas.getContext('2d');
let file = null, drawing = false, hasInk = false, mode = 'draw';
let signPreviewPdf = null, signPreviewPage = 1, signPreviewToken = 0;

function status(message, error = false) {
  $('signStatus').textContent = message;
  $('signStatus').className = 'sign-status' + (error ? ' error' : '');
}
function clearPad() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasInk = false;
  if (mode === 'type') renderTyped();
  updateRun();
}
function updateRun() {
  $('signRun').disabled = !file || !hasInk;
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x:(event.clientX-rect.left)*canvas.width/rect.width, y:(event.clientY-rect.top)*canvas.height/rect.height };
}
canvas.addEventListener('pointerdown', event => {
  if (mode !== 'draw') return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId);
  const p = point(event); drawing = true; hasInk = true;
  ctx.strokeStyle = '#17345f'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+0.1,p.y+0.1); ctx.stroke(); updateRun();
});
canvas.addEventListener('pointermove', event => {
  if (!drawing || mode !== 'draw') return;
  const p = point(event); ctx.lineTo(p.x,p.y); ctx.stroke();
});
function stopDrawing(){ drawing=false; }
canvas.addEventListener('pointerup',stopDrawing); canvas.addEventListener('pointercancel',stopDrawing); canvas.addEventListener('lostpointercapture',stopDrawing);
function renderTyped() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const value = $('signTypedText').value.trim();
  if (!value) { hasInk=false; updateRun(); return; }
  let size = 100;
  ctx.fillStyle='#17345f'; ctx.textAlign='center'; ctx.textBaseline='middle';
  do { ctx.font = 'italic '+size+'px "Segoe Script", "Brush Script MT", cursive'; if(ctx.measureText(value).width <= canvas.width-50) break; size-=4; } while(size>28);
  ctx.fillText(value,canvas.width/2,canvas.height/2);
  hasInk=true; updateRun();
}
function setMode(next) {
  mode=next;
  $('signDrawPanel').hidden=next!=='draw';
  $('signTypePanel').hidden=next!=='type';
  $('signDrawMode').classList.toggle('active',next==='draw');
  $('signTypeMode').classList.toggle('active',next==='type');
  $('signDrawMode').setAttribute('aria-pressed',String(next==='draw'));
  $('signTypeMode').setAttribute('aria-pressed',String(next==='type'));
  clearPad();
}
$('signDrawMode').addEventListener('click',()=>setMode('draw'));
$('signTypeMode').addEventListener('click',()=>setMode('type'));
$('signTypedText').addEventListener('input',renderTyped);
$('signClear').addEventListener('click',clearPad);
picker.addEventListener('change',async()=>{
  const selected=picker.files?.[0]; picker.value=''; if(!selected)return;
  signPreviewToken++; if(signPreviewPdf){signPreviewPdf.destroy();signPreviewPdf=null;}
  $('signPreviewEmpty').hidden=false;$('signPreviewCanvas').hidden=true;$('signPreviewMeta').textContent=selected.name;$('signPageCount').textContent='— / —';$('signPrevPage').disabled=$('signNextPage').disabled=true;
  if(selected.type!=='application/pdf'&&!/\.pdf$/i.test(selected.name)){file=null;$('signFileName').textContent='Choose a PDF file';$('signFileMeta').textContent='Please select a PDF document';status('Please choose a PDF file.',true);updateRun();return;}
  file=selected; $('signFileName').textContent=selected.name; $('signFileMeta').textContent=(selected.size/1048576).toFixed(2)+' MB · checking pages…';
  $('signRun').disabled=true; status('Checking PDF pages…');
  try {
    const pdf=await window.PDFLib.PDFDocument.load(await selected.arrayBuffer());
    const count=pdf.getPageCount();
    $('signPage').replaceChildren(new Option('All pages','all'));
    for(let page=1;page<=count;page++) $('signPage').add(new Option('Page '+page,String(page)));
    $('signFileMeta').textContent=(selected.size/1048576).toFixed(2)+' MB · '+count+' page'+(count===1?'':'s');
    status('PDF ready. Add your signature below.');
    loadSignPreview(selected);
  } catch(error) {
    file=null; $('signFileMeta').textContent='Could not read this PDF'; status(error?.message||'Could not open this PDF. It may be encrypted or damaged.',true);
  }
  updateRun();
});
async function loadSignPreview(selected) {
  const token=++signPreviewToken;
  if(signPreviewPdf){try{await signPreviewPdf.destroy();}catch{}signPreviewPdf=null;}
  $('signPreviewEmpty').hidden=false;$('signPreviewCanvas').hidden=true;
  $('signPreviewEmpty').querySelector('strong').textContent='Preparing preview…';
  $('signPreviewEmpty').querySelector('small').textContent=selected.name;
  try{
    const pdf=await signPdfjs.getDocument({data:new Uint8Array(await selected.arrayBuffer())}).promise;
    if(token!==signPreviewToken){await pdf.destroy();return;}
    signPreviewPdf=pdf;signPreviewPage=1;
    $('signPreviewMeta').textContent=selected.name;
    await renderSignPreviewPage();
  }catch(error){
    $('signPreviewEmpty').hidden=false;
    $('signPreviewEmpty').querySelector('strong').textContent='Preview unavailable';
    $('signPreviewEmpty').querySelector('small').textContent=error?.name==='PasswordException'?'This PDF is password-protected.':'The PDF could not be previewed.';
  }
}
async function renderSignPreviewPage(){
  if(!signPreviewPdf)return;
  const page=await signPreviewPdf.getPage(signPreviewPage);
  const canvas=$('signPreviewCanvas'),stage=canvas.parentElement,base=page.getViewport({scale:1});
  const scale=Math.min((stage.clientWidth-48)/base.width,(stage.clientHeight-48)/base.height,1.5);
  const viewport=page.getViewport({scale:Math.max(.2,scale)});
  const context=canvas.getContext('2d');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:context,viewport}).promise;
  $('signPreviewEmpty').hidden=true;canvas.hidden=false;
  $('signPageCount').textContent=`${signPreviewPage} / ${signPreviewPdf.numPages}`;
  $('signPrevPage').disabled=signPreviewPage<=1;$('signNextPage').disabled=signPreviewPage>=signPreviewPdf.numPages;
}
$('signPrevPage').addEventListener('click',async()=>{if(signPreviewPdf&&signPreviewPage>1){signPreviewPage--;await renderSignPreviewPage();}});
$('signNextPage').addEventListener('click',async()=>{if(signPreviewPdf&&signPreviewPage<signPreviewPdf.numPages){signPreviewPage++;await renderSignPreviewPage();}});
window.addEventListener('resize',()=>{if(signPreviewPdf&&!dialog.hidden)renderSignPreviewPage();});
function openSign(){
  file=null; picker.value=''; $('signFileName').textContent='Choose a PDF file'; $('signFileMeta').textContent='One PDF · processed locally on your device';
  $('signPage').innerHTML='<option value="all">All pages</option><option value="1">Page 1</option>';
  $('signTypedText').value=''; setMode('draw'); status(''); updateRun(); dialog.hidden=false; document.body.classList.add('sign-workspace-open'); $('signPreviewPanel').hidden=false; $('signPreviewEmpty').hidden=false; $('signPreviewCanvas').hidden=true; $('signPreviewMeta').textContent='Upload a PDF to preview its pages'; $('signPageCount').textContent='— / —'; $('signPrevPage').disabled=$('signNextPage').disabled=true;
}
function closeSign(){dialog.hidden=true;file=null;picker.value='';status('');updateRun();document.body.classList.remove('sign-workspace-open');signPreviewToken++;if(signPreviewPdf){signPreviewPdf.destroy();signPreviewPdf=null;}}
$('signClose').addEventListener('click',closeSign); $('signCancel').addEventListener('click',closeSign); $('signBack').addEventListener('click',closeSign);

document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)closeSign();});
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('signRun').addEventListener('click',async()=>{
  if(!file||!hasInk)return;
  $('signRun').disabled=true;$('signCancel').disabled=true;$('signClose').disabled=true;
  try{
    status('Opening PDF…');
    const {PDFDocument}=window.PDFLib;
    const pdf=await PDFDocument.load(await file.arrayBuffer());
    const png=await pdf.embedPng(await new Promise(resolve=>canvas.toBlob(async blob=>resolve(new Uint8Array(await blob.arrayBuffer())),'image/png')));
    const target=$('signPage').value;
    const pages=pdf.getPages();
    const width=Number($('signSize').value);
    const height=width*(png.height/png.width);
    const position=$('signPosition').value;
    const indexes=target==='all'?pages.map((_,i)=>i):[Number(target)-1];
    for(const index of indexes){
      const page=pages[index];if(!page)continue;
      const {width:pw,height:ph}=page.getSize();
      const margin=32;
      let x=margin,y=margin;
      if(position==='bottom-right'||position==='top-right')x=pw-width-margin;
      if(position==='bottom-center')x=(pw-width)/2;
      if(position==='top-right')y=ph-height-margin;
      x=Math.max(0,Math.min(x,pw-width));y=Math.max(0,Math.min(y,ph-height));
      page.drawImage(png,{x,y,width:Math.min(width,pw-2),height:Math.min(height,ph-2)});
    }
    status('Saving signed PDF…');
    const bytes=await pdf.save();
    const name=file.name.replace(/\.pdf$/i,'')+'-signed.pdf';
    download(new Blob([bytes],{type:'application/pdf'}),name);
    status('Signed PDF created. Your download has started.');
  }catch(error){console.error(error);status(error?.message||'Could not sign this PDF. Please try another file.',true);}
  finally{$('signRun').disabled=!file||!hasInk;$('signCancel').disabled=false;$('signClose').disabled=false;}
});
window.AtlasPDFOpenSign=openSign;
