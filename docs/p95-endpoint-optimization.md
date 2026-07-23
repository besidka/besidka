# P95 slow-endpoint optimization (2026-07)

Axiom's "Slowest endpoints — p95" panel flagged nine paths. This document
records what was actually found (by reading the real code, not guessing),
what was fixed, what was deliberately left alone and why, and how the fixes
were verified without access to production traffic.

| Path | p95 (Axiom) | Disposition |
|---|---|---|
| `/api/auth/callback/google` | 3220ms (also 1530ms) | Floor-bound — not fixed |
| `/api/v1/files/upload` | 2480ms | Partially floor-bound — dedup fixed, ~300ms not expected |
| `/api/v1/storage` | 1640ms | Fixed — ~300ms plausible |
| `/api/v1/consents` | 1170ms | Fixed (exclusion), but win is likely near-zero |
| `/api/auth/sign-out` | 1070ms | Platform-tail-bound — dedup helps a little, no further lever |
| `/api/auth/sign-in/email` | 1050ms | Floor-bound — not fixed |
| `/api/v1/chats/new` | 971ms | Platform-tail-bound — dedup helps a little, no further lever |
| `/api/v1/files/policy` | 905ms | Fixed — ~300ms plausible |
| `/api/v1/push/subscribe` | 747ms | Platform-tail-bound — dedup helps a little, no further lever |

## What was actually wrong

### 1. Every request resolved its Better Auth session twice

`server/middleware/evlog-auth.ts` runs on every request (except an exclude
list) purely to attribute logs, and called `createAuthMiddleware(...)` from
the `evlog` package. That helper resolves the session itself
(`auth.api.getSession()`) internally and never exposed the result — it
returns only a boolean. Separately, `server/utils/session.ts`'s
`useUserSession()` — called independently by nearly every protected handler
(`files/upload`, `storage`, `files/policy`, `chats/new`, `push/subscribe`) —
resolved the session again from scratch. Most protected requests paid for
two full Better Auth session resolutions.

On a `cookieCache` hit (5-minute TTL HMAC check) the second resolution is
cheap CPU only. On a miss it costs a KV read and potentially a D1 read —
this is a tail-latency trim, not a guaranteed p95 halving. Worth noting:
server-side `getSession()` calls can't refresh the cookie cache (no
`Set-Cookie` propagation), so misses are more common in practice than the
5-minute TTL suggests.

**Fix**: `evlog-auth.ts` now passes an `onIdentify` callback to
`createAuthMiddleware` that stashes the resolved session on
`event.context.authSession` (typed via `server/types/h3-context.d.ts`).
`useUserSession()` checks that context field first and only falls back to
its own `getSession()` call when nothing is cached.

Only **positive** (successfully identified) results are cached — `onIdentify`
only fires when a session actually resolved. Anonymous and error paths are
never cached, so a transient KV/D1 hiccup can't turn into a spurious 401 for
a request whose own retry would have succeeded. No auth-mutating route
(sign-in, sign-out, OAuth callback, password reset) sits outside
`/api/auth/**`, which stays fully excluded from this middleware and never
calls `useUserSession()` — so there's no route where a stale cached session
could be read after a same-request mutation.

