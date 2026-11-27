const $ = id => document.getElementById(id);
const dialog = $('repairDialog');
const picker = $('repairPicker');
const run = $('repairRun');
let file = null;

function setStatus(message, error = false) {
  $('repairStatus').textContent = message;
  $('repairStatus').className = 'repair-status' + (error ? ' error' : '');
}
function openRepair() {
  file = null;
  picker.value = '';
  $('repairFileName').textContent = 'Choose a PDF to repair';
  $('repairFileMeta').textContent = 'One PDF · processed locally on your device';
  run.disabled = true;
  setStatus('');
  dialog.hidden = false;
  document.body.classList.add('repair-workspace-open');
}
picker.addEventListener('change', () => {
  const selected = picker.files?.[0];
  picker.value = '';
  if (!selected) return;
  if (!/\.pdf$/i.test(selected.name) && selected.type !== 'application/pdf') {
    file = null;
    run.disabled = true;
    setStatus('Please choose a PDF document.', true);
    return;
  }
  file = selected;
  $('repairFileName').textContent = selected.name;
  $('repairFileMeta').textContent = `${(selected.size / 1024 / 1024).toFixed(2)} MB · ready to repair`;
  run.disabled = false;
  setStatus('');
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
async function repairPDF(source) {
  const engine = window.PDFLib;
  if (!engine?.PDFDocument) throw new Error('The PDF repair engine did not load. Refresh the page and try again.');
  setStatus('Reading PDF structure…');
  const input = await source.arrayBuffer();
  let document;
  try {
    document = await engine.PDFDocument.load(input, {
      updateMetadata: false,
      throwOnInvalidObject: false
    });
  } catch (error) {
    if (error?.name === 'PasswordException' || /encrypt|password/i.test(error?.message || '')) {
      throw new Error('This PDF is encrypted or password-protected. Remove its protection before repairing it.');
    }
    throw new Error('The PDF structure could not be read. This file may be too severely damaged to repair.');
  }
  const originalPageCount = document.getPageCount();
  if (!originalPageCount) throw new Error('No recoverable pages were found in this PDF.');
  setStatus(`Rebuilding ${originalPageCount} page${originalPageCount === 1 ? '' : 's'}…`);
  let repaired;
  try {
    repaired = await document.save({
      useObjectStreams: false,
      addDefaultPage: false,
      objectsPerTick: 50,
      updateFieldAppearances: false
    });
  } catch (error) {
    throw new Error('The PDF could be opened, but its structure could not be rebuilt. Try another copy of the file.');
  }
  setStatus('Checking the repaired file…');
  let check;
  try {
    check = await engine.PDFDocument.load(repaired, { updateMetadata: false });
    if (check.getPageCount() !== originalPageCount) {
      throw new Error('The repaired file did not retain all recoverable pages.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('retain all recoverable pages')) throw error;
    throw new Error('The rebuilt PDF failed its validation check. No output was downloaded.');
  }
  const blob = new Blob([repaired], { type: 'application/pdf' });
  return { blob, pages: check.getPageCount(), size: repaired.byteLength };
}
run.addEventListener('click', async () => {
  if (!file || run.disabled) return;
  run.disabled = true;
  $('repairCancel').disabled = true;
  $('repairClose').disabled = true;
  try {
    const result = await repairPDF(file);
    const name = file.name.replace(/\.pdf$/i, '') || 'document';
    download(result.blob, `${name}-repaired.pdf`);
    setStatus(`Repair complete — ${result.pages} page(s) rebuilt and checked. Your repaired PDF download has started.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'This PDF could not be repaired. Please try another copy.', true);
  } finally {
    run.disabled = !file;
    $('repairCancel').disabled = false;
    $('repairClose').disabled = false;
  }
});
function close() {
  dialog.hidden = true;
  file = null;
  picker.value = '';
  setStatus('');
  document.body.classList.remove('repair-workspace-open');
}
$('repairClose').addEventListener('click', close);
$('repairCancel').addEventListener('click', close);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !dialog.hidden) close(); });
window.AtlasPDFOpenRepair = openRepair;
