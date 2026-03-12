# History Chats

## Overview

This document describes the current chat history implementation:

- chat search by title and message content
- single and bulk actions
- folder assignment from history
- cursor-based infinite loading
- local cache persistence while navigating without a full reload
- current test coverage for the scope

This reflects the shipped implementation, not the original planning language.

## Pages and State

### Main page

- `app/pages/chats/history.vue`
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
- History search checks:
  - chat title
  - message content stored in `messages.parts`

### Search result semantics

- Title and message matches are merged
- Duplicate chats are removed
- Results are sorted by `activityAt`
- The response currently returns chat-level matches only

Current limitation:

- if a chat appears because of a message-content match, the result does not yet
  include which message matched
- opening the chat therefore does not scroll to the matched message

## Chat Actions

### Supported actions

- rename
- delete
- pin / unpin
- enter selection mode
- bulk delete
- add to folder
- remove from folder
- bulk move to folder

### Activity semantics

The current implementation refreshes `activityAt` for:

- rename
- pin / unpin
- add to folder
- remove from folder
- bulk folder moves

This affects ordering and date-group placement.

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
- `PATCH /api/v1/chats/[slug]/folder`

### Bulk history actions

- `POST /api/v1/chats/history/pin`
- `POST /api/v1/chats/history/delete/bulk`
- `POST /api/v1/chats/history/folder/bulk`

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
- `tests/unit/components/HistoryChatSections.spec.ts`

Covered cases:

- background refresh after cache hydration
- debounced search
- cursor loading
- pinning
- selection mode
- bulk delete chunking
- bulk move to folder
- rename and delete
- single folder assignment and removal
- current date-group labels

### Integration coverage

- `tests/integration/api/chats-history.spec.ts`
- `tests/integration/pages/history-cache.spec.ts`

Covered cases:

- title + message search merge and dedupe
- pinned vs unpinned response shape
- next cursor calculation
- rename endpoint
- delete endpoints
- folder move endpoints
- pin endpoint
- cache persistence across remount-style navigation

### Useful commands

```bash
pnpm vitest run tests/unit/composables/history.spec.ts
pnpm vitest run tests/integration/api/chats-history.spec.ts
pnpm vitest run tests/integration/pages/history-cache.spec.ts
```
