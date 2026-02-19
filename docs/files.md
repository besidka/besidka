# Files

## Overview

This document is the source of truth for the files module:

- upload/attach/list/rename/delete flows;
- quota and transform governance;
- reliability and security guarantees;
- operational runbook for manual user limit management;
- future shared-chat file access model.

The project is OSS and mostly BYOK, but hosted usage still consumes your own
Cloudflare resources. The implementation is intentionally conservative with
storage and image transforms.

## Core Constraints

### Product and Cost Constraints

- Hosted users do not pay per file usage.
- Storage growth and Cloudflare Images transforms must be capped.
- You need manual DB-level overrides for family/friends without admin UI.

### Cloudflare Runtime Constraints

- Workers allow only 6 simultaneous external connections (R2/KV/fetch).
- Over-parallelized file operations can stall requests.
- DELETE request bodies are unreliable at edge; bulk delete uses POST.

## Architecture

### Components

- R2: binary file objects.
- D1:
  - `files` metadata.
  - `storages` per-user file policy and counters.
  - `image_transform_usage_monthly` global monthly transform guard.
  - `chat_shares` and `chat_share_files` for share-grant model.
- KV:
  - short-lived cached data URLs for AI file conversion.
  - short-lived storage stats cache.

### Source of Truth

- Server-side DB policy is authoritative.
- Client validation is advisory only.
- Runtime config provides defaults and fallback values.
- `public.maxFilesPerMessage` and `public.maxMessageFilesBytes` are used for:
  client-side fallback validation and default values for newly created
  `storages` rows.
- `filesHardMaxStorageBytes` is the only server-side hard cap in file quotas.

## Data Model Reference

### `files`

- Purpose: per-file metadata, ownership, and lookup by storage key.
- Key columns:
  - `id` public id.
  - `userId` owner.
  - `storageKey` unique R2 key.
  - `name`, `type`, `size`.
  - `expiresAt`: nullable timestamp for retention cleanup.
  - `source`: `upload | assistant`.
  - `originMessageId`: nullable FK to `messages` for provenance.
  - `originProvider`: nullable provider id for provenance.

### `storages`

- Purpose: per-user quota policy and transform counters.
- One row per user (`UNIQUE(user_id)`).
- Key columns:
  - `tier`: `free | vip` (classification only).
  - `storage`: max storage bytes.
  - `maxFilesPerMessage`.
  - `maxMessageFilesBytes`.
  - `fileRetentionDays`: nullable retention policy for file expiry materialization.
  - `imageTransformLimitTotal`.
  - `imageTransformUsedTotal`.

### `image_transform_usage_monthly`

- Purpose: global monthly transform circuit breaker.
- Primary key: `monthKey` (`YYYY-MM`).
- Key columns:
  - `transformsUsed`.
  - `transformsLimit` (default `1000`).

### `chat_shares` (future shared chats)

- Purpose: share token lifecycle and revocation/expiry state.
- Key columns:
  - `id`.
  - `chatId`.
  - `revoked`.
  - `expiresAt`.

### `chat_share_files` (future shared chats)

- Purpose: explicit file grants per share.
- Key columns:
  - `chatShareId`.
  - `fileId`.
- Unique pair: (`chatShareId`, `fileId`).

## API Surface

- `GET /api/v1/files` list files with pagination and search.
- `PUT /api/v1/files/upload` upload one file.
- `PATCH /api/v1/files/[id]/name` rename one file.
- `DELETE /api/v1/files/[id]` delete one file.
- `POST /api/v1/files/delete/bulk` bulk delete files.
- `GET /api/v1/files/policy` effective user policy + global monthly remaining.
- `GET /api/v1/storage` usage stats + policy summary.
- `GET /files/[key]` stream file bytes by storage key (owner/share access check).
- `POST /api/v1/internal/files/recompute-expiry` maintenance endpoint to
  recompute one user retention expiry timestamps.

## Endpoint Semantics and Failure Modes

### Upload (`PUT /api/v1/files/upload`)

- Requires auth session.
- Validates required headers and allowed MIME type.
- Uses real body size for quota checks (`X-Filesize` is not trusted).
- Checks user storage usage against effective policy.
- Image flow:
  - reserves per-user lifetime slot;
  - reserves global monthly slot;
  - attempts transform to WebP.
- If transform is unavailable/denied/fails, falls back to original bytes.
- If DB metadata insert fails after R2 put, R2 object is rolled back.

Common failure statuses:

- `400`: invalid headers/type/quota/policy violation.
- `401`: unauthorized.
- `500`: R2 put or DB write failure.

### Delete Single (`DELETE /api/v1/files/[id]`)

- Requires auth and ownership.
- Attempts R2 delete first.
- On R2 delete failure, returns error and keeps DB metadata intact.
- On success, invalidates file cache and storage stats cache, then deletes DB row.

Common failure statuses:

- `404`: file not found.
- `409`: storage delete failed (DB row preserved).

### Delete Bulk (`POST /api/v1/files/delete/bulk`)

