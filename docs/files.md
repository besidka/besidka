# Files

## Overview

This document is the source of truth for the files module:

- upload/attach/list/rename/delete flows;
- quota and transform governance;
- reliability and security guarantees;
- operational runbook for manual user limit management;
- future shared-chat file access model.

The project is OSS and mostly BYOK, but hosted usage still consumes your own
Cloudflare resources. The implementation is intentionally conservative with
storage and image transforms.

## Core Constraints

### Product and Cost Constraints

- Hosted users do not pay per file usage.
- Storage growth and Cloudflare Images transforms must be capped.
- You need manual DB-level overrides for family/friends without admin UI.

### Cloudflare Runtime Constraints

- Workers allow only 6 simultaneous external connections (R2/KV/fetch).
- Over-parallelized file operations can stall requests.
- DELETE request bodies are unreliable at edge; bulk delete uses POST.

## Architecture

### Components

- R2: binary file objects, plus one `<storageKey>.text.md` sidecar per Office
  file (the extracted text, see "Office attachments").
- D1:
  - `files` metadata.
  - `storages` per-user file policy and counters.
  - `image_transform_usage_monthly` global monthly transform guard.
  - `chat_shares` and `chat_share_files` for share-grant model.
- KV:
  - short-lived cached data URLs for AI file conversion.
  - short-lived storage stats cache.

### Source of Truth

- Server-side DB policy is authoritative.
- Client validation is advisory only.
- Runtime config provides defaults and fallback values.
- `public.maxFilesPerMessage` and `public.maxMessageFilesBytes` are used for:
  client-side fallback validation and default values for newly created
  `storages` rows.
- `filesHardMaxStorageBytes` is the only server-side hard cap in file quotas.

### Files from earlier messages in model context

`sanitizeMessagesForModelContext()` (`server/utils/files/assistant-files.ts`)
builds the model-facing copy of the chat. File parts on the latest user message
are always kept. File parts on earlier user messages are kept only inside a
strict, deterministic budget; everything else is replaced with the text
`Previously attached file omitted from model context: <filename>.`

Rules, applied newest first:

1. Only the last `CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES` (3) user messages
   before the latest one are eligible. Text-only user messages count toward
   the window.
2. Files are walked from the newest eligible message to the oldest, in
   original part order. A file is kept only if its size is known, the model
   can accept its media type (rule 5), fewer than `CARRIED_FILES_MAX_COUNT`
   (8) files are carried so far, and the carried bytes plus its size stay
   within the carried byte budget. A file that does not fit is omitted (and
   spends nothing) and the walk continues, so a smaller older file can still
   be kept.
3. Carried byte budget =
   `min(CARRIED_FILES_MAX_BYTES, max(0, REQUEST_FILES_MAX_BYTES - latestBytes))`
   with `CARRIED_FILES_MAX_BYTES` = 5 MB, `REQUEST_FILES_MAX_BYTES` = 10 MB and
   `latestBytes` = size of the latest user message's files. Owned `/files/`
   attachments use their stored size; an inline `data:` URL has no stored
   size, so its bytes are estimated from the payload (`ceil(base64Length * 3 /
   4)` for base64, the payload length otherwise). A heavy new message leaves
   less (possibly zero) room for older files.
4. A carried `text/*` file larger than `CARRIED_TEXT_FILE_MAX_BYTES` (64 KB) is
   omitted. `convertFilesForAI()` inlines text files as prompt text, so a
   multi-megabyte text file would otherwise cost on the order of a million
   input tokens on every turn. An Office file counts as text here: its
   `text_bytes` (the extracted text, passed in as
   `officeTextBytesByStorageKey`) replace its file size in rule 2, rule 3 and
   this cap, and an Office file without ready text is omitted as
   `unsupported-by-model` instead of being carried.
5. Modality gate: carried files are checked against the selected model, which
   only the request's own attachments were checked against before.
   `createCarriedMediaTypePredicate()`
   (`server/utils/files/carried-media-types.ts`) allows `text/*` always,
   `image/*` only if `model.modalities.input` includes `image`, and
   `application/pdf` only if it includes `pdf`, and the three Office types
   always (they are sent as text); everything else (audio, video, archives,
   ...) is never carried. Without this, an image sent to a vision
   model and carried after switching to a text-only model would make the
   provider reject every following turn.
6. Gateway sends carry nothing: this handler does not resolve gateway model
   capabilities, so `sanitizeMessagesForModelContext()` gets no predicate
   there and its safe default (no predicate, no carry-over) applies. Only
   direct-provider sends pass a predicate.
7. Sizes come from `getOwnedFilesByStorageKeys(userId, keys)` in
   `server/api/v1/chats/[slug]/index.post.ts`, so only the user's own `/files/`
   attachments have a size. `data:` URLs, unparsable URLs, missing rows and
   other users' files have no stored size and are never carried.

`getModelContextFileStorageKeys()` returns the deduplicated storage keys the
caller must look up (latest message plus the eligible window).
`getOwnedFilesByStorageKeys()` queries them in sequential chunks of 90 keys
and merges the rows into one map, so no single statement approaches D1's ~100
bound-parameter limit however large the per-user `maxFilesPerMessage` policy
is; `convertFilesForAI()` uses the same function and gets the same
protection. Without a sizes map or without a predicate the function behaves
exactly as before (no carry-over). Carried parts then flow through
`convertFilesForAI()` unchanged, which re-checks ownership and uses the
5-minute KV data-URL cache. The `chats` wide event records
`carriedFilesCount`. The limits are code constants in
`server/utils/files/file-governance.ts`, not per-user policy.