`/api/v1/consents` was also added to the exclude list: its handler never
calls `useUserSession()` at all (it's fully anonymous), so it was paying for
a session resolution with no consumer. In practice this endpoint's cost is
dominated by cold-isolate overhead on the separate `CONSENT_DB` binding and
by the fact that consent POSTs correlate with new visitors' first requests —
don't expect this specific change to move its p95 much.

### 2. `files.userId` had no usable index

`getUserStorageUsageBytes()` (`server/utils/files/file-governance.ts`) runs
`SELECT COALESCE(SUM(size),0) FROM files WHERE userId = ?` — called from the
hot path of `/api/v1/files/upload` and `/api/v1/storage`. The `files` table
had a unique index on `(id, userId)`, but `id` (the table's own primary key)
is the leading column, making it useless for a plain `userId = ?` predicate.
SQLite fell back to a full table scan across every user's files, growing
worse as the table grows.

**Fix**: added `index('idx_files_user_id').on(table.userId)` to
`server/db/schemas/files.ts`. The generated migration
(`.drizzle/migrations/20260723161132_unknown_overlord/migration.sql`)
contains exactly one statement:

```sql
CREATE INDEX `idx_files_user_id` ON `files` (`user_id`);
```

No `DROP TABLE`, no table rebuild — this is the one migration shape this
repo's D1 safety checklist calls unconditionally safe (see `CLAUDE.md`).

### 3. Two helper functions wrote to D1 on every call, even in steady state

This was the single biggest lever found — bigger than the missing index.

`getOrCreateStoragePolicyRow()` always ran `INSERT ... ON CONFLICT DO
NOTHING` followed by a `SELECT`, even when the row already existed (which is
true almost always, after a user's first-ever call). D1 writes serialize at
the primary and have a materially higher latency floor than reads. This
function backs `getEffectiveUserFilePolicy()`, called from `/api/v1/storage`,
`/api/v1/files/policy`, `/api/v1/files/upload`, and
`reserveImageTransformSlots` — nearly every hot read path in this subsystem.

`getGlobalMonthlyTransformStats()` was worse: `INSERT ... ON CONFLICT DO
NOTHING`, then an **unconditional** `UPDATE` (two writes), then a `SELECT` —
on every call, including every `/files/policy` request and every `/storage`
cache miss — just to sync `transformsLimit` from a runtime-config value that
essentially never changes between deploys.

**Fix**: both functions now read first. `getOrCreateStoragePolicyRow` only
inserts (via `.returning()`, avoiding a third round trip) when the row is
actually missing. `getGlobalMonthlyTransformStats` only writes when the row
is missing or its stored `transformsLimit` differs from the computed limit.
Steady state for both: a single `SELECT`, zero writes. The concurrent-miss
race (two requests both seeing "row missing") is exactly as safe as before —
`ON CONFLICT DO NOTHING` already handled that.

`reserveGlobalTransformSlot`'s/`reserveUserTransformSlot`'s atomic
`UPDATE ... WHERE used < limit` reservation logic was deliberately left
untouched — that conditional update *is* the actual slot reservation, not
wasted work.

### 4. Policy and usage were fetched 2-3x per upload for no reason

For one image upload: `upload.put.ts` fetched policy + usage as a pre-check,
`reserveImageTransformSlots` fetched policy again internally just to read one
field, and `persistFile()` fetched both again to redo the exact same
pre-check (nothing D1-relevant changed in between — the only thing that
happened is a Cloudflare Images transform call, which doesn't touch D1).

**Fix**: `reserveImageTransformSlots(userId, policy?)` and
`persistFile(input)` (`policy`/`totalFilesSize` optional fields) now accept
already-fetched values and skip their internal fetch when supplied,
defaulting to fetching internally otherwise (so other callers of
`persistFile` elsewhere in the codebase are unaffected). `upload.put.ts`
fetches policy and usage once and threads them through.

`persistFile`'s **post-insert** re-check of `getUserStorageUsageBytes` — the
authoritative, race-safe check that catches a concurrent second upload
landing in the gap — was left completely untouched. It has to re-query fresh
every time; only the redundant *pre*-check fetches were deduplicated.

Non-negotiable invariant: these optional pre-fetched parameters are only ever
populated from `upload.put.ts`'s own same-request calls, never from anything
client-supplied. `reserveUserTransformSlot` branches its enforcement path on
`policy.imageTransformLimitTotal` (unguarded increment when `null`, `WHERE
... <` guarded otherwise), so a wrong policy here would matter for
enforcement if it could come from outside — it can't.

### 5. Independent D1 calls were awaited sequentially

`storage/index.get.ts` (policy + usage + global stats), `policy.get.ts`
(policy + global stats), and `upload.put.ts`'s pre-check (policy + usage) each
awaited 2-3 independent calls one at a time. None of them depend on each
other's results. All three now use `Promise.all([...])`.

### 6. `/api/v1/files/policy` had no cache; `/api/v1/storage` already did

`storage/index.get.ts` already KV-caches its response for 60 seconds.
`policy.get.ts` computed nearly the same underlying data fresh on every call.

**Fix**: added the same 60-second TTL KV-cache pattern to `policy.get.ts`
(`file-policy:{userId}` key). `invalidateStorageCache` (called from
`persist-file.ts` after a successful upload) now deletes both cache keys, so
the two caches can't silently drift out of sync with each other.

## What was deliberately NOT changed, and why

**`/api/auth/callback/google` (3220/1530ms)** — the OAuth callback makes two
*sequential* external calls to Google (authorization-code→token exchange,
then userinfo — inherently sequential, since userinfo needs the access token
from the first call), plus roughly 5-8 sequential D1/KV operations
(verification-state consume, user/account upsert, a `lastLoginMethod` write,
session create to both D1 and KV, rate-limit KV read+write). This floor
cannot be pushed below Google's own round-trip time. **Not fixed.**

The gap between the two observed samples (3220ms vs 1530ms) is plausibly
explained by Better Auth's `oAuthProxy({ productionURL })` plugin: its
`checkSkipProxy` logic forces the entire OAuth exchange onto
`productionURL`'s origin (`https://www.besidka.com`) with an extra redirect
round-trip whenever the request's current origin differs — e.g. a sign-in
starting on the bare apex domain or a preview URL. This is **unverified** —
it requires checking which origins the slow samples in Axiom actually came
from, which needs Axiom access this work didn't have. **Investigate before
touching** — don't change `baseURL`/proxy config on this hypothesis alone.

**`/api/auth/sign-in/email` (1050ms)** — Better Auth's default password KDF
is scrypt, deliberately CPU-expensive for security, and Workers CPU is
comparatively scarce vs. a typical VM. Weakening the KDF trades security for
speed. **Not fixed, and shouldn't be.**

**`/api/v1/files/upload` (2480ms)** — the redundant-fetch fixes above (items
3 and 4) reduce the server-side D1 cost, but the measured duration starts at
request receipt: `readRawBody()` waits for the entire request body to arrive
from the client. For multi-megabyte files over residential/mobile uplinks,
that transfer time dominates the 2480ms figure, on top of a genuine
Cloudflare Images transform round trip and an R2 put. **~300ms is not
achievable here by definition** — this endpoint should be excluded from the
300ms target the same way the OAuth callback is.

**`/api/auth/sign-out`, `/api/v1/push/subscribe`, `/api/v1/chats/new`
(non-research path)** — each does very little real work (1-3 already-indexed
D1 operations). The session-resolution dedup (fix 1) removes one of their two
session resolutions, which helps some, but their p95 is dominated by
platform tail latency: cold Worker isolates paying the full Better Auth
instance construction cost on first use, Cloudflare Smart Placement variance,
and D1/KV round-trip latency — not application logic. There is no further
code-level lever here.

One considered-and-declined option: collapsing `push/subscribe`'s
find-then-update/insert pair into a single `INSERT ... ON CONFLICT(endpoint)
DO UPDATE` would save one round trip, but the handler deliberately logs
whether a subscription was new vs. reassigned/resubscribed, and the single
upsert would lose that attribution. Declined as not worth the trade.

**Cloudflare Smart Placement** (`wrangler.jsonc`, `"placement": {"mode":
"smart"}`) and the **oAuthProxy origin-mismatch theory** above are both
investigate-only. Flipping Smart Placement without production A/B data would
itself be a guess — for a D1-coupled app, Smart Placement typically converges
execution toward the D1 primary, which *helps* the D1-RTT-dominated
endpoints; blindly disabling it could make things worse.

**Statistical caveat**: `sign-in`, `sign-out`, `callback/google`, and
`consents` are comparatively low-volume endpoints. Their p95 over an Axiom
dashboard window may be computed from a small number of samples — check
per-path sample counts and p50 in Axiom before treating these specific p95
figures as stable facts to re-measure against later.

## Benchmark: proving the index change, not guessing it

Local `wrangler dev`/miniflare D1 has near-zero network latency and no cold
starts — it can never reproduce Axiom's production p95 numbers, and no
number in this document claims to. What *is* provable locally and
deterministically is the algorithmic shift SQLite's query planner makes for
this exact predicate: a full table `SCAN` becomes an indexed `SEARCH`, and
that shift's cost scales with row count regardless of what machine runs it.

`scripts/bench/files-user-id-index.mjs` (run via `pnpm run bench:files-index`)
builds a throwaway SQLite database (never the checked-in local D1 state)
matching the real `files` table DDL, seeds it with a power-law-skewed
`user_id` distribution and realistic file sizes, times the query before and
after applying the exact migration SQL, and prints `EXPLAIN QUERY PLAN` plus
mean/median/p95 over 1000 timed iterations. It accepts `--rows`, `--users`,
`--iterations`, `--seed` for re-running at different scales.

Results at three scales (all runs reproduced independently, not
cherry-picked):

| Rows | Distinct users | Before plan | Before mean/median/p95 | After plan | After mean/median/p95 |
|---|---|---|---|---|---|
| 100,000 | 1,000 | `SCAN files` | 3.66 / 3.52 / 4.05 ms | `SEARCH ... USING INDEX` | 0.026 / 0.009 / 0.061 ms |
| 120,000 | 1,499 | `SCAN files` | 4.20 / 4.14 / 4.57 ms | `SEARCH ... USING INDEX` | 0.021 / 0.008 / 0.051 ms |
| 300,000 | 3,000 | `SCAN files` | 16.74 / 16.60 / 18.03 ms | `SEARCH ... USING INDEX` | 0.041 / 0.016 / 0.126 ms |

The pattern that matters: full-scan cost grows with row count (3.66ms →
4.20ms → 16.74ms as rows went 100k → 120k → 300k) while the indexed-seek cost
stays essentially flat regardless of table size. That's the proof this task
needed — treat the specific "Nx faster" multipliers (roughly two orders of
magnitude) as directional, not precise; sub-0.1ms figures approach timer
resolution.

**The honest way to think about the production win**: it's round-trips
eliminated (and writes eliminated) × real D1/KV round-trip time, not a local
millisecond figure. Fixes 1, 3, 4, and 5 above are what move production
wall-clock p95 today — they remove actual round trips and writes from the
request path. The index (fix 2) is what keeps `getUserStorageUsageBytes`
cheap as the `files` table keeps growing; it's complementary to, not a
substitute for, the round-trip elimination.

## Verification performed

- `pnpm run format && pnpm run typecheck` clean on the full combined change
  set (no errors; only a pre-existing unrelated `no-console` warning).
- Full test suite: 151 files / 1414 tests passing, including a new
  `tests/integration/server/session.spec.ts` (cached-context fast path,
  fallback path, and the existing issue-#235 diagnostic still firing) and a
  new assertion in `tests/integration/server/cache-invalidation.spec.ts`
  confirming both cache keys get invalidated together.
- **Real dev-server smoke test**, because the integration tests above mock
  `useUserSession`/`useServerAuth` — i.e. they mock the exact chain this
  change touches, so green mocked tests alone don't prove the real Nitro
  middleware → handler flow works. Against a live `pnpm run dev` with the
  index migration applied locally:
  - Signed up via email/password (dev auto-signs-in) → `200`.
  - `GET /api/v1/storage` and `GET /api/v1/files/policy` with the real
    session cookie → `200` with correct data, second `/files/policy` call
    served from the new KV cache.
  - Same endpoints with no cookie → `401`.
  - `POST /api/v1/consents` with no cookie → succeeds (no session resolution
    at all, confirming the exclude works).
  - Signed out, then re-hit `/api/v1/storage` with the same cookie jar →
    `401` (session correctly invalidated, no stale-context leak across the
    sign-out boundary).

## Rolling out the migration

The migration (`.drizzle/migrations/20260723161132_unknown_overlord/`) has
only been applied to this worktree's local D1 for benchmarking and smoke
testing. Per this repo's D1 migration safety rules, applying it to
`chat-preview` and then production `chat` is a separate, explicit step:

```bash
npx wrangler d1 time-travel info chat-preview
pnpm run db:migrate:preview
# verify, then:
npx wrangler d1 time-travel info chat
pnpm run db:migrate:prod
```

This migration is additive-only (`CREATE INDEX`, no `DROP TABLE`) and does
not touch any cascade-dependent table, so it carries none of the rebuild risk
this repo's checklist warns about — but the checklist's "take a Time Travel
bookmark first" step is still cheap insurance and should not be skipped.
