// Page editor: place pictures and text on one page. Item positions are fractions (0-1)
// of the page as displayed (after rotation), measured from the top-left corner.
const $ = id => document.getElementById(id);
let cur, sel, scale, vis, onDone, clipboardImage = null, annotationMode = null;

export function setClipboardImage(image) { clipboardImage = image; }
export function hasClipboardImage() { return !!clipboardImage; }

// Paste a snip directly onto a page without opening the page editor.
export async function pasteClipboardToPage(p) {
  if (!clipboardImage) return;
  const { bytes, mime, url } = clipboardImage;
  const im = new Image(); im.src = url;
  await im.decode();
  const pg = await p.file.doc.getPage(p.idx + 1);
  const rotation = (pg.rotate + p.rot) % 360;
  const vis = pg.getViewport({ scale: 1, rotation });
  const ar = im.naturalHeight / im.naturalWidth;
  let w = 0.3, h = w * ar * vis.width / vis.height;
  if (h > 0.6) { h = 0.6; w = h * vis.height / (ar * vis.width); }
  const it = { type: 'image', bytes: new Uint8Array(bytes), mime, url, ar, x: (1 - w) / 2, y: (1 - h) / 2, w, h, opacity: 1 };
  p.items ||= [];
  p.items.push(it);
}

export async function openEditor(p, done) {
  cur = p; p.items ||= []; sel = null; onDone = done; annotationMode = null; updateAnnotationButtons();
  const pg = await p.file.doc.getPage(p.idx + 1), rot = (pg.rotate + p.rot) % 360;
  vis = pg.getViewport({ scale: 1, rotation: rot });
  const w = Math.max(200, Math.min(760, innerWidth - 32, (innerHeight - 130) * vis.width / vis.height));
  scale = w / vis.width;
  const dpr = devicePixelRatio || 1, v = pg.getViewport({ scale: scale * dpr, rotation: rot });
  const c = $('ecanvas'), h = v.height / dpr;
  c.width = v.width; c.height = v.height;
  for (const e of [c, $('stage')]) { e.style.width = w + 'px'; e.style.height = h + 'px'; }
  $('emsg').textContent = '';
  $('editor').hidden = false;
  $('layer').replaceChildren();
  p.items.forEach(mount);
  select(null);
  await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
}

function close() {
  const sw = $('stage').clientWidth, sh = $('stage').clientHeight;
  for (const it of cur.items) {
    if (it.type === 'text' && it.el) { it.w = it.el.offsetWidth / sw; it.h = it.el.offsetHeight / sh; }
    delete it.el;
  }
  cur.items = cur.items.filter(it => it.type !== 'text' || it.text.trim());
  $('editor').hidden = true;
  annotationMode = null; updateAnnotationButtons();
  onDone();
}

function mk(tag, cls, text) { const e = document.createElement(tag); e.className = cls || ''; if (text) e.textContent = text; return e; }

function mount(it) {
  const d = mk('div', 'item'); it.el = d;
  if (it.type === 'image') {
    const im = new Image(); im.src = it.url; im.style.opacity = it.opacity;
    const rs = mk('i', 'rs');
    rs.onpointerdown = e => drag(e, it, 'size');
    d.onpointerdown = e => { if (e.target !== rs) drag(e, it, 'move'); };
    d.append(im, rs);
  } else if (it.type === 'shape') {
    d.classList.add(it.shape === 'highlight' ? 'annotation-highlight' : 'annotation-rectangle');
    d.style.background = it.shape === 'highlight' ? hexRgba(it.color, it.opacity) : 'transparent';
    d.style.border = it.shape === 'rectangle' ? '2px solid ' + it.color : 'none';
    d.onpointerdown = e => drag(e, it, 'move');
  } else {
    const t = mk('div', 'txt', it.text); t.contentEditable = 'true';
    t.oninput = () => { it.text = t.innerText; };
    t.onfocus = () => select(it);
    const m = mk('i', 'mv', '✥'); m.onpointerdown = e => drag(e, it, 'move');
    d.append(t, m);
  }
  $('layer').append(d); place(it);
}

