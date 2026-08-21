# Quotation & Invoice Builder

A local-first, single-page tool for producing polished quotations and invoices
for freelance motion design / 3D / creative production work. No backend, no
build step, no login — just static files and `localStorage`.

## Run it

Open `index.html` through any simple local static server (opening the file
directly with `file://` will block the PDF/PNG export flow in some browsers,
so a server is recommended):

```bash
cd quotation-builder
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

- **Left panel** — edit document type, client/project info, services & fees,
  scope, terms, and section on/off toggles.
- **Right panel** — a live A4 preview that always matches what gets exported.
- **Export PDF** uses the browser's native print dialog (`window.print()`)
  with dedicated `print.css` / `@page` rules — choose "Save as PDF" and turn
  off headers/footers in the print dialog for the cleanest result.
- **Export PNG** renders the current document via `vendor/html2canvas.min.js`
  (bundled, no network needed) at 2x resolution. Documents taller than one
  A4 page export as multiple numbered PNG files.
- **Drafts** autosave to `localStorage` as you type. Use **Save** to keep a
  named copy in the local saved-documents list (via the **Saved** picker),
  **Duplicate** to branch off the current document, **New** to start fresh,
  and **Reset** to clear the current document back to defaults.

Everything lives in your browser's local storage on this machine only —
nothing is sent anywhere.

## Files

- `index.html` — app shell (editor controls + preview markup)
- `styles.css` — app chrome and the document's visual design system
- `print.css` — print-only rules (`@page`, chrome hiding, pagination)
- `app.js` — state model, rendering, persistence, and export logic
- `vendor/html2canvas.min.js` — MIT-licensed, used only for PNG export
