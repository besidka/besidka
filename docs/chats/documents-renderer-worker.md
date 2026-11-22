# Document renderer Worker (`DOC_RENDERER`, D-3)

Status: implemented by BES-286, layer 2 of the native stack "documents" (D-2,
D-3, D-4, D-5, D-6). It hosts `@besidka/doc-renderer` (see
`docs/chats/documents-spec-package.md`) in a separate Worker that the app
reaches through an RPC service binding. The client render path (D-4) stays the
primary one for chat; this Worker is the authority for `validate()` and the
only path for MCP (D-5), research export and scheduled reports.

## Layout

| Piece | Where |
| --- | --- |
| Worker | `workers/doc-renderer` (`besidka-doc-renderer`, env `preview` is `besidka-doc-renderer-preview`) |
| RPC contract (types, `CREATED_VIA_VALUES`) | `workers/doc-renderer/src/contract.ts` |
| Plain functions (`getCapabilities`, `renderDocument`, `validateDocument`) | `workers/doc-renderer/src/renderer.ts` |
| `WorkerEntrypoint` and the 404 `fetch` | `workers/doc-renderer/src/index.ts` |
| Build shims (`node:fs`, `node:https`, `fflate`) | `workers/doc-renderer/src/shims/` |
| App helper | `server/utils/documents/renderer.ts` (auto-imported) |
| Binding | `DOC_RENDERER` in `wrangler.jsonc`: top level and `env.production` bind `besidka-doc-renderer`, `env.production.previews` binds `besidka-doc-renderer-preview` |
| Deploy | `deploy-satellites` in `.github/workflows/production.yml` |

The entrypoint class is a thin delegator over the plain functions so the unit
specs never need the `cloudflare:workers` module (the suite stub exports only
`env`).

## Contract

```ts
class DocRenderer extends WorkerEntrypoint {
  capabilities(): Promise<{ rendererVersion, specVersions, formats, maxOutputBytes, extract? }>
  render(request: { specVersion, spec, assets, provenance }): Promise<RenderResult>
  validate(request: { format, bytes, spec? }): Promise<ValidationResult>
  extract(request: { format, bytes, version?, maxTextBytes? }): Promise<ExtractResult>
}
```

- Nothing is thrown across the binding. Every failure is a value:
  `{ ok: false, code, detail?, issues? }` with `code` one of `spec_invalid`,
  `spec_version_unsupported`, `bounds_exceeded`, `asset_invalid`,
  `render_failed`, `output_invalid`. `validate` returns the package's own
  `{ ok: false, code, detail }`, plus `bad_request` and `spec_invalid` for
  malformed requests.
- Inputs are untrusted and re-checked: the spec version is compared to
  `SUPPORTED_SPEC_VERSIONS` before anything is parsed (an unsupported version
  never renders), the spec goes through `parseDocumentSpec`, assets are
  checked for count, size, media type and repeated ids, and the package
  re-reads the PNG and JPEG headers. `render()` validates its own output, and
  a failure there is `output_invalid`.
- The code mapping from the package: `invalid_spec` to `spec_invalid`;
  `missing_asset`, `unsupported_image`, `image_too_large`, `assets_too_large`
  to `asset_invalid`; `page_limit` to `bounds_exceeded`; `validation_failed`
  to `output_invalid`; `font_missing` and `render_failed` to `render_failed`
  with a fixed `detail`, because library messages could carry document text.
  A spec that Zod accepts but `parseDocumentSpec` refuses (serialized length,
  cell, slide, page and image bounds) is `bounds_exceeded`.
- `rendererVersion` is `<worker package version>+<doc-renderer package
  version>`. Bump the version of `workers/doc-renderer/package.json` when the
  Worker changes behavior.
