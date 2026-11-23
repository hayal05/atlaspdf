const THUMB = 150;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

// Thumbnails render only when a card scrolls into view.
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
    const c = document.createElement('canvas');
    c.width = v.width; c.height = v.height;
    c.style.width = v.width / dpr + 'px'; c.style.height = v.height / dpr + 'px';
    await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    p.canvas = c;
    p.box.append(c);
  } catch (e) { p.box.textContent = '?'; }
  p.drawing = false;
}

export function renderGrid(grid, state, a) {
  grid.replaceChildren();
  state.pages.forEach((p, i) => {
    const card = el('div', 'card' + (i === state.selected ? ' sel' : ''));
    card.draggable = true;
    const thumb = el('div', 'thumb'), rot = el('div', 'rot');
    rot.style.transform = `rotate(${p.rot}deg)`;
    thumb.append(rot); p.box = rot;
    const bar = el('div', 'bar'), label = el('span', '', `${i + 1} · ${p.file.name}`);
    label.title = `${p.file.name}, page ${p.idx + 1}`;
    const ed = el('button', '', '✎'), r = el('button', '', '↻'), d = el('button', '', '✕');
    ed.title = 'Add picture or text';
    const lb = el('button', 'mvb', '←'), rb = el('button', 'mvb', '→');
    lb.title = 'Move earlier'; rb.title = 'Move later';
    lb.disabled = i === 0; rb.disabled = i === state.pages.length - 1;
    lb.onclick = e => { e.stopPropagation(); a.move(i, i - 1); };
    rb.onclick = e => { e.stopPropagation(); a.move(i, i + 1); };
    ed.onclick = e => { e.stopPropagation(); a.edit(i); };
    r.title = 'Rotate 90°'; d.title = 'Delete page';
    r.onclick = e => { e.stopPropagation(); a.rotate(i); };
    d.onclick = e => { e.stopPropagation(); a.remove(i); };
    bar.append(label, lb, rb, ed, r, d);
    card.append(thumb, bar);

    card.onclick = () => a.select(i);
    card.ondblclick = () => a.edit(i);
    card.ondragstart = e => { e.dataTransfer.setData('text/x-page', String(i)); e.dataTransfer.effectAllowed = 'move'; card.classList.add('drag'); };
    card.ondragend = () => card.classList.remove('drag');
    card.ondragover = e => { if (e.dataTransfer.types.includes('text/x-page')) { e.preventDefault(); card.classList.add('over'); } };
    card.ondragleave = () => card.classList.remove('over');
    card.ondrop = e => {
      const from = e.dataTransfer.getData('text/x-page');
      if (from === '') return;
      e.preventDefault(); e.stopPropagation();
      a.move(+from, i);
    };

    grid.append(card);
    if (p.canvas) rot.append(p.canvas);
    else { card._draw = () => draw(p); io.observe(card); }
  });
}
