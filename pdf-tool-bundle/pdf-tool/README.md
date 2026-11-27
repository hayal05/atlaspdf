# PDF Tool

Browser-only PDF workspace: merge, organize pages, insert pictures/text, compress, and unlock PDFs.
Files are processed on the user's device. Hosted as a Render Static Site.

## Libraries (self-hosted in vendor/)
- pdf-lib 1.17.1
- PDF.js (pdfjs-dist) 4.10.38

## Render settings
- Type: Static Site
- Build command: (empty)
- Publish directory: .

## Unlock PDF
- Select a PDF and AtlasPDF automatically attempts to remove its security; no password field or password prompt is shown.
- Uses QPDF compiled to WebAssembly (`@neslinesli93/qpdf-wasm`) on demand.
- PDF bytes are processed locally in the browser and are not uploaded to AtlasPDF.
- PDFs with owner-password restrictions and an empty user password can be unlocked automatically.
- A PDF encrypted with a non-empty open/document password cannot be decrypted without that password. AtlasPDF does not crack or recover unknown passwords.
- The QPDF JavaScript/WASM engine is fetched from public CDNs the first time the tool is used.