- `fetch` returns 404 on every path. The Worker has no bindings, no vars, no
  routes and no triggers, and `workers_dev` and `preview_urls` are off; a spec
  asserts all of it. Notices are not served from here: they are a static file
  of the main app (D-2's collector).
- Fonts are three `Data` module imports of
  `packages/doc-renderer/fonts/*.ttf` (wrangler `rules`), so the Worker needs
  no asset binding.

### Payload bounds

The Worker enforces spec length (200,000 characters, 2,000,000 for XLSX, from
D-2), at most 20 assets, 5 MB per image and 20 MB in total, and 20 MiB of
output. RPC arguments and return values are each limited to 32 MiB; the worst
input (2 MB spec plus 20 MB of images) and the largest output (20 MiB) fit, so
the contract passes bytes. The D-1 advice to pass R2 keys or return a stream
does not apply: the Worker has no R2 binding by design, and the sizes stay
under the ceiling. If the bounds ever grow past it, return a `ReadableStream`.

## Build

`wrangler.jsonc` carries the three flags of the app (`nodejs_compat`,
`no_nodejs_compat_v2`, `nodejs_als`) and an `alias` block, repeated in
`env.preview` because wrangler does not inherit it:

- `node:fs` and `node:https` map to an empty module; `pptxgenjs` imports both
  but only uses them on Node file-path and URL-image paths the spec never
  reaches.
- `fflate` maps to `src/shims/fflate.ts`, which re-exports the real browser
  build and replaces the callback `zip()` with `zipSync()`. Without it
  `write-excel-file` fails on 100,000 cells with `Worker is not defined`.
  The shim reaches the real module by a relative path into
  `workers/doc-renderer/node_modules/fflate`, because esbuild applies the alias
  to every import of the package name, the shim's own included. That is why
  `fflate` is a direct dependency of the Worker.

`wrangler deploy --dry-run` reports 4,784 KiB uploaded (1,237 KiB gzip) and "No
bindings found" with the workbook map (Worker 1.2.0). The map added about
76 KB of first-party code (19 KB gzip; 39 KB and 13 KB minified), measured by
bundling `src/renderer.ts` of the base commit and of the branch with the
libraries external. Run `wrangler deploy` for this directory with
`--env preview` for the preview Worker; a bare `wrangler deploy` prints a
warning about the missing `--env`, which is expected for the production Worker.

## Limits and CPU

`limits.cpu_ms` is 15000, from the D-1 record (about 4x the slowest render
under memory pressure). Measured on 2026-11-11 with the D-1 reference specs
and the D-2 bound cases, through `renderDocument` (render plus the package's
own validation), Node 24.18 on an Apple Silicon laptop, `process.cpuUsage()`,
median of 5 runs, and wall time of the RPC call through a real service
binding in local `workerd` (median of 3):

| Case | Output | Node CPU (median, max) | Local `workerd` RPC wall |
| --- | --- | --- | --- |
| DOCX report, 12 pages | 22.5 KB | 62 ms, 219 ms | 44 ms |
| PDF, 51 pages, Cyrillic | 155.7 KB | 466 ms, 662 ms | 354 ms |
| PPTX, 30 slides | 113.4 KB | 74 ms, 133 ms | 34 ms |
| XLSX, 10,016 cells | 67.1 KB | 92 ms, 190 ms | 59 ms |
| DOCX showcase | 13.2 KB | 15 ms, 35 ms | 13 ms |
| PDF, 200 pages | 299.7 KB | 951 ms, 1,069 ms | 828 ms |
| DOCX, 200 paragraphs and page breaks | 152.8 KB | 75 ms, 98 ms | 54 ms |
| PPTX, 60 slides | 212.0 KB | 95 ms, 118 ms | 58 ms |
| XLSX, 99,980 cells | 595.1 KB | 846 ms, 912 ms | 584 ms |

The slowest case, the 200-page PDF and the 100,000-cell workbook, uses about
7 percent of the limit. The maximum column includes warm-up runs; a cold
isolate in production will look like it. The 200-page
PDF is built from 200 paragraphs of varied Cyrillic text plus page breaks
because the serialized limit caps plain text well below 200 pages (see the D-2
deviations). The DOCX case needs varied text for another reason: 200 identical
paragraphs make `document.xml` compress better than 100:1 and the validator
rejects the file with `zip_ratio` (reported as `render_failed`). Real prose does
not.

Not measured: production CPU. Run `wrangler tail besidka-doc-renderer
--format json` while a worst-case spec renders and read `cpuTime`.

## Spec version negotiation

`renderDocument` in the app helper calls `capabilities()` (cached five minutes
in module scope; a failed call is not cached) and answers
`spec_version_unsupported` when `spec.specVersion` is not in `specVersions`,
without calling `render`. The Worker repeats the check, so a caller that skips
the helper still cannot render an unknown version. `getRenderFailureStatus`
maps a failed result to HTTP: 503 for chat on `spec_version_unsupported` (the
client render still works), 422 for the other channels, 422 for `spec_invalid`,
`bounds_exceeded` and `asset_invalid`, 500 otherwise. Specs stay additive
(`specVersion: 2` next to 1), so a preview that binds an older renderer keeps
working for version 1.

### Extract version negotiation (workbook map)

PR previews and the long-lived preview bind one shared preview renderer that
is deployed from `main`, so app and renderer versions differ for days. The
rules:

- `capabilities().extract.version` stays 1. An app built before the map
  treats any other value as `renderer_unavailable`, which would stop
  `.docx` and `.pptx` extraction too, so the new version is announced in an
  additive field, `extract.versions: [1, 2]`.
- A request without `version`, or with 1, gets the version 1 answer exactly
  as before (the Worker spec compares it to `extractOfficeText(bytes, format)`
  with `toEqual`, `maxTextBytes` ignored). An old app therefore keeps working
  against a renderer redeployed from this branch. Version 2 asks for the
  workbook map for `.xlsx` and is answered as version 1 for `.docx` and
  `.pptx`; `maxTextBytes` is clamped to 16 KiB..1 MiB. An unknown version is
  `unsupported_version`.
- The app (`extractOfficeText` in `server/utils/documents/renderer.ts`)
  sends version 2 only when `offersWorkbookMap(capabilities)` is true, and the
  plain version 1 request otherwise, so a new app against an old renderer
  gets version 1 text. The caller trusts the marker in the result
  (`workbookMap` present), not what it asked for: a stale capabilities cache
  across a renderer deploy can only make it store version 1 and read the file
  again later. The log block gains `extractVersion` and `workbookMap`.
  `docs/files.md` ("Spreadsheets as a workbook map") says what is stored and
  what is read again.

## App helper

`server/utils/documents/renderer.ts`:

- `getDocumentRenderer()` reads `env.DOC_RENDERER` from `cloudflare:workers`
  (safe in background code, no `useEvent()`). A missing binding throws
  `createError` 503, message "Document rendering is unavailable", why
  "DOC_RENDERER binding missing". The `documents` and `documents.mcp` registry
  entries list `requires.bindings: ['DOC_RENDERER']`, so the feature evaluator
  reports them off where the binding is absent.
- `renderDocument(request, logger)`, `validateDocumentBytes(request, logger)`
  and `getRendererCapabilities(logger?)`. A binding call that rejects (renderer
  not running, network) becomes the same 503 with why "The DOC_RENDERER call
  failed" and a message-free error summary in the log.
- One wide-event block per operation, `attributes.documents.renderer.<operation>`
  (`capabilities`, `render`, `validate`, so a render after a capabilities fetch
  does not overwrite it): `operation`, `format` (only `pdf`, `docx`, `pptx`,
  `xlsx`), `ok`, `code`, `durationMs`, `bytes`, `rendererVersion`. Never spec text, titles, file ids or asset bytes;
  a spec asserts it. `detail` and `issues` of a failed result can echo a file
  id or a key name from the spec; callers (D-4, D-5) must not log them or pass
  them to a client verbatim without checking. The Worker itself writes no logs at all (no `console` in
  its sources, asserted), so Workers Logs hold only the invocation records.

## Office text extraction

BES-370, layer 1 (Worker version 1.1.0). `extract` reads the text of a user's DOCX, XLSX or PPTX so a
later layer can send it to models that cannot take Office files. Nothing calls
it yet: it has no user-visible effect. The Worker still holds no user-data
binding; it receives bytes and returns text.

```ts
extract({ format: 'docx' | 'xlsx' | 'pptx', bytes }): Promise<{
  status: 'ready' | 'empty' | 'too_large' | 'failed'
  text: string            // Markdown, at most 1 MiB of UTF-8
  truncated: boolean
  stats: { inputBytes, entries, textBytes, paragraphs?, tables?, sheets?,
           sheetsTotal?, slides?, slidesTotal?, truncations: string[] }
  errorCode?: string
}>
```

The code is `packages/doc-renderer/src/extract/` (export `./extract`, only
`fflate` as a dependency). It reuses the capped ZIP directory reader, the
streaming inflater and the XML tokenizer of `./validate`; it adds no parser
library. Nothing is thrown: every problem is a status and a stable
`errorCode`.

### What comes out

| Format | Output |
| --- | --- |
| DOCX | Headings as `#` to `######`, resolved through the style names in `styles.xml` (`heading 1`, `Title`), so localized style ids work, through `basedOn` chains (at most 8 deep) and through `outlineLvl` on the style or the paragraph. Paragraphs, bulleted and numbered lists with nesting (counters per abstract numbering; a `num` with `lvlOverride/startOverride` gets its own counter that starts at the override), tables as Markdown tables (merged cells become empty cells, nested tables are flattened into their cell), hyperlink text. |
| XLSX | One `## Sheet: <name>` section per worksheet, in workbook order, holding CSV. Shared strings (an empty `<si/>` counts as an empty string, and a prefixed `<x:sst>` from Open XML SDK or ClosedXML writers is read), inline strings and the cached `<v>` of formulas are resolved. Numbers with a date number format (built-in ids 14-22, 27-36, 45-47, 50-58, or a custom code with date or time tokens) become ISO dates or times, with `date1904` honored; a time-only format is a time, and an elapsed format (`[h]:mm:ss`, `[mm]:ss`, `[s]`, built-in 46) is a duration such as `36:00:00`, not a date. The gaps between `<row r=...>` numbers are kept as empty lines (at most 20 in a row). Booleans are `TRUE` or `FALSE`. Merged cells show their value once, in the top-left cell. CSV, not a Markdown table, because it costs fewer tokens, keeps empty cells as consecutive commas and needs no header row. |
| PPTX | `## Slide N` per slide in `sldIdLst` order, then the title as `###`, body text (bullets for body placeholders and explicit bullets), tables as Markdown tables, and `Speaker notes: ...` from the notes body placeholder. |
| XLSX, version 2 | The workbook map (section "Workbook map" below): named ranges, then per sheet the heading facts, formulas as fill patterns, dropdowns and validation, conditional formatting, number formats, merged cells, notes, then the values as CSV with a row-number column and a column-letter header. The result carries `workbookMap`, the summary. |

The version 2 adapter (`extract/xlsx-map.ts`, `extract/xlsx-structure.ts`)
reads, for each sheet:

| XLSX source | Model field |
| --- | --- |
| `<sheet state>` in `workbook.xml` | `visibility` (`visible`, `hidden`, `very-hidden`) |
| `<definedName>` (not `hidden`, not `_xlnm.*`, at most 500) | `names` with `sheet` from `localSheetId` |
| `<dimension ref>` | `usedRange` |
| first `<sheetView>`, `<pane state="frozen|frozenSplit" xSplit ySplit>` | `frozenColumns`, `frozenRows` |
| `<f>` plain | `formula` |
| `<f t="shared" ref si>` master, followers `<f t="shared" si/>` | master text; each follower gets the master shifted by its distance (the fill Excel does). A master with structured or external references, or text the tokenizer cannot read whole, leaves followers as `formulaKind: 'shared-copy'` with `sharedFrom`, never a made-up text |
| `<f t="array" ref>`, `<f t="dataTable" r1 r2>` | `formulaKind: 'array'`, `arrayRange`; a data table as `TABLE(r1,r2)` |
| `s` style index through `cellXfs` `numFmtId` | `numberFormat`: the custom `numFmt` code or the built-in code for ids 1-4, 9-22, 37-40, 45-49, `built-in format N` for the locale-dependent ids, nothing for General |
| `<mergeCell ref>` | `mergedRanges` |
| `<dataValidation>` and `x14:dataValidation` (`x14:formula1/xm:f`, `xm:sqref`) | `validations`: `list` with a quoted list as `list-of-values`, any other source as `list-from-range`; `whole`, `decimal`, `date`, `time`, `textLength` with the operator; `custom`; `strict` is `showErrorMessage` with `errorStyle` stop; `promptTitle`, `prompt`, `error` as messages |
| `<conditionalFormatting>` and `x14:conditionalFormatting` | `conditionalRules`: `expression`, `cellIs`, the text rules, blanks, errors, duplicates, unique, `top10`, `aboveAverage`, `timePeriod`; no colors and no `dxf` |
| `colorScale`, `dataBar`, `iconSet` rules (main section only) | counted in `notRead` |
| `<hyperlink>` | counted |
| sheet rels: legacy `comments` part | `notes` (a threaded-comment placeholder is cut to its text and marked `(threaded)`) |
| sheet rels: `drawing` then its `chart` and `image` rels, `pivotTable` | counted |

Not read at all: cell styles other than the number format, colors, fonts,
column widths, row heights, hidden rows and columns, outline levels, tables
(`tableParts`), sparklines, slicers, threaded comment parts, the print
setup, macros (refused before reading), external links and the calculation
chain.

Limits (`EXTRACT_LIMITS`, overridable per call): 30 MiB input, 1 MiB of text,
5,000 ZIP entries, 150 MiB of declared total and 50 MiB per entry, a 1000:1
ratio for entries over 1 MiB (the validator's 100:1 would reject sparse real
spreadsheets), 50 sheets, 500 slides, 1,000 rows and 200 columns (also per
table in DOCX and PPTX), 2,000 characters per cell, 200,000 cells and 16 MiB
inflated per XML part. When a limit cuts the output,
`truncated` is `true`, `stats.truncations` names the limit and the text says
so: `[Truncated: the text limit was reached ...]` at the end for the 1 MiB cap,
and a marker after the sheet for rows, columns, cells and sheets. Empty rows
are skipped, not counted.

Two budgets count the work of one whole extraction, across every part:
64 MiB of inflated bytes (`inflatedBytesMax`) and 10,000,000 XML parser events
(`eventsMax`). When either runs out the result is `too_large` with
`extract_budget_exceeded`, never a partial text, so a file that is small in
bytes but huge in work (millions of empty `<c/>`, a notes part shared by every
slide) cannot reach the Worker's CPU limit. Measured by bisecting the limits,
the bench fixtures use 0.3 to 1.9 million events and 4 to 19 MiB inflated, and
the worst real-shaped files tried stay under 2.1 million events: 400,000 rows of
styled empty cells (read to the part cap) and a 200,000-string table read by
seven sheets that each reference strings an earlier sheet passed. Exhausting
the 10 million takes under a second of CPU. Other guards against small hostile files:
`gridSpan` and `ilvl` are clamped, a table is capped at 1,000 rows by 200
columns and stops being built once the output budget is spent, DOCX paragraphs
nested deeper than 64 are `ooxml_malformed`, a tag with more than 128
attributes is `xml_attributes`, slide ids and worksheet targets are de-duplicated
(a slide or worksheet is read once however often it is listed), and every
whitespace and number-format scan is a hand-written linear loop (the regular
expressions they replaced took 9 to 15 seconds on 80,000 spaces). Each of these
has a regression test in `tests/unit/packages/doc-renderer/extract-hostile.spec.ts`
that builds the file in memory and asserts the CPU time stays under a second.
`[Content_Types].xml` is read in full or the file is refused (`ooxml_malformed`),
because the macro check depends on all of it.

The ZIP limits come from `readZipDirectory(bytes, limits)`; its default
argument is the validator's own limits, so `validate()` is unchanged.

Version 2 keeps every limit above for the cells (same pass, same budgets;
formula-only cells count as cells) and adds an optional budget for what the
plain text never needed: the structure after `</sheetData>`, the comments
parts and the drawing relationships. Those reads run inside `readOptional()`
and charge `extraInflatedBytesMax` (160 MiB) and `extraEventsMax` (3,000,000)
instead of the main budgets; any failure in them, a spent budget, a corrupt
or malformed part, gives "not read" and never fails the file, so every
workbook version 1 reads is still `ready` in version 2 (a spec bisects the
main event budget to prove it). The tail of a sheet is found by
`readPartTail()`: one forward inflate of the part that searches the bytes as
they arrive for the end tag of `sheetData` (any prefix, carried across
chunks), drops everything before it, and keeps at most `tailBytesMax` (4 MiB)
after it. A row-capped 40 MB sheet therefore reaches its rules without being
held in memory. A part the optional budget cannot cover, or a tail cut at
4 MiB, is reported in the map as "Rules, merged cells and links stored after
the cell data were not read". Formula text is capped at 8,192 characters per
cell and 8 MiB per workbook (then `formulas_limit`). The map renderer adds its
own caps (`WORKBOOK_MAP_DEFAULTS`): 300 formula lines, 20 exception ranges per
line, 100 validation lines, 100 conditional lines, 12 literal variants listed
per grouped rule, 40 number formats with 20 ranges each, 200 merged ranges,
100 notes of 500 characters, 200 names, 1,000 characters per printed formula,
300 per message, 100 per sheet name. The app asks for at most 200 KB of map
(`maxTextBytes`, the inline cap) so the model always sees all of it.

### Rejected before reading

An OLE compound file header (`D0 CF 11 E0`) is refused: `ooxml_encrypted` when
it holds an `EncryptedPackage` stream, `legacy_office_format` otherwise (.doc,
.xls, .ppt). Macro-enabled content types and VBA parts are `ooxml_macro`. A
package whose main part content type is not the requested format is
`ooxml_format_mismatch`. ZIP64, encrypted entries, unsafe names, a size that
differs from the declaration and the limits above are `zip_*` codes; the five
limit codes (`file_too_large`, `zip_too_many_entries`, `zip_entry_too_large`,
`zip_total_too_large`, `zip_ratio`) are status `too_large`, everything else
`failed`.

### Memory and CPU

Each part is inflated as a prefix that starts at 1 MiB and grows fourfold only
while the reader still needs more, so a worksheet that needs 1,000 rows never
inflates its 40 MB tail, and a document stops at the text limit. The inflater
is kept between growths, so a larger prefix continues where the smaller one
stopped and every byte is inflated and charged once. A part over
16 MiB is read as far as that and flagged `part_limit`. Shared strings are
read as a pull stream of 1 MiB windows cut after the closing `si` tag (any
namespace prefix) and parsed with the XML tokenizer, up to the highest index
any sheet references; the position is kept between sheets, and the part is
read again from the start only when a later sheet needs a record that was
passed without being kept. Peak live memory stays near the input size plus the largest prefix
(an estimate of about 45 MiB for a 20 MB workbook; a capped 64 MiB V8 heap ran it without trouble); a Worker has 128 MiB.

Measured on 2026-11-12 with `scripts/bench/doc-renderer-extract.mjs` (Node
24.18, Apple Silicon, cold run then median of warm runs, V8 heap capped at 64
MiB, status asserted `ready`):

| Case | Input | Output | Node cold / warm | Local `workerd` RPC wall, cold / warm |
| --- | --- | --- | --- | --- |
| XLSX, 3 sheets of 57,000 rows, unique strings | 20.0 MiB | 460 KiB, `rows_limit` | 585 ms / 562 ms | 634 ms / 519 ms |
| XLSX, one dense sheet of 3,000 rows by 200 columns | 5.5 MiB | 1 MiB, `cells_limit`, `text_limit` | 563 ms / 521 ms | not run |
| PPTX, 300 slides with bullets, a table and notes | 4.2 MiB | 256 KiB | 93 ms / 77 ms | 114 ms / 87 ms |

The worst case is about 4 percent of the 15 s CPU limit. Re-measured after the
hardening above (the budgets, the linear scans, the kept inflater): Node cold
474 / 521 / 102 ms and local `workerd` cold 485 / 411 / 110 ms for the same three
cases, within noise of the table, on a loaded machine. A hostile 31 MB worksheet
of 1.5 million empty cells took 1.4 s through the binding, 6.8 MB included. The `workerd` column
is wall time of an HTTP request to a harness Worker that calls `extract`
through a service binding (`scripts/bench/doc-renderer-extract-harness/`, run
with `wrangler dev -c <harness> -c workers/doc-renderer/wrangler.jsonc`), so it
includes moving 20 MiB over the binding. Local `wrangler dev` does not enforce
`cpu_ms`, and `Date.now()` does not advance during synchronous work inside
workerd, so the figure is the caller's clock, not the Worker's CPU. Production
CPU and the 128 MiB memory limit are not measured: read `cpuTime` with
`wrangler tail besidka-doc-renderer --format json` on the first real upload.

Workbook map, measured on 2026-11-22 with the same script (new flags `--map`
for version 2 and `--structure` for a shared-formula column plus 50
conditional rules, a list validation and a merge after every sheet's cells),
Node 24.18, Apple Silicon, heap capped at 64 MiB, cold run then median of
three warm runs. Peak RSS is the whole child process (this machine's Node
baseline is about 135 MiB, so compare the columns, not the absolute values
with the table above):

| Case | Mode | Output | Cold / warm | Peak RSS |
| --- | --- | --- | --- | --- |
| XLSX, 3 sheets of 57,000 rows, 20.0 MiB | v1 | 460 KiB | 557 / 533 ms | 317 MiB |
| same | v2 map | 472 KiB | 1,405 / 1,399 ms | 307 MiB |
| same with structure, 19.6 MiB | v1 | 440 KiB | 547 / 536 ms | 333 MiB |
| same with structure | v2 map | 453 KiB | 1,375 / 1,208 ms | 295 MiB |
| XLSX, one sheet of 3,000 x 200, 5.5 MiB | v1 | 1,023 KiB | 520 / 472 ms | 274 MiB |
| same | v2 map | 1,022 KiB | 946 / 902 ms | 287 MiB |

The extra time is mostly the forward inflate that reaches each sheet's tail
(the dense sheet: 399 ms v1, 471 ms v2 with tails skipped, 732 ms v2 with
tails), the rest is building and rendering the model. The worst case is about
9 percent of the 15 s CPU limit, and memory does not grow because the tail
reader drops the bytes before `</sheetData>`. Production CPU is not measured.

### What is lost

Images, charts, drawings, text boxes and shapes in DOCX, SmartArt, comments,
tracked deletions, headers, footers, footnotes, cell colors and all
formatting. In XLSX version 1 also hidden-sheet flags, number formats other
than dates (a currency cell is its raw number) and formulas (only the cached
value); version 2 (the workbook map) carries those, and still loses colors,
fonts, charts, images, pivot tables (counted only), tables, sparklines,
hidden rows and columns, formulas and values after row 1,000 of a sheet, and
the structure of a sheet whose tail the optional budget could not reach.
Values are the cached results in the file: a formula cell without a cached
`<v>` (for example one written by Besidka's own XLSX writer, see below) has a
formula and no value. Newlines and control characters inside a value, a
formula or a note become spaces in the map, and backticks become `ˋ`, so a
formula with a backtick in a string literal is printed slightly changed. PPTX
text follows the shape order in the file, which is the z-order, not always
the reading order. Paragraph breaks inside a table cell become spaces.

Besidka-generated workbooks have formula cells without a cached value
because `write-excel-file` 4.1.1 writes a `"Formula"` cell as `<c><f>…</f></c>`
with no `<v>` and has no option to add one (its `cell.js` builds the element
from the formula alone); the spec's `cached` field is validated but has
nowhere to go. Writing it would mean post-processing the generated sheet XML
and zipping the package again, which is not a small change, so it is left as
is. Excel and Google Sheets recalculate on open; a model reading the file
back sees the formula in the map and no value for that cell.

### App helper

`extractOfficeText(request, logger?)` in `server/utils/documents/renderer.ts`
never throws, and tells retryable failures from terminal ones:

- `failed` with `renderer_unavailable` (retry later): a missing binding, a
  failed `capabilities()` call, a satellite deployed before `extract` existed
  (no `extract` entry, which is how a staggered deploy shows), one that does
  not list the format, or one whose `extract.version` the app does not know.
- `too_large` with `file_too_large`: the file is over
  `capabilities().extract.maxInputBytes`, answered before the call because an
  RPC payload over the limit throws.
- `failed` with `extract_crashed` (terminal): the call threw on a satellite
  that supports `extract` (CPU or memory exceeded, payload too large), which
  the same file will do again, so it must not stay retryable.

Layer 2 stores these states instead of failing the request that stored the
file. The log block
`attributes.documents.renderer.extract` holds `format`, `ok`, `status`, `code`,
`durationMs`, `bytes`, `textBytes`, `truncated`, `rendererVersion`,
`extractVersion` and `workbookMap`, never the text. `capabilities().extract`
carries `version` (`EXTRACT_VERSION`, kept at 1 so older apps keep
extracting), `versions` (`EXTRACT_VERSIONS`, `[1, 2]` since Worker 1.2.0; add a
version here when output changes, so the app can ask for it and re-extract),
`formats`, `maxInputBytes` and `maxTextBytes`. See "Extract version
negotiation" for how the app picks a version.

## Workbook map

BES-448. One text format for spreadsheets that every source fills: the XLSX
extractor (version 2 above) today, a Google Sheets adapter later. The code is
`packages/doc-renderer/src/workbook-map/`, exported as
`@besidka/doc-renderer/workbook-map`, which has no dependencies at all (a
boundary spec asserts it), so the app server can import it without the
extractor or the renderer libraries (`renderWorkbookMap` costs about 24 KB
minified, 9 KB gzip; the app imports only `WORKBOOK_MAP_TITLE` today).

### The model

```ts
interface WorkbookModel {
  names: Array<{ name: string, refersTo: string, sheet?: string }>
  sheets: WorkbookSheet[]          // in tab order, at most what was read
  sheetsTotal: number              // all sheets in the file
  hiddenNamesSkipped?: number
}

interface WorkbookSheet {
  name: string
  visibility: 'visible' | 'hidden' | 'very-hidden'
  usedRange?: string               // A1 range, for example 'A1:AN165'
  frozenRows: number               // 0 when nothing is frozen
  frozenColumns: number
  mergedRanges: string[]           // A1 ranges
  cells: WorkbookCell[]            // sparse; any order
  validations: WorkbookValidationRule[]
  conditionalRules: WorkbookConditionalRule[]   // in priority order
  notes: Array<{ address: string, text: string }>
  notRead: { charts, images, pivotTables, colorScales, dataBars, iconSets,
             hyperlinks, threadedComments: number }
  cuts: Array<'rows' | 'columns' | 'cells' | 'formulas' | 'structure' | 'part'>
  rowsRead?: number                // the row cap, printed with the 'rows' cut
}

interface WorkbookCell {
  row: number                      // 1-based
  column: number                   // 1-based, A is 1
  value?: string                   // the displayed or cached value as text
  formula?: string                 // without the leading '=' (one is stripped)
  formulaKind?: 'normal' | 'array' | 'shared-copy'
  arrayRange?: string              // for 'array'
  sharedFrom?: string              // for 'shared-copy': the master's address
  numberFormat?: string            // an Excel format code; 'General' is skipped
}
```

Validation rules (`WorkbookValidationRule`): `ranges` (A1 strings), `kind`
(`list-from-range` with `source`, a formula such as `Lists!$B$6:$B$45`;
`list-of-values` with `values`; `whole-number`, `decimal`, `date`, `time`,
`text-length` with `operator` and one or two `formulas`; `custom` with one
formula; `any`), `strict` (an invalid entry is refused, not only warned),
optional `inputTitle`, `inputMessage`, `errorMessage`. Conditional rules
(`WorkbookConditionalRule`): `ranges`, `kind` (`formula`, `cell-value` with
`operator`, `text-contains`, `text-not-contains`, `text-begins-with`,
`text-ends-with` with `text`, `blanks`, `no-blanks`, `errors`, `no-errors`,
`duplicates`, `unique`, `top` or `bottom` with `rank` and `percent`,
`above-average`, `below-average`, `date-period` with `period`, `other`),
`formulas`, `stopIfTrue`; never colors. Operators are `between`,
`not-between`, `equal`, `not-equal`, `greater-than`, `less-than`,
`greater-than-or-equal`, `less-than-or-equal`. Formulas in rules are written
for the first cell of their range, as Excel and Sheets store them.

For a Google Sheets adapter: `spreadsheets.get` with `includeGridData` gives
`sheets[].properties` (title, `hidden` as `hidden`, `gridProperties`
`frozenRowCount` and `frozenColumnCount`), `merges`, `conditionalFormats`
(`booleanRule.condition` types map to the kinds above; a gradient rule counts
as a color scale), `data[].rowData[].values[]` with `formattedValue` as
`value`, `userEnteredValue.formulaValue` as `formula` (strip the `=`),
`userEnteredFormat.numberFormat.pattern` as `numberFormat`, `note` as notes
and `dataValidation` per cell (group equal rules over neighboring cells into
ranges, or pass one rule per cell: the renderer merges identical rules and
joins touching ranges), plus `namedRanges`. Sheets has no shared formulas, so
`formulaKind` stays unset. Convert 0-based grid indexes to 1-based rows and
columns. The renderer does the collapsing, grouping, sanitizing and budgets,
so an adapter only fills the model.

### `renderWorkbookMap(model, options?)`

Returns `{ text, summary }`. `options` overrides `WORKBOOK_MAP_DEFAULTS`
(`maxBytes`, default 1 MiB, and the caps listed under "Office text
extraction"). The summary has `sheets`, `sheetsTotal`, `hiddenSheets`,
`cells` (with a value), `formulas`, `patterns` (formula lines printed),
`validations`, `conditionalRules`, `names`, `bytes`, `cut` (what was left
out: `sheets`, `values`, `formula_patterns`, `validations`,
`conditional_rules`, `number_formats`, `merged_cells`, `notes`, `names`,
`structure` for the final hard cut, and the sheet cuts), `notRead` (summed)
and `sheetSummaries` (name cut to 64 characters, visibility,
`valuesCutAfterRow`, `rowsNotShown`).

### The text

```
# Workbook map

How to read this map: … (the legend, WORKBOOK_MAP_LEGEND)

[Only the first 50 of 63 sheets are included.]   (only when cut)

## Named ranges
- TaxRate = Parameters!$C$3
- Rates (only in sheet Lines) = Lines!$B$2:$B$9

## Sheet: Lines
Used range A1:H25. Frozen: rows 1-6 and columns A-B. Hidden.
Not read: 1 chart, 2 color scales, 1 link (count only).
Only the first 1000 rows were read; later formulas and values are not included.

### Formulas
- F7:F24 ↓ =INDEX(Parameters!$D$7:$D$11, MATCH(E7, Parameters!$B$7:$B$11, 0)) · except F19
- H19 =SUM(OFFSET(H19,-12,0,12,1))
- Q20:AN20 → =SUM(OFFSET(Q20,-19,0,19,1))
- D3:D4 {array} =Parameters!B7:B8
- C1:C3, B2:B3: copies of the shared formula in B1 (not written out: …)
(12 more formula lines not shown)

### Dropdowns and validation
- E7:E24: dropdown of the values in Lists!$B$6:$B$45 (strict); input message "…"
- G7:G24: whole number between 0 and 1000 (not enforced, warning only)

### Conditional formatting
- A7:H24: formula =$E7="Lead" (stop if true)
- A7:AN171: 50 rules, formula =$C7=… with … = "Category 1", … and 38 more

### Number formats
- #,##0.00: H7:H25, B3:B7

### Merged cells
A1:H1, A2:C2

### Notes
- E6: "Pick a role from the list on the Lists tab."

### Values
#,A,B,C,…
1,Website estimate
7,Item 1,,,,Lead,8,2,16
(values cut after row 400: 120 more rows not shown)
```

Rules of the format:

- Sections appear in this order and only when they have lines. Everything
  above "Values" is the structure; all sheets' structure is sized first and
  the values of every sheet share what is left of `maxBytes` (a sheet that
  needs little gets all of it, the rest is split evenly), so a size cut
  removes value rows and never the structure of a later sheet. Only if the
  structure alone is larger than `maxBytes` is the text cut at the end with
  `WORKBOOK_MAP_TRUNCATION_MARKER` (cut `structure`).
- Formula lines: `ADDRESS =formula` for a single cell; `START:END ↓ =formula`
  for a fill down a column and `→` for a fill along a row, where the printed
  formula is the first cell's and every other cell of the range holds it
  shifted by its distance (relative parts of cell, whole-column and whole-row
  references move, `$` parts, sheet prefixes, names, strings and errors do
  not); `· except A, B:C` lists cells in the range that are not copies (they
  have their own line, or no formula). A run is formed only from cells whose
  formula text equals the first one shifted exactly (`shiftTokens`), first
  down the columns and then along the rows for what is left; a gap of more
  than two non-copies ends a run, and a run never has more exception cells
  than copies. The round trip is exact by construction and tested
  (`expandPattern`, and a reader of the printed lines checked against
  formulas written out by hand, on generated sheets with quoted sheet names,
  string literals that look like references, lowercase references, inner
  spaces, `LOG10(`, `#REF!`, whole rows and columns and structured
  references). Lines are sorted by their first cell, row first.
- Rules print one line per distinct rule; identical rules on several ranges
  share a line, touching rectangles are joined (`C7:C171, D7:D171` becomes
  `C7:D171`), and conditional rules on the same ranges that differ only in
  string or number literals collapse into "N rules, … with … = …" listing
  the literals.
- Values are CSV: the first field is the row number, then columns from A; the
  header names the columns up to the widest one. Rows without a value are
  left out.
- Every workbook string (sheet and defined names, formulas, values, notes,
  messages, number formats, ranges) goes through `cleanLine`: control,
  zero-width and bidirectional characters become one space, a backtick becomes
  `ˋ` (U+02CB), and the length is capped with `…`. So no workbook text can
  start a line, add a heading or end the Markdown fence the app wraps it in;
  the app's fence is also one backtick longer than any run in the text.

## Local development

`pnpm run dev` (Nuxt through Nitro's platform proxy) binds `DOC_RENDERER` to a
Worker running in another local `wrangler dev` session. Without one the binding
object exists but every call fails with `Worker "besidka-doc-renderer" not
found`, which the helper turns into the 503.

```bash
pnpm run doc-renderer:dev   # terminal 1: the renderer, wrangler dev on 8789
pnpm run dev                # terminal 2: the app
```

Verified with Nitro's proxy (`getPlatformProxy` on the root `wrangler.jsonc`):
`capabilities()` answered while the renderer ran and failed with the message
above after it stopped. To run both in one process:
`wrangler dev -c wrangler.jsonc -c workers/doc-renderer/wrangler.jsonc`
(the first config is the primary Worker).

## Deploy order and owner steps

`deploy-satellites` runs after the same gates as `deploy` and before it, only
on `main` and never on a dry run. It now holds two independent sets of steps:

- artifacts runtime, gated by `vars.ARTIFACTS_RUNTIME_DEPLOY_ENABLED` as
  before (the gate moved from the job to its steps);
- document renderer, ungated and on every run: `wrangler deploy` and
  `wrangler deploy --env preview` from `workers/doc-renderer`. There is no
  change detection: the deploy is idempotent, and a skipped deploy after an
  earlier failed run would leave the app bound to a Worker that was never
  published (concurrent pushes drop pending runs, so a diff against the
  previous push cannot be trusted).

There is deliberately no opt-in variable for the renderer. `env.production`
binds `besidka-doc-renderer`, and `wrangler deploy` of the app fails when the
target Worker does not exist, so the renderer must exist whenever the app is
deployed. The job runs before `deploy` and `deploy` needs it to be `success` or
`skipped`: a failed renderer deploy blocks the app deploy rather than shipping a
dangling binding. The satellites use one concurrency group,
`satellites-besidka`.

Consequences for the merge:

1. The first run after this layer reaches `main` deploys both renderer Workers,
   then the app. No manual step is needed. If the satellite step fails, fix it
   and re-run the workflow; do not remove the binding.
2. Between the merge and the end of that job, a PR preview deploy (it uses the
   default branch's `wrangler.jsonc`) can fail on the missing
   `besidka-doc-renderer-preview`. Re-run it.
3. To bootstrap by hand (for example before the first merge, so previews
   resolve the target at once): `cd workers/doc-renderer && pnpm exec wrangler
   deploy` and `pnpm exec wrangler deploy --env preview`.

## Not verified

The workflow change was checked by a parser-level spec, not by a run on `main`.
`tests/unit/workers/doc-renderer/bundle.spec.ts` runs `wrangler deploy
--dry-run` for both configs, so the aliases, the font rule and the bundle size
are exercised on every PR rather than first on `main`.
Production CPU, a real `wrangler deploy` of both Workers, the RPC call on a PR
preview (the preview of this PR deploys with `main`'s `wrangler.jsonc`, which
has no binding until it merges) and Workers Logs retention. The per-PR renderer
Worker is not built; see `docs/cloudflare-previews.md`, "Satellite Worker
bindings".

## Deviations from the ticket

- `RenderRequest.provenance.createdVia` is the package's `CreatedVia`
  (`chat`, `mcp`, `research`, `code-execution`); there is no `schedule` value
  in D-2. An optional `aiGenerated` mirrors the package, so MCP content the
  caller wrote can be marked `channel-only`.
- Asset media types follow the package (`image/webp` is in the type and rejected
  as `asset_invalid`, D-2 does not embed WebP).
- The ticket's `limits.cpu_ms: 30000` example is 15000, the D-1 value.
- No per-PR renderer Worker, no change to `preview-deploy.yml` or
  `preview-cleanup.yml`.
- `cf-typegen` output is not committed: `worker-configuration.d.ts` is
  gitignored and regenerated by `pnpm run typecheck`. The app helper types the
  binding with `DocumentRendererService` from the contract instead of
  `Service<DocRenderer>`, because importing the entrypoint into the app's
  program would pull the font imports.
- Two small edits to D-2 source: the two `TextDecoder('utf-8', { fatal: true })`
  calls pass `ignoreBOM: false` (the default) because the Workers types demand
  both options.
- The deploy job is shared with the artifacts runtime and its job-level
  variable gate became step-level gates.
- The `unsupported` mapping to HTTP statuses lives in `getRenderFailureStatus`.
