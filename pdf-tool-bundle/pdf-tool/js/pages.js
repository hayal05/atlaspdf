import * as pdfjs from '../vendor/pdf.min.mjs';
const THUMB = 126;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { io.unobserve(e.target); e.target._draw(); }
}), { rootMargin: '200px' });

async function draw(p) {
  if (p.canvas || p.drawing) return;
  p.drawing = true;
  try {
    const pg = await p.file.doc.getPage(p.idx + 1);
    const v0 = pg.getViewport({ scale: 1 });
    const s = Math.min(THUMB / v0.width, THUMB / v0.height), dpr = window.devicePixelRatio || 1;
    const v = pg.getViewport({ scale: s * dpr });
    const c = document.createElement('canvas'); c.width = v.width; c.height = v.height;
    c.style.width = v.width / dpr + 'px'; c.style.height = v.height / dpr + 'px';
    await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    p.canvas = c; p.box.append(c);
  } catch (e) { p.box.textContent = '?'; }
  p.drawing = false;
}

export function renderGrid(grid, state, a) {
  grid.replaceChildren();
  state.pages.forEach((p, i) => {
    const card = el('div', 'page-card' + (i === state.selected ? ' sel' : '')); card.draggable = true;
    const thumb = el('div', 'page-thumb'), rot = el('div', 'rot'); rot.style.transform = `rotate(${p.rot}deg)`;
    thumb.append(rot); p.box = rot;
    const label = el('div', 'page-label', `<${i + 1}> ${p.file.name}`); label.title = `${p.file.name}, page ${p.idx + 1}`;
    const tools = el('div', 'page-tools');
    const ed = el('button', '', '✎'), r = el('button', '', '↻'), d = el('button', '', '×');
    ed.title = 'Edit page'; r.title = 'Rotate page'; d.title = 'Remove page';
    ed.onclick = e => { e.stopPropagation(); a.edit(i); }; r.onclick = e => { e.stopPropagation(); a.rotate(i); }; d.onclick = e => { e.stopPropagation(); a.remove(i); };
    tools.append(ed,r,d); card.append(thumb,label,tools);
    card.onclick = () => a.select(i);
    card.ondragstart = e => { e.dataTransfer.setData('text/x-page', String(i)); e.dataTransfer.effectAllowed = 'move'; card.classList.add('drag'); };
    card.ondragend = () => card.classList.remove('drag');
    card.ondragover = e => { if (e.dataTransfer.types.includes('text/x-page')) { e.preventDefault(); card.classList.add('over'); } };
    card.ondragleave = () => card.classList.remove('over');
    card.ondrop = e => { const from = e.dataTransfer.getData('text/x-page'); if (from === '') return; e.preventDefault(); e.stopPropagation(); a.move(+from, i); };
    grid.append(card);
    if (p.canvas) rot.append(p.canvas); else { card._draw = () => draw(p); io.observe(card); }
  });
}

let previewRender = 0;
export async function renderPreview(page, canvas, area) {
  const token = ++previewRender, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const docPage = await page.file.doc.getPage(page.idx + 1);
  const base = docPage.getViewport({ scale: 1 });
  const rotation = (base.rotation + page.rot) % 360;
  const rotated = docPage.getViewport({ scale: 1, rotation });
  const availableW = Math.max(1, area.clientWidth - 16);
  const availableH = Math.max(1, area.clientHeight - 16);
  // Fit the complete page inside the preview area without vertical scrolling.
  const scale = Math.min(availableW / rotated.width, availableH / rotated.height, 2.1);
  area.style.alignItems = 'center';
  const viewport = docPage.getViewport({ scale: scale * dpr, rotation });
  canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
  canvas.style.width = (viewport.width / dpr) + 'px'; canvas.style.height = (viewport.height / dpr) + 'px';
  const ctx = canvas.getContext('2d');
  await docPage.render({ canvasContext: ctx, viewport }).promise;
  if (token !== previewRender) return;
}
