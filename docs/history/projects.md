# History Projects

## Overview

This document describes the current projects implementation linked with chat
history:

- projects list page with cursor-based infinite loading
- project detail page
- creating, renaming, pinning, archiving, and deleting projects
- moving chats into and out of projects
- project instructions
- project memory
- cache persistence between project-related pages
- current test coverage for the scope

## Pages and State

### Projects list page

- `app/pages/chats/projects/index.vue`
- Uses `useProjects()`
- Supports search, sort, archive toggle, and create flow
- Infinite scroll via intersection observer when `hasMore` is true

### Project detail page

- `app/pages/chats/projects/[id].vue`
- Uses `useProjectChats(projectId)`
- Shows project metadata plus pinned and unpinned chats inside that project
- Includes instructions editing and project memory refresh UI

### Project picker modal

- `app/components/Projects/ProjectPicker.client.vue`
- Used from history actions to move chats
- Can also create a new project inline before selecting it

## Project List Behavior

### Search

- Server search is active for `2+` characters
- Search matches project name only

### Sort

- `activity`
- `name`

### Archive filter

- Active and archived projects are separate list views
- Archive visibility is part of the projects cache key

### Pinning

- Pinned projects render separately above regular projects
- Pinned projects are only returned on the first page (no cursor)
- Current server-side pinned limit is `50`

## Loading Model

### Infinite scroll

- Unpinned projects are loaded with cursor pagination
- Default page size is `30`
- Max page size is `100`
- Cursor is polymorphic: keyset varies by sort mode
  - `activity` sort: compound `(activityAt DESC, id DESC)`
  - `name` sort: compound `(name ASC, id ASC)`
- Search mode and archive toggle reset the cursor on each fetch
- `nextCursor` is `null` when all projects have been loaded

### Response shape

```typescript
interface ProjectsResponse {
  pinned: Project[]
  projects: Project[]
  nextCursor: string | null
}
```

### Cursor implementation

- `server/utils/projects/cursor.ts`
- `createProjectsCursor(row, sortBy)` — serializes keyset position
- `parseProjectsCursor(cursor, sortBy)` — deserializes and validates; returns
  `null` on any mismatch or parse failure

## Project Detail Behavior

The project detail response includes:

- `project`
- `pinned`
- `chats`
- `nextCursor`

Unpinned chats inside a project use cursor pagination, while pinned chats are
returned separately.

## Project Instructions

Project instructions are request-time context only.

- They are never persisted as `messages` rows
- They are injected as a synthetic system message on every generation request
- The effective instructions always come from the chat's current `projectId`

Move semantics:

- moving a chat into a project applies that project's instructions on the next turn
- moving a chat between projects switches future turns to the new project only
- removing a chat from a project removes project instructions from future turns
- in-flight generations keep the request snapshot they started with

## Project Memory

Project memory is project-scoped, read-only in v1 (the user can only toggle it
on or off and trigger a refresh), and also request-time context.

- Stored on `projects.memory`, capped at 4k chars
- Refreshed from chats currently assigned to the project
- Generated on the user's own BYOK key with the cheapest available provider
  (see "Model selection")
