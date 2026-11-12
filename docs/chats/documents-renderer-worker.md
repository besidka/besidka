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
  extract(request: { format, bytes }): Promise<ExtractResult>
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
  Worker changes behaviour.
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

`wrangler deploy --dry-run` reports 4,622 KiB uploaded (1,199 KiB gzip) and "No
bindings found". Run `wrangler deploy` for this directory with
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
| DOCX | Headings as `#` to `######`, resolved through the style names in `styles.xml` (`heading 1`, `Title`), so localized style ids work. Paragraphs, bulleted and numbered lists with nesting (counters per abstract numbering), tables as Markdown tables (merged cells become empty cells, nested tables are flattened into their cell), hyperlink text. |
| XLSX | One `## Sheet: <name>` section per worksheet, in workbook order, holding CSV. Shared strings, inline strings and the cached `<v>` of formulas are resolved. Numbers with a date number format (built-in ids 14-22, 27-36, 45-47, 50-58, or a custom code with date or time tokens) become ISO dates or times, with `date1904` honoured. Booleans are `TRUE` or `FALSE`. Merged cells show their value once, in the top-left cell. CSV, not a Markdown table, because it costs fewer tokens, keeps empty cells as consecutive commas and needs no header row. |
| PPTX | `## Slide N` per slide in `sldIdLst` order, then the title as `###`, body text (bullets for body placeholders and explicit bullets), tables as Markdown tables, and `Speaker notes: ...` from the notes body placeholder. |

Limits (`EXTRACT_LIMITS`, overridable per call): 30 MiB input, 1 MiB of text,
5,000 ZIP entries, 150 MiB of declared total and 50 MiB per entry, a 1000:1
ratio for entries over 1 MiB (the validator's 100:1 would reject sparse real
spreadsheets), 50 sheets, 1,000 rows, 200 columns, 2,000 characters per cell,
200,000 cells and 16 MiB inflated per XML part. When a limit cuts the output,
`truncated` is `true`, `stats.truncations` names the limit and the text says
so: `[Truncated: the text limit was reached ...]` at the end for the 1 MiB cap,
and a marker after the sheet for rows, columns, cells and sheets. Empty rows
are skipped, not counted.

The ZIP limits come from `readZipDirectory(bytes, limits)`; its default
argument is the validator's own limits, so `validate()` is unchanged.

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
inflates its 40 MB tail, and a document stops at the text limit. A part over
16 MiB is read as far as that and flagged `part_limit`. Shared strings are
cut into 1 MiB windows at `</si>` and only the records the sheets reference
are parsed. Peak live memory stays near the input size plus the largest prefix
(an estimate of about 45 MiB for a 20 MB workbook; a capped 64 MiB V8 heap ran it without trouble); a Worker has 128 MiB.

Measured on 2026-11-12 with `scripts/bench/doc-renderer-extract.mjs` (Node
24.18, Apple Silicon, cold run then median of warm runs, V8 heap capped at 64
MiB, status asserted `ready`):

| Case | Input | Output | Node cold / warm | Local `workerd` RPC wall, cold / warm |
| --- | --- | --- | --- | --- |
| XLSX, 3 sheets of 57,000 rows, unique strings | 20.0 MiB | 460 KiB, `rows_limit` | 585 ms / 562 ms | 634 ms / 519 ms |
| XLSX, one dense sheet of 3,000 rows by 200 columns | 5.5 MiB | 1 MiB, `cells_limit`, `text_limit` | 563 ms / 521 ms | not run |
| PPTX, 300 slides with bullets, a table and notes | 4.2 MiB | 256 KiB | 93 ms / 77 ms | 114 ms / 87 ms |

The worst case is about 4 percent of the 15 s CPU limit. The `workerd` column
is wall time of an HTTP request to a harness Worker that calls `extract`
through a service binding (`scripts/bench/doc-renderer-extract-harness/`, run
with `wrangler dev -c <harness> -c workers/doc-renderer/wrangler.jsonc`), so it
includes moving 20 MiB over the binding. Local `wrangler dev` does not enforce
`cpu_ms`, and `Date.now()` does not advance during synchronous work inside
workerd, so the figure is the caller's clock, not the Worker's CPU. Production
CPU and the 128 MiB memory limit are not measured: read `cpuTime` with
`wrangler tail besidka-doc-renderer --format json` on the first real upload.

### What is lost

Images, charts, drawings, text boxes and shapes in DOCX, SmartArt, comments,
tracked deletions, headers, footers, footnotes, hidden-sheet flags, number
formats other than dates (a currency cell is its raw number), formulas
(only the cached value), cell colours and all formatting. PPTX text follows the
shape order in the file, which is the z-order, not always the reading order.
Paragraph breaks inside a table cell become spaces. A shared string table that
writes an empty string as `<si/>` instead of `<si></si>` would shift later
strings; Excel, LibreOffice and the common libraries never do.

### App helper

`extractOfficeText(request, logger?)` in `server/utils/documents/renderer.ts`
never throws. A missing binding, a satellite deployed before `extract` existed
(its `capabilities()` has no `extract` entry, which is how a staggered deploy
shows) and a failed call all return `status: 'failed'` with `errorCode:
'renderer_unavailable'`, so layer 2 can store that state and retry instead of
failing the request that stored the file. The log block
`attributes.documents.renderer.extract` holds `format`, `ok`, `status`, `code`,
`durationMs`, `bytes`, `textBytes`, `truncated` and `rendererVersion`, never
the text. `capabilities().extract` carries `version` (`EXTRACT_VERSION`, bump it
when output changes so layer 2 can re-extract), `formats`, `maxInputBytes` and
`maxTextBytes`.

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
