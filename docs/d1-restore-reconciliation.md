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
| Feature opt-outs and `experiments` objections (`feature_opt_ins`) | Withdrawn opt-ins come back, so a feature can spend a user's key again | High (consent) | No |
| Revoked roles (`user_roles`), deny grants and grant revocations (`feature_grants`) | Revoked testers and grants work again; deny grants vanish | High | No |
| Kill switch and rollout changes (`feature_flag_rules`) | Revert to B | Medium | No |
| `feature_audit_log` | Rolled back with the rows it describes, so it cannot be the replay source; rows anonymised in the window lose their scrub | Medium (erasure) | No |
| Artifact links revoked or taken down in the window (A-7 writes them) | Public again; a takedown is undone, also inside shared chats | High (privacy, notice-and-action) | No |
| Artifacts deleted in the window | Rows return; R2 objects stay gone, so reads answer 410 | Medium (erasure) | No |
| Artifact reports and decisions in the window | Rolled back or reopened; legal holds set in the window vanish | High (TCO preservation) | No |
| Viewer storage reset or purged in the window | Old answers return | Medium (erasure) | No |
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
runtime external keys are short-lived: the KV generation guard has a 120 s
lease, and the storage and file-policy caches live 60 s. Chat slugs, share
slugs and R2 keys are ULIDs or UUIDs, so they never collide.

Numeric ids recorded in Axiom during the window are different: they are
long-lived, and after the restore they can name a different user's row.
This is why the bulk routes log chat **slugs**, and why every step 4 replay
statement is guarded to rows that existed at B.

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
- Bulk revoke: `attributes.chatShareRevoke.chatSlugs` (owned chats only,
  added with this document).
- Chat delete: `DELETE /api/v1/chats/<slug>` with `chatSlug`.
- Bulk chat delete: `attributes.chatBulkDelete.chatSlugs`.
- Settings changes: `chatSlug` only. The flag values are not logged, so the
  safe reconciliation is to set the restrictive values and tell the owner.

The bulk routes take public chat ids in their request body but log slugs on
purpose. `chats.id` is a plain `INTEGER PRIMARY KEY`, so a chat created in
the window can have its row id reused after the restore, and replaying a
logged id would hit someone else's chat. A slug never collides.

## Artifacts

A restore rolls back every artifact table (`artifacts`, `artifact_versions`,
`artifact_shares`, `artifact_storage`, `artifact_reports`;
`server/db/schemas/artifacts.ts`, A-1) to the bookmark B. None of them has a
foreign key, so nothing cascades. R2 keeps its current state; every version's
object key is stored in `artifact_versions.r2_key`
(`artifacts/<userId>/<id>/v<n>-<uuid>`) and never re-derived. Reconcile before `/a/` is reachable again: turn the
global `artifacts` rule off in `/admin` until the steps below are done.

- **Revocations and takedowns first.** Revoked and taken-down artifact links
  come back live, and a restored takedown comes back too. Replay from Axiom
  every share revoke (`attributes.artifacts.operation = 'share-revoke'`),
  every takedown (`report-decision`, `direct-takedown`) and every restore
  (`restore`) in the window by share id (`sh_...`) and artifact id (A-7 logs
  ids, never tokens): set `revoked_at`, `takedown_at` and `takedown_reason`
  again, or clear them for a restore. The admin audit log
  (`feature_audit_log`, actions `artifact.takedown`, `artifact.restore`,
  `artifact-report.reject`) is rolled back with D1, so Axiom is the record. A
  takedown that was undone is a notice-and-action failure and, for a TCO
  order, a breach of the one-hour rule. A `direct-takedown` with scope
  `user` also wrote a deny grant for `artifacts.share` (logged as
  `attributes.featureAccess` with `action: 'grant.set'`, `effect: 'deny'`);
  write it again, or the owner can publish new links.
- **Legal holds.** Re-set `legal_hold_until` for every artifact held in the
  window, from the private content-incident record
  (`docs/legal/content-incidents.md`, section 8). A held artifact deleted
  before B and held after it is not affected; one held in the window and
  deleted after the restore point must not be purged by the sweep.
- **Reports.** Report rows created in the window are gone from D1; the mailbox
  email is the copy. Recreate the open ones by hand, or keep working from the
  mailbox and the private record. Decisions taken in the window (`status`,
  `decision`, `decision_statement`, `decided_at`) are rolled back and the
  report reopens: replay them from Axiom (`report-decision` by report id) and
  the decision emails already sent, and do not send them again.
- **Deletions.** Artifacts and viewer storage deleted in the window come back
  as rows. Replay the deletes (artifact ids, viewer resets) from Axiom; their
  R2 objects are already gone, so reads answer 410 until then.
- **Ids.** Public artifact ids are encoded from the integer row id, so an
  artifact created in the window can get the same public id as one created
  after the restore. Record `SELECT name, seq FROM sqlite_sequence` before the
  restore (runbook step 0) and push the sequences past the old high-water mark
  (step 3). Match a replayed event to a row by its `created_at`, version
  SHA-256 or `r2_key`, not by the id alone.