- The refresh behaviour below lives in `server/utils/projects/` (`memory.ts`,
  `memory-limits.ts`, `memory-lease.ts`, `instructions.ts`); the model it runs
  on is decided by `server/utils/memory/resolve-model.ts` (see "Model choice
  and redaction (W3, 2026-10-25)")

Refresh triggers:

- assistant response completion in a project chat
- chat moved into or out of a project
- bulk move
- chat deletion
- branch creation in a project

Every trigger only marks the project `stale` (`memoryDirtyAt`) unless the
status is `disabled`; the client then calls the refresh endpoint.

### Injection

`buildProjectSystemPrompt()` injects the last-known-good `projects.memory`
whenever it is non-empty and `memoryStatus` is not `disabled`.

- `memoryStatus` only drives the UI. `stale`, `refreshing`, `failed` and
  `unavailable` still inject the previous memory, so a user message (which
  flips the status to `stale`) never makes memory vanish from the next prompt
- Disabling memory clears `projects.memory`, so `disabled` never injects
- Project instructions stay primary; memory is secondary background context
  and loses any conflict with the instructions

### Refresh lease

A refresh is guarded per project so concurrent refreshes do not double-spend
the user's key.

- KV key `project-memory-refreshing:<projectId>`
- 120 s lease renewed by a 30 s heartbeat, reusing the generation-guard
  helpers (`putGenerationGuard`, `startGenerationGuardHeartbeat`); see
  `docs/chats/stuck-generation-guard.md`
- A live lease makes a second refresh return the current state without
  doing any work
- A `refreshing` row with no live lease (the Worker died) is recovered by the
  next refresh: only the lease decides, not the status
- On read, a stored `refreshing` status without a live lease is reported as
  `stale` (`resolveProjectMemoryDisplayStatus`, applied by
  `getProjectMemoryState` and `GET /api/v1/projects/:id`), so the project page
  stops polling a dead refresh. Read-only, the row is not rewritten; an
  unreadable lease counts as held
- The lease is released in `finally`; release failures are logged, not thrown
- KV read errors fail open: the refresh proceeds without a lease check

Known gaps:

- KV get-then-put is not atomic, so two refreshes that start within the same
  few milliseconds can both acquire the lease. Rare, and the cost is one
  duplicate refresh
- A crashed refresh shows `Refreshing` for up to the lease expiry (about 2-3
  minutes), then reads as `stale`
- The lease has no owner token and get/put is not atomic: the first finisher
  deletes the key even if a second refresh took it meanwhile. Accepted, and
  shared with the generation guard

### Bounded refresh

One refresh is a single synchronous request, so its input and output are
capped by `PROJECT_MEMORY_LIMITS` (`memory-limits.ts`):

| Limit | Value |
|---|---|
| Chats considered (newest activity first) | 20 |
| Chats summarised per refresh | 6 |
| Messages per transcript | 60 |
| Characters per transcript | 12k |
| Characters per user message | 3k |
| Characters per assistant message | 1k |
| Characters per chat summary | 1.5k |
| Characters of project memory | 4k |

Rules:

- Chats are read by `activityAt` descending and cut at 20. Chats beyond the
  20 most recently active are not summarised and do not contribute to memory
- Staleness is judged from the newest persisted message of each chat
  (`projectMemorySummaryUpdatedAt >= newest message createdAt`), not from
  `activityAt`
- Fresh chats reuse their cached `projectMemorySummary`; stale chats are
  summarised newest first, at most 6 per refresh, one sequential LLM call each
- Leftover stale chats keep their cached (older) summary, which still feeds
  the merge, and the project ends `stale` with `memoryDirtyAt` set so the next
  refresh continues. The project is `ready` only when nothing is pending
- A `NONE` summary counts as fresh: it is stored as `null` with an updated
  timestamp, so the chat is not re-summarised until a new message arrives
- A transcript keeps the newest messages that fit the 12k budget (message
  separators and the marker count toward it) and is prefixed with
  `[earlier messages omitted]` only when older messages were dropped; exactly
  60 messages is not an omission
- Summaries over 1.5k chars and a merged memory over 4k chars are truncated
  with an ellipsis; the memory is cut at a line break when one falls in the
  last 20% of the budget
- On failure the previous `projects.memory` is left untouched and the status
  becomes `failed`
- Every refresh-path write (`refreshing`, success, `failed`, `unavailable`)
  carries `memoryStatus <> 'disabled'`, and the success write re-reads the
  project first and is skipped when it was disabled mid-pass, so a refresh never
  overrides Disable. Toggling memory stays unconditional
- A message that arrives during the pass keeps the project `stale` with its
  `memoryDirtyAt`, even when no chat is pending. It is detected by comparing the
  re-read `memoryDirtyAt` with the snapshot read at the start of the pass: a
  non-null value that is strictly greater, or any value when the snapshot was
  null. Timestamps have second granularity, so a second message in the same
  second as the existing marker is missed (accepted); in exchange the usual
  flow, where a message marks the project stale and the client refreshes in the
  same second, ends `ready` instead of costing a second pass
- When the 20-chat window yields no summaries, existing memory and
  `memoryUpdatedAt` are kept: older chats beyond the window may hold durable
  memory, so an empty window never wipes it
- A chat's summary timestamp is captured before its messages are read, so a
  message inserted during the read leaves that chat stale for the next refresh

### Trust boundary

- User text is the primary source; assistant text is secondary context only
  because it can echo web, tool or file content
- Only `text` parts are ever fed to the summariser. Tool, file, source,
  reasoning and data parts are never included
- Transcripts and chat summaries are data, not instructions: the transcript is
  wrapped in `<transcript>` tags and each summary in `<summary index="n">`
  tags, both prompts call the tagged content untrusted data, and the
  summariser must not record instructions or claims that appear only in
  assistant text or in quoted or pasted material

### Model selection

Each direct provider flags exactly one model with `forProjectMemory`. Since
W3 this is only the last step of the resolution chain (see "Model choice and
redaction (W3, 2026-10-25)" below): the fallback walks
`MEMORY_MODEL_PROVIDER_ORDER` (a cost ranking, still exported from
`memory.ts` as `PROJECT_MEMORY_PROVIDER_ORDER`) and picks the first provider
the user has a saved key for.

| Provider | Model | $/1M input | $/1M output |
|---|---|---|---|
| `openai` | `gpt-6-luna` | 0.10 | 0.50 |
| `anthropic` | `claude-haiku-5-5` | 0.10 | 0.50 |
| `qwen` | `qwen3.8-flash` | 0.15 | 0.47 |
| `deepseek` | `deepseek-flash` | 0.15 | 0.60 |
| `google` | `gemini-3.1-flash-lite` | 0.25 | 1.50 |
| `moonshotai` | `kimi-k2.6` | 0.95 | 4 |
| `xai` | `grok-4.20-0309-non-reasoning` | 1.25 | 2.50 |

- Users with none of these keys and no other resolvable model get
  `unavailable`; the fallback step never picks a gateway, a gateway is only
  used when the user's setting or the source chat selects one
- `qwen3.7-flash` was skipped: its price is only a "from" lower bound and the
  catalog snapshot carries no cost for it
- The order puts `openai` before `google`, the reverse of the earlier catalog
  order, because `gemini-3.1-flash-lite` costs more than `gpt-6-luna`
- Reasoning is off for every provider except OpenAI, which gets `low`

### Model choice and redaction (W3, 2026-10-25)

Workstream W3 of `docs/memory-architecture.md` (sections 3.9 and 3.10) changes
how a refresh picks its model and what it may store.

- Project memory resolves its model with `resolveMemoryModel({ scope:
  'project', projectId })`: the user's `projectMemoryModel` setting first,
  then the model of the project's most recent chats, then the cost-ranked
  fallback above. Gateway models are supported on the first two steps.
- `resolveProjectMemoryModel` and `getProjectMemoryModelInstance` are removed
  from `server/utils/projects/memory.ts`. Building the AI SDK model moved to
  `server/utils/memory/resolve-model.ts` (`instantiate()` on the resolved
  selection), so the decision is logged before any credential is read.
  `PROJECT_MEMORY_PROVIDER_ORDER` stays as a re-export of
  `MEMORY_MODEL_PROVIDER_ORDER`.
- `projects.memoryProvider` holds the key-provider id
  (`keyProviderIdForGateway`: `vercel-gateway`, `cloudflare-gateway`,
  `openrouter`) when the pick is a gateway model, the direct provider id
  otherwise, so it joins with `usage.provider` and `providerMeta`;
  `projects.memoryModel` holds the model id either way.
- A failing saved-keys lookup is not treated as "no key": the resolver
  rethrows, the refresh leaves the project status untouched and releases its
  lease in `finally`. The fallback step applies the same usability filter as
  the setting and chat steps. A gateway model taken from the latest chat is
  not catalog-checked at resolution time, so an unusable one fails the
  refresh instead of falling through.
- Both the per-chat summaries (`chats.projectMemorySummary`) and the
  synthesised `projects.memory` pass through never-store redaction
  (`redactNeverStore`): card, IBAN, government and tax IDs, passports, API
  keys, JWTs, credentials and private keys become `[redacted]`. Only counts
  are logged, as `attributes.memoryCompliance` with origin
  `project-memory-summary` or `project-memory`. A chat summary cached before
  this change stays unredacted until that chat is next summarised; the
  synthesised memory is always redacted on write.
- Both prompts gained one instruction sentence telling the model not to
  record card, bank, government or tax ID, passport or credential data.
- Both `generateText` calls now pass `maxOutputTokens`
  (`PROJECT_MEMORY_LIMITS.maxSummaryChars` for the per-chat summary,
  `maxMemoryChars` for the synthesis): a generous bound against runaway
  output, the character caps still truncate.
- When the user's `memoryIncludeSensitive` is not `true`, both instruction
  strings also end with a sentence asking the model to omit health, religion
  or beliefs, political opinions, racial or ethnic origin, sex life or
  orientation, trade-union membership, genetic or biometric data, ongoing
  legal disputes and drug use. This is a PROMPT-ONLY control for the legacy
  blob, not code-enforced (the entry pipeline gets code enforcement through
  `evaluateMemoryEntry`), and project memory written before W3 is not
  retro-scrubbed.
- New nullable column `projects.useAccountMemory` (default `true` in app code,
  `null` means the default). Nothing reads it yet; the memory UI and the
  account-memory injection are later workstreams.

UI surfaces:

- project detail page memory card
- top-of-chat project context box, shown whenever the project has non-empty
  memory text, whatever the status
  (`app/components/Chat/ProjectInstructions.vue` on `chats/new` and
  `chats/[slug]`)

## Project Actions

### Create

- `PUT /api/v1/projects`

### Rename

- `PATCH /api/v1/projects/[id]/name`

### Pin

- `POST /api/v1/projects/[id]/pin`

### Archive

- `POST /api/v1/projects/[id]/archive`

### Delete

- `DELETE /api/v1/projects/[id]`
- Unlinks chats from the project by setting `chat.projectId = null`
- Does not delete chats

### Instructions

- `PATCH /api/v1/projects/[id]/instructions`

### Memory

- `PATCH /api/v1/projects/[id]/memory` (enable or disable)
- `POST /api/v1/projects/[id]/memory/refresh`
- `POST /api/v1/chats/[slug]/project-context/refresh`

## Activity Semantics

Project `activityAt` changes when project chat membership changes:

- creating a new chat inside a project
- single chat move into a project
- bulk move into a project
- moving chats out of a project, including moving them to root

When chats move out of a project, the source project is recomputed from its
latest remaining chat. If the project becomes empty, it falls back to the
project creation time.

Rename, pin, and archive update project metadata but do not change
`activityAt`.

## APIs

- `GET /api/v1/projects` — query: `cursor`, `limit`, `search`, `sortBy`, `archived`
- `PUT /api/v1/projects`
- `GET /api/v1/projects/[id]`
- `PATCH /api/v1/projects/[id]/name`
- `PATCH /api/v1/projects/[id]/instructions`
- `POST /api/v1/projects/[id]/pin`
- `POST /api/v1/projects/[id]/archive`
- `DELETE /api/v1/projects/[id]`
- `GET /api/v1/projects/[id]/chats`
- `PATCH /api/v1/projects/[id]/memory`
- `POST /api/v1/projects/[id]/memory/refresh`
- `PATCH /api/v1/chats/[slug]/project`
- `POST /api/v1/chats/history/project/bulk`
- `POST /api/v1/chats/[slug]/project-context/refresh`

## Migration Notes

The final rollout does not use the abandoned generated `0017`-`0019` path.

Current migration baseline:

- production baseline: `0015_fuzzy_tempest.sql`
- rollout migration: `0016_dark_rictor.sql`

Because folders never shipped to production, the production upgrade path does
not need to preserve live folder rows there. Preview/local environments that
had experimental folder schema were reset back to the `0015` baseline before
the final rollout migration was applied.

`0016_dark_rictor.sql` is the single real upgrade migration for the projects
feature line and includes:

- projects table creation
- chats `activity_at`
- chats `project_id`
- project memory columns on chats
- project instructions and memory columns on projects

Preview/local environments that had earlier experimental folder migrations were
reset back to the `0015` schema baseline before applying the final `0016`.

## Testing Notes

### Unit coverage

- `tests/unit/composables/projects.spec.ts`
- `tests/unit/composables/project-chats.spec.ts`
- `tests/unit/components/Projects/ActionsDropdown.spec.ts`
- `tests/unit/components/Projects/InstructionsCard.spec.ts`
- `tests/unit/components/Projects/MemoryCard.spec.ts`
- `tests/unit/components/Chat/ProjectInstructions.spec.ts`
- `tests/unit/utils/project-instructions.spec.ts`
- `tests/unit/utils/project-memory.spec.ts`
- `tests/unit/utils/project-memory-lease.spec.ts`

Covered cases (composable):

- cache hydration and background refresh
- create, rename, pin, archive, delete
- re-sort on pin/unpin by sort mode
- filtered view does not insert non-matching created project
- debounced search with sort and archive filters
- cursor-based load more
- cursor reset when filters change

Covered cases (project memory utils):

- last-known-good injection for every non-`disabled` status, on the server and
  in the chat pages
- provider options (reasoning off) reaching both `generateText` calls
- lease acquire, live-lease early return, heartbeat release, fail-open on KV
  read errors, recovery of a `refreshing` row without a lease
- bounded refresh: chat and per-refresh caps, newest-message staleness,
  leftover stale chats ending `stale`, `NONE` summaries counting as fresh
- display status of a `refreshing` row, writes guarded against `disabled`,
  messages arriving mid-pass, the 20-chat window never wiping memory
- transcript limits, `[earlier messages omitted]`, text-only parts
- provider order and per-provider memory model selection
- gateway picks stored as the key-provider id, a failing keys lookup leaving
  the project untouched, `maxOutputTokens` on both calls, and the
  special-category omission sentence present only when the flag is not `true`
- model resolution through `resolveMemoryModel` (setting, chat, fallback,
  gateway providers) and never-store redaction of summaries and the
  synthesised memory, with count-only logging
  (`tests/unit/utils/memory/resolve-model.spec.ts`,
  `tests/unit/utils/memory/compliance.spec.ts`)

### Integration coverage

- `tests/integration/api/projects.spec.ts`
- `tests/integration/api/projects-memory.spec.ts`
- `tests/integration/api/chats-project-instructions.spec.ts`
- `tests/integration/pages/history-cache.spec.ts`

### E2E coverage

- `tests/e2e/history/dropdown-touch.spec.ts`

## Useful commands

```bash
pnpm vitest run tests/integration/api/projects.spec.ts
pnpm vitest run tests/integration/api/projects-memory.spec.ts
pnpm vitest run tests/integration/api/chats-project-instructions.spec.ts
pnpm vitest run tests/unit/utils/project-memory.spec.ts
pnpm vitest run tests/unit/utils/project-memory-lease.spec.ts
pnpm vitest run tests/unit/utils/project-instructions.spec.ts
pnpm vitest run tests/unit/composables/projects.spec.ts
```
