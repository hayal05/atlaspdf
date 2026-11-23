import * as pdfjs from '../vendor/pdf.min.mjs';

// Each preset lists the passes to try, best quality first. "Smallest" keeps stepping down
// until the file is TARGET smaller or the quality floor (60 DPI, JPEG 40%) is reached.
const PRESETS = {
  High: [{ dpi: 150, q: 0.85 }],
  Medium: [{ dpi: 110, q: 0.7 }],
  Smallest: [{ dpi: 110, q: 0.7 }, { dpi: 85, q: 0.55 }, { dpi: 72, q: 0.45 }, { dpi: 60, q: 0.4 }],
};
const TARGET = 0.7;
const toBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
export const fmt = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// Renders every page to a JPEG and rebuilds the PDF from those images (text becomes part of the image).
async function flatten(bytes, { dpi, q }, progress) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out = await PDFLib.PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    progress(i, doc.numPages);
    await new Promise(r => setTimeout(r));
    const pg = await doc.getPage(i), v1 = pg.getViewport({ scale: 1 });
    const v = pg.getViewport({ scale: Math.min(dpi / 72, 6000 / Math.max(v1.width, v1.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(v.width); c.height = Math.round(v.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: v }).promise;
    const jpg = await out.embedJpg(new Uint8Array(await (await toBlob(c, q)).arrayBuffer()));
    out.addPage([v1.width, v1.height]).drawImage(jpg, { x: 0, y: 0, width: v1.width, height: v1.height });
    pg.cleanup(); c.width = c.height = 0;
  }
  await doc.destroy();
  return out.save();
}

// Returns { bytes, report }. progress(text) is called with status text.
export async function compress(bytes, level, progress) {
  const orig = bytes.length;
  if (!PRESETS[level]) return { bytes, report: `Size: ${fmt(orig)} (original quality, nothing flattened).` };
  let best = null, pass = { dpi: 0 };
  for (const p of PRESETS[level]) {
    pass = p;
    const out = await flatten(bytes, p, (i, n) => progress(`Compressing ${dpi(p)} · page ${i}/${n}`));
    if (!best || out.length < best.bytes.length) best = { bytes: out, p };
    if (1 - best.bytes.length / orig >= TARGET) break;
  }
  if (best.bytes.length >= orig) {
    return { bytes, report: `Flattening wouldn’t make this file smaller (${fmt(orig)}). It’s probably mostly text or vector graphics, or already compact, so the original was kept.` };
  }
  const pct = Math.round((1 - best.bytes.length / orig) * 100);
  const note = pct >= TARGET * 100 ? '' : level === 'Smallest' ? ` Only ${pct}% was possible at the quality floor; this file doesn’t have much to cut.` : ` Try “Smallest” for a bigger reduction.`;
  return { bytes: best.bytes, report: `${fmt(orig)} → ${fmt(best.bytes.length)} (${pct}% smaller, ${dpi(best.p)}).${note} Pages are now images, so text can’t be selected.` };
}
const dpi = p => `${p.dpi} DPI, JPEG ${Math.round(p.q * 100)}%`;