function hexRgba(hex, opacity) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${opacity})`; }

function place(it) {
  const d = it.el; d.style.left = it.x * 100 + '%'; d.style.top = it.y * 100 + '%';
  if (it.type === 'image' || it.type === 'shape') { d.style.width = it.w * 100 + '%'; d.style.height = it.h * 100 + '%'; }
  else { d.firstChild.style.fontSize = it.size * scale + 'px'; d.firstChild.style.color = it.color; }
}

function select(it) {
  sel = it;
  cur.items.forEach(i => i.el && i.el.classList.toggle('sel', i === it));
  $('eimgctl').hidden = !(it && it.type === 'image');
  $('etxtctl').hidden = !(it && it.type === 'text');
  $('edel').hidden = !it;
  if (it?.type === 'image') $('eop').value = it.opacity;
  if (it?.type === 'text') { $('esz').value = it.size; $('ecol').value = it.color; }
}

function drag(e, it, mode) {
  e.preventDefault(); e.stopPropagation(); select(it);
  const sw = $('stage').clientWidth, sh = $('stage').clientHeight, x0 = e.clientX, y0 = e.clientY, o = { x: it.x, y: it.y, w: it.w };
  const move = ev => {
    const dx = (ev.clientX - x0) / sw, dy = (ev.clientY - y0) / sh;
    if (mode === 'move') { it.x = Math.min(Math.max(o.x + dx, 0), 1 - it.w); it.y = Math.min(Math.max(o.y + dy, 0), 1 - it.h); }
    else { it.w = Math.min(Math.max(o.w + dx, 0.03), 1 - it.x); it.h = it.w * it.ar * vis.width / vis.height; }
    place(it);
  };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

async function addImage(file) {
  if (!/^image\/(png|jpeg)$/.test(file.type)) { $('emsg').textContent = 'Only PNG and JPG pictures are supported.'; return; }
  const bytes = new Uint8Array(await file.arrayBuffer()), url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  const im = new Image(); im.src = url;
  try { await im.decode(); } catch { $('emsg').textContent = 'Couldn’t read that picture.'; return; }
  const ar = im.naturalHeight / im.naturalWidth, w = 0.3;
  const it = { type: 'image', bytes, mime: file.type, url, ar, x: 0.1, y: 0.1, w, h: w * ar * vis.width / vis.height, opacity: 1 };
  cur.items.push(it); mount(it); select(it);
}


function addText() {
  const it = { type: 'text', text: 'Text', size: 18, color: '#000000', x: 0.1, y: 0.1, w: 0.2, h: 0.04 };
  cur.items.push(it); mount(it); select(it);
  const t = it.el.firstChild; t.focus(); getSelection().selectAllChildren(t);
}

$('eimg').onclick = () => $('epick').click();
$('epick').onchange = e => { if (e.target.files[0]) addImage(e.target.files[0]); e.target.value = ''; };
$('etxt').onclick = addText;
$('edone').onclick = close;
$('edel').onclick = () => { cur.items = cur.items.filter(i => i !== sel); sel.el.remove(); select(null); };
function updateAnnotationButtons() {
  for (const [id, mode] of [['ehighlight','highlight'],['erectangle','rectangle']]) {
    const button = $(id); if (!button) continue;
    button.classList.toggle('active', annotationMode === mode);
    button.setAttribute('aria-pressed', String(annotationMode === mode));
  }
}
function setAnnotationMode(mode) {
  annotationMode = annotationMode === mode ? null : mode;
  updateAnnotationButtons();
  $('emsg').textContent = annotationMode ? 'Drag on the page to add a ' + annotationMode + '.' : '';
}
function drawAnnotation(e) {
  const rect = $('stage').getBoundingClientRect();
  const startX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const startY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  const it = { type:'shape', shape:annotationMode, color: annotationMode === 'highlight' ? '#ffdf45' : '#e04444', opacity: annotationMode === 'highlight' ? 0.34 : 1, x:startX, y:startY, w:0, h:0 };
  cur.items.push(it); mount(it); select(it);
  const move = ev => {
    const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
    it.x = Math.min(startX,x); it.y = Math.min(startY,y);
    it.w = Math.abs(x-startX); it.h = Math.abs(y-startY);
    place(it);
  };
  const finish = () => {
    removeEventListener('pointermove',move); removeEventListener('pointerup',finish);
    if (it.w < 0.006 || it.h < 0.006) { cur.items = cur.items.filter(item => item !== it); it.el.remove(); select(null); }
  };
  addEventListener('pointermove',move); addEventListener('pointerup',finish,{once:true});
}
$('ehighlight').onclick = () => setAnnotationMode('highlight');
$('erectangle').onclick = () => setAnnotationMode('rectangle');
$('layer').onpointerdown = e => {
  if (annotationMode) { e.preventDefault(); drawAnnotation(e); }
  else if (e.target === $('layer')) select(null);
};
$('eop').oninput = e => { sel.opacity = +e.target.value; sel.el.firstChild.style.opacity = sel.opacity; };
$('esz').oninput = e => { sel.size = Math.min(Math.max(+e.target.value || 12, 4), 300); place(sel); };
$('ecol').oninput = e => { sel.color = e.target.value; place(sel); };

// Keeps items on the same spot of the page when the page is rotated 90 degrees clockwise.
export async function rotateItems(p) {
  const pg = await p.file.doc.getPage(p.idx + 1), v = pg.getViewport({ scale: 1, rotation: (pg.rotate + p.rot) % 360 });
  for (const it of p.items) {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, w = it.w * v.width / v.height, h = it.h * v.height / v.width;
    it.w = w; it.h = h; it.x = 1 - cy - w / 2; it.y = cx - h / 2;
  }
}

const map = (u, v, R, W, H) => R === 90 ? [v * W, u * H] : R === 180 ? [(1 - u) * W, v * H] : R === 270 ? [(1 - v) * W, (1 - u) * H] : [u * W, (1 - v) * H];
const clean = s => [...s].map(ch => { const c = ch.charCodeAt(0); return c > 255 || (c > 126 && c < 161) ? '?' : ch; }).join('');

// Draws a page's items onto the exported pdf-lib page, converting preview fractions to PDF points.
export async function drawItems(out, pg, p, font) {
  const { rgb, degrees } = PDFLib, R = ((pg.getRotation().angle % 360) + 360) % 360, { width: W, height: H } = pg.getSize();
  const vw = R % 180 ? H : W, vh = R % 180 ? W : H;
  for (const it of p.items) {
    if (it.type === 'image') {
      const img = it.mime === 'image/png' ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes);
      const [x, y] = map(it.x, it.y + it.h, R, W, H);
      pg.drawImage(img, { x, y, width: it.w * vw, height: it.h * vh, rotate: degrees(R), opacity: it.opacity });
    } else if (it.type === 'shape') {
      const c = it.color, col = rgb(parseInt(c.slice(1,3),16)/255,parseInt(c.slice(3,5),16)/255,parseInt(c.slice(5,7),16)/255);
      const [x,y] = map(it.x,it.y+it.h,R,W,H);
      pg.drawRectangle({ x, y, width:it.w*vw, height:it.h*vh, rotate:degrees(R),
        color:it.shape === 'highlight' ? col : undefined,
        opacity:it.shape === 'highlight' ? it.opacity : 1,
        borderColor:it.shape === 'rectangle' ? col : undefined,
        borderWidth:it.shape === 'rectangle' ? 2 : 0 });
    } else {
      const c = it.color, col = rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);
      it.text.split('\n').forEach((ln, i) => {
        const [x, y] = map(it.x, it.y + (0.93 + 1.2 * i) * it.size / vh, R, W, H);
        pg.drawText(clean(ln), { x, y, size: it.size, font, color: col, rotate: degrees(R) });
      });
    }
  }
}
