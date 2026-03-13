# Phased rollout: projects rename, project instructions, project memory

## Status

This plan is complete.

- Phase 1 shipped: full rename from folders to projects across app, server,
  shared types, routes, tests, and schema sources
- Phase 2 shipped: project instructions are request-time synthetic system
  context and are never persisted as chat messages
- Phase 3 shipped: project memory is automatic, project-scoped, read-only in
  v1, and injected only when the current project memory is ready
- Migration shipped: the final rollout uses a single manual
  `.drizzle/migrations/0016_dark_rictor.sql` upgrade from the production
  `0015_fuzzy_tempest.sql` baseline

Visual note:

- Keep the product renamed to Projects, but restore the previous folder-style
  icons in the UI.
- Do not use the briefcase/portfolio metaphor introduced during the rename.

## Summary

This work was implemented in 3 phases plus a final migration checkpoint:

1. Phase 1: Full rename to Projects
2. Phase 2: Project instructions
3. Phase 3: Automatic project memory
4. Final migration/checkpoint: finalize the single production migration from
   the real `0015` baseline

That order kept each phase independently testable while still landing the full
feature line as one release candidate.

## Why this phase order

- The rename came first because everything after that needed to use project
  naming only.
- Instructions came before memory because they are synchronous request-time
  context and lower risk.
- Memory came last because it adds async refresh logic, model selection, extra
  schema fields, and more edge cases.
- The generated migration path was abandoned after validation because it did not
  apply safely against the real upgrade path. The final migration was rebased to
  a single manual `0016` upgrade from the production `0015` baseline.

## Public API / interface end state

By the end of all phases:

- DB table: `projects`
- Chat foreign key: `projectId`
- API routes:
  - `/api/v1/projects`
  - `/api/v1/projects/[id]`
  - `/api/v1/projects/[id]/chats`
  - `/api/v1/projects/[id]/instructions`
  - `/api/v1/projects/[id]/memory/refresh`
  - `/api/v1/chats/[slug]/project`
  - `/api/v1/chats/history/project/bulk`
  - `/api/v1/chats/[slug]/project-context/refresh`
- App routes:
  - `/chats/projects`
  - `/chats/projects/[id]`
- Shared types:
  - `Project`
  - `ProjectsResponse`
  - `ProjectChatsResponse`
