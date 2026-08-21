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

## AI text recommendation (optional, Vercel-only)

Every free-text field (Project Description, Scope & Deliverables, Service
item name/detail, Revision Terms, Exclusions, Payment Terms, Notes) has a
"✨ Rekomendasi" button that suggests a polished, professional English
rewrite — translating from Indonesian if that's what you typed. It always
shows the suggestion first; nothing replaces your text until you click
"Pakai teks ini".

This is the one feature that needs a live backend, so it only works on a
Vercel deployment — it fails gracefully with a clear message when the app
is opened via a plain local static server (everything else still works
100% offline). To enable it on your deployment:

1. Get a free API key at [Google AI Studio](https://aistudio.google.com/apikey)
   (no credit card required for the free tier).
2. In the Vercel project's **Settings → Environment Variables**, add
   `GEMINI_API_KEY` = your key, for both **Production** and **Preview**.
3. Redeploy (or just push — it happens automatically).

The key is only ever used server-side by `/api/rewrite.js` **at the repo
root** (not inside this folder) — Vercel's zero-config Functions only auto-detect
an `api/` directory at the project root, so that's where it has to live for
`/api/rewrite` to resolve correctly. It's never sent to the browser.

## Files

- `index.html` — app shell (editor controls + preview markup)
- `styles.css` — app chrome and the document's visual design system
- `print.css` — print-only rules (`@page`, chrome hiding, pagination)
- `app.js` — state model, rendering, persistence, and export logic
- `vendor/html2canvas.min.js` — MIT-licensed, used only for PNG export

See also `/api/rewrite.js` at the repository root — the Vercel serverless
function powering the optional AI text recommendation feature (see above).
