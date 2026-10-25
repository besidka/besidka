# D1 Time Travel restore: what comes back, and how to reconcile

The D1 migration-safety section in `CLAUDE.md` and the runbook in
`docs/auth-security.md` both use a whole-database D1 Time Travel restore as
the recovery step. A restore is not a neutral undo. It rolls back **only D1**.
KV, R2, Axiom, Analytics Engine, browser cookies and provider-side state stay
as they are. Every user action between the bookmark and the restore that
lived in D1 is reverted, and some of those reverts are security or privacy
regressions: revoked sessions work again, revoked shares are public again,
and deleted accounts come back.

This document lists what comes back, why, and the reconciliation steps
that must follow every restore of `besidka` or `besidka-preview`. It closes
the "Restore reintroduces invalid state" unit that the 2026-10 security audit
deferred (run-1 critic, wave 2).

Terms used below:

- **B**: the bookmark timestamp you restore to.
- **R**: the moment the restore runs.
- **The window**: everything users did in (B, R].

Nothing here was run against a remote database. The Better Auth behavior is
pinned by `tests/unit/server/auth/session-database-fallback.spec.ts`. Every
command below is for the operator, preview first.

## Summary table

| State | What the restore does | Severity | Self-heals? |
| --- | --- | --- | --- |
| Sessions revoked in the window | Valid again through the D1 fallback | High | No |
| Sessions created in the window | KV-only, invisible to every D1-based list or revoke | High | Expire in ≤ 7 days |
| `users.id` reuse | New sign-ups reuse ids, and old KV sessions authenticate as them | High | No |
| Password, 2FA, passkey, email, OAuth-link changes | Reverted (an old password works again) | High | No |
| Deleted accounts | Row and every cascade child return; R2 files stay gone | High (erasure) | No |
| Revoked shares, share settings | Public again with file grants; flags revert | High (privacy) | No |
| Deleted chats, projects, keys | Return (deleted BYOK keys get used again) | Medium | No |
| Push unsubscribes | Subscriptions return; pushes resume | Low to medium | Partly (410 pruning) |
| `files` rows whose R2 object is gone | 404 on open, still counted in quota | Medium | Expired rows only |
| R2 objects uploaded in the window | No row, no owner | Medium (privacy) | No |
| `message_search` FTS index | Consistent with `messages` | None | Yes |
| `d1_migrations` | Rolled back, so the next deploy re-applies migrations | **Blocking** | No |

## Sessions: why a restore revives revoked sessions

`server/utils/auth.ts` configures Better Auth with KV `secondaryStorage` and
`session.storeSessionInDatabase: true`, without
`preserveSessionInDatabase`. In Better Auth 1.7
(`node_modules/better-auth/dist/db/internal-adapter.mjs`):

