# Post-mortem: D1 cascade wipe via Drizzle migration

**Date:** 2026-05-15
**Severity:** SEV-1 (production data loss)
**Stack:** Nuxt 4 + Cloudflare D1 + Drizzle ORM + Better Auth
**Affected:** `besidka` (production), `besidka-preview` (preview)
**Status:** Resolved — both databases restored via D1 Time Travel

## Timeline

1. **Schema edit** — `.default(false)` added to `users.emailVerified` in `server/db/schemas/auth.ts`. Looked harmless.
2. **Migration generated** — `pnpm run db:generate` produced `0018_woozy_hemingway.sql`. The SQL contained `DROP TABLE users` as part of a table-rebuild dance. Reviewed and incorrectly classified as safe.
3. **Migration applied** to production and preview. `DROP TABLE users` fired `ON DELETE CASCADE` on every child table. `chats`, `messages`, `projects`, `accounts`, `sessions`, `files`, `storages`, `keys`, `user_settings`, `chat_shares`, `chat_share_files` — all wiped in a fraction of a second.
4. **Recovery** — D1 Time Travel restored both DBs from pre-migration bookmarks.
5. **Prevention** — bad migration deleted, schema change reverted (default moved out of SQL), AGENTS.md updated with a HIGH RISK warning.

## Root cause — the schema change forced a table rebuild

SQLite cannot `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT`. The only way to change a column default in SQLite is to **rebuild the entire table**. Drizzle automates this with the standard SQLite "12-step" pattern:

```sql
PRAGMA foreign_keys=OFF;                                -- (1) try to suppress cascades
CREATE TABLE __new_users (...);                          -- (2) new table with new schema
INSERT INTO __new_users SELECT ... FROM users;          -- (3) copy data over
DROP TABLE users;                                        -- (4) destroy old table  ← BOMB
ALTER TABLE __new_users RENAME TO users;                -- (5) swap names
PRAGMA foreign_keys=ON;                                  -- (6) re-enable
```

The same pattern is forced by ANY of these schema changes in SQLite:

- Adding / changing / removing a column DEFAULT
- Changing a column type, nullability, or constraint
- Renaming or dropping a column
- Changing a primary key
- Changing or removing a foreign key

So a single innocuous-looking `.default(false)` triggered the same SQL pattern that "remove a column" would.

## What is `PRAGMA`, and why didn't it save us?

`PRAGMA` is a SQLite-specific command that controls engine settings. Examples:

- `PRAGMA foreign_keys = ON|OFF` — toggle foreign key enforcement (and therefore CASCADE behavior)
- `PRAGMA journal_mode = WAL` — set write-ahead-log mode
- `PRAGMA synchronous = NORMAL` — control durability

**The catch:** `PRAGMA foreign_keys` is a **per-connection** setting. It only applies within the same connection and only persists for the duration of that connection.

In **vanilla SQLite** (e.g., `better-sqlite3`, a single embedded file): the whole migration runs in one connection, so `PRAGMA foreign_keys=OFF` at the top applies to the `DROP TABLE` four statements later. Cascades suppressed. Safe.

In **Cloudflare D1**: the migration file is split on `--> statement-breakpoint` markers and each statement is executed as a **separate HTTP API call to D1's edge service**. Whether those calls share a connection is implementation-defined and not guaranteed. The `PRAGMA foreign_keys=OFF` in statement 1 effectively had **no effect** on statement 4 (`DROP TABLE users`). When D1 executed `DROP TABLE`, foreign keys were enabled, and the cascade fired across every child table referencing `users`.

This is the load-bearing fact: **D1's transport boundary breaks the `PRAGMA` contract that the SQLite 12-step rebuild pattern depends on for safety.**

## Why did `users` survive but everything else die?

The most counter-intuitive part. Look at the order:

```sql
CREATE TABLE __new_users (...);              -- empty new table
INSERT INTO __new_users SELECT * FROM users;  -- ← users data is NOW also in __new_users
DROP TABLE users;                             -- cascade kills children, but __new_users is untouched
ALTER TABLE __new_users RENAME TO users;      -- __new_users becomes users
```

By the time `DROP TABLE users` ran, the user rows had **already been copied** into `__new_users`. So when the original `users` table was dropped:

- The **rows in `users`** were "gone" — but the same rows still existed in `__new_users`.
- Every **cascade-child table** received `DELETE FROM <child> WHERE user_id IN (SELECT id FROM users)` — those DELETEs ran against the rows in the table being dropped, fired before the drop completed. All children were wiped.
- The rename in step 5 brought users data back under the name `users`, but the children that cascade-deleted are **not recovered** — there's no equivalent backup of them anywhere in the migration.

