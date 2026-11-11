# Documents spec package (`@besidka/doc-renderer`, D-2)

Status: implemented by BES-282, layer 1 of the native stack "documents"
(D-2, D-3, D-4, D-5, D-6). It is the shared contract and the security boundary
for every generated or provider-made PDF, DOCX, PPTX and XLSX. The library
choice is the D-1 decision record in `docs/chats/files-generation-plan.md`
(section "Document renderer decision record"); this page records what D-2
built on top of it and where it deviates from the ticket.

## Layout

`packages/doc-renderer`, workspace package, subpath exports only:

| Subpath | What | Weight (minified, gzip) |
| --- | --- | --- |
| `./spec` | Zod spec v1, `parseDocumentSpec`, `summarizeSpec`, bounds | 94 KB, almost all Zod (the app already ships it) |
| `./validate` | `validate(format, bytes, { spec? })`, `checkFormula`, ZIP reader | 11 KB plus `fflate` |
| `./zip` | `readZipSummary`, `readZipDirectory`, no dependencies | under 2 KB |
| `./render` | `render(spec, assets, options)` | docx 85 KB, pptx 135 KB, xlsx 27 KB, pdf 634 KB |
| `./stamp` | `stampDocument`, `stampOoxml`, `stampPdf` | pdf-lib for PDF |
| `./provenance` | marking constants, builders and readers | tiny |
| `./csv` | `escapeCsvCell`, `toCsvRow` | tiny |

`app/utils/knowledge-zip.ts` now re-exports `readZipSummary` from `./zip`, so
there is one copy of the central-directory reader.

No Nuxt, h3, DOM, `cloudflare:workers`, `eval`, `new Function` or network code
is allowed in `src/`; `tests/unit/packages/doc-renderer/package-boundaries.spec.ts`
enforces it, plus the D-1 library pins and that `./spec`, `./validate` and
`./zip` never pull a renderer library.

## `render()` contract

```ts
render(spec, assets: Map<fileId, { bytes, mediaType }>, options?: {
  provenance?: { createdVia, model?, aiGenerated? }, // default: chat, AI
  fonts?: { regular, bold, italic },                  // required for PDF
  createdAt?: string,                                 // default: pinned date
}) => { bytes, mediaType, extension, stats, warnings }
```

- Fonts are never read by the package. Callers pass the Noto Sans subset
  (`packages/doc-renderer/fonts/`, OFL 1.1, Latin plus Cyrillic, 218 KB). The
  PDF always uses Noto Sans; `theme.font` only changes DOCX, PPTX and XLSX.
- `render()` re-checks the bounds, resolves images (PNG and JPEG only, 5 MB
  each, 20 MB total, header dimensions and a bounded IDAT inflate), renders,
  then runs `validate()` on its own output and throws `validation_failed`
  when it does not pass.
- `RenderError.code`: `invalid_spec`, `missing_asset`, `unsupported_image`,
  `image_too_large`, `assets_too_large`, `font_missing`, `page_limit`,
  `render_failed`, `validation_failed`.

## Spec bounds

Zod enforces per-field limits with JSON paths (`$.blocks[3].runs[0].link.href`,
first 10 issues). `checkSpecBounds` adds: 100,000 cells (headers included),
60 slides, 20 images, 200 estimated pages. The serialized limit is 200,000
characters, and 2,000,000 for XLSX (see deviations). Objects are strict:
unknown keys are errors. Text rejects control characters except line breaks.
Links accept `https:` and `mailto:` only, with no whitespace, backslash or
angle brackets.

## Validation codes

Stable strings, one table in `src/validate/rules.ts` for every denylist and
allowlist (never duplicate them).

- Common: `empty`, `too_large`, `validation_error`.
- ZIP: `zip_invalid`, `zip64`, `zip_too_many_entries`, `zip_entry_too_large`,
  `zip_total_too_large`, `zip_ratio`, `zip_unsafe_path`, `zip_duplicate_entry`,
  `zip_encrypted`, `zip_method`, `zip_size_mismatch`, `zip_corrupt`.
