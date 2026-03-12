# History Folders

## Overview

This document describes the current folders implementation used by history:

- folders list page
- folder detail page
- creating, renaming, pinning, archiving, and deleting folders
- moving chats into and out of folders
- cache persistence between folder-related pages
- current test coverage for the scope

## Pages and State

### Folders list page

- `app/pages/chats/folders/index.vue`
- Uses `useFolders()`
- Supports search, sort, archive toggle, and create flow

### Folder detail page

- `app/pages/chats/folders/[id].vue`
- Uses `useFolderChats(folderId)`
- Shows folder metadata plus pinned and unpinned chats inside that folder

### Folder picker modal

- `app/components/History/FolderPicker.client.vue`
- Used from history actions to move chats
- Can also create a new folder inline before selecting it

## Folder List Behavior

### Search

- Server search is active for `2+` characters
- Search matches folder name only

### Sort

- `activity`
- `name`

### Archive filter

- Active and archived folders are separate list views
- Archive visibility is part of the folders cache key

### Pinning

- Pinned folders render separately above regular folders
- Pinning does not create a separate page state key by itself

## Folder Detail Behavior

### Data model

The folder detail response includes:

- `folder`
- `pinned`
- `chats`
- `nextCursor`

### Loading

- Unpinned chats inside a folder use cursor pagination
- Pinned chats are returned separately
- Cache key format: `folder:${folderId}`
- Fetch results are written back to the cache entry that started the request, so
  late responses from a previously viewed folder do not overwrite the current
  folder view

### Chat actions inside a folder

- rename chat
- delete chat
- pin / unpin chat
- move chat to another folder
- remove chat from folder

Removing a chat from the current folder removes it from the current list
immediately.

## Folder Actions

### Create

- `PUT /api/v1/folders`
- Creates a folder for the current user
- New folders are prepended locally in the folders list state

### Rename

- `PATCH /api/v1/folders/[id]/name`
- Updates the folder name

### Pin

- `POST /api/v1/folders/[id]/pin`
- Toggles `pinnedAt`

### Archive

- `POST /api/v1/folders/[id]/archive`
- Toggles `archivedAt`

### Delete

- `DELETE /api/v1/folders/[id]`
- Unlinks chats from the folder by setting `chat.folderId = null`
- Does not delete chats

## Activity Semantics

Folder `activityAt` changes when folder chat membership changes:

- creating a new chat inside a folder
- single chat move into a folder
- bulk move into a folder
- moving chats out of a folder, including moving them to root

When chats move out of a folder, the source folder is recomputed from its
latest remaining chat. If the folder becomes empty, it falls back to the
folder creation time.

Folder rename, pin, and archive update folder metadata but do not change
`activityAt`.

## APIs

### Folder list

- `GET /api/v1/folders`
- Query:
  - `search`
  - `sortBy`
  - `archived`

### Folder CRUD

- `PUT /api/v1/folders`
- `PATCH /api/v1/folders/[id]/name`
- `POST /api/v1/folders/[id]/pin`
- `POST /api/v1/folders/[id]/archive`
- `DELETE /api/v1/folders/[id]`

### Folder chats

- `GET /api/v1/folders/[id]/chats`

## Cache Notes

### Folders list cache key

`useFolders()` caches by:

- normalized search
- sort mode
- active vs archived view

### Folder detail cache key

`useFolderChats()` caches by folder id only.

That means:

- folder list state survives page navigation when filters are unchanged
- archived and active list caches are independent
- each folder detail page keeps its own cached chat state

## Testing Notes

### Unit coverage

- `tests/unit/composables/folders.spec.ts`
- `tests/unit/composables/folder-chats.spec.ts`

Covered cases:

- cached hydration + refresh
- create
- rename
- pin
- archive
- delete
- debounced search
- sort and archive filter queries
- folder detail cursor loading
- folder detail ignores stale responses after folder navigation
- folder detail rename/remove/move behavior
- folder detail pinning and folder metadata updates

Additional coverage:

- `tests/integration/api/chats-history.spec.ts`
- `tests/integration/api/chats-new.spec.ts`
- `tests/unit/utils/folder-activity.spec.ts`

Covered cases:

- move endpoints refresh source folder activity
- creating a chat inside a folder bumps folder activity
- folder activity recomputation falls back to folder creation time when empty

### Integration coverage

- `tests/integration/api/folders.spec.ts`
- `tests/integration/pages/history-cache.spec.ts`

Covered cases:

- folders list response shape
- search / sort / archive query handling
- create, rename, pin, archive endpoints
- delete folder keeps chats intact
- folder chats response shape and next cursor
- folders and folder detail cache persistence across remount-style navigation

### Useful commands

```bash
pnpm vitest run tests/unit/composables/folders.spec.ts
pnpm vitest run tests/unit/composables/folder-chats.spec.ts
pnpm vitest run tests/integration/api/folders.spec.ts
```