- Requires auth.
- Body: `{ ids: string[] }` (`1..100`).
- Processes files sequentially.
- If an individual R2 delete fails, that file is not removed from DB.
- Returns partial failure as `409` after processing successful deletions.

### Storage/Policy (`GET /api/v1/storage`, `GET /api/v1/files/policy`)

- Require auth.
- Expose effective policy plus transform usage summary.
- Storage stats endpoint uses short TTL KV cache.

## Retention Cleanup Architecture

- File retention is materialized per file using `files.expiresAt`.
- Default free retention: `30` days.
- VIP effective retention: `null` (no automatic expiry).
- Shared chat references do not pin files against expiration.
- Cleanup uses `expiresAt <= now` only. It does not re-join per-file policy rows.
- Cleanup runs via Cloudflare cron through Nitro `cloudflare:scheduled` hook.
- Runtime controls:
  - `filesRetentionCleanupEnabled`
  - `filesRetentionCleanupBatchSize`
  - `filesRetentionCleanupMaxRuntimeMs`

### Background Logging in Cleanup Paths

- Cloudflare scheduled hooks do not run with an h3 request event.
- Because of that, code in cron/background paths must not assume `useEvent()`
  exists.
- Shared infra utilities used by cleanup (`useDb`, file storage, KV helpers)
  must stay request-agnostic and avoid `useEvent()` for config reads.
- Files module uses `server/utils/files/logger.ts`:
  - `LoggerLike` (minimal `set(...)` contract).
  - `resolveServerLogger(...)` to safely resolve logger in both request and
    non-request contexts.
- File helpers that can be called from both request handlers and cron jobs
  accept optional `logger?: LoggerLike` and pass it through.
- Cron entrypoint emits one structured evlog event per run and forwards the same
  logger into cleanup utilities for consistent context.

## Quota and Transform Governance

### Default Policy

- Free:
  - `20MB` max storage.
  - `10` max files per message.
  - `1GB` max total message file bytes.
  - `30` days file retention.
  - `0` lifetime transforms.
- VIP:
  - same storage/message defaults unless manually overridden.
  - no file retention expiry by default (`fileRetentionDays = null` effective).
  - recommended transform limit baseline: `100` lifetime transforms.

### Global Transform Guard

- Global monthly default: `1000`.
- Stored in `image_transform_usage_monthly`.
- Used as a circuit breaker to preserve transform budget for other projects.

### Counter Behavior

- User/global slots are reserved before transform.
- If transform fails, reserved slots are released.
- Slots remain consumed only when transform succeeds.

## Security and Ownership Guarantees

- Upload quota checks use actual request body length.
- File conversion for AI validates ownership before any storage read.
- `/files/[key]` access:
  - owner session is allowed; or
  - valid signed share token + matching file grant + active share.
- No `isPublic` bypass flag is used.

## Reliability Guarantees

- DB metadata is not deleted when R2 deletion fails.
- Cache invalidation failures are logged but do not block successful file delete.
- Upload DB insert failure triggers best-effort R2 rollback.
- Retention cleanup uses R2-first delete and keeps DB rows for retry on R2 failure.

## Assistant File Guardrails (Future Scope)

- Assistant-generated files must not be kept as final inline `data:` payloads in
  stored chat history.
- When assistant file generation is implemented, generated bytes should be
  persisted to R2 and metadata should be written to `files` with
  `source = 'assistant'`.
- Assistant message file parts should be rewritten to `/files/<storageKey>`
  before message persistence.
- Generated files use the same storage quota model as uploads.
- Generated files should be visible in the file manager by default.
- Assistant file parts are excluded from automatic model-context replay.
  Reuse should happen through explicit user reattach from file manager.
- Current `enableAssistantFilePersistence` flag is scaffolding-only and defaults
  to `false`.

## Operations Runbook (Manual DB Management)

`users.role` is not a source of truth for file policy in current implementation.
Use `storages` policy columns directly. Treat `tier` as metadata and always
update tier and explicit limit columns together.
`public.maxFilesPerMessage` and `public.maxMessageFilesBytes` do not cap DB values;
they only seed defaults and client fallback behavior.
`fileRetentionDays` controls future/retroactive file expiry materialization.

### 1. Inspect Current User Policy

```sql
SELECT
  u.id AS user_id,
  u.email,
  s.tier,
  s.storage AS max_storage_bytes,
  s.max_files_per_message,
  s.max_message_files_bytes,
  s.file_retention_days,
  s.image_transform_limit_total,
  s.image_transform_used_total
FROM users u
LEFT JOIN storages s ON s.user_id = u.id
WHERE u.email = 'friend@example.com';
```

### 2. Create/Upsert Policy Row

```sql
INSERT INTO storages (
  user_id,
  storage,
  tier,
  max_files_per_message,
  max_message_files_bytes,
  file_retention_days,
  image_transform_limit_total,
  image_transform_used_total
)
SELECT
  u.id,
  20 * 1024 * 1024,
  'free',
  10,
  1000 * 1024 * 1024,
  30,
  0,
  0
FROM users u
WHERE u.email = 'friend@example.com'
ON CONFLICT(user_id) DO NOTHING;
```

