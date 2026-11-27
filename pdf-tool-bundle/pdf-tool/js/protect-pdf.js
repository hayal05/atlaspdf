const $ = id => document.getElementById(id);
const dialog = $('protectDialog');
const picker = $('protectPicker');
let file = null;
let qpdfPromise = null;

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
picker.addEventListener('change',()=>{
  const selected=picker.files?.[0];picker.value='';if(!selected)return;
  if(selected.type!=='application/pdf'&&!/\.pdf$/i.test(selected.name)){file=null;$('protectFileName').textContent='Choose a PDF file';$('protectFileMeta').textContent='Please select a PDF document';status('Please choose a PDF file.',true);updateRun();return;}
  file=selected;$('protectFileName').textContent=selected.name;$('protectFileMeta').textContent=(selected.size/1048576).toFixed(2)+' MB · ready to encrypt';status('PDF selected. Set and confirm your password.');updateRun();
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
function openProtect(){
  file=null;picker.value='';$('protectFileName').textContent='Choose a PDF file';$('protectFileMeta').textContent='One PDF · processed locally on your device';
  $('protectPassword').value='';$('protectConfirm').value='';strength('');status('');updateRun();dialog.hidden=false;
}
function closeProtect(){dialog.hidden=true;file=null;picker.value='';$('protectPassword').value='';$('protectConfirm').value='';status('');updateRun();}
$('protectClose').addEventListener('click',closeProtect);$('protectCancel').addEventListener('click',closeProtect);
dialog.addEventListener('click',event=>{if(event.target===dialog)closeProtect();});
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
    const code=qpdf.callMain(['--encrypt',password,ownerPassword,'256','--',inputPath,outputPath]);
    if(code!==0&&code!==3)throw new Error('The PDF encryption engine could not protect this file. Check that the PDF is valid and not already password-locked.');
    const protectedBytes=qpdf.FS.readFile(outputPath);
    if(!protectedBytes?.length)throw new Error('The encryption engine did not return a protected PDF.');
    const outputName=file.name.replace(/\.pdf$/i,'')+'-protected.pdf';
    download(new Uint8Array(protectedBytes),outputName);
    status('AES-256 protected PDF created. Your download has started.');
    try{qpdf.FS.unlink(inputPath);qpdf.FS.unlink(outputPath);}catch{}
    $('protectPassword').value='';$('protectConfirm').value='';strength('');
  }catch(error){console.error(error);status(error?.message||'Could not protect this PDF. Please try another file.',true);}
  finally{$('protectRun').disabled=!file||$('protectPassword').value.length<8||$('protectPassword').value!==$('protectConfirm').value;$('protectCancel').disabled=false;$('protectClose').disabled=false;}
});
window.AtlasPDFOpenProtect=openProtect;
