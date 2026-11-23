import { loadFiles, exportPdf, download } from './merge.js';
import { renderGrid } from './pages.js';
import { compress } from './compress.js';
import { openEditor, rotateItems } from './editor.js';

const $ = id => document.getElementById(id);
const state = { pages: [], selected: -1 };
let busy = false, msgTimer;
const setBusy = b => { busy = b; document.body.classList.toggle('busy', b); };

function say(text, err, ms) {
  const m = $('msg');
  m.textContent = text; m.className = 'show' + (err ? ' err' : '');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.className = '', ms || (err ? 8000 : 3000));
}

function refresh() {
  const n = state.pages.length, files = new Set(state.pages.map(p => p.file.id)).size;
  $('empty').hidden = n > 0;
  $('download').disabled = !n || busy;
  $('info').textContent = n ? `${n} page${n > 1 ? 's' : ''} · ${files} PDF file${files > 1 ? 's' : ''}` : '';
  renderGrid($('grid'), state, actions);
}

const actions = {
  select(i) { state.selected = state.selected === i ? -1 : i; refresh(); },
  async rotate(i) {
    const p = state.pages[i];
    if (p.items?.length) await rotateItems(p);
    p.rot = (p.rot + 90) % 360; refresh();
  },
  edit(i) { openEditor(state.pages[i], refresh); },
  remove(i) {
    state.pages.splice(i, 1);
    state.selected = -1;
    refresh();
  },
  move(from, to) {
    if (from === to) return;
    state.pages.splice(to, 0, state.pages.splice(from, 1)[0]);
    state.selected = to;
    refresh();
  },
};

async function add(files) {
  files = [...files].filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  if (!files.length || busy) return;
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > 150 * 1048576 && !confirm(`These files add up to ${Math.round(total / 1048576)} MB. Large files can be slow or crash the browser tab. Continue?`)) return;
  setBusy(true); $('info').textContent = 'Loading PDFs…';
  try {
    const { pages, errors } = await loadFiles(files, t => { $('info').textContent = t; });
    const at = state.selected >= 0 ? state.selected + 1 : state.pages.length;
    state.pages.splice(at, 0, ...pages);
    state.selected = -1;
    if (errors.length) say(errors.join(' · '), true);
  } catch (e) {
    console.error(e);
    say('Could not load those PDFs. Check that they are valid and not password-protected.', true);
  } finally {
    setBusy(false); refresh();
  }
}

async function save() {
  setBusy(true); $('download').disabled = true; $('download').textContent = 'Building…';
  try {
    const built = await exportPdf(state.pages);
    let res;
    try { res = await compress(built, $('quality').value, t => { $('download').textContent = t; }); }
    catch (e) { console.error(e); res = { bytes: built, report: 'Compression failed, so the original-quality PDF was downloaded.' }; }
    const { bytes, report } = res;
    download(bytes);
    say(report, false, 12000);
  }
  catch (e) { say('Could not build the PDF. One of the files may be encrypted or damaged.', true); console.error(e); }
  setBusy(false); $('download').textContent = '↓ Download PDF'; refresh();
}

const isFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
const openPicker = () => { if (!busy) $('picker').click(); };
$('add').onclick = openPicker;
$('browse').onclick = e => { e.stopPropagation(); openPicker(); };
$('uploadZone').onclick = e => { if (!e.target.closest('button')) openPicker(); };
$('empty').onclick = openPicker;
$('picker').onchange = e => { add(e.target.files); e.target.value = ''; };
$('download').onclick = save;
window.addEventListener('dragover', e => {
  if (isFiles(e)) {
    e.preventDefault();
    $('uploadZone').classList.add('hot');
  }
});
window.addEventListener('dragleave', e => {
  if (!e.relatedTarget) $('uploadZone').classList.remove('hot');
});
window.addEventListener('drop', e => {
  if (isFiles(e)) {
    e.preventDefault();
    $('uploadZone').classList.remove('hot');
    add(e.dataTransfer.files);
  }
});
window.addEventListener('keydown', e => { if ($('editor').hidden && (e.key === 'Delete' || e.key === 'Backspace') && state.selected >= 0) actions.remove(state.selected); });

addEventListener('unhandledrejection', e => { console.error(e.reason); say('Something went wrong. Reloading the page and trying again usually helps.', true); });
refresh();
