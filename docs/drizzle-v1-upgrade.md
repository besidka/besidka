# Drizzle ORM v0 → v1 upgrade (issue #276)

## Rebase onto main after PRs #277/#278 (2026-07-01)

This branch was rebased onto `main` after merging #277 (iOS wake-lock) and
#278 (push notifications). #278 added a new `push_subscriptions` table and
a `user_settings.notification_prompt_state` column as three new v0-format
flat migrations (`0019_wide_ravenous`, `0020_famous_old_lace`,
`0021_fancy_mantis`). These were converted into this branch's v1 folder
format the same way as the original 19 — via the real `drizzle-kit up`
binary on an isolated copy of the *complete* migration history (a partial,
headless chain starting mid-sequence does not get its snapshot version
bumped to the current format; confirmed empirically) — then relinked to
follow `tidy_vengeance` (this branch's own extra migration) instead of
`motionless_prowler` directly, since #278 was authored with no knowledge of
that insertion.

`server/db/schemas/push-subscriptions.ts` was converted to `snakeCase.table`
(it still used plain `sqliteTable`, which would have silently resolved
`p256dhKey`/`authKey`/`userId` to the wrong, non-existent column names), and
its two `db.query.pushSubscriptions.findFirst/findMany` call sites
(`server/api/v1/push/subscribe.post.ts`,
`server/utils/push.ts`) were converted to the v1 declarative filter syntax.
The unique-constraint taxonomy fix (see "sqliteTable() -> snakeCase.table()"
below) had to be reapplied to the new latest snapshot (`fancy_mantis`),
since it was generated fresh from #278's un-fixed v0 history and didn't
carry the earlier fix forward. `scripts/drizzle-v1-migration-rename.sql`
gained three more entries for `0019`/`0020`/`0021`, on the assumption they
were already deployed to preview/production via the normal merge-to-main
pipeline before this rebase.

Re-verified end to end: `db:generate` clean no-op, full chain (23
migrations) rebuilt from scratch on a wiped local D1 with `push_subscriptions`
and the new `user_settings` column both present and correctly named, 563/563
unit+integration tests passing (470 before #277/#278, 561 on main after
them, 563 on this branch).

## Overview

`drizzle-orm` and `drizzle-kit` are pinned to `1.0.0-rc.4` (exact, no `^`).
This is a release candidate, not GA — npm's `latest` tag still points at the
old `0.45.x`/`0.31.x` line. The upgrade was done deliberately on the RC
channel; revisit pinning to a future GA release once one ships.

`wrangler` was bumped to `^4.106.0` (from `^4.94.0`) — required, not
optional, see "wrangler migrations_pattern" below.

## REQUIRED manual step before the next deploy

**Timing matters, not just order.** `preview-build.yml` triggers on
`pull_request: [opened, synchronize, reopened]`, and `preview-deploy.yml`
runs automatically once that build succeeds — so **opening the PR itself
kicks off an automatic deploy attempt against real preview**, migrations
included. `production.yml` triggers on `push: main` — merging the PR
kicks off the production deploy the same way. Run the preview rename
**before opening the PR**, and the production rename **before merging it**
(or immediately after merge, before the auto-triggered production deploy
job reaches its migration-apply step — you may need to be fast, or hold the
merge until you're ready to run the production command right away).

```bash
# before opening the PR:
npx wrangler d1 execute besidka-preview --remote --file=scripts/drizzle-v1-migration-rename.sql
npx wrangler d1 execute besidka-consent-preview --remote --file=scripts/drizzle-v1-migration-rename-consent.sql

# before/immediately at merge time (note --env production, not a different db name flag):
npx wrangler d1 execute besidka --env production --remote --file=scripts/drizzle-v1-migration-rename.sql
npx wrangler d1 execute besidka-consent --env production --remote --file=scripts/drizzle-v1-migration-rename-consent.sql
```

**Recommended precaution before the production commands above.** The rename
script itself only runs `UPDATE d1_migrations SET name = ...` bookkeeping
statements — no `CREATE TABLE`, no `DROP TABLE`, no touching any application
data — so it does not fall under CLAUDE.md's D1 migration-rebuild danger
pattern, and the destructive-DDL risk that rule targets does not apply here.
Even so, this is the highest-risk migration-format change this project has
made, and both `production.yml` and `preview-deploy.yml` run the real
`wrangler d1 migrations apply --remote` step unconditionally right after this
manual step — so as defense-in-depth, take a Time Travel bookmark and record
row counts on the cascade-child tables before running the production rename
commands, the same way CLAUDE.md's own D1 safety checklist requires for real
schema migrations:

```bash
npx wrangler d1 time-travel info besidka --env production
npx wrangler d1 time-travel info besidka-consent --env production
```

Save the returned bookmarks somewhere retrievable before proceeding. Then
capture row counts on `chats`, `messages`, `projects`, and `accounts` — the
tables that cascade-delete off `users` — both before and after running the
production rename commands, and confirm they match:

```bash
npx wrangler d1 execute besidka --env production --remote --command="SELECT
  (SELECT COUNT(*) FROM chats) AS chats,
  (SELECT COUNT(*) FROM messages) AS messages,
  (SELECT COUNT(*) FROM projects) AS projects,
  (SELECT COUNT(*) FROM accounts) AS accounts;"
```

**Verified against the real databases (read-only, 2026-07-01)**, not just
reasoned about from git history: every name both scripts expect is present
verbatim on all 4 real databases (preview main, preview consent, production
main, production consent). `files.source`/`origin_provider`/
`origin_message_id`, `push_subscriptions`, and
`user_settings.notification_prompt_state` all already exist on both preview
and production (PR #278 was already deployed before this branch existed).

One harmless discrepancy found only in production's real `d1_migrations`
table (not visible from git, since it predates git tracking `.drizzle/` at
all): an extra row, `0001_oval_blizzard.sql` (applied 2025-07-08), with no
corresponding file anywhere in this repo's history — the exact same phantom
entry already identified and removed from the local journal earlier in this
upgrade, except it turns out it really was applied to production once,
before its source file was ever committed. Preview doesn't have this row
(provisioned later from an already-consolidated set). This does **not**
block the rename script — wrangler's migration-apply only cares about
files it can't find a matching applied-row for, never about extra applied
rows with no file — so no action is needed; it's just a permanent, inert
bookkeeping artifact. Do not attempt to delete it; there is no benefit and
it touches production's tracking table for no operational gain.

Why: drizzle-kit v1's mandatory migration-folder codemod (`drizzle-kit up`)
renames every migration file from the old flat `0000_name.sql` form to a new
`<timestamp>_name/migration.sql` form. Wrangler's `d1_migrations` tracking
table on the already-deployed preview/production databases still has the OLD
names recorded. Since wrangler matches "already applied" purely by exact
filename string, it would otherwise see all already-applied migrations as
"new" and try to re-run their `CREATE TABLE` statements against tables that
already exist, failing loudly on the first one. These scripts just `UPDATE`
the `name` column in `d1_migrations` to the new names — they touch no
application data, only migration bookkeeping. The mapping was generated from
git's own rename detection (`git diff -M --summary -- .drizzle/migrations/`),
not guessed.

This is a one-time fix. After it runs once per database, all future
deploys work normally with no extra steps.

## What changed, and why

### 1. Migration journal/folder restructure (`drizzle-kit up`)

v1 removed the old `_journal.json` + flat-snapshot format in favor of one
folder per migration (`<timestamp>_<name>/migration.sql` + `snapshot.json`).
Running the codemod is mandatory to use any v1 drizzle-kit command. The
actual applied SQL content of every migration is byte-identical to before —
verified by diffing each converted `migration.sql` against the original
`.sql` file.

Two **pre-existing, unrelated** repo hygiene issues had to be fixed first
(on the v0 toolchain, before installing the RC), because v1's codemod walks
the full historical snapshot chain and hard-fails on either:

- A phantom journal entry (`0001_oval_blizzard`) with no real `.sql` file —
  traced via git history to commit `a3ab74a` (#139), which is the single
  commit that first added `.drizzle/migrations/` to git at all. The entry
  was already orphaned at that point (the file never existed in any commit)
  — almost certainly local-only churn that predates this repo's history of
  tracking migrations. Removed from the journal; nothing was ever applied
  under that name via the tracked CI/CD pipeline, so there is no
  corresponding remote `d1_migrations` row to worry about.
- A missing snapshot for migration index 10 (`0010_gentle_arbiter`) — the
  `.sql` file was real and already applied, but its snapshot JSON was never
  committed. Recovered exactly (not guessed) by noticing migration 11's
  snapshot already recorded `0010`'s real UUID in its own `prevId` field;
  reused migration 11's table-state JSON with the `id`/`prevId` corrected to
  the recovered values, restoring a single connected chain.

A third item, `0009_sturdy_spectrum.sql`, was a real migration (adds
`files.source`/`origin_provider`/`origin_message_id`) that was applied to
real databases at some point but was **never tracked in drizzle's
journal** — wrangler applies files by directory listing, independent of
drizzle's bookkeeping, so it ran anyway even though drizzle's own tooling
never knew about it. `drizzle-kit up` ignores anything not in the journal,
so it would have silently disappeared from the migration history entirely
— which matters: `chubby_sumo`'s own committed snapshot (idx 9) already
recorded `files` as having these 3 columns (an artifact of the same messy
merge), even though `chubby_sumo`'s actual SQL only rebuilds
`image_transform_usage_monthly` and never touches `files`. Confirmed by
actually replaying the full chain from scratch into an empty local D1 with
the file simply deleted: **`files` came out missing all 3 columns**, a real,
silent, load-bearing gap — a fresh disaster-recovery restore or new test
environment would not match the current schema, even though every
automated test in this repo passed anyway (none of them assert on these
specific columns).

Fixed properly instead of just deleting the file: re-created it as a
correctly tracked migration
(`.drizzle/migrations/20260218001926_sturdy_spectrum/`, positioned right
after `chubby_sumo` to match wrangler's real historical apply order — it
sorts alphabetically after `chubby_sumo` and before `gentle_arbiter`, and
both were introduced in the same commit/PR #139), with the exact original
SQL content recovered from git history. `chubby_sumo`'s own snapshot was
corrected to no longer claim these columns already exist (restored to
match `aromatic_starjammers`, the migration immediately before it, for just
the `files` table) — `sturdy_spectrum`'s new snapshot is what now correctly
introduces them. Re-verified end to end: `db:generate` stays a clean no-op,
and a from-scratch local D1 rebuild now produces a `files` table with all 3
columns present. `scripts/drizzle-v1-migration-rename.sql` includes the
`0009_sturdy_spectrum.sql` → new-name mapping alongside the other 18, since
it's real, already-applied history on preview/production exactly like the
rest.

All of the above was verified empirically: tested against the real RC binary
in an isolated copy before touching the real repo, including a clean
`drizzle-kit up` run, a `db:generate` no-op confirmation, and a from-scratch
local D1 apply of all 19 migrations in sequence.

### 2. `relations()` → `defineRelations()`

v1 removes the old per-table `relations(table, ({one,many}) => ({...}))`
helper entirely. All 12 relation definitions (previously spread across
`server/db/schemas/*.ts`) are now centralized in `server/db/relations.ts`
using `defineRelations(schema, (r) => ({...}))`.

This change is **purely TypeScript-level query-builder metadata** — it has
no SQL/DDL footprint and cannot affect migrations or trigger a D1 table
rebuild. The actual FK constraints that matter for D1's cascade-rebuild
hazard live in each column's `.references(() => table.col, { onDelete })`,
which this change never touches.

One real behavioral subtlety preserved deliberately: v1's `r.one.X(...)`
defaults `optional: true` regardless of the underlying column's
nullability (unlike the old API, which inferred it from the schema). Every
relation in `relations.ts` sets `optional: false` explicitly wherever the
FK column is `.notNull()` in the schema, matching the old inferred behavior.

### 3. `sqliteTable()` → `snakeCase.table()`

v1 removed the runtime `casing: 'snake_case'` option from `drizzle()` — the
camelCase-property → snake_case-column conversion is now baked into the
table definition itself via `snakeCase.table()` (a drop-in replacement for
`sqliteTable()`, same signature). Every table definition across
`server/db/schemas/*.ts` and `server/db/consent/schema.ts` was converted.
Verified empirically against the installed package that `snakeCase.table`
produces identical column names to what the old runtime option did
(`userId` → `user_id`, etc.) — without this, every camelCase column would
silently resolve to a nonexistent SQL column name.

The drizzle-kit **config-level** `casing` field (`drizzle.config.ts`,
`drizzle-consent.config.ts`) was a different, unrelated mechanism and is
gone too — v1 only has `introspect.casing` (`'camel' | 'preserve'`, for the
`pull` command's output, not used here). Removed from both config files.

### 4. Relational query `where`/`orderBy` syntax

The relational query builder (`db.query.<table>.findFirst/findMany`)
replaced its callback-based `where`/`orderBy` with a declarative object
filter, across ~30 call sites in `server/api/v1/**`, `server/routes/**`,
and `server/utils/{files,projects,providers}/*.ts`:

```ts
// old
where(table, { eq, and }) { return and(eq(table.col, val), eq(table.col2, val2)) }
// new — multiple top-level keys are implicit AND
where: { col: val, col2: val2 }

// old
where(table, { and, isNotNull, lte }) { return and(isNotNull(table.col), lte(table.col, val)) }
// new — multiple operators on the same column nest under that column
where: { col: { isNotNull: true, lte: val } }

// old
orderBy(table, { desc }) { return [desc(table.col)] }
// new
orderBy: { col: 'desc' }
```

Plain query-builder calls (`db.update(...).where(...)`,
`db.delete(...).where(...)`, `db.select(...).where(...)`) are **unchanged**
in v1 and were deliberately left alone — only the relational `db.query.*`
API uses the new object syntax.

### 5. Logger replacement

`drizzle-query-logger` (third-party debug pretty-printer) has a peer
dependency of `drizzle-orm: ">=0.44.3 <1.0.0"` — it hard-excludes v1 and had
to be dropped. Replaced with a ~10-line in-repo `Logger` implementation
(`server/utils/drizzle-logger.ts`), preserving the same
`runtimeConfig.drizzleDebug`-gated behavior.

### 6. `wrangler` bump + `migrations_pattern`

Wrangler 4.94.0's D1 migration discovery only scans the top level of
`migrations_dir` for files ending in `.sql` — it cannot see v1's nested
`<folder>/migration.sql` layout at all, and would silently report "no
migrations to apply" forever after this upgrade, for old AND new
migrations. Cloudflare added an explicit `migrations_pattern` config field
for exactly this ORM-folder scenario in wrangler **4.98.0**
([changelog](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/CHANGELOG.md),
PR #14089). Bumped to `4.106.0` (latest at the time) and added
`"migrations_pattern": ".drizzle/migrations/*/migration.sql"` (and the
consent-DB equivalent) next to every existing `migrations_dir` in
`wrangler.jsonc` — both database entries, both the default/preview block and
`env.production`.

## Deliberately deferred / skipped

- **Effect.js**: not integrated anywhere. Drizzle v1's native `effect-core`/
  `effect-d1` entry points peer-require `effect >=4.0.0-beta.83`, itself
  pre-GA (stable Effect is `3.21.4`). Stacking two pre-release dependencies
  in the database layer, on top of Effect's tagged-error model conflicting
  with this project's mandated async/await + try/catch + evlog convention,
  isn't worth it pre-GA. Revisit once both Drizzle v1 and Effect v4 reach GA.
- **drizzle-zod**: not adopted. `customType()` columns (this project's
  `publicId` pattern, used on nearly every table) always degrade to `z.any()`
  in drizzle-zod (upstream issue #762, closed won't-fix/by-design), and
  there's a separate open SQLite-specific bug (#4619) returning
  `Record<string, never>`. Every endpoint already has hand-written
  `z.object().safeParse()` validation that's stricter than anything
  drizzle-zod would generate (`.max()`, `.trim()`, enum constraints). Kept
  the existing schemas as-is.
- **`publicId().primaryKey({ autoIncrement: true })`** (the commented-out
  line in `server/utils/schema.ts`, citing upstream issue #818): that bug
  was closed as fixed-in-beta on 2026-01-03, pointing at this same RC line.
  Not re-enabled as part of this upgrade — it's an independent schema change
  with its own D1-safety blast radius and deserves its own isolated PR/gate,
  not bundled into a dependency bump.

## Verification performed

- `db:generate` / `db:consents:generate`: zero new SQL beyond one safe,
  intentional `DROP INDEX IF EXISTS` (removing a pre-existing duplicate
  index on `files.storageKey` — it had both an implicit `.unique()` index
  and an explicit `uniqueIndex`; v1 correctly deduplicates them). No
  `DROP TABLE`, no `__new_*` rebuild pattern, anywhere.
- `tests/unit/db/migrations-clean.spec.ts` (new): encodes the above check as
  an automated regression test, registered in
  `scripts/test-affected-check.mjs`.
- Full `pnpm run format && pnpm run typecheck`: clean.
- Full `pnpm run test:unit` (361 tests) and `pnpm run test:integration` (111
  tests, the real gate — exercises every relational query call site against
  a live local D1): 100% pass, every run, no flakiness observed.
- `pnpm run test:e2e:chromium`: 56/57 passed (1 expected platform skip) on
  an uncontended run. Subsequent re-runs on this dev machine, under heavy
  unrelated load from other concurrent worktrees/projects, showed
  inconsistent failures in timing-sensitive, DB-unrelated tests (theme
  icon rendering, cookie-popup auto-show delay, carousel auto-scroll) —
  a different set failed each time, and Playwright itself classified the
  cookie-popup test as "flaky" (failed, then passed on retry). Every
  individual failing test passed cleanly when isolated, including
  `auth/signin.spec.ts` (the one test actually touching this change's
  blast radius — sessions/accounts/users). Treat this as pre-existing
  environmental flakiness, not a regression; re-verify on a quieter machine
  or in CI if you want extra confidence before deploying.
- `drizzle-kit up` tested against the real RC binary in an isolated copy
  before touching the real repo.
- Local D1 (both `DB` and `CONSENT_DB`) wiped and rebuilt from scratch
  through all 20 + 1 migrations under the new structure, confirming every
  converted migration file's SQL applies cleanly in sequence and that the
  resulting `files` table schema matches `server/db/schemas/files.ts`
  exactly (`PRAGMA table_info(files)` checked directly).
- An independent code-reviewer subagent pass caught the `sturdy_spectrum`
  gap described above (it was initially just deleted rather than
  re-tracked); fixed and re-verified end to end before finalizing. A
  separate independent security-auditor subagent pass found zero findings.

## Files touched

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (version pins +
  `drizzle-orm` override)
- `drizzle.config.ts`, `drizzle-consent.config.ts` (removed `casing` field)
- `wrangler.jsonc` (added `migrations_pattern` ×4)
- `server/db/relations.ts` (new), `server/db/schemas/*.ts`,
  `server/db/consent/schema.ts` (`snakeCase.table`, relations removed)
- `server/utils/db.ts`, `server/utils/consents-db.ts`,
  `server/utils/drizzle-logger.ts` (new)
- ~30 files under `server/api/v1/**`, `server/routes/files/**`,
  `server/utils/{files,projects,providers}/*.ts` (where/orderBy syntax)
- `.drizzle/migrations/**`, `.drizzle/migrations-consent/**` (folder
  restructure + journal/snapshot fix)
- `scripts/drizzle-v1-migration-rename.sql`,
  `scripts/drizzle-v1-migration-rename-consent.sql` (new, manual one-time
  use — see top of this doc)
- `scripts/test-affected-check.mjs` (new test mapping)
- `tests/unit/db/migrations-clean.spec.ts` (new)
