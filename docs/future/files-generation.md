# Files Generation (Future Implementation Guide)

## Goals

- Persist assistant-generated files as first-class files in R2 + D1.
- Keep ownership, access checks, and deletion semantics aligned with uploads.
- Keep model replay payloads stable by avoiding automatic assistant file replay.

## Non-Goals

- No immediate product rollout in this change set.
- No UI polish for source badges or generated-file-specific actions yet.
- No provider-specific file-generation UX contracts yet.

## Locked Decisions

- Generated files persist in `R2 + D1`, not external provider URLs.
- Generated files use the same storage quota policy as uploads.
- Generated files appear in file manager by default.
- Assistant-generated files are not auto-sent back to model context.
  Reuse requires explicit user reattach.

## Current Scaffolding Delivered

- `files` schema includes provenance columns:
  - `source` (`upload | assistant`)
  - `originMessageId` (nullable FK to `messages`)
  - `originProvider` (nullable text)
- Shared persistence utility exists: `server/utils/files/persist-file.ts`
  - validates storage quota
  - writes file bytes to R2
  - writes metadata to D1
  - rolls back R2 when DB insert fails
  - invalidates storage cache
- Chat model-context sanitizer exists:
  - `sanitizeMessagesForModelContext()`
  - strips assistant `file` parts before `convertToModelMessages(...)`
- Assistant persistence hook exists:
  - `normalizeAssistantMessagePartsForPersistence()`
  - currently no-op for persistence
  - logs assistant file detection via evlog context
- Runtime gate exists:
  - `enableAssistantFilePersistence` (default `false`)

## End-to-End Flow To Implement Later

1. Detect assistant `file` parts in final response message.
2. For each assistant file part:
   - decode inline `data:` URL into bytes; or
   - securely fetch external URL server-side with strict limits.
3. Validate each candidate file:
   - MIME allowlist
   - max byte limits
   - provider-specific constraints
4. Persist each valid file through `persistFile(...)`:
   - `source = 'assistant'`
   - `originProvider = <provider id>`
   - `originMessageId = <saved assistant message id>` when available
5. Rewrite assistant message `file` part URLs to `/files/<storageKey>`.
6. Save normalized assistant message parts in `messages.parts`.
7. Emit client data events for partial failures when needed.

## Failure Modes and Fallbacks

- If one generated file fails persistence:
  - keep chat response successful
  - skip only failed file part
  - emit warning event to client
- If all generated files fail:
  - assistant text response still persists
  - no broken file URLs should be stored
- If R2 write succeeds but DB write fails:
  - rollback R2 object (already handled by `persistFile`)

## Security and Cost Constraints

- Keep owner-private file model; no public-by-default generated files.
- Continue serving bytes via `/files/[key]` ownership/share authorization.
- Enforce same user storage quota for upload and assistant-generated files.
- Keep Cloudflare connection limits in mind:
  - avoid unbounded parallel R2/KV/fetch fan-out
  - batch or sequence when required

## API and Type Change Map

- `FileMetadata` now includes:
  - `source`
  - `originMessageId`
  - `originProvider`
- `GET /api/v1/files` now returns `source`.
- `PUT /api/v1/files/upload` now returns `source`.
- Chat API contract remains unchanged for clients in this scaffolding phase.

## Test Matrix and Acceptance Criteria

1. Migration:
   - legacy rows receive `source = 'upload'` default
2. Upload regression:
   - upload endpoint behavior unchanged after persistence refactor
3. Model-context safety:
   - assistant file parts are excluded from automatic replay
4. Hook behavior:
   - with flag disabled, assistant file detection logs context and persists
     unchanged parts
5. Validation:
   - `pnpm run format` passes
   - `pnpm run typecheck` passes

## Rollout Plan (Feature Flag Stages)

1. Stage 0 (current):
   - `enableAssistantFilePersistence = false`
   - logging + scaffolding only
2. Stage 1:
   - enable in local/dev only
   - validate persistence, rewrite, and failure semantics
3. Stage 2:
   - limited production rollout
   - monitor storage growth, failure rates, and chat latency
4. Stage 3:
   - full rollout
   - add optional UI refinements (source badges, generated-file filters)