Why a byte budget: `convertFilesForAI()` base64-encodes every kept file into
the request. Base64 is about 1.33x the raw size, and several copies (R2 bytes,
encoded string, serialized provider request body) are in flight at once, so
re-sending every historical file blew the 128 MB Worker memory limit on long
chats (issue #221, commit 9c79d6ab). Bytes are the quantity that threatens the
Worker, so they are capped.

Why a count and a window: a re-sent file is billed as input tokens on every
turn. One past chat re-sent 29 images (17 MB) per turn. Prompt caching does not
remove the re-send bytes from the Worker, and it only discounts the cached
prefix within its TTL, so it is not a substitute for bounding what is sent.

#### Telling the user what was left out

`buildModelContextMessages()` is the same function plus a report:
`{ messages, omittedFiles }`. `sanitizeMessagesForModelContext()` is a thin
wrapper returning only `messages`. When `omittedFiles` is non-empty the
handler writes a `data-omitted-context-files` part
(`{ modelName, files: [{ filename?, mediaType, reason }] }`, types in
`shared/types/model-context.d.ts`) before the model output, and
`Chat/OmittedContextFiles.vue` renders it as a collapsed
"N earlier files weren't sent to the model" row above the answer text. The
`chats` wide event records `omittedContextFilesCount`.

| Reason | Copy | When |
| --- | --- | --- |
| `unsupported-by-model` | `<model> can't read this file type` | window file the modality gate rejects |
| `over-limit` | `Over the size or count limit for earlier files` | window file skipped by the text cap, the count cap or the byte budget |
| `outside-window` | `Attached too many messages ago` | file of the one message that just left the window (readable media type only) |
| `gateway-no-carry` | `Gateway models only see files from the latest message` | every window file on a gateway send |

Classification of a file on a user message other than the latest one:

1. No latest user message: nothing is reported.
2. No predicate (gateway send): every window file is `gateway-no-carry`, and
   nothing else is reported.
3. Window file with no known size: not reported (see the gap below).
4. Window file with a known size: `unsupported-by-model` first, then
   `over-limit`. This reorders the checks of the carry rules but not their
   outcome, since each check only skips a file without spending budget.
5. `outside-window`: only the files of the single user message that has just
   left the window on this send, the
   (`CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES` + 1)-th previous user message,
   and only if a predicate exists and accepts the media type. No size is
   needed, so none is looked up for them.

Assistant file parts and latest-message files are never reported.

Why only the just-exited message: the server is stateless per request and
never knows what an earlier turn already told the user. Reporting every older
file would repeat the same notice on every turn of a long chat. A message
leaves the window exactly once, so reporting only that message tells the user
once, without storing anything. Files that were already unreadable by the
model are not reported as `outside-window`, since being older made no
difference to them.

Known gap: window files of unknown size (`data:` URLs, other users' files,
missing rows) stay silent. The missing-files toast only fires for parts that
reach `convertFilesForAI()`, and omitted parts reach it as plain text, so
neither surface mentions them.

The part is live-only. It is written with `writer.write()` outside the
persistence tee, so it never reaches the stored assistant message: it
disappears on reload and shared chats never show it (the shared page does not
render the component). The client's `hasMeaningfulAssistantParts()` ignores
it, so a lone notice does not turn an empty assistant message into a
"meaningful" one.

Reasoning, tool calls, tool results, sources and data parts from earlier turns
are dropped from the model context on every turn by design and get no notice.

Open questions (not built):

- Should there be a one-time explainer that sources/URLs and tool results from
  earlier turns are never carried to the model?
- Should the notice be persisted with the assistant message so it survives a
  reload? That would need a stored part type and a decision on whether
  shared chats should show it.

### Files in the newest message

The newest user message is gated against the selected model before anything
is persisted or sent to a provider, so a send the model cannot read fails
fast with a 400 instead of reaching the provider. Regenerate re-posts the last
user message through the same handler (same message id, body parts), so
switching model and regenerating hits the same gate; it runs before the
already-persisted-reply replay and before `persistUserMessage()`.

- **Direct providers**: every image and PDF `file` part is checked against
  the model's input modalities
  (`shared/utils/input-media-types.ts`, the same kind detection the client
  picker and the carried-files rule use). `assertInputFilesSupported()`
  (`server/utils/chats/input-file-support.ts`) rejects an image without
  `image` and a PDF without `pdf`, each with its own message; `text/*` always
  passes, and other types (audio, video, archives) are left to
  `validateMessageFilePolicy()`. The modalities come from
  `getModelInputModalities()` (`shared/utils/model.ts`): an image-generation
  model (`gpt-image-*`, `gemini-*-image`, `grok-imagine-*`) streams through
  its controller model, so the controller's modalities apply, and "make an
  infographic from this PDF" is accepted although the image model itself
  lists no `pdf`. The same list drives the carried-files predicate and the
  client picker. Before this, only images were checked: Moonshot threw inside
  `@ai-sdk/moonshotai` and DeepSeek silently dropped the PDF.
- **Gateways (Vercel, OpenRouter)**: images only, and only on positive
  evidence. `assertGatewayImageInputSupported()`
  (`server/utils/gateways/image-input-support.ts`) looks the model up in the
  cached gateway catalog, and only when the message carries an image, then
  rejects only if the entry has a non-empty `modalities.input` that omits
  `image`. A catalog miss, an outage or missing modalities fail open. PDFs are
  never gated on gateways: catalogs use a different vocabulary (OpenRouter
  says `file`, not `pdf`) and OpenRouter parses PDFs for any routed model, so a
  catalog-derived gate would reject sends that work. Cloudflare is skipped
  entirely: its catalog needs the user's credentials and exposes no reliable
  input modalities (see `docs/providers/gateways.md`).
- **Office and unknown types**: images and PDFs above are judged from the
  declared type before the database is read. The database-aware check
  (`assertFilesDeliverable()`) then re-judges every file by its stored type and
  adds Office readiness, legacy Office and unknown types, through
  `resolveFileDelivery()`. See "Office attachments".
- **Provider-side fallback**: when a provider still rejects a PDF at request
  time, `normalizeChatError()` rewrites the raw upstream text into
  "This model does not support PDF input..." (the PDF counterpart of the image
  rewrite in `server/utils/chats/errors.ts`). Only wording that says the
  model, input, file or media type does not support PDF matches; unrelated PDF
  errors (encrypted file, unsupported page size, parse failure) pass through
  unchanged.

OpenAI models that read images are treated as reading PDFs: OpenAI's PDF guide
(<https://developers.openai.com/api/docs/guides/pdf-files>) requires "models
with vision capabilities, such as gpt-4o and later", and `@ai-sdk/openai`
has no per-model restriction, while models.dev omits `pdf` for several of
them (gpt-5, gpt-5-mini, o4-mini, ...). `providers/openai.ts` sets
`impliedInputModalities: { image: ['pdf'] }` (see
`docs/models-data-fetching.md`); text-only models stay without `pdf`.

xAI never advertises `pdf`. `@ai-sdk/xai` 5.0.24 only exposes the Responses
model, whose converter throws `UnsupportedFunctionalityError` for non-image
inline data ("requires a URL or a Files API reference for non-image files"),
and `convertFilesForAI()` always produces `data:` URLs. Grok models can read
PDFs on xAI's side, but this app cannot deliver them, so
`providers/xai.ts` sets `excludedInputModalities: ['pdf']`, which
`mergeProvider()` applies on top of the models.dev snapshot for every xAI
model (see `docs/models-data-fetching.md`). Uploading each PDF through the xAI
Files API was rejected as larger: an extra request per file, a file lifecycle
with deletion to manage, and more cost surface.

The AI SDK's per-call `warnings` (for example a file type an adapter dropped)
are written to the `ai-stream` wide event as
`attributes.aiWarnings = { count, warnings }` (first 10, each
`{ type, feature?, setting?, message?, details? }`) only when a step produced
any. The search-answer continuation call records its own warnings under
`attributes.aiContinuationWarnings`, because evlog concatenates arrays on
repeated `set()` and would otherwise inflate the main call's list. Both live
under `attributes` per `docs/axiom-map-fields.md`. The serializer is
`server/utils/ai/sdk-warnings.ts`.

### Office attachments (`files.office`)

Word, Excel and PowerPoint files (`.docx`, `.xlsx`, `.pptx`) are attachments
on every provider and gateway because the model gets their text, not the file.
No provider reads them uniformly: OpenAI Responses reads them natively but
returns text only, Anthropic, Moonshot and Cloudflare throw on an Office
`file` part, DeepSeek silently drops it, and Gemini documents them only on the
Interactions API. One extraction, sent as a text part, behaves the same
everywhere and survives a model switch. Provider research and the full
decision list are in BES-370.

- **Flag.** Accepting an Office upload needs the `files.office` flag
  (`internalFeature`, requires the `DOC_RENDERER` binding). With it off the
  upload routes answer exactly as before ("File type must be one of ..."). The
  rest is not flagged: text extraction runs for every Office file that is
  stored (uploads, generated documents, code-execution outputs) and on the
  first send of an older one, and the resolver, the send guard and the sidecar
  cleanup apply to all of them. That fixes today's behaviour: a generated DOCX
  attached to an Anthropic model used to reach the provider as a raw file part
  and throw.
- **Allowlist.** `nuxt.config.ts` keeps the base `allowedFileFormats`. The
  three Office media types join it only through `getAllowedFileFormats()`
  (`shared/utils/office-files.ts`) while the flag is active, so the flag-off
  list is the base list. `AllowedFileFormat` includes them.
- **Upload checks** (`server/utils/files/upload-file-type.ts`,
  `office-upload-check.ts`, shared by `PUT /files/upload` and
  `POST /files/create`). The extension decides the media type (the declared
  type never makes a file legacy: browsers send `application/vnd.ms-excel` for
  a `.csv`), because
  browsers send an empty type, `application/zip` or
  `application/octet-stream` for these files. Then, in order: the extension
  (legacy `.doc/.xls/.ppt` and macro `.docm/.xlsm/.pptm` are rejected with a
  "Save as .docx, .xlsx or .pptx" hint, as the owner decided on 2026-11-12;
  the server still rejects a raw `.xls` and never trusts the browser's
  conversion, see "Legacy `.xls` conversion in the browser" below),
  the ZIP magic bytes (a compound `D0 CF 11 E0` file is legacy or
  password-protected), the central-directory bounds (`readZipSummary` and
  `readZipDirectory` from `@besidka/doc-renderer/zip`, with the extractor's
  limits and not the tighter ones for generated documents: 5000 entries,
  50 MB per entry, 150 MB in all, ratio 1000:1 above 1 MB, encrypted entries
  refused; nothing is inflated), the main part
  (`word/document.xml`, `xl/workbook.xml`, `ppt/presentation.xml`) and a 20 MB
  cap per Office file (read as a capped stream, so a larger body is never
  buffered). Generated documents go through the renderer's `validate()`
  instead; an upload has no spec, so this is the structural gate.
- **Extraction when a file is stored.** `persistFile()` calls
  `extractAndStoreOfficeText()` (`server/utils/files/office-text.ts`) for any
  Office media type, so it covers uploads, chat and MCP documents
  (`documents/finalize.ts`), code-execution outputs and MCP-created files. The
  `extractOfficeText` binding call runs in the storing request. The
  Markdown goes to R2 at `<storageKey>.text.md` (at most 1 MB, not counted in
  the quota) and the state to `files.text_*`. It never fails the request: a
  failed or `too_large` result is stored as such, and a renderer that is
  unavailable leaves the status null, so the next send retries. The log is
  `attributes.files.officeText` (format, status, sizes, error code, the
  omitted counts, never the text).
- **What the text leaves out.** At the same moment `office-text.ts` counts the
  parts the text cannot carry, from the ZIP entry names only (nothing is
  inflated, and it runs in the main Worker, not in the doc-renderer
  satellite). `readZipSummary` returns no names, so it uses `readZipDirectory`
  with the same `OFFICE_UPLOAD_ZIP_LIMITS` as the upload check. Entries are
  matched under `word/`, `ppt/` and `xl/` only: `media/*` and `embeddings/*`
  count as `text_omitted_media`; `charts/chart*.xml` and `diagrams/data*.xml`
  count as `text_omitted_charts` (relationship, style, colour and layout parts
  are ignored). Each count is capped at 99 and the UI shows "99+". An archive
  that cannot be read stores 0 and 0, so NULL only ever means "not counted
  yet" and nothing is retried forever. Embedded spreadsheets (`.xlsx`,
  `.xlsm`, `.xlsb`, `.xls`) are the data behind a chart and count as neither,
  so a deck with one chart and no picture reads "1 chart not sent"; other
  embedded objects (`oleObject*.bin`, `.docx`, `.pdf`) still count as media.
  Known over-count: `ppt/media` also holds images from slide masters and
  layouts. A generated document with no image shows nothing.
- **Lazy fallback.** A file with a null status (stored before extraction, or
  while the renderer was down) or an older `text_version` is read once on its
  first send (`ensureOfficeTextState()`) and cached the same way. Only the
  newest message's files are read lazily; an earlier file with no text is
  omitted from the carry-over instead. A `ready` file whose omitted counts are
  both NULL (stored before they existed) gets a count-only backfill on its
  first use: one R2 read of the file, no renderer call, no rewrite of the text,
  and `OFFICE_TEXT_VERSION` stays at 1 so no stored file is re-extracted.
  `getOwnedFilesByStorageKeys()` selects both columns, or the backfill would
  run on every send.
- **Deleting.** `withDerivedKeys(keys)` returns the keys plus their sidecar
  keys. All four paths that delete file objects use it in their batched R2
  delete: `delete-files.ts`, `cleanup-expired-files.ts`,
  `chat-deletion-cleanup.ts` and `account/purge-user-data.ts` (before
  chunking, so a batch stays within 1000 keys). `documents/cleanup.ts` deletes
  spec objects under `documents/<userId>/`, not file objects, so it needs
  nothing. `tests/unit/server/utils/files/derived-keys-delete-sites.spec.ts`
  fails when a new server file deletes from the file bucket without being
  listed. The sidecar has no `files` row, so `/files/[key]` returns 404 for it
  and the MCP `read_file` tool (which reads by row, `text/*` only) cannot
  expose it.
- **Resolver.** `resolveFileDelivery({ route, providerId, modalities,
  mediaType, textStatus })` (`shared/utils/file-delivery.ts`) is the single
  answer to how a file reaches the model: `native`, `text` or `unsupported`
  with a reason. It is total, so an unknown type is `unsupported`, never an
  exception. Images and PDFs are `native` when the modalities allow them
  (`model-no-image`, `model-no-pdf` otherwise; unknown modalities fail open),
  `text/*` is `text`, an Office file is `text` when its text is `ready` and
  `office-unreadable` otherwise, legacy Office types are `legacy-office`. A
  per-provider and per-gateway `office: 'extract'` row is the seam for turning
  OpenAI's native path on behind a flag later.
- **Send path.** Before anything is persisted or streamed,
  `assertFilesDeliverable()` (`server/utils/chats/file-delivery-check.ts`)
  checks every file of the newest message against the database row (the stored
  type, not the client's `mediaType`), reads lazily where needed and answers
  400 with the file name, the reason and a fix. `convertFilesForAI()` then
  turns a ready Office file into a `text` part: the file name and format
  ("Word document", "Excel spreadsheet", "PowerPoint presentation"), the line
  "Extracted text. Images, charts and formatting are not included.", then the
  Markdown in a fence, cut at 200 KB per file and 512 KB per message on a UTF-8
  boundary with a "[Truncated ...]" marker. Gateways get the same text. A file
  it cannot send becomes a "[File not included: ...]" note and an
  `unsupportedFiles` entry, never a dropped part. `assertOnlyDeliverableFileParts()`
  runs once after the conversion (a real 400, before the stream) and once just
  before `convertToModelMessages` (a backstop): the only `file` parts that may
  reach a provider are images and PDFs.
- **Run code.** On a direct Anthropic, OpenAI or Google send with "Run code"
  and `code-execution.files`, an Office or JSON file of the newest message
  also reaches the provider sandbox (`docs/chats/code-execution.md`), so
  `resolveFileDelivery()` takes `codeExecutionFiles` and
  `CODE_EXECUTION_FILE_DELIVERY` says how each provider takes it: Anthropic and
  OpenAI by upload (the route uploads the bytes itself, the model message has
  no file part and gets a "[Available in the code sandbox ...]" note, plus the
  extracted text when it is ready), Gemini inline (the file part stays in the
  model message, in addition to the text). The result is `container` when the
  model gets no text of the file, so an unreadable Office file or a re-attached
  JSON output is not a 400 there. Only the Office and JSON types in
  `CODE_EXECUTION_CONTAINER_MEDIA_TYPES` qualify (a spec ties them to
  `server/utils/code-execution/file-types.ts`), only for the sandbox message,
  and `assertOnlyDeliverableFileParts()` lets a raw part through only for the
  Gemini case. Without Run code, with `code-execution.files` off, on a gateway
  or on any other provider, they are refused as before.
- **Carry-over.** Office counts as text: any model can carry an earlier Office
  file, the 64 KB cap and the 8 file / 5 MB / 10 MB budgets use `text_bytes`
  instead of the file size, and an earlier file without ready text is omitted
  as `unsupported-by-model` instead of failing the send.
- **API surface.** `GET /api/v1/files` adds `textStatus`, `textBytes`,
  `textTruncated` (true when `textBytes` is over the 200 KB inline cap, so only
  the start is sent), `textOmittedMedia` and `textOmittedCharts`. The upload
  response carries the same columns.
- **The text note (owner decision, 2026-11-12).** Normal files show nothing.
  Earlier every Office file showed "Sent as text"; that label is gone. A quiet
  `badge-soft badge-xs` appears only when something is lost, on the attached
  chip (`files-delivery-hint`) and on file manager rows and tiles
  (`files-text-note`): "3 images not sent", "2 charts not sent", "Shortened",
  or a combination ("Shortened · 3 images · 2 charts not sent"), with correct
  singular and plural forms. The tooltip says "The model gets this file's text
  only. Images, charts and formatting aren't sent." plus "It is long, so only
  the start is sent." when shortened. The logic is `getTextLossNote()` in
  `app/utils/file-delivery-hints.ts`; NULL counts (not counted yet) show
  nothing. Unsupported-file reasons ("No readable text", "Old Office format",
  "Needs Run code") are unchanged, and on a disabled row the reason replaces
  the note.

### Legacy `.xls` conversion in the browser

The owner exports `.xls` from Jira. It is real BIFF8 (OLE2, `D0 CF 11 E0`), so
on 2026-11-12 he overrode the "reject with a hint" decision for `.xls` only
(BES-370). The browser converts it to `.xlsx` before upload and the server
only ever receives XLSX. `.doc`, `.ppt` and the macro formats keep the
"Save it as .xlsx / .docx / .pptx and upload again" hint: the only converters
for them are new single-maintainer libraries or LibreOffice (about 52 MB of
WASM that needs COOP/COEP, or a Container with a patch treadmill).

- **Flag and entry point.** Behind `files.office`. `useChatFiles().uploadFiles`
  converts first, before the count and size caps, so they see the converted
  file; every upload path (modal, full-page drop, paste) goes through it. The
  upload modal (`Upload.client.vue`) lets a `.xls` through only when its first
  8 bytes are the CFB signature, otherwise it keeps its inline hint.
- **Code.** `app/composables/xls-convert.ts` (`useXlsConversion`),
  `app/workers/xls-convert.ts` (`convertXlsBytes`), `app/utils/xls-convert.ts`
  (limits, signature check, naming, no SheetJS import) and
  `app/types/xls-convert.d.ts`. SheetJS is imported only in the worker file, so
  it is a lazily loaded worker chunk: never on the server, never in the entry
  chunk, and there is no main-thread fallback (no `Worker` means the hint).
- **Library.** SheetJS Community Edition 0.20.3 from the official CDN tarball
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), pinned in
  `package.json` with the sha512 integrity in `pnpm-lock.yaml`. It fixes
  CVE-2023-30533 and CVE-2024-22363. The npm `xlsx@0.18.5` has both and the
  `@e965/xlsx` mirror is a third-party republisher: never use either.
- **Safety limits.** Only a file named `.xls` (not `.xlsm`, `.xlt`, `.xlsb`)
  whose first 8 bytes are `D0 CF 11 E0 A1 B1 1A E1`; HTML or other content
  disguised as `.xls` gets the hint. Input is capped at 20 MB before it is
  read. Parsing uses `sheetRows: 100000` and no `cellStyles`, `bookVBA` or
  `bookFiles`. Each file gets its own worker with a 30 s timeout; the worker is
  terminated after the file, on timeout, on error and when the scope is
  disposed. Any failure ends in the existing hint, never a crash. The server
  keeps all its checks and does not trust the conversion.
- **Output.** `XLSX.write(..., { bookType: 'xlsx', type: 'array',
  compression: true })`, uploaded as `<original base name>.xlsx` with the XLSX
  media type. Cells keep their values and number formats (`cellNF: true`;
  without it a date column arrives as a serial number); formulas keep their
  cached values; styles, charts and macros are not kept. SheetJS writes a fixed
  content-type table that maps `.bin` to the macro-enabled binary workbook
  type, and the server's Office reader treats that type as a macro marker and
  refuses the file as `ooxml_macro`, so the worker drops that one entry from
  the new package. Do not remove that step.
- **UI.** The attached chip shows "Converted from .xls" (under the text note
  when there is one), with a tooltip that says styles, charts and macros are not kept. The state is
  client-only (`convertedFromXlsKeys` from `useChatFiles`, keyed by storage
  key), so it is gone after a reload.
- **Maintenance.** Dependabot cannot see a tarball dependency, so a SheetJS
  security fix will not open a PR. Watch https://cdn.sheetjs.com/advisories/
  by hand and bump the tarball URL when an advisory lists a newer version.

## Data Model Reference

### `files`

- Purpose: per-file metadata, ownership, and lookup by storage key.
- Key columns:
  - `id` public id.
  - `userId` owner.
  - `storageKey` unique R2 key.
  - `name`, `type`, `size`.
  - `expiresAt`: nullable timestamp for retention cleanup.
  - `source`: `upload | assistant`.
  - `originMessageId`: nullable FK to `messages` for provenance.
  - `originProvider`: nullable provider id for provenance.
  - `textStatus`, `textBytes`, `textVersion`: nullable. The state of the text
    extracted from an Office file (`ready | empty | failed | too_large`), the
    UTF-8 size of the stored text, and the extractor version that made it.
    All three are null for every other file and for an Office file not read
    yet. No SQL defaults, so the migration is three `ALTER TABLE ... ADD`.
  - `textOmittedMedia`, `textOmittedCharts`: nullable integers, capped at 99.
    Images plus embedded objects, and charts plus diagrams, that the extracted
    text leaves out. NULL means not counted yet (a file stored before they
    existed, until its first send). No SQL defaults, so the migration is two
    `ALTER TABLE ... ADD`.

### `storages`

- Purpose: per-user quota policy and transform counters.
- One row per user (`UNIQUE(user_id)`).
- Key columns:
  - `tier`: `free | vip` (classification only).
  - `storage`: max storage bytes.
  - `maxFilesPerMessage`.
  - `maxMessageFilesBytes`.
  - `fileRetentionDays`: nullable retention policy for file expiry materialization.
  - `imageTransformLimitTotal`.
  - `imageTransformUsedTotal`.

### `image_transform_usage_monthly`

- Purpose: global monthly transform circuit breaker.
- Primary key: `monthKey` (`YYYY-MM`).
- Key columns:
  - `transformsUsed`.
  - `transformsLimit` (default `1000`).

### `chat_shares` (future shared chats)

- Purpose: share token lifecycle and revocation/expiry state.
- Key columns:
  - `id`.
  - `chatId`.
  - `revoked`.
  - `expiresAt`.

### `chat_share_files` (future shared chats)

- Purpose: explicit file grants per share.
- Key columns:
  - `chatShareId`.
  - `fileId`.
- Unique pair: (`chatShareId`, `fileId`).

## API Surface

- `GET /api/v1/files` list files with pagination and search. `source` is
  `all | upload | assistant | project | library`; with `source=project`, an
  optional `projectId` (public id) narrows the page to one project.
- `GET /api/v1/files/projects` the Projects tab groups (see below).
- `PUT /api/v1/files/upload` upload one file.
- `PATCH /api/v1/files/[id]/name` rename one file.
- `DELETE /api/v1/files/[id]` delete one file.
- `POST /api/v1/files/delete/bulk` bulk delete files.
- `GET /api/v1/files/policy` effective user policy + global monthly remaining.
- `GET /api/v1/storage` usage stats + policy summary.
- `GET /files/[key]` stream file bytes by storage key (owner/share access check).
- `POST /api/v1/internal/files/recompute-expiry` maintenance endpoint to
  recompute one user retention expiry timestamps.

## File Manager Modal

`app/components/ChatInput/Files/Modal.client.vue` is a `<dialog>` with
`modal-bottom sm:modal-middle`:

- Below `sm` (640px) it is the bottom sheet: `max-h-[80vh]`, height follows
  the content. This is unchanged from before the resize.
- From `sm` the box has a fixed height, `sm:h-[85vh] sm:max-h-[85vh]`, and is
  `sm:max-w-3xl`; from `lg` (1024px) it is `lg:max-w-5xl`. The height is fixed
  so the box does not jump while the user switches tabs, filters or searches
  (the same reasoning as the model picker's fixed sheet height in
  `docs/chats/model-picker.md`).
- The title, storage usage and the Select/Upload tabs are `shrink-0`; the
  active tab body is `flex-1 min-h-0`, and the file list scrolls inside it.
  The Upload drop zone grows to fill the box from `sm`.
- Grid view: 3 columns, 4 from `sm`, 6 from `lg`; the skeleton uses the same
  columns with 12 tiles (full rows at 3, 4 and 6). List view: from `lg` the
  name column is wider (`lg:max-w-sm`, a 48-character middle truncation
  instead of 24) and an "Added" date column appears.

## Source Tabs

The file manager has three source tabs: Uploaded (the default), Generated by AI
(hidden when the model has no image input) and Projects. There is no "All"
tab on the client: project files are already excluded from Uploaded and
Generated, so All would only repeat the first two. The server still accepts
`source=all`, which the MCP `list_files` tool uses. When the Generated tab is
hidden or its source becomes unavailable, the picker falls back to Uploaded.

The tabs come from a typed list in `app/utils/file-manager-sources.ts`
(types `FileSourceTab` in `app/types/file-manager.d.ts`):

- `fileManagerBuiltInSourceTabs` holds the three built-in tabs (`kind:
  'built-in'`). Their `id` is the `useFileManager()` `source` filter sent to
  `GET /api/v1/files`; `requiresImageInput` hides Generated by AI. Their
  `data-testid` values (`files-source-upload`, `files-source-assistant`,
  `files-source-project`) are used by unit and e2e tests and must not change.
- `getFileManagerExtraSourceTabs()` is the registry for other sources (Google
  Drive in G-6, documents in D-4). It returns no entries today.
- `resolveFileManagerSourceTabs()` returns the built-in tabs followed by every
  extra tab whose `isEnabled()` is true (a missing `isEnabled` means always
  shown).

To add a source tab, add one entry to `getFileManagerExtraSourceTabs()`:

```ts
{
  kind: 'extra',
  id: 'drive',
  label: 'Google Drive',
  testId: 'files-source-drive',
  component: ChatInputFilesModalSelectDrive,
  isEnabled: () => useFeature('google.drive').value.enabled,
}
```

`useFeature` arrives with the feature access work (P0-4); read its real
signature then. `isEnabled` runs inside a `computed`, so reactive feature
state shows or hides the tab live. Selecting an extra tab does not change the
`useFileManager()` source (its watcher would request `source=<id>` and get a
400); `Select.client.vue` keeps the extra tab id locally and renders
`component` in the scroll area instead of the built-in grid, list or project
groups. The component receives `attachedIds`, `search` and `viewMode` and may
emit `attach` with `FileManagerFile[]`, which the modal forwards like a normal
selection. The bulk actions toolbar of the built-in sources is hidden while an
extra tab is open, so it never acts on files the user cannot see. Picking a
built-in tab, opening the modal on a source, closing it, or the extra tab's
`isEnabled()` turning false leaves the extra tab. An extra entry whose `id`
matches a built-in id is dropped. The tab row scrolls horizontally (`flex-nowrap
overflow-x-auto no-scrollbar`) instead of wrapping when the tabs do not fit.

## Projects Tab

The Projects tab lists only files linked to project knowledge. Those files are
excluded from the Uploaded and Generated tabs.

- Default open state: when the list holds exactly one project it opens and
  loads its first page; with two or more projects every section starts
  collapsed and loads lazily on first open. While a search term is active, up
  to the first five matching sections open (a single match opens too). A
  files refresh resets to this default, while a background sync (used to reconcile after
  deletes) keeps the sections the user opened or closed.
- Section headers are sticky in both grid and table views: each `<summary>` is
  `position: sticky` (`top-0`, `h-11`, opaque `bg-base-100`, `z-20`) at the top
  of the modal's scroll area, so a long section keeps its header visible and
  clickable to collapse. Each header sticks within its own `<details>`, so the
  next section's header replaces it. daisyUI `collapse` leaves the `<details>`
  at `overflow: visible` and `isolation: isolate`, so nothing extra is needed
  for sticky to work (checked in Chromium and WebKit).
- In table view the pinned column header sits below the section header: the
  list view takes a `stickyOffset` prop (used only inside project groups) that
  adds `top-11` to the `<thead>`, matching the fixed `h-11` header height.
  Flat tabs keep `top-0`.
- Collapsing a section whose header is currently stuck (the user scrolled
  deep into it) scrolls that section to the top of the scroll area afterwards,
  so they do not land in the middle of the next section.

- `GET /api/v1/files/projects` returns the groups:
  `{ projects: [{ id, name, fileCount, pinned, archived }] }`. `id` is the
  project public id and `fileCount` counts distinct linked files. Notes (no
  file) are ignored, and `search` (name match, `%` and `_` literal) counts only
  matching files and omits projects with none. Order: pinned first, then
  active by recent activity, archived last. Archived projects are included so
  their files stay reachable. The list is capped at 200 projects.
- Each group loads its own pages lazily with
  `GET /api/v1/files?source=project&projectId=<id>&offset=&limit=`. A malformed
  or foreign `projectId` returns an empty page, not an error. Pages are ordered
  by `createdAt` then `id`, both descending, so equal timestamps do not shuffle
  between pages.
- A file linked to several projects shows under each of them, and its count is
  included in each group.
- `search` on `/api/v1/files` uses the shared escaped, case-insensitive
  contains match, so group counts and per-project pages agree.

## Endpoint Semantics and Failure Modes

### Upload (`PUT /api/v1/files/upload`)

- Requires auth session.
- Validates required headers and allowed MIME type (`allowedFileFormats` in
  `nuxt.config.ts`: WebP/PNG/JPEG images (no GIF), `application/pdf`,
  `text/plain`, `text/markdown`, `text/csv` and
  `text/tab-separated-values`). CSV and TSV are the main input of provider code
  execution (`docs/chats/code-execution.md`); they are read as text for the
  model like any `text/*` file. `normalizeUploadFile` also maps the types some
  browsers send for a `.csv` (`application/vnd.ms-excel`, `application/csv`)
  to `text/csv`.
- Markdown uploads: browsers often give a `.md` file an empty `File.type` (and
  some send `text/x-markdown`). `normalizeUploadFile` in `app/utils/files.ts`
  resolves the type from the extension (`.md`/`.markdown` to `text/markdown`,
  `.txt` to `text/plain`) before the type check, in both the upload modal and
  `useChatFiles().uploadFiles` (drop zone, image paste). A `text/markdown` file
  is read as text for the model like any `text/*` file
  (`server/utils/files/convert-files-for-ai.ts`), its download name gets the
  `.md` extension, and in the chat input it shows as a text card that opens a
  read-only viewer. Long pastes are not uploaded at all: see
  `docs/chats/chat-input-markdown.md`.
- Office uploads (`.docx`, `.xlsx`, `.pptx`) are accepted only while the
  `files.office` flag is active and go through their own checks and text
  extraction: see "Office attachments". A `.xls` is converted to `.xlsx` in the
  browser first and is still rejected here as a raw `.xls`.
- Uses real body size for quota checks (`X-Filesize` is not trusted).
- Checks user storage usage against effective policy.
- Image flow:
  - reserves per-user lifetime slot;
  - reserves global monthly slot;
  - attempts transform to WebP.
- If transform is unavailable/denied/fails, falls back to original bytes.
- If DB metadata insert fails after R2 put, R2 object is rolled back.

Common failure statuses:

- `400`: invalid headers/type/quota/policy violation.
- `401`: unauthorized.
- `500`: R2 put or DB write failure.

### Delete Single (`DELETE /api/v1/files/[id]`)

- Requires auth and ownership.
- Attempts R2 delete first (the file and, for an Office file, its extracted
  text sidecar, in one batched call through `withDerivedKeys()`).
- On R2 delete failure, returns error and keeps DB metadata intact.
- On success, invalidates file cache and storage stats cache, then deletes DB row.

Common failure statuses:

- `404`: file not found.
- `409`: storage delete failed (DB row preserved).

### Delete Bulk (`POST /api/v1/files/delete/bulk`)

- Requires auth.
- Body: `{ ids: string[] }` (`1..100`).
- Processes files sequentially.
- If an individual R2 delete fails, that file is not removed from DB.
- Returns partial failure as `409` after processing successful deletions.

Both routes and the MCP `delete_files` tool call
`server/utils/files/delete-files.ts`. When a deleted file was linked as project
knowledge, the row delete cascades the knowledge item rows away, so the helper
first collects `(projectId, itemId)` of the linked items and, after the row is
deleted, removes their `knowledge/u<userId>/p<projectId>/items/<itemId>.md` R2
text objects (one batch call per project; a failure is logged and does not fail
the delete). Before this, those text objects were left in R2 with no row and no
quota accounting.

### Storage/Policy (`GET /api/v1/storage`, `GET /api/v1/files/policy`)

- Require auth.
- Expose effective policy plus transform usage summary.
- Storage stats endpoint uses short TTL KV cache.

## Retention Cleanup Architecture

- File retention is materialized per file using `files.expiresAt`.
- Default free retention: `30` days.
- VIP effective retention: `null` (no automatic expiry).
- Shared chat references do not pin files against expiration.
- Cleanup uses `expiresAt <= now` only. It does not re-join per-file policy rows.
- Cleanup runs via Cloudflare cron through Nitro `cloudflare:scheduled` hook.
- Runtime controls:
  - `filesRetentionCleanupEnabled`
  - `filesRetentionCleanupBatchSize`
  - `filesRetentionCleanupMaxRuntimeMs`

### Background Logging in Cleanup Paths

- Cloudflare scheduled hooks do not run with an h3 request event.
- Because of that, code in cron/background paths must not assume `useEvent()`
  exists.
- Shared infra utilities used by cleanup (`useDb`, file storage, KV helpers)
  must stay request-agnostic and avoid `useEvent()` for config reads.
- Files module uses `server/utils/files/logger.ts`:
  - `LoggerLike` (minimal `set(...)` contract).
  - `resolveServerLogger(...)` to safely resolve logger in both request and
    non-request contexts.
- File helpers that can be called from both request handlers and cron jobs
  accept optional `logger?: LoggerLike` and pass it through.
- Cron entrypoint emits one structured evlog event per run and forwards the same
  logger into cleanup utilities for consistent context.

## Quota and Transform Governance

### Default Policy

- Free:
  - `20MB` max storage.
  - `10` max files per message.
  - `1GB` max total message file bytes.
  - `30` days file retention.
  - `0` lifetime transforms.
- VIP:
  - same storage/message defaults unless manually overridden.
  - no file retention expiry by default (`fileRetentionDays = null` effective).
  - recommended transform limit baseline: `100` lifetime transforms.

### Global Transform Guard

- Global monthly default: `1000`.
- Stored in `image_transform_usage_monthly`.
- Used as a circuit breaker to preserve transform budget for other projects.

### Counter Behavior

- User/global slots are reserved before transform.
- If transform fails, reserved slots are released.
- Slots remain consumed only when transform succeeds.

## Security and Ownership Guarantees

- Upload quota checks use actual request body length.
- File conversion for AI validates ownership before any storage read.
- `/files/[key]` access:
  - owner session is allowed; or
  - valid signed share token + matching file grant + active share.
- No `isPublic` bypass flag is used.

## Reliability Guarantees

- DB metadata is not deleted when R2 deletion fails.
- Cache invalidation failures are logged but do not block successful file delete.
- Upload DB insert failure triggers best-effort R2 rollback.
- Retention cleanup uses R2-first delete and keeps DB rows for retry on R2 failure.

## Assistant File Guardrails (Future Scope)

- Assistant-generated files must not be kept as final inline `data:` payloads in
  stored chat history.
- When assistant file generation is implemented, generated bytes should be
  persisted to R2 and metadata should be written to `files` with
  `source = 'assistant'`.
- Assistant message file parts should be rewritten to `/files/<storageKey>`
  before message persistence.
- Generated files use the same storage quota model as uploads.
- Generated files should be visible in the file manager by default.
- Assistant file parts are excluded from automatic model-context replay.
  Reuse should happen through explicit user reattach from file manager.
- Current `enableAssistantFilePersistence` flag is scaffolding-only and defaults
  to `false`.

## Operations Runbook (Manual DB Management)

`users.role` is not a source of truth for file policy in current implementation.
Use `storages` policy columns directly. Treat `tier` as metadata and always
update tier and explicit limit columns together.
`public.maxFilesPerMessage` and `public.maxMessageFilesBytes` do not cap DB values;
they only seed defaults and client fallback behavior.
`fileRetentionDays` controls future/retroactive file expiry materialization.

### 1. Inspect Current User Policy

```sql
SELECT
  u.id AS user_id,
  u.email,
  s.tier,
  s.storage AS max_storage_bytes,
  s.max_files_per_message,
  s.max_message_files_bytes,
  s.file_retention_days,
  s.image_transform_limit_total,
  s.image_transform_used_total
FROM users u
LEFT JOIN storages s ON s.user_id = u.id
WHERE u.email = 'friend@example.com';
```

### 2. Create/Upsert Policy Row

```sql
INSERT INTO storages (
  user_id,
  storage,
  tier,
  max_files_per_message,
  max_message_files_bytes,
  file_retention_days,
  image_transform_limit_total,
  image_transform_used_total
)
SELECT
  u.id,
  20 * 1024 * 1024,
  'free',
  10,
  1000 * 1024 * 1024,
  30,
  0,
  0
FROM users u
WHERE u.email = 'friend@example.com'
ON CONFLICT(user_id) DO NOTHING;
```

### 3. Promote User to VIP (Recommended Pattern)

```sql
UPDATE storages
SET
  tier = 'vip',
  storage = 200 * 1024 * 1024,
  max_files_per_message = 20,
  max_message_files_bytes = 2 * 1024 * 1024 * 1024,
  file_retention_days = NULL,
  image_transform_limit_total = 100
WHERE user_id = (
  SELECT id FROM users WHERE email = 'friend@example.com'
);
```

### 4. Apply Custom Limits Without Tier Change

```sql
UPDATE storages
SET
  storage = 500 * 1024 * 1024,
  max_files_per_message = 30,
  max_message_files_bytes = 3 * 1024 * 1024 * 1024,
  file_retention_days = 30,
  image_transform_limit_total = 250
WHERE user_id = (
  SELECT id FROM users WHERE email = 'poweruser@example.com'
);
```

### 5. Demote Back to Free Defaults

```sql
UPDATE storages
SET
  tier = 'free',
  storage = 20 * 1024 * 1024,
  max_files_per_message = 10,
  max_message_files_bytes = 1000 * 1024 * 1024,
  file_retention_days = 30,
  image_transform_limit_total = 0
WHERE user_id = (
  SELECT id FROM users WHERE email = 'friend@example.com'
);
```

### 6. Inspect Global Monthly Transform Usage

```sql
SELECT
  month_key,
  transforms_used,
  transforms_limit,
  (transforms_limit - transforms_used) AS transforms_remaining
FROM image_transform_usage_monthly
ORDER BY month_key DESC;
```

### 7. Recompute File Expiry After Policy Changes

After manual tier/retention updates, call maintenance recompute so `expiresAt`
is synchronized for existing files:

```bash
curl -X POST \
  -H "content-type: application/json" \
  -H "x-maintenance-token: $FILES_MAINTENANCE_TOKEN" \
  -d '{"userId":123,"graceDays":7}' \
  https://besidka.com/api/v1/internal/files/recompute-expiry
```

## Shared Chats: Future File Implementation Notes

### Access Model

- Keep owner-private file ownership model.
- Grant shared access by relationship, not by per-file public flags.
- Use:
  - `chat_shares` for token lifecycle and revocation;
  - `chat_share_files` for explicit file grants.

### Token Model

- Use short-lived signed token payload:
  - `shareId`,
  - `fileId`,
  - `exp`.
- Sign with HMAC using server secret (`encryptionKey`).
- Revoke by marking `chat_shares.revoked = true`.

### Authorization Policy for `/files/[key]`

- Allow when:
  - requester is owner; or
  - share token is valid and references file grant on active share.
- Deny all other access.

### Caching Policy for `/files/[key]`

- `/files/[key]` is an authorization-gated route, not a public asset route.
- Required response policy:
  - `Cache-Control: private, no-store, max-age=0`
  - `Vary: Cookie, x-file-access-token`
- Do not use `public, max-age=..., immutable` on `/files/[key]` in the current
  ownership/share-token model.

Why this is required:

- Owner access is session-based; public/shared caching can replay bytes to
  unauthorized requests without re-running auth checks.
- Shared chat file access is token-based and revocable/expiring. Long-lived
  public cache entries can outlive token expiry/revocation and serve stale
  authorized content.
- Owner delete/revoke semantics depend on revalidation at request time.

If CDN caching is needed in the future:

- Treat it as a separate design, not a header tweak.
- Use dedicated signed file URLs where the cache key fully includes a
  short-lived signature context.
- Keep TTL bounded by token expiry and define purge/invalidation on revoke,
  expiry, and file delete.

### Owner Delete Semantics

- Owner delete removes R2 object and DB metadata (only when R2 delete succeeds).
- Shared references should resolve to “file removed by owner” UI state.
- Message parts can remain for historical integrity, but no file bytes served.

### UX Notes for Shared Views

- Show clear state for missing/revoked/expired files.
- Avoid leaking owner identifiers in shared error messages.
- Ensure preview/attachment components degrade gracefully when file is removed.

## Complexity and Key Decisions

- DB policy over app config:
  needed for per-user manual control and OSS-hosted cost governance.
- Lifetime transforms + global monthly guard:
  controls both abusive users and total account budget usage.
- Transform fallback to original bytes:
  prioritizes user upload success over optimization.
- R2-first delete with DB preservation on failure:
  prevents silent storage leaks and metadata inconsistencies.
- Share grants + signed tokens:
  future-safe model without unsafe `isPublic` shortcuts.

## Known Issues and Fixes

### `data:` URL handling (resolved in AI SDK v7)

`convertFilesForAI()` encodes R2 file bytes as `data:<mime>;base64,<content>`
strings in `FileUIPart.url`. In AI SDK v6 this silently broke attachments
(images, PDFs) with `"URL scheme must be http or https, got data:"`:
`convertToModelMessages()` mapped `url` → a plain-string `FilePart.data`, and
`streamText()`'s `downloadAssets()` pipeline then ran `new URL(data)` on it.
Because `data:` strings are valid `URL` objects, they entered the download path
where the http/https SSRF guard (`provider-utils` ≥ 4.0.15) rejected them.

This was worked around by `server/utils/files/resolve-data-urls.ts`, which
rewrote `data:` URL strings to `Uint8Array` before the download stage.

**AI SDK v7 fixes this upstream** ([vercel/ai#13103](https://github.com/vercel/ai/issues/13103)):
`convertToModelMessages()` still emits `{ type: 'url', url: new URL(part.url) }`
for file parts (including `data:` URLs). The split happens *inside*
`downloadAssets()`: its internal `convertUrlToFilePartData()` detects
`url.protocol === 'data:'` and converts the entry to `{ type: 'data', data }`,
after which the `.filter(part => part.data.type === 'url')` step removes it from
`plannedDownloads` — so it never reaches the http/https SSRF guard. The
`resolve-data-urls.ts` workaround was removed during the v7 upgrade; inline
`data:` URLs in `FileUIPart.url` now pass straight through. Note: passing a
`data:` URL *inside* a `{ type: 'data', data }` part is rejected
(`InvalidDataContentError`) — send raw bytes via `{ type: 'data' }` or a
`data:`/hosted URL via `url`.

## Troubleshooting

- Upload hangs/errors with many files:
  check parallel R2/KV usage and connection fan-out.
- Unexpected quota rejections:
  query `storages` row and compare with actual file sum in `files`.
- Transforms not occurring:
  check user transform limit and monthly global remaining.
- File missing in AI conversion:
  verify ownership and `/files/<key>` origin in message parts.