Users data lived because it was copied. Everything else died because the cascade fired on the table being dropped, with no copy step protecting it.

## Could this happen on Postgres?

**No, not for this scenario.** The design differences are deep:

1. **Postgres has full ALTER COLUMN support.** `ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT false` is a single-line, in-place metadata change. No rebuild needed. The whole disaster pattern doesn't exist for default-changes.

2. **Postgres `DROP TABLE` does not cascade by default.** You must explicitly write `DROP TABLE users CASCADE` to drop dependent objects. A bare `DROP TABLE users` with FK children will **fail** with "cannot drop table because other objects depend on it." Postgres errors out instead of silently destroying data.

3. **Postgres has transactional DDL.** Wrap the whole migration in `BEGIN ... COMMIT` and if anything fails, every change rolls back atomically. SQLite supports `BEGIN/COMMIT` but D1's per-statement HTTP execution model often does not preserve that semantic across the boundary.

4. **`ON DELETE CASCADE` semantics are clearer in Postgres.** The cascade only fires on actual `DELETE` of parent rows, not on schema-level operations like dropping the parent table.

This bug class is essentially **specific to SQLite-style engines used over an HTTP/RPC boundary that doesn't preserve connection state** — D1, libsql/Turso, and similar serverless SQLite offerings are the risk surface. Local SQLite with `better-sqlite3` would have been safer (single connection, PRAGMA persists). Postgres on any deployment model would have been safer (different ALTER semantics, different cascade semantics, transactional DDL).

## How D1 Time Travel works

D1 keeps a **continuous write-ahead log** for every database for the last 30 days (Workers Paid) or 7 days (Free). Every committed write produces a **bookmark** — a versioned identifier of database state at that moment. Bookmarks look like:

```
00000a5d-00000002-0000506c-a30f085a6a7ac4bb8d62d31efd4c1b4a
```

Three sub-counters concatenated with a checksum. Higher numbers = newer state.

The `wrangler d1 time-travel info` command gives you the bookmark active at a specific moment:

```bash
# bookmark active right now
wrangler d1 time-travel info chat

# bookmark active at a past timestamp
wrangler d1 time-travel info chat --timestamp=2026-05-15T16:00:00Z
```

`wrangler d1 time-travel restore` replaces the current state with the state at that bookmark:

```bash
wrangler d1 time-travel restore chat --bookmark=00000a5d-...
```

The restore is itself an operation — it produces a new bookmark, and the restore command **prints an undo bookmark** representing the pre-restore state. So you always have a one-step rollback for the restore itself.

There's no list-all-bookmarks API. You can only query by timestamp or by the "current" call. This is what made the dashboard unhelpful — there's no UI for it because there's no real list endpoint to back a UI.

## How the bookmark to restore to was identified

Binary-searching through timestamps.

### Step 1 — get the current (broken) bookmark and save it as the safety net

```bash
$ wrangler d1 time-travel info chat
The current bookmark is '00001390-00000000-0000506c-167c665731e03ffcc8afcf0cef5d6d9c'
```

If anything went wrong with restoration, this is the rollback target.

### Step 2 — probe past timestamps to find bookmark transitions

The migration file was generated at ~16:27 UTC (from `stat` on the file). Querying timestamps walking backwards:

```bash
$ wrangler d1 time-travel info chat --timestamp=2026-05-15T16:00:00Z
→ bookmark '0000138a-00000014-...'

$ wrangler d1 time-travel info chat --timestamp=2026-05-15T16:30:00Z
→ bookmark '0000138e-0000000a-...'   # new bookmark — DB activity happened

$ wrangler d1 time-travel info chat --timestamp=2026-05-15T17:00:00Z
→ bookmark '0000138e-0000000a-...'   # same

$ wrangler d1 time-travel info chat --timestamp=2026-05-15T17:05:00Z
→ bookmark '0000138f-00000006-...'   # another transition
```

Every transition is a write to the DB. Between bookmark `138f` and the current `1390`, the migration ran.

### Step 3 — restore to a candidate bookmark and CHECK row counts

First attempt was wrong. Restored to `0000138f` (the latest pre-current bookmark), assuming "just before the broken one" = "just before migration":

```bash
$ wrangler d1 time-travel restore chat --bookmark=0000138f-...
$ wrangler d1 execute chat --remote --command="SELECT COUNT(*) FROM chats..."
→ users: 107, chats: 0, messages: 0   # STILL EMPTY
```

