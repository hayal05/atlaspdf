import * as pdfjs from '../vendor/pdf.min.mjs';
import { drawItems } from './editor.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

let nextId = 0;

// Reads PDF files; returns page entries {file, idx, rot} plus readable errors.
export async function loadFiles(files, progress) {
  const pages = [], errors = [];
  for (const [k, f] of files.entries()) {
    progress?.(`Loading ${f.name} (${k + 1}/${files.length})…`);
    await new Promise(r => setTimeout(r));
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { errors.push(`${f.name}: not a PDF`); continue; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const file = { id: nextId++, name: f.name, bytes, doc };
      for (let i = 0; i < doc.numPages; i++) pages.push({ file, idx: i, rot: 0 });
    } catch (e) {
      errors.push(e.name === 'PasswordException' ? `${f.name}: password-protected, can’t be opened` : `${f.name}: couldn’t be read (damaged file?)`);
    }
  }
  return { pages, errors };
}

// Builds one PDF from the ordered page list.
export async function exportPdf(pages, options = {}) {
  const { PDFDocument, degrees } = PDFLib;
  const out = await PDFDocument.create(), src = new Map();
  let font;
  for (const p of pages) {
    await new Promise(r => setTimeout(r));
    if (!src.has(p.file.id)) src.set(p.file.id, await PDFDocument.load(p.file.bytes));
    const [pg] = await out.copyPages(src.get(p.file.id), [p.idx]);
    if (p.rot) pg.setRotation(degrees((pg.getRotation().angle + p.rot) % 360));
    if (p.crop) {
      const { width, height } = pg.getSize();
      const left = Math.max(0, Math.min(0.4, p.crop.left || 0));
      const right = Math.max(0, Math.min(0.4, p.crop.right || 0));
      const top = Math.max(0, Math.min(0.4, p.crop.top || 0));
      const bottom = Math.max(0, Math.min(0.4, p.crop.bottom || 0));
      if (left + right < 0.9 && top + bottom < 0.9) {
        pg.setCropBox(left * width, bottom * height, width * (1 - left - right), height * (1 - top - bottom));
      }
    }
    out.addPage(pg);
    if (p.items?.length) { font ||= await out.embedFont(PDFLib.StandardFonts.Helvetica); await drawItems(out, pg, p, font); }
    if (options.watermark?.text && (options.watermark.scope !== 'selected' || options.watermark.selectedIndex === out.getPageCount() - 1)) {
      font ||= await out.embedFont(PDFLib.StandardFonts.Helvetica);
      const box = pg.getCropBox();
      const label = clean(options.watermark.text).slice(0, 80);
      const size = Math.max(12, Math.min(96, Number(options.watermark.size) || 36));
      const width = font.widthOfTextAtSize(label, size);
      const hex = options.watermark.color || '#777777';
      const color = rgb(parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255);
      pg.drawText(label, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - size) / 2,
        size, font, color, opacity: Math.max(0.05, Math.min(1, Number(options.watermark.opacity) || 0.25)),
        rotate: degrees(Number(options.watermark.rotation) || 0) });
    }
    if (options.pageNumbers) {
      font ||= await out.embedFont(PDFLib.StandardFonts.Helvetica);
      const box = pg.getCropBox();
      const label = String((options.startNumber || 1) + out.getPageCount() - 1);
      const size = 10, labelWidth = font.widthOfTextAtSize(label, size);
      const pos = options.numberPosition || 'bottom-center';
      const x = pos.endsWith('left') ? box.x + 18 : pos.endsWith('right') ? box.x + box.width - labelWidth - 18 : box.x + (box.width - labelWidth) / 2;
      const y = pos.startsWith('top') ? box.y + box.height - 24 : box.y + 12;
      pg.drawText(label, { x, y, size, font, color: PDFLib.rgb(0.28, 0.32, 0.4) });
    }
  }
  return out.save();
}

export function download(bytes, name = 'merged.pdf') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
