import { loadFiles, exportPdf, download } from './merge.js';
import { renderGrid, renderPreview } from './pages.js';
import { compress } from './compress.js';
import { openEditor, rotateItems, setClipboardImage, hasClipboardImage, pasteClipboardToPage } from './editor.js';

const $ = id => document.getElementById(id);
const state = { pages: [], selected: -1, zoom: 1 };
let snipMode = false, snipOverlay = null, snipStart = null;
let busy = false, msgTimer, previewToken = 0;
const setBusy = b => { busy = b; document.body.classList.toggle('busy', b); };

function say(text, err, ms) {
  const m = $('msg'); m.textContent = text; m.className = 'show' + (err ? ' err' : '');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => m.className = '', ms || (err ? 8000 : 3000));
}

async function refresh() {
  const n = state.pages.length, files = new Set(state.pages.map(p => p.file.id)).size;
  $('empty').hidden = n > 0;
  $('documentWorkspace').closest('.workspace').classList.toggle('has-documents', n > 0);
  $('documentWorkspace').hidden = n === 0;
  $('uploadZone').hidden = n > 0;
  $('download').disabled = !n || busy;
  $('info').textContent = n ? `${n} page${n > 1 ? 's' : ''} · ${files} PDF file${files > 1 ? 's' : ''}` : '';
  $('pageCount').textContent = n ? `${n} total` : '';
  const byFile = new Map();
  for (const page of state.pages) byFile.set(page.file.id, (byFile.get(page.file.id) || 0) + 1);
  const estimatedBytes = [...byFile.entries()].reduce((sum, [id, count]) => {
    const file = state.pages.find(page => page.file.id === id).file;
    return sum + file.bytes.length * (count / Math.max(1, file.doc.numPages));
  }, 0);
  const sizeMB = estimatedBytes / 1048576;
  const sizeStatus = sizeMB >= 10 ? 'recommended' : sizeMB >= 5 ? 'optional' : 'unnecessary';
  $('sizeAssessment').hidden = !n;
  $('estimatedSize').textContent = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${Math.max(1, Math.round(estimatedBytes / 1024))} KB`;
  $('sizeBadge').textContent = sizeStatus === 'recommended' ? 'Compression recommended' : sizeStatus === 'optional' ? 'Compression optional' : 'Compression not needed';
  $('sizeBadge').className = `size-badge ${sizeStatus}`;
  $('sizeAdvice').textContent = sizeStatus === 'recommended' ? 'Your selected pages may produce a large PDF. Consider Medium or High compression.' : sizeStatus === 'optional' ? 'Your PDF is moderate in size. Compress only if you need a smaller file.' : 'Your selected pages are relatively small. Original quality is likely sufficient.';
  renderGrid($('grid'), state, actions);
  $('zoomLevel').textContent = `${Math.round(state.zoom * 100)}%`;
  $('zoomOut').disabled = !n || state.zoom <= 0.5;
  $('zoomIn').disabled = !n || state.zoom >= 3;
  const selected = state.pages[state.selected];
  $('previewEdit').disabled = $('previewRotate').disabled = $('previewRemove').disabled = !selected;
  $('previewSnip').disabled = !selected;
  $('organizePages').disabled = !n;
  $('previewPaste').disabled = !selected || !hasClipboardImage();
  if (snipMode && !selected) stopSnip();
  if (!selected) {
    $('previewTitle').textContent = 'Page preview'; $('previewMeta').textContent = 'Select a page';
    $('previewCanvas').hidden = true; $('previewPageStage').hidden = true; $('previewEmpty').hidden = false; return;
  }
  $('previewTitle').textContent = selected.file.name;
  $('previewMeta').textContent = `Page ${selected.idx + 1} · ${state.selected + 1} of ${n}`;
  $('previewEmpty').hidden = true; $('previewCanvas').hidden = false;
  const token = ++previewToken;
  try { await renderPreview(selected, $('previewCanvas'), $('previewCanvasArea'), state.zoom); }
  catch (e) { console.error(e); if (token === previewToken) say('Could not render this PDF page.', true); }
}

function parsePageRanges(value, total) {
  const input = value.trim();
  if (!input) throw new Error('Enter at least one page range.');
  const ranges = input.split(',').map(part => {
    const token = part.trim();
    const match = token.match(/^(\\d+)(?:\\s*-\\s*(\\d+))?$/);
    if (!match) throw new Error(`Invalid range: ${token}`);
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > total) throw new Error(`Page range ${token} is outside 1-${total}.`);
    return { start: start - 1, end: end - 1 };
  });
  const seen = new Set();
  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i++) {
      if (seen.has(i)) throw new Error('Page ranges must not overlap.');
      seen.add(i);
    }
  }
  return ranges;
}

function closeOrganize() {
  $('organizeDialog').hidden = true;
}

async function runOrganize(operation) {
  if (busy || !state.pages.length) return;
  let ranges;
  try {
    ranges = parsePageRanges($('pageRanges').value, state.pages.length);
    if (operation === 'split' && ranges.length < 2) throw new Error('Enter at least two ranges to create separate PDF files.');
    if (operation === 'remove' && ranges.reduce((n, r) => n + r.end - r.start + 1, 0) >= state.pages.length) {
      throw new Error('At least one page must remain in the workspace.');
    }
  } catch (e) { say(e.message, true); return; }

  setBusy(true);
  const buttons = ['extractRanges', 'splitRanges', 'removeRanges'].map(id => $(id));
  buttons.forEach(button => { button.disabled = true; });
  try {
    if (operation === 'remove') {
      const remove = new Set(ranges.flatMap(r => Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i)));
      const selectedPage = state.pages[state.selected];
      const oldIndex = state.selected;
      state.pages = state.pages.filter((_, i) => !remove.has(i));
      state.selected = state.pages.indexOf(selectedPage);
      if (state.selected < 0) state.selected = Math.min(oldIndex, state.pages.length - 1);
      closeOrganize();
      refresh();
      say(`${remove.size} page${remove.size === 1 ? '' : 's'} removed.`);
      return;
    }

    if (operation === 'extract') {
      const selected = ranges.flatMap(r => state.pages.slice(r.start, r.end + 1));
      $('info').textContent = 'Extracting pages…';
      const bytes = await exportPdf(selected);
      download(bytes, 'atlaspdf-extracted-pages.pdf');
      closeOrganize();
      say(`${selected.length} page${selected.length === 1 ? '' : 's'} extracted.`);
      return;
    }

    $('info').textContent = 'Preparing split PDFs…';
    const outputs = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const bytes = await exportPdf(state.pages.slice(range.start, range.end + 1));
      outputs.push(bytes);
      $('info').textContent = `Preparing split PDF ${i + 1} of ${ranges.length}…`;
    }
    outputs.forEach((bytes, i) => {
      setTimeout(() => download(bytes, `atlaspdf-part-${i + 1}.pdf`), i * 350);
    });
    closeOrganize();
    say(`${outputs.length} split PDFs prepared. If your browser asks, allow multiple downloads.`, false, 9000);
  } catch (e) {
    console.error(e);
    say('Could not complete that page operation. Check the PDF and try again.', true);
  } finally {
    setBusy(false);
    buttons.forEach(button => { button.disabled = false; });
    refresh();
  }
}

const actions = {
  select(i) { state.selected = i; state.zoom = 1; refresh(); },
  async rotate(i) { const p = state.pages[i]; if (p.items?.length) await rotateItems(p); p.rot = (p.rot + 90) % 360; refresh(); },
  edit(i) { openEditor(state.pages[i], refresh); },
  remove(i) { state.pages.splice(i, 1); state.selected = state.pages.length ? Math.min(i, state.pages.length - 1) : -1; refresh(); },
  move(from, to) { if (from === to) return; const selectedPage = state.pages[state.selected]; state.pages.splice(to, 0, state.pages.splice(from, 1)[0]); state.selected = state.pages.indexOf(selectedPage); refresh(); },
};

async function add(files) {
  files = [...files].filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  if (!files.length || busy) return;
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > 150 * 1048576 && !confirm(`These files add up to ${Math.round(total / 1048576)} MB. Large files can be slow or crash the browser tab. Continue?`)) return;
  setBusy(true); $('info').textContent = 'Loading PDFs…';
  try {
    const { pages, errors } = await loadFiles(files, t => { $('info').textContent = t; });
    state.pages.push(...pages);
    if (state.selected < 0 && state.pages.length) state.selected = 0;
    if (errors.length) say(errors.join(' · '), true);
  } catch (e) { console.error(e); say('Could not load those PDFs. Check that they are valid and not password-protected.', true); }
  finally { setBusy(false); refresh(); }
}

function stopSnip() {
  snipMode = false; snipStart = null;
  if (snipOverlay) snipOverlay.remove();
  snipOverlay = null;
  $('previewSnip').classList.remove('active');
  $('previewSnip').textContent = '▧ Snip';
}

function startSnip() {
  if (state.selected < 0 || busy) return;
  if (snipMode) { stopSnip(); return; }
  const stage = $('previewPageStage'), source = $('previewCanvas');
  if (stage.hidden || !source.width) return;
  snipMode = true;
  $('previewSnip').classList.add('active');
  $('previewSnip').textContent = 'Cancel snip';
  snipOverlay = document.createElement('div');
  snipOverlay.className = 'snip-overlay';
  snipOverlay.setAttribute('aria-label', 'Drag to select an area to snip');
  const selection = document.createElement('div');
  selection.className = 'snip-selection';
  snipOverlay.append(selection);
  stage.append(snipOverlay);
  let start = null;
  snipOverlay.onpointerdown = e => {
    e.preventDefault(); start = { x: e.offsetX, y: e.offsetY };
    selection.style.cssText = `left:${start.x}px;top:${start.y}px;width:0;height:0;display:block`;
    snipOverlay.setPointerCapture(e.pointerId);
  };
  snipOverlay.onpointermove = e => {
    if (!start) return;
    const x = Math.min(start.x, e.offsetX), y = Math.min(start.y, e.offsetY);
    selection.style.left = x + 'px'; selection.style.top = y + 'px';
    selection.style.width = Math.abs(e.offsetX - start.x) + 'px';
    selection.style.height = Math.abs(e.offsetY - start.y) + 'px';
  };
  snipOverlay.onpointerup = async e => {
    if (!start) return;
    const x = Math.min(start.x, e.offsetX), y = Math.min(start.y, e.offsetY);
    const w = Math.abs(e.offsetX - start.x), h = Math.abs(e.offsetY - start.y);
    start = null;
    if (w < 8 || h < 8) { stopSnip(); say('Select a larger area to snip.', true); return; }
    const rect = source.getBoundingClientRect(), factorX = source.width / rect.width, factorY = source.height / rect.height;
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(w * factorX)); crop.height = Math.max(1, Math.round(h * factorY));
    crop.getContext('2d').drawImage(source, Math.round(x * factorX), Math.round(y * factorY), crop.width, crop.height, 0, 0, crop.width, crop.height);
    try {
      const blob = await new Promise(resolve => crop.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not create snip');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const url = URL.createObjectURL(blob);
      setClipboardImage({ bytes, mime: 'image/png', url });
      $('previewPaste').disabled = state.selected < 0;
      say('Snip copied. Select the destination page and click Paste Snip.');
    } catch (err) { console.error(err); say('Could not capture that area.', true); }
    stopSnip();
  };
}

async function save() {
  setBusy(true); $('download').disabled = true; $('download').textContent = 'Building…';
  try {
    const built = await exportPdf(state.pages);
    let res;
    try { res = await compress(built, $('quality').value, t => { $('download').textContent = t; }); }
    catch (e) { console.error(e); res = { bytes: built, report: 'Compression failed, so the original-quality PDF was downloaded.' }; }
    download(res.bytes); say(res.report, false, 12000);
  } catch (e) { say('Could not build the PDF. One of the files may be encrypted or damaged.', true); console.error(e); }
  setBusy(false); $('download').textContent = '↓ Download PDF'; refresh();
}

$('add').onclick = () => { if (!busy) $('picker').click(); };
$('addMore').onclick = () => { if (!busy) $('picker').click(); };
$('browse').onclick = e => { e.stopPropagation(); $('picker').click(); };
$('uploadZone').onclick = e => { if (!e.target.closest('button')) $('picker').click(); };
$('empty').onclick = () => $('picker').click();
$('picker').onchange = e => { add(e.target.files); e.target.value = ''; };
$('download').onclick = save;
$('organizePages').onclick = () => { $('pageRanges').value = ''; $('organizeDialog').hidden = false; $('pageRanges').focus(); };
$('organizeClose').onclick = closeOrganize;
$('organizeDialog').addEventListener('click', e => { if (e.target === $('organizeDialog')) closeOrganize(); });
$('extractRanges').onclick = () => runOrganize('extract');
$('splitRanges').onclick = () => runOrganize('split');
$('removeRanges').onclick = () => runOrganize('remove');
$('pageRanges').addEventListener('keydown', e => { if (e.key === 'Escape') closeOrganize(); });
$('previewEdit').onclick = () => { if (state.selected >= 0) actions.edit(state.selected); };
$('previewSnip').onclick = startSnip;
$('previewPaste').onclick = async () => {
  const page = state.pages[state.selected];
  if (!page || !hasClipboardImage()) return;
  try {
    await pasteClipboardToPage(page);
    refresh();
    say('Snip pasted onto the selected page.');
  } catch (e) { console.error(e); say('Could not paste the snipped image.', true); }
};
$('previewRotate').onclick = () => { if (state.selected >= 0) actions.rotate(state.selected); };
$('previewRemove').onclick = () => { if (state.selected >= 0) actions.remove(state.selected); };
$('zoomOut').onclick = () => { state.zoom = Math.max(0.5, Math.round((state.zoom - 0.25) * 100) / 100); refresh(); };
$('zoomIn').onclick = () => { state.zoom = Math.min(3, Math.round((state.zoom + 0.25) * 100) / 100); refresh(); };
const isFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragover', e => { if (isFiles(e)) { e.preventDefault(); $('uploadZone').classList.add('hot'); } });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('uploadZone').classList.remove('hot'); });
window.addEventListener('drop', e => { if (isFiles(e)) { e.preventDefault(); $('uploadZone').classList.remove('hot'); add(e.dataTransfer.files); } });
window.addEventListener('keydown', e => { if ($('editor').hidden && (e.key === 'Delete' || e.key === 'Backspace') && state.selected >= 0 && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) actions.remove(state.selected); });
addEventListener('unhandledrejection', e => { console.error(e.reason); say('Something went wrong. Reloading the page and trying again usually helps.', true); });
refresh();
