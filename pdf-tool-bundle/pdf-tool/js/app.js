import { loadFiles, exportPdf, download } from './merge.js';
import { renderGrid, renderPreview } from './pages.js';
import { compress } from './compress.js';
import { openEditor, rotateItems } from './editor.js';

const $ = id => document.getElementById(id);
const state = { pages: [], selected: -1 };
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
  renderGrid($('grid'), state, actions);
  const selected = state.pages[state.selected];
  $('previewEdit').disabled = $('previewRotate').disabled = $('previewRemove').disabled = !selected;
  if (!selected) {
    $('previewTitle').textContent = 'Page preview'; $('previewMeta').textContent = 'Select a page';
    $('previewCanvas').hidden = true; $('previewEmpty').hidden = false; return;
  }
  $('previewTitle').textContent = selected.file.name;
  $('previewMeta').textContent = `Page ${selected.idx + 1} · ${state.selected + 1} of ${n}`;
  $('previewEmpty').hidden = true; $('previewCanvas').hidden = false;
  const token = ++previewToken;
  try { await renderPreview(selected, $('previewCanvas'), $('previewCanvasArea')); }
  catch (e) { console.error(e); if (token === previewToken) say('Could not render this PDF page.', true); }
}

const actions = {
  select(i) { state.selected = i; refresh(); },
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
$('previewEdit').onclick = () => { if (state.selected >= 0) actions.edit(state.selected); };
$('previewRotate').onclick = () => { if (state.selected >= 0) actions.rotate(state.selected); };
$('previewRemove').onclick = () => { if (state.selected >= 0) actions.remove(state.selected); };
const isFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragover', e => { if (isFiles(e)) { e.preventDefault(); $('uploadZone').classList.add('hot'); } });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('uploadZone').classList.remove('hot'); });
window.addEventListener('drop', e => { if (isFiles(e)) { e.preventDefault(); $('uploadZone').classList.remove('hot'); add(e.dataTransfer.files); } });
window.addEventListener('keydown', e => { if ($('editor').hidden && (e.key === 'Delete' || e.key === 'Backspace') && state.selected >= 0 && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) actions.remove(state.selected); });
addEventListener('unhandledrejection', e => { console.error(e.reason); say('Something went wrong. Reloading the page and trying again usually helps.', true); });
refresh();