### 3. Promote User to VIP (Recommended Pattern)

```sql
UPDATE storages
SET
  tier = 'vip',
  storage = 200 * 1024 * 1024,
  max_files_per_message = 20,
  max_message_files_bytes = 2 * 1024 * 1024 * 1024,
  file_retention_days = NULL,
  image_transform_limit_total = 100
WHERE user_id = (
  SELECT id FROM users WHERE email = 'friend@example.com'
);
```

### 4. Apply Custom Limits Without Tier Change

```sql
UPDATE storages
SET
  storage = 500 * 1024 * 1024,
  max_files_per_message = 30,
  max_message_files_bytes = 3 * 1024 * 1024 * 1024,
  file_retention_days = 30,
  image_transform_limit_total = 250
WHERE user_id = (
  SELECT id FROM users WHERE email = 'poweruser@example.com'
);
```

### 5. Demote Back to Free Defaults

```sql
UPDATE storages
SET
  tier = 'free',
  storage = 20 * 1024 * 1024,
  max_files_per_message = 10,
  max_message_files_bytes = 1000 * 1024 * 1024,
  file_retention_days = 30,
  image_transform_limit_total = 0
WHERE user_id = (
  SELECT id FROM users WHERE email = 'friend@example.com'
);
```

### 6. Inspect Global Monthly Transform Usage

```sql
SELECT
  month_key,
  transforms_used,
  transforms_limit,
  (transforms_limit - transforms_used) AS transforms_remaining
FROM image_transform_usage_monthly
ORDER BY month_key DESC;
```

### 7. Recompute File Expiry After Policy Changes

After manual tier/retention updates, call maintenance recompute so `expiresAt`
is synchronized for existing files:

```bash
curl -X POST \
  -H "content-type: application/json" \
  -H "x-maintenance-token: $FILES_MAINTENANCE_TOKEN" \
  -d '{"userId":123,"graceDays":7}' \
  https://besidka.com/api/v1/internal/files/recompute-expiry
```

## Shared Chats: Future File Implementation Notes

### Access Model

- Keep owner-private file ownership model.
- Grant shared access by relationship, not by per-file public flags.
- Use:
  - `chat_shares` for token lifecycle and revocation;
  - `chat_share_files` for explicit file grants.

### Token Model

- Use short-lived signed token payload:
  - `shareId`,
  - `fileId`,
  - `exp`.
- Sign with HMAC using server secret (`encryptionKey`).
- Revoke by marking `chat_shares.revoked = true`.

### Authorization Policy for `/files/[key]`

- Allow when:
  - requester is owner; or
  - share token is valid and references file grant on active share.
- Deny all other access.

### Caching Policy for `/files/[key]`

- `/files/[key]` is an authorization-gated route, not a public asset route.
- Required response policy:
  - `Cache-Control: private, no-store, max-age=0`
  - `Vary: Cookie, x-file-access-token`
- Do not use `public, max-age=..., immutable` on `/files/[key]` in the current
  ownership/share-token model.

Why this is required:

- Owner access is session-based; public/shared caching can replay bytes to
  unauthorized requests without re-running auth checks.
- Shared chat file access is token-based and revocable/expiring. Long-lived
  public cache entries can outlive token expiry/revocation and serve stale
  authorized content.
- Owner delete/revoke semantics depend on revalidation at request time.

If CDN caching is needed in the future:

- Treat it as a separate design, not a header tweak.
- Use dedicated signed file URLs where the cache key fully includes a
  short-lived signature context.
- Keep TTL bounded by token expiry and define purge/invalidation on revoke,
  expiry, and file delete.

### Owner Delete Semantics

- Owner delete removes R2 object and DB metadata (only when R2 delete succeeds).
- Shared references should resolve to “file removed by owner” UI state.
- Message parts can remain for historical integrity, but no file bytes served.

### UX Notes for Shared Views

- Show clear state for missing/revoked/expired files.
- Avoid leaking owner identifiers in shared error messages.
- Ensure preview/attachment components degrade gracefully when file is removed.

## Complexity and Key Decisions

- DB policy over app config:
  needed for per-user manual control and OSS-hosted cost governance.
- Lifetime transforms + global monthly guard:
  controls both abusive users and total account budget usage.
- Transform fallback to original bytes:
  prioritizes user upload success over optimization.
- R2-first delete with DB preservation on failure:
  prevents silent storage leaks and metadata inconsistencies.
- Share grants + signed tokens:
  future-safe model without unsafe `isPublic` shortcuts.

## Troubleshooting

- Upload hangs/errors with many files:
  check parallel R2/KV usage and connection fan-out.
- Unexpected quota rejections:
  query `storages` row and compare with actual file sum in `files`.
- Transforms not occurring:
  check user transform limit and monthly global remaining.
- File missing in AI conversion:
  verify ownership and `/files/<key>` origin in message parts.