- **R2.** Diff the `artifacts/` prefix against `artifact_versions.r2_key`:
  objects written in the window have no row after the restore. Delete them
  unless they belong to an artifact under a legal hold.
- **Pending headers.** A row with `current_version = 0` is a create that was
  interrupted between its header insert and its version batch. No reader
  shows it and the quota does not count it; delete it and its objects with
  the R2 diff.
- **Chat deletions.** Deleting a chat sets `origin_chat_id` to NULL on its
  artifacts. A restore brings back both the chat and the link, which is
  consistent.
- **Report retention.** Report rows the hourly sweep removed in the window
  come back and are removed again on its next run.

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

## Feature access

`user_roles`, `feature_flag_rules`, `feature_grants`, `feature_opt_ins`,
`feature_rule_schedules` and `feature_audit_log`
(`server/db/schemas/features.ts`, `docs/feature-flags.md`)
have no foreign key to `users`, so nothing cascades to them. A restore:

- brings back opt-ins that users withdrew and `experiments` objections they
  turned off or on, so a feature could spend a user's key again without
  consent (the most serious case),
- brings back revoked `tester` roles and revoked allow grants, and removes
  deny grants set in the window,
- reverts kill-switch, rollout and variant changes made after B, and the
  scheduled steps created, cancelled or applied after B: a step that applied
  in the window is `pending` again and would apply a second time on the next
  cron tick, so before the first tick re-create or cancel it from the
  `schedule.create`, `schedule.cancel` and `rule.set` (`actorKind: 'schedule'`,
  `scheduleId`) ledger lines,
- rolls back `feature_audit_log` together with the rows it describes. The
  audit table is therefore **not a replay source**. The ledger is Axiom
  `besidka-prod`: every feature-access write logs
  `attributes.featureAccess` with ids only (action, flag, target user id,
  effect, expiry; a rule write also logs `rule.before` and `rule.after`
  with `enabled`, `rolloutBps`, `allowRoles` and `variants`; the opt-in
  route logs `optedIn`, the objection switch `objected`). Those writers ship with the admin API, Labs and MCP tickets
  (P0-6, P0-7, P0-8).

Rules live in KV (`features:config:v1`, TTL 300 seconds) as a cache only.
Delete that key after the restore so every location reads the restored rules
at once.

The env admin (`NUXT_ADMIN_EMAILS`, a Worker secret, verified email
required) is not stored in D1, so a restore can never lock the owner out of
`/admin`. For an instant global off switch while reconciling, set
`NUXT_FEATURES_DISABLED=*` and redeploy.

Replay is runbook step 4, item 7.

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
the session takeover. What remains is id reuse in Axiom attribution, in
caches that expire within 120 s, and in the step 4 replay. Step 4 has its
own guard for that. Even when this step succeeds, ids handed out between
step 1 and step 3 have already been reused, so the step 4 guard is required
either way.

### 4. Replay the window's revocations and deletions from Axiom

Query `besidka-prod` for the window. Wide events set `message` to
`METHOD path`. Keep only successful requests (`status < 400`).

