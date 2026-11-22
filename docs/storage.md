# Storage

Every account has one storage allowance (20 MB by default, the `storages`
policy row read by `getEffectiveUserFilePolicy`, capped by
`filesHardMaxStorageBytes`). Everything a user keeps in Besidka draws on it,
and the Storage page (`/profile/storage`) shows what fills it. BES-393.

## What counts

Eight categories, defined once in `server/utils/storage/categories.ts`
(`STORAGE_CATEGORIES`). Each gives a bytes expression and a count expression
for a user; the total is their sum.

| Id | What | How it is told apart |
| --- | --- | --- |
| `aiImages` | Images the models generated | `files.source = 'assistant'` and `files.type like 'image/%'` |
| `uploads` | Files the user uploaded or created through MCP | `files.source = 'upload'` and `files.external_source is null` |
| `googleDrive` | Copies of the Google Drive files the user picked (`docs/google.md`, section 12) | `files.source = 'upload'` and `files.external_source is not null` |
| `generatedFiles` | Rendered documents, code-execution output and other generated files | `files.source = 'assistant'` and `files.type not like 'image/%'` |
| `connectorImages` | Images connectors returned in chats and Besidka kept with those chats (C-15, BES-406) | `files.source = 'connector'` |
| `artifacts` | Every stored version of every artifact | `sum(artifacts.total_bytes)`, counting rows with `current_version > 0` (a pending header from an interrupted write has `0` bytes and no version) |
| `knowledge` | Text extracted from project files and notes | `sum(project_knowledge_items.text_bytes)` |
| `skills` | Every stored version of every skill | The bytes of unique blobs: `skill_files` rows deduplicated by `(skill_id, blob_sha256)`, so a blob counts once per skill however many versions hold it (the way R2 stores it). The count is the number of `skills` rows (`userSkillsBytesSql` and `userSkillsCountSql` in `skills/usage.ts`) |

The file categories (`aiImages`, `uploads`, `googleDrive`, `generatedFiles`,
`connectorImages`) partition `files` by `source`, `type` and
`external_source`, so their sum equals `sum(files.size)`; `uploads` excludes
the Drive copies so none is counted twice. No column was added for this: `connector` is a
new value of the app-level `source` enum on the existing text column, which
needed no migration (`db:generate` reports no schema change).

Connector images are hidden from every file list (`getFilesSourceCondition`
excludes `source = 'connector'`), so the Storage page is the only place that
shows them outside their chat; see `docs/connectors.md` section 6.5.

### What is not counted

- Data that visitors store inside an artifact a user shared
  (`artifact_storage`, per viewer, capped separately at 100 KB per artifact and
  viewer). It belongs to the viewer.
- Document specs (the JSON outline in R2 that a document is rendered from),
  project knowledge packs, and the extracted text of Office files kept next to
  a file (`office-text`). They are small, derived and removed with the item
  they belong to.
- A file linked to a project counts in `uploads` **and** its extracted text
  counts in `knowledge`. That is two different objects in R2 (the original and
  the text), so both are real bytes.

## One number

`getUserStorageUsageBytes(userId)` (`file-governance.ts`) runs one statement
built from `userStorageUsedBytesSql(userId)`, the sum of every category's bytes
expression. The atomic guards in `knowledge/ingest.ts` embed the same fragment,
so a guard and the API can never disagree. `getUserStorageBreakdown(userId)`
(`storage/usage.ts`) runs one statement for the per-category bytes and counts;
it is used by `GET /api/v1/storage` and the MCP `get_settings` tool only, never
on a write path.

## Enforcement

A write that would pass the allowance is refused, nothing is deleted, and
existing data stays readable. HTTP routes throw `createStorageFullError`
(`storage/errors.ts`): status `413`, message `Storage is full`, code
`storage_full`, `why` `X of Y used`, `fix` `Free space on the Storage page`,
`link` `/profile/storage`. `assertStorageAvailable` (`storage/guard.ts`) is the
check for writers that have no quota of their own.

| Write path | Where it is checked |
| --- | --- |
| File upload, file create | `upload.put.ts`, `create.post.ts` (Content-Length, streamed body and the final size), then `persistFile` |
| Google Drive copies | `POST /api/v1/google/drive/files`: the metadata size and the space left are checked before the download, the same cap bounds the stream, then `persistFile`; a refusal is a per-file `storage_full` result, not a thrown 413 |
| Every stored file: generated images, documents, code-execution files, MCP `create_file` | `persistFile` (before the R2 put and again after the row insert) |
| Image generation | `assertGeneratedImageStorageAvailable` needs 10 MB free before the provider is called; the save goes through `persistFile` |
| Document creation | The chat `create_document` tool checks first and returns a plain tool error; the rendered file goes through `persistFile` (`finalizeRenderedDocument`, 413 with code `quota_exceeded`); MCP `create_document` answers 413 in the message |
| Artifact create and update | `createArtifact` and `appendArtifactVersion` in `artifacts/store.ts` call `assertStorageAvailable`, so the chat tools, the app routes and MCP `create_artifact` and `update_artifact` are all covered. The old 25 MB artifact quota is gone |
| Project knowledge | `assertKnowledgeCapacity` and the guarded insert and update statements in `knowledge/ingest.ts` |
| Skill create, import, update check, save and restore | `assertLimits` (`skills/import/commit.ts`) before any write, the atomic skill-row insert (`insertSkillWithinLimits`) and the guarded version insert (`buildGuardedVersionStatements`), all against the shared total. A refusal is the same 413 `Storage is full` with a link to `/profile/storage`. A write that adds no new blob bytes (a delete, a restore over existing blobs) is never refused, even while the account is over its allowance |