- Provider model metadata:
  - `forProjectMemory?: boolean`

  ## Phase 1: Full rename to Projects

  ### Goal

  Replace all folder terminology and identifiers with project terminology everywhere in application code, server code, routes, types, tests, and schemas, while preserving existing behavior.

  ### Scope

  - Rename DB schema identifiers:
      - folders table definition -> projects
      - chats.folderId -> chats.projectId
      - relations and indexes renamed accordingly
  - Rename server API files/directories:
      - server/api/v1/folders/** -> server/api/v1/projects/**
      - server/api/v1/chats/[slug]/folder.patch.ts -> .../project.patch.ts
      - server/api/v1/chats/history/folder/bulk.post.ts -> .../project/bulk.post.ts
  - Rename frontend pages:
      - app/pages/chats/folders/index.vue -> app/pages/chats/projects/index.vue
      - app/pages/chats/folders/[id].vue -> app/pages/chats/projects/[id].vue
  - Rename components/composables/types/tests:
      - FolderPicker -> ProjectPicker
      - FolderNameModal -> ProjectNameModal
      - useFolders -> useProjects
      - useFolderChats -> useProjectChats
      - all folderId, folderName, folderContext -> projectId, projectName, projectContext
  - Rename UI copy and messages from folder(s) to project(s)
  - Keep folder-style icons for project surfaces so the visual metaphor
    stays organizational rather than workspace/briefcase-oriented
  - Rename selectors/test ids/hook classes containing folder naming
  - Rename test files and fixtures to match project terminology

  ### Important behavior

  - No new functionality in this phase.
  - Existing “folders” behavior should remain logically identical, only renamed to “projects”.
  - Keep the existing folder visual metaphor in the UI. Rename the feature to
    Projects, but do not replace folder-style icons with portfolio or
    briefcase icons.
  - Keep folder-style icons as the visual metaphor for projects.
  - Visual icons should keep the folder metaphor even after the rename.

  ### What not to do in Phase 1

  - Do not implement instructions yet.
  - Do not implement memory yet.
  - Do not generate Drizzle migration yet.

  ### Validation for Phase 1

  - rg -n "folder|folders" should return no relevant application/server/test code matches, excluding immutable generated/migration artifacts if any
  - All renamed pages/routes work under /projects
  - Existing move/create/rename/archive/delete/pin project flows behave exactly as before

  ### Phase 1 test target

  - Update and run all current folder/project unit/integration/e2e tests under new naming
  - Add one grep-style repository check in local validation workflow during implementation, not as a permanent runtime feature

  ## Phase 2: Project instructions

  ### Goal

  Add project-level instructions that affect every future generation in chats assigned to that project, without leaking old project instructions after project moves.

  ### Core rule

  Project instructions are not persisted as chat messages.

  They are built into a synthetic request-time system message for every generation request, based on the chat’s current projectId.

  ### Exact logic

  For every chat generation request:

  1. Load chat and current projectId
  2. Load current project record
  3. If project has instructions:
      - build synthetic system context for this request only
  4. Prepend synthetic system context before model messages
  5. Persist only user and assistant messages
  6. Do not store the synthetic project instructions message in messages

  ### Move behavior

  This is the exact rule set to prevent mistakes:

  - New chat in project:
      - first assistant response uses that project’s instructions
  - Existing chat moved into project:
      - next assistant response uses that project’s instructions
  - Existing chat moved from Project A to Project B:
      - next assistant response uses only Project B instructions
      - Project A stops affecting future turns immediately
  - Existing chat removed from project:
      - next assistant response uses no project instructions
  - In-flight stream after move:
      - current stream keeps old request snapshot
      - next user turn uses new project

  ### Required schema additions

  Add to projects:

  - instructions: text | null

  ### Required API additions/changes

  - Extend GET /api/v1/projects/[id] to return instructions
  - Add PATCH /api/v1/projects/[id]/instructions
  - Update chat fetch/project fetch shapes as needed for UI

  ### UI work

  - Project detail page:
      - add instructions editor card
      - textarea + save action
  - Chat page:
      - show info box at the top when current project has instructions
      - show current project name and instructions
  - Project move success messaging should explicitly mention:
      - “Future messages will use this project’s instructions”

  ### What not to do in Phase 2

  - Do not implement memory generation yet
  - Do not generate Drizzle migration yet

  ### Validation for Phase 2

  - Synthetic system instructions are injected on every generation for project chats
  - No synthetic project instructions are persisted to DB
  - Moving a chat between projects changes future behavior immediately
  - Removing chat from project removes project instruction context immediately

  ### Phase 2 test target

  - Unit tests for request-time system prompt construction
  - API tests for instructions update endpoint
  - Integration tests for move scenarios:
      - no project -> project
      - project A -> project B
      - project -> no project
  - UI tests for top-of-chat instructions box

  ## Phase 3: Automatic project memory

  ### Goal

  Add project-level memory that summarizes durable context from chats currently assigned to the project and injects that memory on future turns.

  ### Memory model

  Project memory is:

  - project-scoped
  - read-only in v1
  - refreshed automatically
  - injected per request like instructions
  - based only on the chat’s current project

  ### Required schema additions

  Add to projects:

  - memory: text | null
  - memoryStatus: 'idle' | 'stale' | 'refreshing' | 'ready' | 'failed' | 'unavailable'
  - memoryUpdatedAt: timestamp | null
  - memoryDirtyAt: timestamp | null
  - memoryProvider: text | null
  - memoryModel: text | null
  - memoryError: text | null

  Add to chats:

  - projectMemorySummary: text | null
  - projectMemorySummaryUpdatedAt: timestamp | null

  ### Provider/model selection

  - Extend Model type with forProjectMemory?: boolean
  - Mark one low-cost memory model per provider:
      - Google: gemini-2.5-flash-lite
      - OpenAI: gpt-5-nano

  ### Auto-selection logic

  For each refresh:

  1. Load user saved provider keys
  2. Iterate enabled providers in configured order
  3. Select the first provider with:
      - saved API key
      - model flagged forProjectMemory
  4. If none available:
      - do nothing
      - mark project memoryStatus = 'unavailable'

  ### Memory generation design

  Use a two-step pipeline:

  1. Chat summary refresh

  - summarize one chat into durable facts only
  - save to chats.projectMemorySummary

  2. Project memory synthesis

  - collect summaries for chats currently in the project
  - deduplicate and compress
  - save to projects.memory

  ### What memory should include

  - durable goals
  - stable preferences
  - recurring constraints
  - important long-lived decisions
  - project-specific conventions

  ### What memory should exclude

  - one-off temporary tasks
  - stale short-lived context
  - transient troubleshooting state
  - wording tied to a single turn

  ### Memory injection logic

  During chat generation:

  - if project memory exists, include it in the synthetic system context together with project instructions
  - memory and instructions are both derived from the chat’s current project at request time

  ### Refresh triggers

  Mark project memory stale on:

  - assistant response completion in a project chat
  - chat moved into project
  - chat moved out of project
  - chat moved between projects
  - bulk move
  - chat deletion
  - branch creation in a project

  ### Refresh execution

  - mutation endpoints should only mark projects stale
  - do not call memory LLM inline inside move/delete endpoints
  - after successful assistant finish, trigger best-effort project context refresh
  - project page and chat page may also trigger refresh when stale state is detected
  - manual refresh action exists on project page

  ### UI work

  - project page:
      - memory block
      - status badge
      - provider/model info
      - refresh action
  - optional chat page compact memory section if useful, but instructions box remains primary UX surface

  ### Validation for Phase 3

  - memory model resolver picks valid provider/model when keys exist
  - no refresh occurs when no supported key exists
  - project memory updates from current project chats only
  - move/delete operations eventually remove stale facts from memory
  - generation uses current project memory only

  ### Phase 3 test target

  - unit tests for memory model resolver
  - unit tests for stale-marking logic
  - integration tests for refresh endpoint
  - integration tests for move/delete effects on stale state
  - prompt-construction tests for memory + instructions together

## Final migration/checkpoint phase

### Goal

Ship exactly one production rollout migration from the real production baseline.

### Why separate this

- It avoids carrying the abandoned experimental 0016-0019 migration chain into
  production.
- It gives production a single clean upgrade from the real `0015` state.
- It keeps preview/local aligned with the migration that production will
  eventually apply.

### Final applied steps

1. Finish Phase 1, 2, and 3 code changes
2. Validate the generated migration path against the real old schema
3. Discard the generated `0017`-`0019` path because it was not safe to apply
4. Rebase the rollout to a single manual `0016_dark_rictor.sql` migration from
   the `0015` production baseline
5. Reset preview/local back to the `0015` schema baseline
6. Apply the final `0016` on preview/local with Wrangler D1 migrations
7. Keep production untouched in this scope

### Final migration contents

The final `0016_dark_rictor.sql` rollout migration covers:

- `projects` table creation
- chat `activity_at`
- chat `project_id`
- project instructions and memory fields
- chat project-memory summary fields
- related indexes and foreign keys

## Recommended execution sequence

1. Implement Phase 1 fully
2. Run tests for renamed project surface
3. Implement Phase 2 fully
4. Run tests for request-time instructions behavior
5. Implement Phase 3 fully
6. Run tests for memory refresh and prompt composition
7. Finalize the single production migration from the real `0015` baseline
8. Run full repo validation:
  - `pnpm run format`
  - `pnpm run typecheck`
  - targeted tests from all three phases
  - broader relevant suite if needed

  ## Test strategy by phase

  ### Phase 1

  - Focus: no behavior regressions after rename
  - Reuse and rename existing tests instead of duplicating them

  ### Phase 2

  - Add only new tests for instructions lifecycle
  - Do not duplicate rename coverage from Phase 1

  ### Phase 3

  - Add only new tests for memory lifecycle and model selection
  - Reuse Phase 2 prompt tests by extending them where necessary

## Assumptions and defaults

- Full rename is mandatory because the feature is not yet in production
- No folder naming should remain in normal source after implementation, except
  where the plan deliberately references the prior term for migration history or
  icon metaphor
- Project instructions and project memory are both request-time context, not
  persisted system messages
- The final rollout migration is a single manual `0016` from the production
  `0015` baseline
- Branched chats remain in the same project by default
- Memory remains read-only in v1

## Completion notes

- Preview and local D1 were reset to the `0015` schema baseline and then had
  the final `0016_dark_rictor.sql` applied successfully.
- Production was not touched.
- The current release candidate should be reviewed and merged against the final
  `0016` migration path, not the abandoned generated 0017-0019 sequence.