```kusto
['besidka-prod']
| where _time between (datetime(<B>) .. datetime(<R>))
| where status < 400
| where message matches regex @"^(POST /api/v1/chats/[^/]+/share/revoke|POST /api/v1/chats/[^/]+/share$|POST /api/v1/chats/shared/revoke|DELETE /api/v1/chats/[^/]+$|POST /api/v1/chats/history/delete/bulk|DELETE /api/v1/profiles/keys/[^/]+$|DELETE /api/v1/files/[^/]+$|POST /api/v1/files/delete/bulk|DELETE /api/v1/projects/[^/]+$|POST /api/v1/push/unsubscribe)"
| project _time, message, userId, chatSlug, fileId, projectId, shareRevokeChatSlugs = attributes['chatShareRevoke']['chatSlugs'], bulkDeleteChatSlugs = attributes['chatBulkDelete']['chatSlugs']
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
compare it with `tostring(userId)`.

**Replay guard: only touch rows that existed at B.** A numeric id from the
window can belong to someone else after the restore. `users` ids come back
through the restored `sqlite_sequence`, and `chats` and `projects` ids
through `max(rowid) + 1` reuse. Example: a user signs up in the window, gets
id N, and deletes their account. After the restore, a new sign-up gets id N.
An unguarded `DELETE FROM users WHERE id = N` then wipes the new user's
account. Every statement below therefore carries the guard, where `<B_s>` is
B in Unix seconds (`created_at` columns store seconds):

- `user_id IN (SELECT id FROM users WHERE created_at <= <B_s>)` for
  user-scoped rows,
- `created_at <= <B_s>` on the row itself when the ledger names it by
  numeric id.

Chats are matched by `slug`, a ULID, which never collides: a slug from a chat
created in the window matches nothing after the restore. Apply, in this
order:

1. **Deleted accounts**: for each `userId`,
   `DELETE FROM image_generation_locks WHERE user_id = <id> AND user_id IN (SELECT id FROM users WHERE created_at <= <B_s>);`,
   the same `DELETE` for `feature_grants`, `feature_opt_ins` and
   `user_roles` (no foreign key, so no cascade), and the audit scrub that
   `purgeUserFeatureAccess` (`server/utils/account/purge-feature-access.ts`)
   runs:
   `UPDATE feature_audit_log SET actor_user_id = CASE WHEN actor_user_id = <id> THEN NULL ELSE actor_user_id END, target_user_id = CASE WHEN target_user_id = <id> THEN NULL ELSE target_user_id END, before = CASE WHEN json_valid(before) THEN json_remove(before, '$.userId', '$.targetUserId', '$.actorUserId', '$.grantedBy', '$.updatedBy', '$.reason') ELSE NULL END, after = CASE WHEN json_valid(after) THEN json_remove(after, '$.userId', '$.targetUserId', '$.actorUserId', '$.grantedBy', '$.updatedBy', '$.reason') ELSE NULL END WHERE (actor_user_id = <id> OR target_user_id = <id>) AND <id> IN (SELECT id FROM users WHERE created_at <= <B_s>);`
   and the grantor clean-up
   `UPDATE feature_grants SET granted_by = NULL WHERE granted_by = <id>;`,
   the same for `user_roles.granted_by`, and
   `UPDATE feature_flag_rules SET updated_by = NULL WHERE updated_by = <id>;`
   (all guarded the same way),
   then `DELETE FROM users WHERE id = <id> AND created_at <= <B_s>;`. The
   cascade removes the restored children. This is the cascade `CLAUDE.md`
   warns about, and here it is intended. R2 and KV were already purged
   before B, and `message_search` orphans are collected by the hourly sweep.
2. **Share revokes and deleted chats**, by `chatSlug` (single routes) and
   `chatSlugs` (bulk routes):
   `DELETE FROM chat_shares WHERE chat_id IN (SELECT id FROM chats WHERE slug IN (...));`
   then `UPDATE chats SET shared = 0 WHERE slug IN (...);`. For deleted chats,
   `DELETE FROM chats WHERE slug IN (...);`.
3. **Share settings changes** (`POST /api/v1/chats/<slug>/share`): set the
   restrictive flags for those `chatSlug`s and tell the owners. The same
   route also creates shares, but a share created after B no longer exists
   after the restore, so those rows match nothing.
4. **Key deletions**:
   `DELETE FROM keys WHERE user_id = <id> AND provider = '<provider from path>' AND user_id IN (SELECT id FROM users WHERE created_at <= <B_s>);`.
5. **Push unsubscribes**:
   `DELETE FROM push_subscriptions WHERE user_id = <id> AND user_id IN (SELECT id FROM users WHERE created_at <= <B_s>);`.
   The user re-subscribes from the device that should get pushes.
6. **Project deletions**: the path carries a public (Hashids) project id.
   Decode it with the production `encryptionHashids` salt and minimum length
   16, as `decodePublicId` in `server/utils/custom-db-types.ts` does, then run
   `DELETE FROM projects WHERE id = <decoded id> AND user_id = <id> AND created_at <= <B_s> AND user_id IN (SELECT id FROM users WHERE created_at <= <B_s>);`.

7. **Feature access** (`docs/feature-flags.md`). Query the ledger, not
   `feature_audit_log`:

   ```kusto
   ['besidka-prod']
   | where _time between (datetime(<B>) .. datetime(<R>))
   | where status < 400
   | where isnotnull(attributes['featureAccess'])
   | project _time, userId, featureAccess = attributes['featureAccess']
   | order by _time asc
   ```

   Re-apply, in this order, each statement guarded with
   `user_id IN (SELECT id FROM users WHERE created_at <= <B_s>)`:
   1. opt-outs (`opt_in.set` with `optedIn: false`): set `opted_out_at` on
      the user's `feature_opt_ins` row; and `experiments` objections
      (`experiments.set` with `objected: true`): upsert the `experiments`
      row with `opted_out_at`,
   2. role revocations (`role.revoke`): delete the `user_roles` row,
   3. deny grants (`grant.set` with `effect: 'deny'`) and grant revocations
      (`grant.revoke`): upsert the deny row or delete the grant,
   4. rule changes (`rule.set`): set `enabled`, `rollout_bps`,
      `allow_roles` and `variants` to `rule.after` of the last event logged
      per flag in the window, then delete the KV key `features:config:v1`.
      The env kill switch (`NUXT_FEATURES_DISABLED`) is not in D1 and needs
      no replay.

   Within each group, take only the **last** logged event per (user, flag)
   in `_time asc` order: an opt-out followed by a fresh opt-in in the window
   ends opted in, and a deny grant followed by a revocation ends with no
   grant.

   Do not replay grants, roles or opt-ins that were *added* in the window:
   those were the user's or admin's choice at the time and can be redone by
   them. Re-adding consent from a log line would be wrong for opt-ins.

Back up anything you delete with a `SELECT` first. Each `DELETE` here
removes data that users already asked to delete.

### 5. Reconcile files and R2

For artifacts, run the R2 diff of the Artifacts section as well.

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
