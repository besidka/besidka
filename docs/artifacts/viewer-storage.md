# Artifact saved progress (A-5, BES-260)

Quizzes, flashcards and trackers keep progress through
`window.besidka.storage` (`get`, `set`, `delete`, `list`). The runtime has no
network (A-2), so every call is a `besidka/storage/*` request on the frame's
MessagePort, answered by the parent (`Frame.client.vue`) through the API
below. This page covers the server routes, the host side, limits,
retention and what is deliberately left for share links (A-7).

## Who gets persistent storage

`resolveArtifactStorageMode()` (`app/composables/artifact-storage.ts`)
advertises `capabilities.storage = 'persistent'` in `ui/initialize` only when
all of these hold; otherwise `'memory'`:

| Condition | Why |
| --- | --- |
| The viewer is signed in | The sandbox has an opaque origin and no identity |
| `useFeature('artifacts.storage').active` | Per-viewer flag (includes the global `artifacts` rule) |
| The panel was opened from the viewer's own chat (`source === 'owner'`) | Only the owner resolves on the server until A-7 |
| The artifact is saved (has an id) | A streaming preview has nothing to key rows on |

In memory mode the host passes no storage handler, so the runtime keeps
values in a `Map` inside the frame and no storage request reaches the server.
Capabilities are fixed for a frame session, so the Frame remounts when the
mode or the artifact id changes (for example when a streamed artifact is
saved, or the flag changes).

Shared chats stay in memory mode in this layer: a chat share is not an
artifact share, and the resolver answers 404 to every non-owner. The planned
"Sign in to save your progress" caption is not shown yet, because signing in
on a shared chat would not enable storage; it belongs with A-7, where a share
link with `storageAllowed` makes sign-in meaningful.

## Server

`resolveArtifactViewerAccess()` (`server/utils/artifacts/access.ts`) returns
`{ mode, artifactInternalId, ownerUserId, viewerUserId, storageAllowed,
bridgeAllowed }`. Owner mode only: unknown, forged or foreign ids answer 404,
a taken-down artifact 451. The share token header `x-besidka-artifact-share`
is read and ignored until A-7 extends the resolver; it is never a query
string.

Routes (session, `requireFeature('artifacts.storage')`, current legal
consent per the A-12 pre-check, then the resolver; every route acts on the
caller's own rows only):

| Route | Result |
| --- | --- |
| `GET /api/v1/artifacts/<id>/storage` | `{ items: { key, value }[], keys, bytes }`, `private, no-store` |
| `PUT /api/v1/artifacts/<id>/storage/<key>` body `{ value }` | `{ keys, bytes }` |
| `DELETE /api/v1/artifacts/<id>/storage/<key>` | `{ keys, bytes }` |
| `DELETE /api/v1/artifacts/<id>/storage` | Reset: `{ keys: 0, bytes: 0, deleted }` |

The ticket named the reset route `reset.post.ts`. It is `index.delete.ts`
instead: a static `storage/reset` segment would collide with a key named
`reset` on `PUT storage/<key>`, and a body-less DELETE is safe (RFC 9110
note in `CLAUDE.md`).

Limits per (artifact, viewer), `shared/utils/artifacts.ts`:

| Limit | Value | Error |
| --- | --- | --- |
| Keys | 64 | 413 `artifact_storage_full`, `why` "64 of 64 keys are used." |
| Total | 100 KB of `JSON.stringify(value)` bytes | 413, `why` with used and limit |
| One value | 32 KB | 413 |
| Key | `^(?!\.{1,2}$)[A-Za-z0-9._:-]{1,128}$` (`.` and `..` are refused: the URL parser would turn `storage/.` into `storage/`, the reset route) | 400 |
| Request body | 40 KB by `Content-Length`, checked before the body is read | 413 |
| Writes (`PUT`, `DELETE`, reset) | 120 per minute, KV prefix `artifact-storage`, keyed `viewer:artifact` | 429 with `Retry-After` |

The write limiter runs before the body is read. Workers KV accepts one
write per second per key, so two quick saves can make the counter update
fail; the save then goes ahead (fail open, noted as
`storageRateLimit.skipped: 'kv-error'`), because the D1 caps still bound
what a viewer stores. A value too deeply nested for `JSON.stringify` is a
400.

Totals are read and checked in the same request before the upsert; two
concurrent writes can overshoot a cap by one value (accepted in the ticket).
The protocol still accepts keys up to 256 characters and values up to about
100 KB (A-2), so the host checks the stricter server rules first and answers
`-32602` without a request.

Logs carry ids, counts and bytes only (`attributes.artifacts.storageKeys`,
`storageBytes`, `storageDeleted`), never key names or values. Values are
opaque JSON: never rendered by the parent, never sent to a model, never
exposed through MCP, an export or an admin view, not even to the owner.

## Host side

`createArtifactStorageSession()` loads the snapshot once per frame session
(after any write still in flight from an earlier frame of the same
artifact) and serves `get` and `list` from it. Writes are serialised per
artifact (a superset of the ticket's per-key queue), so a slow response can
never overwrite a newer value, and the snapshot changes only after the
server accepted the write. Errors map to the runtime's codes, which show
their own text to artifact code:

| HTTP | JSON-RPC |
| --- | --- |
| 400, 413 | `-32602` invalid params ("too large or invalid") |
| 429 | `-32012` rate limited |
| 403 with `reason: legal-consent` | `-32010` consent required |
| other 4xx | `-32013` not allowed |
| 5xx, network | `-32603` internal error |

The actions menu of the detail view shows **Reset saved progress** when the
storage is persistent and holds at least one key. It asks for confirmation,
starts the reset (queued behind any write in flight), remounts the frame
at once so the old frame cannot queue a write after the reset, and the new
frame's snapshot waits for the reset.

## Retention

Per the Privacy Policy row "Progress you saved in artifacts" (A-9):

- Kept until the viewer uses Reset, the artifact is deleted
  (`deleteArtifacts` removes every viewer's rows) or the account is deleted
  (purge by `viewerUserId`).
- For someone else's artifact (non-owner viewers, which exist only once A-7
  ships) the hourly sweep `sweepViewerArtifactStorage()`
  (`server/plugins/artifact-storage-sweep.ts`, cron `0 * * * *`) also deletes
  rows 30 days after the last share link to that artifact ended (the
  earliest of revoked, taken down or expired, per link), at the next run
  after a takedown of the artifact, and when the artifact no longer exists.
  There is no takedown helper in code yet (A-8), so the sweep is the
  mechanism; "at once" therefore means within the hour.
- Revoking a share does not delete rows by itself, so re-sharing within the
  30 days keeps progress.

Restored `artifact_storage` rows after a D1 Time Travel restore are harmless
(no security state).

## Not in this layer

- Share-mode access (`x-besidka-artifact-share`, `storageAllowed`) and the
  sign-in caption: A-7.
- Owner-visible aggregates (leaderboards): never.
- MCP access to storage: never.