- XML and OOXML: `xml_doctype`, `xml_encoding`, `xml_malformed`,
  `xml_part_too_large`, `ooxml_missing_part`, `ooxml_format_mismatch`,
  `ooxml_macro`, `ooxml_active_x`, `ooxml_embedding`, `ooxml_custom_ui`,
  `ooxml_web_extension`, `ooxml_ole_object`, `ooxml_external_link`,
  `ooxml_data_connection`, `ooxml_external_relationship`,
  `ooxml_attached_template`, `ooxml_alt_chunk`, `docx_field_instruction`,
  `pptx_action`.
- XLSX: `formula_not_allowed`, `formula_syntax`, `formula_undeclared`,
  `xlsx_formula_type`.
- PDF: `pdf_header`, `pdf_truncated`, `pdf_malformed`, `pdf_encrypted`,
  `pdf_unsupported_filter`, `pdf_inflate_limit`, `pdf_too_many_pages`,
  `pdf_javascript`, `pdf_launch`, `pdf_embedded_file`, `pdf_rich_media`,
  `pdf_xfa`, `pdf_submit_form`, `pdf_import_data`, `pdf_goto_remote`,
  `pdf_open_action`, `pdf_additional_actions`, `pdf_media`, `pdf_uri_scheme`.

How the checks work, because the obvious implementations are bypassable:

- ZIP: central directory read first (entries, sizes, ratio for entries over
  100 KiB, names, duplicates, encryption, method, local header agreement, no
  data after the end record), then each XML part is inflated through the
  streaming `Inflate` in 4 KiB slices with a cap equal to the declared size.
  Declared sizes are a pre-filter only; a forged size ends in
  `zip_size_mismatch` after at most one slice of overshoot. XML parts are
  capped at 24 MiB each and 64 MiB together.
- XML: one linear, quote-aware tokenizer (`src/validate/xml.ts`), not regular
  expressions. Prefixes are ignored, CDATA is text, entities are decoded in
  one pass, DOCTYPE and ENTITY are refused, BOM-less UTF-16 and invalid UTF-8
  are refused. Every check runs on every XML part whatever its path.
- DOCX fields: `fldChar` runs and `fldSimple` are reassembled, so a name split
  across runs is still found.
- XLSX formulas: tokenizer allowlist (`formula.ts`), also on defined names,
  data validations and `x14` formulas. With `{ spec }`, every `<f>` must sit on
  a cell the spec declared as a formula.
- PDF: a structural scan, not a byte grep. Names are decoded (`/J#53`), object
  streams are inflated under a 50 MiB cap and scanned, `/URI` strings must
  start with `https:` or `mailto:` (hex strings are decoded, indirect values
  refused), page objects are counted. Streams are skipped by `endstream`, so
  object-looking bytes inside stream data are not parsed.

Residual PDF risk: the scan is linear and ignores the cross-reference table.
A polyglot that hides an object where only a viewer's xref points is not
modelled. Provider-made PDFs that the app cares about should go through
`stampDocument`, which rewrites the file with pdf-lib.

## Provenance

Three states from `validate()`: `ai` (IPTC `DigitalSourceType`
trainedAlgorithmicMedia or composite), `channel-only` (a `createdVia` property
without the AI source type, for MCP content the caller wrote) and `missing`.

- OOXML: `docProps/custom.xml` with `Iptc4xmpExt:DigitalSourceType`,
  `Iptc4xmpExt:AISystemUsed` (model id only, 200 characters),
  `besidka:generator`, `besidka:createdVia`. It only counts when the root
  relationships point to it. The pre-check wording (mirror the image XMP)
  superseded the ticket's `besidka:digitalSourceType` names; the reader still
  accepts that spelling.
- PDF: an uncompressed UTF-8 XMP stream as the catalog `/Metadata`, with IPTC,
  Besidka and Dublin Core (title, language) blocks, plus `/Lang` and the Info
  title. Residual: an orphan metadata stream also reads as marked.
