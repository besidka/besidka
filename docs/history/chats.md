# History Chats

## Overview

This document describes the current chat history implementation:

- chat search by title
- single and bulk actions
- project assignment from history
- cursor-based infinite loading
- local cache persistence while navigating without a full reload
- current test coverage for the scope

This reflects the shipped implementation, not the original planning language.

## Pages and State

### Main page

- `app/pages/chats/history/index.vue`
- Uses `useHistory()`
- Server-primes the initial payload when there is no cache
- On mount, hydrates from cache first and then refreshes in background

### Core composable

- `app/composables/history.ts`
- State is stored in Nuxt `useState()`
- Cache key format: `history:${normalizedSearch}`

Stored state:

- `pinned`
- `chats`
- `nextCursor`
- `search`
- selection mode state for bulk actions

## Loading Model

### Initial load

- If a cache entry exists for the active search key, it is shown immediately
- A refresh request still runs in background
- If no cache exists, the page shows the loading state and fetches history

### Infinite scroll

- Unpinned chats are loaded with cursor pagination
- Default page size is `30`
- Max page size is `100`
- `nextCursor` is based on the last unpinned chat `activityAt`
- Search mode disables cursor pagination and always returns `nextCursor: null`

### Pinned rows

- Pinned chats are fetched separately from unpinned chats
- Pinned chats do not participate in infinite scroll
- Current server-side pinned limit is `50`

## Search Behavior

### Query rules

- Search is active for `2+` characters
- History search matches chat title only

### Search result semantics

- Results are sorted by `activityAt`
- The response returns chat-level matches only

### Why message content search was removed

Message content is stored as rich `UIMessage['parts']` JSON (tool calls,
reasoning, file refs, plain text) in a single `messages.parts` blob column.
A `LIKE '%query%'` scan on this column:

- has no index and triggers a full table scan on `messages`
- matches JSON structure keys and non-text fields, producing false positives
- is semantically unsound — users expect to search message text, not raw JSON

Full-text search via SQLite FTS5 is the correct long-term approach and is
tracked as a separate improvement in `docs/history/content-search.md`.
Title-only search is the current behavior.

## Chat Actions

### Supported actions

- rename
- delete
- pin / unpin
- enter selection mode
- bulk delete
- add to project
- remove from project
- bulk move to project

### Touch dropdown behavior

Chat row actions use DaisyUI dropdown method 1:

- native `details`
- native `summary`
- positioned `.dropdown-content`

Important implementation note:

- do not add `tabindex` to the trigger `summary`

Why:

- the working mobile dropdowns in chat input rely on plain native `summary`
- adding `tabindex="0"` changed touch behavior for the history row trigger
- on desktop the menu still opened, but on touch devices the trigger could
  become active without opening the disclosure

This was reproduced on:

- `app/pages/chats/history.vue`
- `app/pages/chats/projects/[id].vue`

Relevant shared component:

- `app/components/History/ActionsDropdown.vue`

Current rule for this dropdown family:

- keep the trigger as a plain native `summary`
- use `onClickOutside()` only for closing
- do not replace this with custom popover positioning unless there is a
  separate verified browser issue

### Activity semantics

The current implementation refreshes `activityAt` for:

- rename
- pin / unpin
- creating a new chat inside a project
- add to project
- remove from project
- bulk project moves

For project assignment changes, chat `activityAt` is refreshed and the affected
project `activityAt` values are kept in sync as well:

- destination projects are bumped immediately on move
- source projects are recomputed from their latest remaining chat when chats are
  moved out

This affects ordering and date-group placement for chats and activity sorting
for projects.

## Date Grouping

History sections are rendered by:

- `app/components/History/ChatSections.vue`
- `shared/utils/date-groups.ts`

Current unpinned section labels are:

- `Today`
- `Yesterday`
- `Previous 7 days`
- `Month Year` for older groups, for example `February 2026`

Pinned chats are rendered in a separate `Pinned` section above date groups.

## APIs

### History list

- `GET /api/v1/chats/history`
- Query:
  - `cursor`
  - `limit`
  - `search`

### Single chat actions

- `PATCH /api/v1/chats/[slug]/rename`
- `DELETE /api/v1/chats/[slug]`
- `PATCH /api/v1/chats/[slug]/project`

### Bulk history actions

- `POST /api/v1/chats/history/pin`
- `POST /api/v1/chats/history/delete/bulk`
- `POST /api/v1/chats/history/project/bulk`

## Cache Notes

History cache is scoped by normalized search value.

That means:

- default history and searched history are cached independently
- navigating away and back without reload restores the matching cache entry
- switching search keys requires a re-hydration step, not just changing the ref

## Testing Notes

### Unit coverage

- `tests/unit/composables/history.spec.ts`
- `tests/unit/utils/date-groups.spec.ts`
- `tests/unit/components/History/ChatSections.spec.ts`

Covered cases:

- background refresh after cache hydration
- debounced search
- cursor loading
- pinning
- selection mode
- bulk delete chunking
- bulk move to project
- rename and delete
- single project assignment and removal
- current date-group labels

### Integration coverage

- `tests/integration/api/chats-history.spec.ts`
- `tests/integration/pages/history-cache.spec.ts`

Covered cases:

- title search
- pinned vs unpinned response shape
- next cursor calculation
- rename endpoint
- delete endpoints
- project move endpoints, including source-project activity refresh
- pin endpoint
- new chat in project updates project activity
- cache persistence across remount-style navigation

### E2E coverage

- `tests/e2e/history/dropdown-touch.spec.ts`

Covered cases:

- mobile touch opens the chat row dropdown on `/chats/history`
- mobile touch opens the chat row dropdown on `/chats/projects/[id]`

Why this exists:

- unit tests do not model native `details` touch behavior well enough
- the regression only showed up in a real browser-level mobile interaction path

### Useful commands

```bash
pnpm vitest run tests/unit/composables/history.spec.ts
pnpm vitest run tests/integration/api/chats-history.spec.ts
pnpm vitest run tests/integration/pages/history-cache.spec.ts
pnpm exec playwright test tests/e2e/history/dropdown-touch.spec.ts --project=chromium
```
