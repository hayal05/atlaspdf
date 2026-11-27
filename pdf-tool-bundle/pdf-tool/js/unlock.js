const QPDF_VERSION = '0.3.1';
const QPDF_MODULE_URL = `https://esm.sh/@neslinesli93/qpdf-wasm@${QPDF_VERSION}`;
const QPDF_WASM_URL = `https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@${QPDF_VERSION}/dist/qpdf.wasm`;

let qpdfPromise;
let qpdfDiagnostics = '';

async function getQpdf() {
  if (!qpdfPromise) {
    qpdfPromise = (async () => {
      const imported = await import(QPDF_MODULE_URL);
      const createModule = imported.default || imported;
      if (typeof createModule !== 'function') {
        throw new Error('The PDF unlock engine could not be initialized.');
      }
      return createModule({
        noInitialRun: true,
        locateFile: path => path.endsWith('.wasm') ? QPDF_WASM_URL : path,
        print: message => { qpdfDiagnostics += String(message) + '\n'; },
        printErr: message => { qpdfDiagnostics += String(message) + '\n'; }
      });
    })().catch(error => {
      qpdfPromise = null;
      throw error;
    });
  }
  return qpdfPromise;
}

export async function unlockPdf(file, onProgress) {
  if (!(file instanceof File) || (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf'))) {
    throw new Error('Choose a valid PDF file.');
  }
  if (file.size > 150 * 1024 * 1024) {
    throw new Error('This PDF is larger than the 150 MB limit.');
  }

  onProgress?.('Loading automatic PDF unlock engine…');
  const qpdf = await getQpdf();
  const inputPath = '/atlaspdf-unlock-input.pdf';
  const outputPath = '/atlaspdf-unlocked-output.pdf';

  try {
    onProgress?.('Reading your PDF…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      throw new Error('The selected file does not appear to be a valid PDF.');
    }

    qpdf.FS.writeFile(inputPath, bytes);
    qpdfDiagnostics = '';
    onProgress?.('Automatically removing PDF restrictions…');
    let exitCode;
    try {
      // QPDF uses the empty password by default. This removes owner-password
      // permissions without asking the user to enter a password.
      exitCode = qpdf.callMain(['--decrypt', inputPath, outputPath]);
    } catch (error) {
      if (error?.name !== 'ExitStatus' && !String(error).includes('ExitStatus')) throw error;
      exitCode = error.status;
    }

    let output;
    try { output = qpdf.FS.readFile(outputPath); } catch { output = null; }
    if ((exitCode !== 0 && exitCode !== 3 && exitCode !== undefined) || !output?.length) {
      const detail = qpdfDiagnostics.toLowerCase();
      if (detail.includes('invalid password') || detail.includes('password')) {
        throw new Error('This PDF requires a document password. AtlasPDF cannot determine or recover an unknown password.');
      }
      throw new Error('AtlasPDF could not automatically unlock this PDF. It may be damaged or use unsupported encryption.');
    }

    onProgress?.('Preparing your unlocked PDF…');
    return new Blob([output.slice()], { type: 'application/pdf' });
  } finally {
    try { qpdf.FS.unlink(inputPath); } catch {}
    try { qpdf.FS.unlink(outputPath); } catch {}
  }
}