- `findSession` reads KV first. When the KV entry is missing, it does **not**
  stop. It falls back to the D1 `sessions` row (lines ~333-336). That fallback
  is why the database store was turned on: it keeps users signed in when a KV
  read misses (see the comment in `auth.ts` and issue #235).
- Revocation removes both stores (`deleteSession` / `deleteSessions`, lines
  ~466-556). Sign-out, the profile "End session" route, password changes that
  revoke other sessions, and account deletion all delete the KV entry **and**
  the D1 row.

A restore puts the D1 row back while the KV entry stays deleted. So the next
request finds it through the fallback and the session is live again. This
includes a session the user ended because it was stolen. Two details make it
worse:

- **Revival is not limited to 7 days after B.** `updateSession` refreshes
  the D1 row (`executeMainFn`) but only rewrites KV when a KV entry already
  exists (lines ~425-465). A revived session therefore keeps extending its D1
  `expiresAt` on each refresh and never re-enters KV. It lives as long as it
  is used.
- **Every session row whose `expiresAt` is after R revives.** The default
  lifetime is 7 days, refreshed daily, so with a bookmark older than about a
  week most restored rows have already expired.

### Sessions created in the window

These sessions exist only in KV now. Their D1 rows were lost. They still
authenticate, because KV answers first. But `listSessions` reads D1 whenever
the database fallback is enabled (line ~179), and so does the app's own
`GET /api/v1/profiles/sessions`. So these sessions do not appear in the
profile list, and "sign out other sessions" cannot end them. If the user
was created in the window, the KV session also points at a `users` row that
no longer exists.

### `users.id` reuse: a takeover path

`users`, `sessions`, `accounts`, `verifications`, `user_settings`,
`push_subscriptions`, `two_factors` and `passkeys` are `AUTOINCREMENT`.
`sqlite_sequence` is part of the restored database, so the next sign-up after
the restore gets the same id as a user who signed up in the window. That
window user's KV session (`auth:<token>`) still carries `session.userId` =
that id, and `useUserSession()` scopes every query by `session.user.id`. The
window user's still-valid cookie therefore opens the **new** user's account.

The other tables (`chats`, `messages`, `files`, ...) use plain
`INTEGER PRIMARY KEY`. They reuse `max(rowid) + 1` after any restore. Their
external keys are all short-lived: the KV generation guard has a 120 s
lease, and the storage and file-policy caches live 60 s. Share slugs and R2
keys are ULIDs or UUIDs, so they never collide.

### Why not the obvious levers

- **Rotating `betterAuthSecret`** would invalidate every cookie, but it also
  makes every stored TOTP secret and 2FA backup code permanently
  undecryptable (`docs/auth-security.md`, two-factor section). Do not use it
  as a sign-out switch.
- **Setting `preserveSessionInDatabase: true`** would disable the D1
  fallback, which is the root cause here. It would also bring back the
  KV-miss sign-outs that the database store was added to fix. That is a
  product trade-off, not a restore fix, and this document does not make it.

So the runbook clears **both** stores right after the restore. It runs
`DELETE FROM sessions` in D1 and removes every KV key under `auth:`. Everyone
is signed out once. The only tail is Better Auth's 5-minute `cookieCache`:
a signed `session_data` cookie issued before the wipe keeps answering
`getSession` until it expires. The same KV prefix also holds
`auth:active-sessions-<userId>`, `auth:verification:*` (pending reset-password
and delete-account tokens) and `auth:rate-limit:*`. Losing all of them is
expected.

## Credentials and account security

Better Auth stores all of this state in D1, so a restore reverts it all:
a password changed in the window (the old password works again), 2FA turned
on or off, passkeys added or removed, email changes, linked or unlinked OAuth
accounts. These requests go through `server/api/auth/[...all].ts`, and
`/api/auth/**` is excluded from the evlog identify middleware
(`server/middleware/evlog-auth.ts`). Their wide events carry only
`METHOD path`, with **no `userId`**, so Axiom cannot tell you who did what. The mitigation is the global sign-out
plus a notice to every user (step 7 below) asking anyone who changed security
settings after B to redo the change.

## Deleted accounts

Deleting an account runs `purgeUserData` (R2 objects, KV caches, KV sessions,
`message_search` rows), then deletes the `users` row so D1 cascades remove
the rest. A restore brings back the `users` row and every cascade child:
chats, messages, shares (public again), encrypted BYOK `keys`,
`push_subscriptions`, `two_factors`, `passkeys`, `accounts` (the password
hash). The R2 objects stay deleted, so the restored `files` rows point at
nothing. This reverses an erasure the user asked for.

Ledger: the deletion wide event sets `accountPurge.phase = 'completed'` with
`accountPurge.userId` (`server/utils/account/purge-user-data.ts`).

## Shares

Revoking a share deletes the `chat_shares` row (cascading
`chat_share_files`) and sets `chats.shared = false`. The single route is
`POST /api/v1/chats/<slug>/share/revoke`, the bulk one is
`POST /api/v1/chats/shared/revoke`. A restore brings the row back with
`revoked = false`, its file grants and `chats.shared = true`, so the public
link works again. Settings changes made in the window
(`POST /api/v1/chats/<slug>/share`: `indexable`, `showFiles`, `showMetadata`,
`showAuthorAvatar`, `allowBranch`) revert to their values at B. A chat deleted
in the window comes back together with its share.

Ledger:

- Single revoke: `chatSlug` and `userId`.
- Bulk revoke: `attributes.chatShareRevoke.chatIds` (owned chats only, added
  with this document).
- Chat delete: `DELETE /api/v1/chats/<slug>` with `chatSlug`.
- Bulk chat delete: `attributes.chatBulkDelete.chatIds`.
- Settings changes: `chatSlug` only. The flag values are not logged, so the
  safe reconciliation is to set the restrictive values and tell the owner.

Bulk routes log **public** chat ids (Hashids of the integer row id). Decode
them with the production `encryptionHashids` salt and minimum length 16, the
same as `decodePublicId` in `server/utils/custom-db-types.ts`.

### The visibility-flag migrations (closed)

`20260704234926`, `20260705120249` and `20260705130243` add `indexable`,
`show_files`, `show_metadata`, `show_author_avatar` and `allow_branch` as
`NOT NULL DEFAULT true`. These permissive defaults never override a user's
choice:

- The app always writes every flag explicitly
  (`server/api/v1/chats/[slug]/share/index.post.ts`, insert and upsert). The
  SQL default is never what a user's share gets.
- Rows that existed before the migrations were unreachable. Nothing wrote
  `chat_shares` before #286 (`git log -S chatShares`: #139 added the schema
  and read helpers, #280 only relations), and public resolution goes by
  `slug`, which was added as nullable in the same migration
  (`resolveActiveShareBySlug`).
- The migrations date from July 2026, outside the 30-day Time Travel window.
  No restore available today can land before them, so they cannot re-run over
  configured rows.

The general rule still holds for future migrations: a restore to a point
before an additive migration re-runs it on the next deploy (see the next
section). A `DEFAULT true` on a privacy flag would then reset rows that users
had configured after the migration. Prefer restrictive defaults, or no SQL
default at all, which `CLAUDE.md` already favors for rebuild reasons.

## Migrations re-apply on the next deploy (blocking)

`d1_migrations` lives in the same database, so a restore rolls it back too.
`production.yml` (production and the long-lived preview) and
`preview-deploy.yml` run `wrangler d1 migrations apply ... --remote` on every
deploy. The most likely reason to restore is the one in `CLAUDE.md`: a
migration that rebuilt a table and wiped cascade children. **If that
migration is still in `.drizzle/migrations/` on `main`, the next deploy runs
it again and repeats the damage.** Remove or hand-rewrite the migration on
`main`, and make sure no deploy can run, before you restore. Until migrations
are re-applied, the deployed Worker may also expect columns the restored
database lacks.

## Files and R2

- **Rows whose retention expired in the window** come back. The hourly
  retention sweep (`server/plugins/file-retention-cleanup.ts`) picks them up
  again. Deleting an R2 key that no longer exists is a no-op, so the sweep
  removes the row. This case self-heals.
- **Rows deleted by a user in the window** (`DELETE /api/v1/files/<id>`,
  `POST /api/v1/files/delete/bulk`, chat-deletion cleanup, account purge) come
  back without their objects. Opening one returns 404, and the row still
  counts against the owner's storage quota. Reconcile by listing the bucket
  and deleting `files` rows whose `storage_key` is absent.
- **Objects uploaded in the window** stay in R2 with no `files` row. Keys are
  `crypto.randomUUID().<ext>` with only `customMetadata.name`, so they cannot
  be attributed to a user. They are orphaned personal data. Decide a retention
  period, then delete objects whose key is in no `files` row. `DATA_BUCKET`
  holds only user files: landing and key-guide media live in `CMS_BUCKET`.

If your `wrangler` version has no command to list bucket objects, use the
R2 S3-compatible API (for
example `aws s3api list-objects-v2 --endpoint-url
https://<account-id>.r2.cloudflarestorage.com`) and diff the result against
`SELECT storage_key FROM files`.

## Search index

`message_search` is an FTS5 table inside the same D1 database. It is restored
consistently with `messages`, so no action is needed. Its sweep cursor lives
in KV (`search-index:sweep-cursor`) and may point past the restored max
message id. The next short page resets it to 0
(`server/utils/search/sweeper.ts`). Rows orphaned by step 4 below are removed
by the hourly garbage collection.

## Smaller reverts (accept, or mention in the notice)

- BYOK keys **replaced** in the window revert to the old ciphertext. If the
  provider already revoked the old key, calls fail until the user enters it
  again.
- `image_transform_usage_monthly` counters roll back, so the monthly quota
  partly resets.
- `user_activation_events` rows from the window are lost. Those users can
  fire their activation event again, which duplicates it in Analytics Engine.
- `research_jobs` that were `pending`/`running` at B are polled again by the
  research sweep. This has not been verified against a provider whose
  response already expired.
- `user_settings`, `projects` and favorites revert to B.

## Runbook

Run every step on `besidka-preview` first (`--remote`, no `--env`), check it,
then run it on `besidka` (`--env production --remote`). The KV namespaces
are in `wrangler.jsonc`: production uses binding `KV` under `env.production`,
previews use namespace `6ee10a2a05034ba092a9fb815f633e06`.

### 0. Before the restore

1. Stop deploys. If the restore undoes a migration, merge its removal or
   rewrite into `main` first (see "Migrations re-apply" above).
2. Write down **R** and keep the undo bookmark that `time-travel restore`
   prints.
3. Record the `AUTOINCREMENT` high-water marks of the live database. They
   survive deletes, so they are accurate even after a cascade disaster:

   ```bash
   npx wrangler d1 execute besidka --env production --remote --command="SELECT name, seq FROM sqlite_sequence;"
   ```

4. Check that Axiom retention on `besidka-prod` covers B. The ledger
   queries in step 4 depend on it.

### 1. Restore

Use the restore in `CLAUDE.md` ("Recovery if it goes wrong"), then verify the
row counts there.

### 2. Invalidate every session, immediately

```bash
npx wrangler d1 execute besidka --env production --remote --command="DELETE FROM sessions;"
npx wrangler kv key list --binding KV --env production --remote --prefix "auth:" > auth-keys.json
jq '[.[].name]' auth-keys.json > auth-key-names.json
npx wrangler kv bulk delete auth-key-names.json --binding KV --env production --remote
```

One pass is enough. Do not repeat until the list is empty: every new sign-in
writes a fresh `auth:<token>` key, so under live traffic the list never
empties, and each extra pass signs out people who just signed in. A revived
session never writes itself back into KV (`updateSession` only rewrites an
existing KV entry), so nothing illegitimate reappears. KV deletes can take
about 60 s to reach every location, and the `cookieCache` tail ends 5
minutes after the wipe.

The `DELETE /api/v1/chats/<slug>` alternative in step 4 is anchored with
`$` on purpose. Without the anchor it also matches the single-message delete
(`DELETE /api/v1/chats/<slug>/messages/<id>`), which logs the same
`chatSlug`, and step 4 would then delete whole chats.

### 3. Push id sequences past the pre-restore high-water marks

For each table from step 0.3 whose restored `seq` is lower:

```sql
UPDATE sqlite_sequence SET seq = <pre-restore seq> WHERE name = '<table>' AND seq < <pre-restore seq>;
```

Nobody has confirmed that D1 accepts writes to `sqlite_sequence`. Try it on
`besidka-preview` first. If D1 refuses, skip the step: step 2 already closes
the session takeover. What remains is id reuse in Axiom attribution and in
caches that expire within 120 s.

### 4. Replay the window's revocations and deletions from Axiom

Query `besidka-prod` for the window. Wide events set `message` to
`METHOD path`. Keep only successful requests (`status < 400`).

```kusto
['besidka-prod']
| where _time between (datetime(<B>) .. datetime(<R>))
| where status < 400
| where message matches regex @"^(POST /api/v1/chats/[^/]+/share/revoke|POST /api/v1/chats/shared/revoke|DELETE /api/v1/chats/[^/]+$|POST /api/v1/chats/history/delete/bulk|DELETE /api/v1/profiles/keys/[^/]+$|DELETE /api/v1/files/[^/]+$|POST /api/v1/files/delete/bulk|DELETE /api/v1/projects/[^/]+$|POST /api/v1/push/unsubscribe)"
| project _time, message, userId, chatSlug, fileId, projectId, ['attributes.chatShareRevoke.chatIds'], ['attributes.chatBulkDelete.chatIds']
| order by _time asc
```

```kusto
['besidka-prod']
| where _time between (datetime(<B>) .. datetime(<R>))
| where ['accountPurge.phase'] == "completed"
| project _time, ['accountPurge.userId']
```

`userId` comes from `server/middleware/evlog-auth.ts` (evlog's Better Auth
identify middleware). It is set on every authenticated request except
`/api/auth/**`, `/api/v1/stats*` and `/api/v1/consents*`. The middleware
writes it as a string, while routes that set it themselves write a number, so
compare it with `tostring(userId)`. Then apply, in this order:

1. **Deleted accounts**: for each `userId`,
   `DELETE FROM image_generation_locks WHERE user_id = <id>;` then
   `DELETE FROM users WHERE id = <id>;`. The cascade removes the restored
   children. This is the cascade `CLAUDE.md` warns about, and here it is
   intended. R2 and KV were already purged before B, and `message_search`
   orphans are collected by the hourly sweep.
2. **Share revokes and deleted chats**:
   `DELETE FROM chat_shares WHERE chat_id IN (SELECT id FROM chats WHERE slug IN (...));`
   then `UPDATE chats SET shared = 0 WHERE slug IN (...);`. For deleted chats,
   `DELETE FROM chats WHERE slug IN (...);`. Map the bulk routes' public ids
   to row ids first (see "Shares").
3. **Share settings changes**: set the restrictive flags for those
   `chatSlug`s and tell the owners.
4. **Key deletions**: `DELETE FROM keys WHERE user_id = <id> AND provider = '<provider from path>';`.
5. **Push unsubscribes**: `DELETE FROM push_subscriptions WHERE user_id = <id>;`.
   The user re-subscribes from the device that should get pushes.
6. **Project deletions**: `DELETE FROM projects WHERE id = <decoded id> AND user_id = <id>;`.

Back up anything you delete with a `SELECT` first. Each `DELETE` here
removes data that users already asked to delete.

### 5. Reconcile files and R2

1. `files` rows whose object is missing: delete those rows. This lowers the
   owners' quota usage.
2. R2 objects with no row: list them, decide a retention period, delete.

### 6. Verify

Run the row counts from `CLAUDE.md` again and add:

```bash
npx wrangler d1 execute besidka --env production --remote --command="SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM chat_shares) AS shares, (SELECT COUNT(*) FROM keys) AS keys, (SELECT COUNT(*) FROM push_subscriptions) AS push_subscriptions, (SELECT COUNT(*) FROM files) AS files;"
```

`sessions` stays near 0 until users sign in again.

### 7. Tell users

Send one notice to all users. It says that everything done after B was
undone, that everyone was signed out, and that anyone who changed their
password, 2FA, passkeys, email, linked accounts, BYOK keys or share settings
after B must redo the change. No ledger can do that last part for them.

## Known gaps and follow-ups

- Better Auth routes (`/api/auth/*`) are excluded from the identify
  middleware and carry no `userId`, so credential changes cannot be
  attributed. Logging the user in a Better Auth `hooks.after` would close
  this gap.
- Settings changes on shares, projects and user settings log no values, so
  they can be reset but not replayed.
- A durable revocation ledger outside D1 (KV or Analytics Engine) would make
  step 4 independent of Axiom retention and field naming.