Model tool calls never fail the stream. `toToolError` in `artifact-tools.ts`
maps `storage_full` to the `artifact-quota` tool error, whose text reads
`Storage is full. X of Y used. Free space on the Storage page.`;
`create_document` returns `document-storage-full`
(`describeStorageFullForModel`); the image tool keeps its persisted
`storage-quota` failure text. MCP clients get the same sentence folded into
the error message (`withReadableDetails`).

The check is read-then-write, so concurrent writes can overshoot by one write
each. That is accepted; the knowledge statements and the guarded skill
statements are atomic. A skill row is inserted before its files, and the row
itself is not counted (only `skill_files` is), so two skill creations racing
at the very end of the allowance can both pass the insert guard.

An account over its allowance (for example because artifacts now count) keeps
everything. Every new write is refused until it is back under, and the Storage
page clamps the bar at 100%.

## Skills

Skills have no byte cap of their own. The old `SKILLS_MAX_USER_BYTES`
(50 MiB) is gone: the bytes of a skill draw on the same allowance as files,
artifacts and project knowledge. The per-skill caps stay (5 MiB per skill,
1 MiB per file, 200 files, the 50 skill count cap, per-save limits), and see
`docs/skills.md` for the rest of the skills limits. Deleting a skill or a
version frees its bytes: versions beyond `SKILL_VERSIONS_KEPT` are pruned on
every save, and a pending update counts until it is accepted or rejected.

## Cache

`GET /api/v1/storage` is cached in KV for 60 seconds under
`storage-stats:<userId>`; `invalidateStorageCache` drops it. Writers and
deleters call it: `persistFile`, file deletion and expiry, chat deletion
cleanup, knowledge ingest, project lifecycle, account purge and, since BES-393,
`createArtifact`, `appendArtifactVersion`, artifact deletion and every skill
write: create, save, restore, import, update check, accepting or rejecting an
update, and delete. A cached entry
without `breakdown` (written before this shipped) is treated as a miss.

## The page

`app/pages/profile/storage.vue`: one `UiBubble`, "X of Y used" with a daisyUI
`progress` (primary, warning from 80%, error at 100%), a row per category with
size, count and a Manage action (the file manager on the right source for AI
images, uploads and generated files, `/chats/artifacts` when the `artifacts`
feature is on, `/chats/projects`, `/chats/skills` when the `skills` feature is
on). The "Connector images" row has no Manage action: it has **Delete all**
(a confirm dialog, then `POST /api/v1/storage/connector-images/delete`,
called again while it answers `hasMore`, at most 100 times, then a refresh;
one call deletes at most 3 batches of 90),
because those images are in no file list. The rest: a skeleton after 300 ms,
an error state with
Retry and an empty state. Labels, icons and links live in
`app/utils/storage-categories.ts`. The page has a tab in
`app/layouts/profile.vue` and the `search-option-storage` row in the Search
modal; it is deliberately not in the sidebar user dropdown.

## MCP

`get_settings` (`settings:read`, since 3.2.0) returns a `storage` block:
`usedBytes`, `totalBytes` and `categories` (`id`, `bytes`, `count`, with
`skills` and `connectorImages` among them). `delete_connector_images`
(`data:delete`, since 5.2.0) deletes the connector images. See
`docs/mcp-server.md`.

## Adding a category

Skills registered this way, and any later feature that stores bytes per user
registers with one entry:

1. Add the id to `StorageCategoryId` in `shared/types/files.d.ts`.
2. Add one `StorageCategoryDefinition` to `STORAGE_CATEGORIES` in
   `server/utils/storage/categories.ts`: a `bytesSql(userId)` and a
   `countSql(userId)` that are scalar subqueries (`select coalesce(sum(bytes),
   0) from skills where user_id = ...`).
3. Add its label, icon, noun and action to `STORAGE_CATEGORY_META` in
   `app/utils/storage-categories.ts`. The page skips ids it does not know, so
   this step is what makes the category visible there. The API, the guards and
   the MCP block return every registered category regardless.
4. Make its writers call `assertStorageAvailable` (or embed
   `userStorageUsedBytesSql` in an atomic statement) and
   `invalidateStorageCache` after writes and deletes.

The total, the guards in `ingest.ts`, the API and the MCP block pick the new
category up without further changes. `tests/unit/server/utils/storage/usage.spec.ts`
shows a registered extra category flowing into the total and the breakdown.
