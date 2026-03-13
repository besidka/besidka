# History Projects

## Overview

This document describes the current projects implementation used by history:

- projects list page
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

### Project detail page

- `app/pages/chats/projects/[id].vue`
- Uses `useProjectChats(projectId)`
- Shows project metadata plus pinned and unpinned chats inside that project
- Includes instructions editing and project memory refresh UI

### Project picker modal

- `app/components/History/ProjectPicker.client.vue`
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
- The effective instructions always come from the chat’s current `projectId`

Move semantics:

- moving a chat into a project applies that project’s instructions on the next turn
- moving a chat between projects switches future turns to the new project only
- removing a chat from a project removes project instructions from future turns
- in-flight generations keep the request snapshot they started with

## Project Memory

Project memory is project-scoped, read-only in v1, and also request-time
context.

- Stored on `projects.memory`
- Refreshed from chats currently assigned to the project
- Injected together with project instructions only when `memoryStatus = ready`
- Generated with automatic BYOK provider fallback using models flagged
  `forProjectMemory`

Refresh triggers:

- assistant response completion in a project chat
- chat moved into or out of a project
- bulk move
- chat deletion
- branch creation in a project

UI surfaces:

- project detail page memory card
- top-of-chat project context box when memory is ready

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

### Memory refresh

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

- `GET /api/v1/projects`
- `PUT /api/v1/projects`
- `GET /api/v1/projects/[id]`
- `PATCH /api/v1/projects/[id]/name`
- `PATCH /api/v1/projects/[id]/instructions`
- `POST /api/v1/projects/[id]/pin`
- `POST /api/v1/projects/[id]/archive`
- `DELETE /api/v1/projects/[id]`
- `GET /api/v1/projects/[id]/chats`
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
- `tests/unit/components/History/ProjectActionsDropdown.spec.ts`
- `tests/unit/components/Projects/InstructionsCard.spec.ts`
- `tests/unit/components/Projects/MemoryCard.spec.ts`
- `tests/unit/components/Chat/ProjectInstructions.spec.ts`
- `tests/unit/utils/project-instructions.spec.ts`
- `tests/unit/utils/project-memory.spec.ts`

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
pnpm vitest run tests/unit/utils/project-instructions.spec.ts
```
