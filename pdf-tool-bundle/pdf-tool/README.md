# PDF Tool

Browser-only PDF workspace: merge, organize pages, insert pictures/text, compress, and unlock password-protected PDFs.
Files never leave the user's device. Hosted as a Render Static Site.

## Libraries (self-hosted in vendor/)
- pdf-lib 1.17.1
- PDF.js (pdfjs-dist) 4.10.38

## Render settings
- Type: Static Site
- Build command: (empty)
- Publish directory: .

## Unlock PDF
- Uses QPDF compiled to WebAssembly (`@neslinesli93/qpdf-wasm`) on demand.
- PDF bytes and the supplied password are processed locally in the browser; neither is uploaded to AtlasPDF.
- Requires the correct document password. This tool does not crack or bypass unknown passwords.
- The QPDF JavaScript/WASM engine is fetched from public CDNs the first time the tool is used.
