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
export async function exportPdf(pages) {
  const { PDFDocument, degrees } = PDFLib;
  const out = await PDFDocument.create(), src = new Map();
  let font;
  for (const p of pages) {
    await new Promise(r => setTimeout(r));
    if (!src.has(p.file.id)) src.set(p.file.id, await PDFDocument.load(p.file.bytes));
    const [pg] = await out.copyPages(src.get(p.file.id), [p.idx]);
    if (p.rot) pg.setRotation(degrees((pg.getRotation().angle + p.rot) % 360));
    out.addPage(pg);
    if (p.items?.length) { font ||= await out.embedFont(PDFLib.StandardFonts.Helvetica); await drawItems(out, pg, p, font); }
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
