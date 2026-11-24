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
    const label = el('div', 'page-label', String(i + 1));
    label.setAttribute('aria-label', `Page ${i + 1}`);
    card.append(thumb, label);
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
export async function renderPreview(page, canvas, area, zoom = 1) {
  const token = ++previewRender, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const docPage = await page.file.doc.getPage(page.idx + 1);
  const base = docPage.getViewport({ scale: 1 });
  const rotation = (base.rotation + page.rot) % 360;
  const rotated = docPage.getViewport({ scale: 1, rotation });
  const availableW = Math.max(1, area.clientWidth - 16);
  const availableH = Math.max(1, area.clientHeight - 16);
  // Fit the complete page inside the preview area without vertical scrolling.
  const fitScale = Math.min(availableW / rotated.width, availableH / rotated.height, 2.1);
  const scale = fitScale * zoom;
  const viewport = docPage.getViewport({ scale: scale * dpr, rotation });
  canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
  canvas.style.width = (viewport.width / dpr) + 'px'; canvas.style.height = (viewport.height / dpr) + 'px';
  const stage = document.getElementById('previewPageStage');
  const layer = document.getElementById('previewItems');
  stage.style.width = canvas.style.width; stage.style.height = canvas.style.height;
  stage.hidden = false;
  layer.replaceChildren();
  const ctx = canvas.getContext('2d');
  await docPage.render({ canvasContext: ctx, viewport }).promise;
  if (token !== previewRender) return;

  // Mirror the editor's normalized item positions over the rendered PDF page.
  const cssScale = parseFloat(canvas.style.width) / rotated.width;
  for (const item of page.items || []) {
    const node = el('div', 'preview-item');
    node.style.left = (item.x * 100) + '%';
    node.style.top = (item.y * 100) + '%';
    node.style.width = (item.w * 100) + '%';
    node.style.height = (item.h * 100) + '%';
    if (item.type === 'image') {
      const img = el('img');
      img.src = item.url;
      img.alt = '';
      img.style.opacity = item.opacity;
      const handle = el('span', 'preview-resize-handle');
      handle.setAttribute('aria-label', 'Resize pasted image');
      node.append(img, handle);
      node.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.preview-item.selected').forEach(n => n.classList.remove('selected'));
        node.classList.add('selected');
        const resizing = e.target === handle;
        const rect = stage.getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        const origin = { x: item.x, y: item.y, w: item.w, h: item.h };
        const ratio = item.ar * rect.width / rect.height;
        node.setPointerCapture?.(e.pointerId);
        const move = ev => {
          const dx = (ev.clientX - startX) / rect.width;
          const dy = (ev.clientY - startY) / rect.height;
          if (resizing) {
            const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy / ratio;
            item.w = Math.max(0.03, Math.min(origin.w + delta, 1 - origin.x, (1 - origin.y) / ratio));
            item.h = item.w * ratio;
          } else {
            item.x = Math.max(0, Math.min(1 - item.w, origin.x + dx));
            item.y = Math.max(0, Math.min(1 - item.h, origin.y + dy));
          }
          node.style.left = (item.x * 100) + '%';
          node.style.top = (item.y * 100) + '%';
          node.style.width = (item.w * 100) + '%';
          node.style.height = (item.h * 100) + '%';
        };
        const finish = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', finish);
          document.removeEventListener('pointercancel', finish);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', finish);
      });
    } else if (item.type === 'shape') {
      node.classList.add(item.shape === 'highlight' ? 'preview-highlight' : 'preview-rectangle');
      const n=parseInt(item.color.slice(1),16);
      node.style.background = item.shape === 'highlight' ? 'rgba('+(n>>16)+','+((n>>8)&255)+','+(n&255)+','+item.opacity+')' : 'transparent';
      if (item.shape === 'rectangle') node.style.border = '2px solid ' + item.color;
    } else if (item.type === 'path') {
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 1000 1000'); svg.setAttribute('preserveAspectRatio','none');
      const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');
      line.setAttribute('points',item.points.map(pt=>(pt[0]*1000)+','+(pt[1]*1000)).join(' '));
      line.setAttribute('fill','none'); line.setAttribute('stroke',item.color);
      line.setAttribute('stroke-width','9'); line.setAttribute('stroke-linecap','round'); line.setAttribute('stroke-linejoin','round');
      svg.append(line); node.append(svg);
    } else if (item.type === 'text') {
      node.classList.add('preview-text');
      node.textContent = item.text;
      node.style.color = item.color;
      node.style.fontSize = (item.size * cssScale) + 'px';
    }
    layer.append(node);
  }
}