`138f` was POST-cascade. The migration had been applied earlier than initially estimated.

Tried `0000138e` — still empty. Tried `0000138a` (the oldest distinct bookmark probed) — **data was back**:

```bash
→ users: 107, chats: 1027, messages: 5815, projects: 110, accounts: 242
```

**The key technique:** don't trust your inference about WHEN the destructive event ran. Verify by actually inspecting data after each restore, and walk further back until cascade-children are populated again. The bookmark numbers alone tell you "something changed" but not "what changed."

For `chat-preview`, the same approach ended on bookmark `000009e0-...` — much older than initially probed, because the preview had less activity and so fewer bookmark transitions.

## Why the dashboard couldn't help

Cloudflare's D1 dashboard exposes:

- Database metadata (name, ID, size)
- Query console
- Some metrics

It does NOT expose:

- Bookmark history
- Bookmark search by timestamp
- A "restore to point in time" UI

Time Travel is **only available via wrangler CLI** (or the underlying Cloudflare API). You have to know it exists, know the command syntax, and know the database name. There's no signpost in the dashboard saying "your data is recoverable here."

## Lessons (encoded in AGENTS.md)

1. **Every Drizzle SQLite migration needs a `grep DROP TABLE` review** before it touches a remote DB. If `DROP TABLE` appears, treat the migration as destructive until proven otherwise.
2. **Avoid schema changes that force a table rebuild** — especially on tables with cascade children. Prefer setting defaults in application code (`$defaultFn()` in Drizzle works at insert time without needing a SQL default).
3. **`PRAGMA foreign_keys=OFF` is not a safety net on D1.** Don't trust it across statement boundaries.
4. **Take a Time Travel bookmark before every `--remote` migration**, even ones that look additive. Saving the current bookmark before applying is 10 seconds of insurance against a 30-minute disaster.
5. **Apply to `chat-preview` first, verify counts, then `chat`.** The user environment naturally provides this safety order — use it.

## Files touched by the prevention work

- `AGENTS.md` (also surfaced via the `CLAUDE.md` symlink) — added the `🚨 SUPER IMPORTANT — HIGH RISK: D1 Migration Safety 🚨` section after the commands block. Covers the disaster pattern, the full list of cascade-dependent tables, the mandatory pre-apply checklist, the production workflow, recovery commands, and the style consequence of biasing schema decisions toward non-rebuild changes.
- `server/db/schemas/auth.ts` — `.default(false)` removed from `users.emailVerified` (the change that forced the rebuild). Kept the safe additions from the same iteration: `sessions.ipAddress` column, `sessions.userId` / `accounts.userId` / `verifications.identifier` indexes.
- `.drizzle/migrations/0018_woozy_hemingway.sql` — destructive migration deleted along with its journal entry and snapshot.
- `.drizzle/migrations/0018_motionless_prowler.sql` — replacement, safe-only migration. Contains only `ALTER TABLE ADD COLUMN` and `CREATE INDEX`. No `DROP TABLE`. No risk.

## Playground repository

I decided to create a [playground repository](https://github.com/serhii-chernenko/drizzle-schema-alter-column-test) to compare behavior between SQLite (without Cloudflare-specific abstractions), Cloudflare D1 (based on SQLite), MySQL, and PostreSQL.

## Background reading

The original incident and recovery: [`docs/postmortems/2026-05-15-postmortem-d1-cascade-wipe.md`](docs/postmortems/2026-05-15-postmortem-d1-cascade-wipe.md).

External references:

- [Playground repository](https://github.com/serhii-chernenko/drizzle-schema-alter-column-test)
- [Cloudflare D1 — defer foreign-key constraints](https://developers.cloudflare.com/d1/sql-api/foreign-keys/#defer-foreign-key-constraints) — the official advice that turns out not to help in this case (it defers FK *validation*, not cascade *actions*).
- [NuxtHub — foreign key constraints in migrations](https://hub.nuxt.com/docs/database/migrations#foreign-key-constraints) — references the Cloudflare doc; same caveat applies.
- [drizzle-team/drizzle-orm#1813](https://github.com/drizzle-team/drizzle-orm/issues/1813) — the open issue tracking this exact class of problem in drizzle-kit's generator. Still unresolved.
- [SQLite docs — foreign keys](https://www.sqlite.org/foreignkeys.html) — for the underlying semantics, especially the distinction between deferred validation and immediate cascade actions.