# Documents in chat (`create_document`, D-4)

Status: implemented by BES-293, layer 3 of the native stack "documents" (D-2,
D-3, D-4, D-5, D-6). A chat model writes a JSON spec through the
`create_document` tool, the browser renders the file from that spec, the
server validates it through `DOC_RENDERER` and stores it as a normal private
file, and the result shows as a card in the message with a preview in the
shared side panel. Spec contract: `docs/chats/documents-spec-package.md`.
Renderer Worker: `docs/chats/documents-renderer-worker.md`.

## Flow

1. The send endpoint registers the tool through the capability registry
   (`server/capabilities/documents.ts`, `defineCapability`) when the
   `documents` flag and at least one `documents.<format>` flag are active,
   the model supports tool calling and no forced `toolChoice`, exclusive
   native search or `image_generation` is requested.
2. `execute` (`server/utils/documents/create-document-tool.ts`) validates the
   spec, resolves image `fileId`s to the user's own PNG and JPEG files, writes
   the spec to R2 (`documents/<userId>/<documentId>/spec.v<n>.json`), inserts a
   `documents` row with `status: 'spec_ready'` and returns
   `{ documentId, format, title, specVersion, stats }`. At most three calls per
   turn; the counter is claimed before the first `await`.
3. `rewriteDocumentToolParts` replaces the tool part with a `data-document`
   part (`documentId`, `format`, `title`, `specVersion`, `status`) before the
   message is persisted, so `messages.parts` never holds spec text. A rejected
   call that the AI SDK stores as a `dynamic-tool` part is reduced the same
   way. After the insert, `linkDocumentsToMessage` writes the message row id
   onto the document and its file.
4. When the message stops streaming, `useDocumentFlow` (browser) fetches the
   status, fetches the spec, renders in `app/workers/document-render.ts`,
   validates locally and posts the bytes to `POST /api/v1/documents/:id/file`.
   Specs with image blocks skip the client render and go straight to
   `POST .../render`, because only the server can read the images.
5. `file.post` checks `Content-Length` (411 missing, 413 over 20 MiB) before
   claiming, claims the row, reads the body with a hard cap, validates through
   `DOC_RENDERER` (the spec is passed for XLSX), requires provenance `ai`,
   persists with `persistFile` (`source: 'assistant'`) and marks the row
   `ready` (`renderedBy: 'client'`). `render.post` renders on the server
   (`renderedBy: 'worker'`). Any other client failure calls `render.post`
   once; 413, 429 and 507 do not, because the server would fail the same way.
6. The card polls `GET /api/v1/documents/:id` every 3 s while `rendering`
   and stops after 120 s with a Try again button.

## State machine

`spec_ready` to `rendering` (claim) to `ready` or `failed`. The claim is one
`UPDATE ... RETURNING` with a 120 s lease. `markDocumentReady`,
`markDocumentFailed` and `releaseDocumentClaim` only act while the caller's
own claim (`renderLeaseUntil` and `renderAttempts` it received) still holds
the row, so an expired request cannot fail, release or finish a newer claim.
A `rendering` row with an expired lease is reported as `spec_ready` by the
status route without writing.

## Data and deletion

`documents` has no foreign key and no cascade (a rebuild of any table must not
touch it, see `docs/d1-restore-reconciliation.md`). Retention follows the
pre-check D-10 row 3:

- File deleted (single, bulk, retention): the spec object is deleted, the row
  keeps `failed` / `file_deleted` with `title` null so a persisted card says
  "unavailable".
- Chat, message or bulk chat delete: rows with no surviving file are deleted
  with their spec; rows whose file survives lose `title` and `originChatId`.
  A branch's `data-document` part is not a reference that keeps the file, so
  deleting the source chat makes the branch card "unavailable".
- `sweepOrphanedDocuments` (retention cron): repairs rows whose file row is
  gone, deletes failed rows with no file and no chat, and expires specs of
  never-rendered rows after 7 days (`spec_expired`).
- `purgeUserData` deletes every row and every object under
  `documents/<userId>/`.

## Sharing and branching

The shared view never receives a document id. `resolveSharedDocumentParts`
turns each part into a title-only card, or, when the share has `showFiles`
and the file is granted in `chat_share_files`, a card with a tokenized
download link. `enumerateChatFileIds` includes the files of the chat's ready
documents and `finalizeRenderedDocument` re-syncs the grants of an active
`showFiles` share. A shared branch drops `data-document` parts; an own-chat
branch keeps them. The share personal-data check reads document titles.

## UI

`ChatDocument` (card) and `ChatDocumentPreview` (side panel body) live in
`app/components/Chat/`. DOCX, PPTX and XLSX previews are Vue templates over
the spec (no `v-html`); PDF is an `<iframe>` of the same-origin `/files/<key>`
URL plus an "Open in a new tab" link (some iOS versions show one page). The
file manager "Generated by AI" tab is visible for every model, has an
All / Images / Documents filter (`kind` query on `GET /api/v1/files`) and
disables files the current model cannot take (existing image and PDF
checks only; there is no helper for Office input yet).

"Open in Google" is G-5 and is not built: the card has an `extraActions`
slot and the preview a `header-actions` slot for it. There is no
`google.drive` flag yet and none was added.

## Flags

`documents` and `documents.pdf|docx|pptx|xlsx` are `internal`, admin only,
and now `available: true` (the routes 404 and the tool is not registered
otherwise). Routes guard `documents` only; a format flag switched off later
does not block documents that already exist.

## Deviations from the ticket

- Extra nullable columns: `stats`, `originProvider`, `originModel`,
  `originMessagePublicId`; `title` is nullable (pre-check retention rule).
- Rate limits use the auth KV limiter and fail open on a KV error (one write
  per second per key would otherwise fail a three-document turn).
- `createDocument` passes no provider id (the capability context has none),
  so `originProvider` stays null.
- `render.post` and `file.post` check the session before the feature flag so
  a signed-out user gets 401 and not 404.
- The client path for DOCX, PPTX and PDF is not bound to the spec (only XLSX
  is compared): a user can store a hand-made file that carries the AI mark.
  The file is private to the user; revisit before documents leave `internal`.
- The chat model context line lists up to 10 document names (sanitised to
  letters, numbers and a few punctuation marks, labelled as data).

## Local development and tests

`pnpm run doc-renderer:dev` and `pnpm run dev` (see the renderer doc). The
mock provider scenario `/chats/test?scenario=document` (test mode only)
creates a real document and streams a `create_document` call; the Playwright
config starts the renderer as a third web server. Specs are registered in
`scripts/test-affected-check.mjs` (`documentsChatTests`,
`documentsFileManagerTests`).

## Not verified

Snyk scan, the e2e spec `tests/e2e/chat/create-document.spec.ts` in CI,
iOS Safari and PWA, the PDF iframe in a real browser viewer, production
`DOC_RENDERER` CPU, the preview-database migration.
