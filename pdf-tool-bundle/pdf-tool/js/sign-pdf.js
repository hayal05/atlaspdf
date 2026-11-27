const $ = id => document.getElementById(id);
const dialog = $('signDialog');
const picker = $('signPicker');
const canvas = $('signCanvas');
const ctx = canvas.getContext('2d');
let file = null, drawing = false, hasInk = false, mode = 'draw';

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
picker.addEventListener('change',()=>{
  const selected=picker.files?.[0]; picker.value=''; if(!selected)return;
  if(selected.type!=='application/pdf'&&!/\.pdf$/i.test(selected.name)){file=null;$('signFileName').textContent='Choose a PDF file';$('signFileMeta').textContent='Please select a PDF document';status('Please choose a PDF file.',true);updateRun();return;}
  file=selected; $('signFileName').textContent=selected.name; $('signFileMeta').textContent=(selected.size/1048576).toFixed(2)+' MB · ready to sign';
  $('signPage').innerHTML='<option value="all">All pages</option><option value="1">Page 1</option>';
  status('PDF selected. Add your signature below.'); updateRun();
});
function openSign(){
  file=null; picker.value=''; $('signFileName').textContent='Choose a PDF file'; $('signFileMeta').textContent='One PDF · processed locally on your device';
  $('signPage').innerHTML='<option value="all">All pages</option><option value="1">Page 1</option>';
  $('signTypedText').value=''; setMode('draw'); status(''); updateRun(); dialog.hidden=false;
}
function closeSign(){dialog.hidden=true;file=null;picker.value='';status('');updateRun();}
$('signClose').addEventListener('click',closeSign); $('signCancel').addEventListener('click',closeSign);
dialog.addEventListener('click',event=>{if(event.target===dialog)closeSign();});
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