- `stampDocument(format, bytes, options)` validates, adds the mark without
  re-rendering (OOXML re-zipped with fixed entry times, PDF rewritten by
  pdf-lib), validates again and returns the original bytes when the AI mark is
  already present. D-7 and D-8 use it for provider files.
- No prompt, user id or chat id is ever written.

## Determinism

Every OOXML output goes through `stampOoxml`: it pins `dcterms:created` and
`dcterms:modified` (`2026-01-01T00:00:00Z` unless `createdAt` is passed), writes
title and language into `core.xml`, re-zips with a fixed entry time and keeps
entry order. DOCX also renumbers `wp:docPr` ids and relationship ids (docx
uses module-level counters and random ids). PDF uses `updateMetadata: false`
and fixed dates. Same spec gives byte-identical output in Node and in a
Chromium Web Worker (checked by `pnpm run smoke:documents`); PDF goldens are
still best rendered in Node because D-1 saw a 12-byte difference in WebKit.

## Notices

`pnpm run notices:documents` (`scripts/third-party-notices.mjs`) bundles the
package entry points twice with esbuild (client conditions and Worker
conditions, `node:fs` and `node:https` stubbed as in the D-1 spike, minified,
`legalComments: 'eof'`), collects every package in the bundle graph with its
licence text, and merges `packages/doc-renderer/notices/inlined.json` for code
the graph cannot see (fontkit's Brotli decoder under Apache-2.0,
`base64-arraybuffer`, `events`, the `fflate` and `nanoid` inlined in `docx`,
the JSZip MIT election, the Noto Sans OFL text). The committed
`packages/doc-renderer/THIRD_PARTY_NOTICES.txt` is asserted equal to a fresh
run by `notices.spec.ts`, so a dependency bump forces regeneration; the same
spec asserts the `/*! */` banners (JSZip, tslib, docx) survive the minified
build. D-3 and D-4 point the script at their real Worker and Vite graphs and
serve the file from the main app (pre-check Q1).

## Browser smoke

`pnpm run smoke:documents` bundles `smoke/worker.js` for the browser, runs the
four reference specs in a module Web Worker in headless Chromium, validates
them there and compares the bytes with a Node render.

## Deviations from the ticket

- `render(spec, assets, options)` has a third argument for provenance, fonts
  and `createdAt`; the package never reads files.
- Spec serialized limit is 2,000,000 characters for XLSX: 100,000 cells cannot
  fit 200,000 characters, and the D-1 worst case needs about 900,000. The
  200-page text worst case of D-1 (four copies of `report-pdf.json`) exceeds
  200,000 characters too, so 200 pages are reachable only with page breaks,
  tables or images.
- WebP is not accepted: `docx`, `pdf-lib` and `pptxgenjs` cannot embed it.
  Callers convert to PNG or JPEG.
- XLSX provenance, title and dates use the shared OOXML stamp, not a
  `write-excel-file` `features` hook; DOCX does not use `customProperties`.
  One code path, byte-stable output.
- Formula cells are written without the leading `=` (the library copies the
  value as written; `=` inside `<f>` is not valid OOXML) and `IFS`, `XLOOKUP`,
  `CONCAT` get the `_xlfn.` prefix Excel needs. `cached` values are accepted
  by the spec but not written, so viewers that do not recalculate show empty
  formula cells.
- Currency columns use `#,##0.00` without a symbol: the spec has no currency
  code.
- `validate()` is synchronous; it uses its own PDF scanner instead of loading
  `pdf-lib`.
- The reference specs were converted from the D-1 shape (`version: 0`) to spec
  v1, one sheet name changed (`/` is forbidden) and `showcase.json` was added.

## Not verified

Opening goldens in Word, Excel, PowerPoint, Keynote, Numbers, Google import
and Acrobat; Firefox and WebKit Web Worker runs; production Worker CPU and
memory. LibreOffice 26.8 converts the DOCX, PPTX and XLSX goldens and Quick
Look renders the PDFs.
