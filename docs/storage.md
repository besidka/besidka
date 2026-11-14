# Storage

Every account has one storage allowance (20 MB by default, the `storages`
policy row read by `getEffectiveUserFilePolicy`, capped by
`filesHardMaxStorageBytes`). Everything a user keeps in Besidka draws on it,
and the Storage page (`/profile/storage`) shows what fills it. BES-393.

## What counts

Five categories, defined once in `server/utils/storage/categories.ts`
(`STORAGE_CATEGORIES`). Each gives a bytes expression and a count expression
for a user; the total is their sum.

| Id | What | How it is told apart |
| --- | --- | --- |
| `aiImages` | Images the models generated | `files.source = 'assistant'` and `files.type like 'image/%'` |
| `uploads` | Files the user uploaded or created through MCP | `files.source = 'upload'` |
| `generatedFiles` | Rendered documents, code-execution output and other generated files | `files.source = 'assistant'` and `files.type not like 'image/%'` |
| `artifacts` | Every stored version of every artifact | `sum(artifacts.total_bytes)`, counting rows with `current_version > 0` (a pending header from an interrupted write has `0` bytes and no version) |
| `knowledge` | Text extracted from project files and notes | `sum(project_knowledge_items.text_bytes)` |

The three file categories partition `files` by `source` and `type`, so their
sum equals `sum(files.size)`. No column was added for this.

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
| Every stored file: generated images, documents, code-execution files, MCP `create_file` | `persistFile` (before the R2 put and again after the row insert) |
| Image generation | `assertGeneratedImageStorageAvailable` needs 10 MB free before the provider is called; the save goes through `persistFile` |
| Document creation | The chat `create_document` tool checks first and returns a plain tool error; the rendered file goes through `persistFile` (`finalizeRenderedDocument`, 413 with code `quota_exceeded`); MCP `create_document` answers 413 in the message |
| Artifact create and update | `createArtifact` and `appendArtifactVersion` in `artifacts/store.ts` call `assertStorageAvailable`, so the chat tools, the app routes and MCP `create_artifact` and `update_artifact` are all covered. The old 25 MB artifact quota is gone |
| Project knowledge | `assertKnowledgeCapacity` and the guarded insert and update statements in `knowledge/ingest.ts` |

Model tool calls never fail the stream. `toToolError` in `artifact-tools.ts`
maps `storage_full` to the `artifact-quota` tool error, whose text reads
`Storage is full. X of Y used. Free space on the Storage page.`;
`create_document` returns `document-storage-full`
(`describeStorageFullForModel`); the image tool keeps its persisted
`storage-quota` failure text. MCP clients get the same sentence folded into
the error message (`withReadableDetails`).

The check is read-then-write, so concurrent writes can overshoot by one write
each. That is accepted; the knowledge statements are atomic.

An account over its allowance (for example because artifacts now count) keeps
everything. Every new write is refused until it is back under, and the Storage
page clamps the bar at 100%.

## Not counted yet: skills

The skills tables (`skills`, `skill_versions`, `skill_files`, with `bytes`
per skill) are already on `main` (#864), but no skill writer or route exists
yet and skills are not in `STORAGE_CATEGORIES`. The layer that adds the
writers registers a `skills` category as described under "Adding a category"
and makes its writes call the guard.

## Cache

`GET /api/v1/storage` is cached in KV for 60 seconds under
`storage-stats:<userId>`; `invalidateStorageCache` drops it. Writers and
deleters call it: `persistFile`, file deletion and expiry, chat deletion
cleanup, knowledge ingest, project lifecycle, account purge and, since BES-393,
`createArtifact`, `appendArtifactVersion` and artifact deletion. A cached entry
without `breakdown` (written before this shipped) is treated as a miss.

## The page

`app/pages/profile/storage.vue`: one `UiBubble`, "X of Y used" with a daisyUI
`progress` (primary, warning from 80%, error at 100%), a row per category with
size, count and a Manage action (the file manager on the right source for AI
images, uploads and generated files, `/chats/artifacts` when the `artifacts`
feature is on, `/chats/projects`), a skeleton after 300 ms, an error state with
Retry and an empty state. Labels, icons and links live in
`app/utils/storage-categories.ts`. The page has a tab in
`app/layouts/profile.vue` and the `search-option-storage` row in the Search
modal; it is deliberately not in the sidebar user dropdown.

## MCP

`get_settings` (`settings:read`, since 3.2.0) returns a `storage` block:
`usedBytes`, `totalBytes` and `categories` (`id`, `bytes`, `count`). See
`docs/mcp-server.md`.

## Adding a category

Skills (or any later feature that stores bytes per user) registers with one
entry:

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
