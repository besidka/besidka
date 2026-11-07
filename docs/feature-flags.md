# Feature flags, roles and Labs

Status: **partly built** (2026-11-08). Phase 0 tickets P0-2 to P0-8 build
it, and P0-10 adds the Flagship provider later. Each of those tickets updates
the section it implements with the final API. The roadmap is in
`docs/agentic-capabilities-roadmap.md`.

| Section | Ticket | State |
|---|---|---|
| 3. Tables | P0-2 (BES-234) | Built |
| 4. Registry, 5. Evaluation | P0-3 (BES-236) | Design |
| 8. Client access | P0-4 (BES-238) | Design |
| 6. `/admin`, 7. Ledger writers, 8. Labs and MCP | P0-6 to P0-8 | Design |

This document is the contract for per-user feature access: which account can
use which experimental feature, how a feature is rolled out to a share of
accounts, how an A/B variant is chosen, and how a user opts in to a feature
that spends their own API keys.

The design includes the changes required by the Phase 0 compliance pre-check
(`docs/legal/agentic-capabilities-precheck.md`, PR #731). They are marked
with their codes C1 to C15. Do not remove one without re-running that
pre-check.

## 1. What exists today

Gating is global only: `runtimeConfig` keys in `nuxt.config.ts` set through
`wrangler.jsonc` vars (`researchMockEnabled`, `enableAssistantFilePersistence`,
`turnstileEnforced`, the `*SweepEnabled` switches). There are no roles and no
per-user flags. `users` (`server/db/schemas/auth.ts`) has no role column, and
Better Auth (`server/utils/auth.ts`) runs without its admin plugin.

## 2. Decisions

- **In-house evaluator now, OpenFeature-shaped, Cloudflare Flagship later**
  (owner, 2026-11-07). Flagship has been in public beta since 2026-05-26, and
  its pricing and Free-plan support are not announced. The evaluator sits
  behind a provider interface so Flagship can replace the rollout and variant
  steps only (section 9).
- **No columns on `users` and no foreign key to `users`** in the new tables
  (`research_jobs` precedent). `purgeUserData` deletes the rows explicitly.
  The Better Auth admin plugin is rejected because it adds `users` columns,
  and changing `users` risks the table rebuild that CLAUDE.md warns about.
- **Rollout percentage, variants and the global kill switch are UI-only,
  never MCP.** MCP may change access for one user at a time
  (`docs/mcp-server.md`, "What MCP does not do", item 6).
- **Anything that spends the user's keys needs an explicit opt-in, default
  OFF.** In the registry, `spend !== 'none'` implies `optIn: 'required'`.
- **Flag keys are dotted namespaces:** `artifacts.*`, `documents.*`,
  `code-execution.*`, `research.*`, `connectors.*`, `google.*`, `skills.*`,
  `ui.*`. A child flag (`artifacts.react`) is on only when its parent
  (`artifacts`) is on.
- **Disabled features are invisible.** A gated route answers 404, not 403.

## 3. Tables (P0-2)

All in `server/db/schemas/features.ts`, exported from `server/db/schema.ts`.
Defaults come from `$defaultFn` in code, never from SQL `DEFAULT`. The
migration (`.drizzle/migrations/*_feature_access_tables`) contains only
`CREATE TABLE` and `CREATE [UNIQUE] INDEX`.

| Table | Columns | Indexes |
|---|---|---|
| `user_roles` | `id`, `user_id`, `role` (`admin` or `tester`), `granted_by` (nullable actor id; null = env or system), `created_at` | unique `(user_id, role)` |
| `feature_flag_rules` | `flag` (primary key), `enabled` (boolean, default true), `rollout_bps` (0 to 10000, default 0), `allow_roles` (JSON array, null = registry default), `variants` (JSON `[{ key, weightBps }]`, null = none), `salt` (16 random bytes as hex, Web Crypto), `updated_by`, `created_at`, `updated_at` | primary key |
| `feature_grants` | `id`, `user_id`, `flag`, `effect` (`allow` or `deny`), `variant` (forced variant), `expires_at`, `reason` (free text; the P0-6 writer caps it at 200 characters), `granted_by`, `created_at` | unique `(user_id, flag)`, index `flag` |
| `feature_opt_ins` | `id`, `user_id`, `flag`, `opted_in_at`, `opted_out_at` | unique `(user_id, flag)` |
| `feature_audit_log` | `id`, `actor_user_id` (null for env), `actor_kind` (`ui`, `mcp`, `env`), `client_id` (MCP OAuth client), `action`, `flag`, `target_user_id`, `before` (JSON), `after` (JSON), `created_at` | `created_at`; `(flag, created_at)`; `target_user_id`; `actor_user_id` (account-deletion scrub) |

No row in `feature_flag_rules` means "use the registry defaults". Rules are
created on the first admin write. There are no seed rows.

`feature_opt_ins` also holds one reserved key, `experiments` (C3). A row with
`opted_out_at` set means the user objected to rollouts and experiments
(GDPR Art. 21). The registry never defines a flag named `experiments`.

`feature_audit_log.before` and `after` hold ids and flag data only, never
emails or names (C5). They are **flat** JSON objects: every user reference
sits in a top-level key named `userId`, `targetUserId`, `actorUserId`,
`grantedBy` or `updatedBy`, and the grant reason in `reason`. The purge scrub
removes exactly those keys (`FEATURE_AUDIT_PERSONAL_KEYS` in
`server/utils/account/purge-feature-access.ts`), so a writer that nests a user
id or names a key differently leaks it past account deletion. The scrub
reaches only rows where the deleted user is `actor_user_id` or
`target_user_id`, so a writer must also put every user id that appears in
`before` or `after` into one of those two columns.

Timestamps (`created_at`, `updated_at`, `expires_at`, `opted_in_at`,
`opted_out_at`) are Unix seconds, like every other table. The rule `salt` is
16 random bytes from Web Crypto (`crypto.getRandomValues`) as 32 hex
characters; changing it reshuffles every rollout bucket of that flag.

**Account deletion.** Nothing cascades to these tables, so `purgeUserData`
(`server/utils/account/purge-user-data.ts`) calls `purgeUserFeatureAccess`
(`server/utils/account/purge-feature-access.ts`) as its last step, right
before the `users` row is deleted, so a purge that aborts earlier leaves the
user's opt-outs and objections in place. It deletes the user's rows from
`user_roles`, `feature_grants` and `feature_opt_ins`, nulls the grantor ids
the user left on other users' rows (`granted_by`, `feature_flag_rules
.updated_by`), and anonymises the audit rows instead of deleting them: one
`UPDATE` nulls `actor_user_id` and `target_user_id` where they equal the user
**and** runs `json_remove` over the personal keys of `before` and `after` in
every row that references the user (C5). A value that is not valid JSON is
set to null rather than blocking the deletion. The counts go to
`attributes.accountPurge`. A failure aborts the purge, so the deletion stays
retryable.

Why anonymise and not delete: the audit log is the admin's accountability
record (GDPR Art. 5(2) and 32). Deleting every row that mentions a deleted
user would also delete the record of what an admin changed for that user,
and, when the deleted user was an admin, the record of every rule they
changed. Without the ids and the reason, the remaining row (action, flag,
effect, time) no longer relates to an identifiable person.

**Retention.** An hourly sweep deletes audit rows older than 365 days (C6).

**Restore.** A D1 Time Travel restore brings back revoked roles and grants,
withdrawn opt-ins, objections and old rules, and it rolls back the audit
table too. The replay source is therefore Axiom, not the audit table
(section 7 and `docs/d1-restore-reconciliation.md`).

## 4. Registry (P0-3)

`shared/utils/features/registry.ts` holds one typed entry per flag:

| Field | Meaning |
|---|---|
| `key` | Dotted flag key |
| `title`, `description` | Plain-English text for Labs and `/admin` |
| `stage` | `internal`, `beta` or `ga` |
| `default` | Value when no rule, grant or role decides |
| `allowRoles` | Roles that get the feature (default `['admin']`) |
| `spend` | `none`, `foreground` (spends the user's key when they act) or `background` (spends it without a fresh action) |
| `optIn` | `required` or `none`. `spend !== 'none'` implies `required` |
| `requires` | `{ bindings: string[], keyKinds: ProviderKind[] }`. Bindings the host must have; key kinds (`provider`, `search`, `gateway`, `memory-check` from `shared/utils/provider-meta.ts`) the user needs, used for readiness hints |
| `variants?` | Variant keys. Only allowed when `spend === 'none'` (C4), so an experiment never changes what a user's key spends |
| `exposeToClient` | Whether `GET /api/v1/features` and Labs may show it |
| `parent?` | Parent flag key |

Seed flags at stage `internal`, `default: false`, `allowRoles: ['admin']`:
`artifacts` (and `.react`, `.storage`, `.llm-bridge`, `.share`, `.mcp`),
`documents` (and `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.mcp`), `code-execution`
(and `.files`, `.skills`), `research.custom` (and `research.custom.max`,
`research.export`, `research.mcp`), `connectors` (and `.oauth`, `.registry`,
`.native`), `google.drive` (and `google.calendar`, `google.byo`,
`google.gmail`), `skills` (and `.import-url`, `.scripts`), and
`ui.side-panel-demo`.

## 5. Evaluation (P0-3)

`server/utils/features/evaluate.ts` takes `{ flag, userId, db, kv, config }`
and never calls `useEvent()`, so crons and background jobs can use it. It
returns an OpenFeature-like `{ value, variant, reason, flagMetadata }`. The
first step that decides wins:

| # | Step | Reason |
|---|---|---|
| 1 | Flag not in the registry → off | `UNKNOWN` |
| 2 | Flag listed in `NUXT_FEATURES_DISABLED` (or `*`) → off, admins included | `KILL_SWITCH` |
| 3 | Host mode (`NUXT_FEATURES_HOST_MODE`: `off`, `byok`, `hosted`) or a missing binding from `requires.bindings` → off | `HOST_MODE` |
| 4 | Rule row with `enabled = false` → off | `DISABLED` |
| 5 | Signed out → registry default | `ANONYMOUS` |
| 6 | Deny grant (not expired) → off | `DENY_GRANT` |
| 7 | Allow grant (not expired) → on, with its forced variant | `ALLOW_GRANT` |
| 8 | User has a role in `allow_roles` (or the registry's `allowRoles`) → on | `ROLE` |
| 9 | Rollout: skipped when `NUXT_FEATURES_ROLLOUT_ENABLED` is false (C2) or the user objected (C3). Otherwise on when `sha256(flag:salt:userId)` (first 4 bytes as uint32) `% 10000 < rollout_bps` | `ROLLOUT` |
| 10 | Registry default | `DEFAULT` |

The variant comes from a separate hash, `sha256(flag:salt:variant:userId)`,
against the cumulative `weightBps`. A grant can force a variant. The variant
split has the same C2 and C3 gates as step 9. A child flag is off whenever
its parent is off.

A feature is **enabled** when the user has access, and **active** when it is
enabled and, for `optIn: 'required'` features, the user has an active opt-in
(`opted_in_at` set and newer than any `opted_out_at`).

There is no targeting on user attributes (country, email domain, usage). The
evaluator sees only the user id, roles, grants and opt-ins (C14). Adding
attribute targeting reopens the compliance pre-check, because it would turn
random assignment into profiling.

**`NUXT_FEATURES_ROLLOUT_ENABLED`** defaults to false. Production turns it on
only after the Privacy Policy notice from P0-9 has taken effect. Until then,
production grants go only to the owner and to named testers who were told
individually what is recorded and how to object (C2).

### Caching

- Rules: KV key `features:config:v1` with the JSON of every
  `feature_flag_rules` row, TTL 300 seconds, read on a miss from D1. Every
  admin write deletes the key. Other locations can serve the old rules for up
  to 300 seconds plus KV propagation, so the instant off switch is
  `NUXT_FEATURES_DISABLED` (needs a redeploy).
- User state: one indexed `db.batch` per request for the user's roles,
  unexpired grants and opt-ins, memoised on `event.context.features`.
  Nothing per-user is stored in KV, so a grant takes effect on the next
  request.

### Guards

`server/utils/features/guards.ts`:

- `requireFeature(event, flag, { active? })` throws evlog `createError` with
  status 404 and `why: 'feature_unavailable'`.
- `requireAdmin(event)` answers 404 to non-admins and 401 to signed-out
  callers.

## 6. Admins

An admin is either a `user_roles` row with role `admin`, or a user whose
email is listed in `NUXT_ADMIN_EMAILS` **and** whose `emailVerified` is true.
The email check is never skipped, even in dev and CI, where email
verification is off. An account whose email was changed to an admin address
without verification is not admin (C13). In production an admin also needs
`twoFactorEnabled` (C13b), because the admin user search is the first place
where one account can see every user's email.

`NUXT_ADMIN_EMAILS` is a **secret** (`wrangler secret put`, listed in
`.dev.vars.example`), never a `wrangler.jsonc` var: email addresses are
personal data and the repository is public. The env admin is a virtual role
that cannot be revoked in the UI. It is the escape hatch after a lock-out or a
D1 restore.

In v1 the UI and API grant and revoke only the `tester` role (C7). Admin
comes only from `NUXT_ADMIN_EMAILS`, which today holds only the controller.
The Privacy Policy says that access to production data is limited to the
controller, and a second admin would make that false.

### `/admin` (P0-6)

- API: `server/api/v1/admin/**`. Every handler starts with `requireAdmin`.
- UI: `app/layouts/admin.vue` with the pages Features, Users and Audit.
  Every page is `noindex`, and `/admin` is in `robots.disallow`.
- Entry: an admin-only row in the Search popup. Admin never gets a nav pill
  slot.
- Every write runs one `db.batch([write, auditInsert])`, busts the rules
  cache for rule writes, and logs the Axiom ledger line (section 7).
- The kill switch needs a confirmation. Rollout changes need an explicit
  save. While `NUXT_FEATURES_ROLLOUT_ENABLED` is false, the rollout and
  variant controls are disabled with a one-line explanation.
- The grant reason field says "Do not write names or emails here".
- Shared write logic lives in `server/utils/features/admin.ts`, so the MCP
  tools reuse it with `actorKind: 'mcp'`.

## 7. Telemetry and the replay ledger

**Exposure** (C1), only for hash-based decisions (reason `ROLLOUT` and hash
variant splits), at most once per flag per request:

- Analytics Engine (`ANALYTICS` binding, `server/utils/analytics.ts`):
  `blobs: ['feature_exposure', flag, variant, reason]`. No bucket, no path,
  no user id, and no indexes holding ids. Filter on `blob1` as described in
  `docs/analytics-utm.md`.
- Axiom: `attributes.features[flag] = { value, variant, reason }` on the
  request's wide event (`docs/axiom-map-fields.md`). The wide event already
  carries the user id, so this is personal data under operational logging.

`GET /api/v1/features` (a listing) records no exposure.

**Ledger** (C8). Every write logs `attributes.featureAccess` with ids only,
never an email or a reason:

| Writer | Fields |
|---|---|
| Admin UI and MCP writes | `{ action, flag, targetUserId, effect, expiresAt }`; MCP writes also carry the client id |
| Opt-in route | `{ action: 'opt_in.set', flag, optedIn }` |
| Objection switch | `{ action: 'experiments.set', objected }` |
| Admin reads (C15) | `{ action: 'admin.read', resource, resultCount }`, never the search text |

After a D1 restore, replay the window from these lines in this order:
opt-outs and objections, role revocations, deny grants and grant
revocations, then rule changes.

## 8. Client access and Labs

**Client (P0-4).**

- `GET /api/v1/features` returns `{ features, isAdmin }` for flags with
  `exposeToClient`, with `Cache-Control: private, no-store`. Signed out, it
  returns 200 with the defaults.
- `app/plugins/10.features.ts` fills `useState('features')` during SSR
  (skipped on cached responses) and refreshes on sign-in and sign-out.
- `useFeature(key)` returns `{ enabled, active, variant }`.
- Feature state never goes into cookies, localStorage, sessionStorage or
  IndexedDB (C11).
- The client check only hides UI. The server guard is the security boundary.

**Labs (P0-7).** The `/profile/labs` tab (the sixth profile tab, plus a
Search popup row) lists the features the user can access:

- each feature with its stage, a plain description, "Uses your API keys" for
  spend features, and readiness hints that link to `/profile/keys`;
- an opt-in switch, default OFF, for `optIn: 'required'` features;
- the switch "Include my account in gradual rollouts and experiments" (on by
  default), with one sentence on the right to object (C3).

The opt-in route is `server/api/v1/profiles/features/[flag]/opt-in.post.ts`.
Opt-ins and the objection switch are never exposed over MCP: opting in
authorises spend.

Labs copy says "experimental, may change or be removed". It never says
"premium", "exclusive", "members" or "early access", and no email or push
notification announces Labs features (C12; `docs/legal/monetisation-readiness.md`).

**MCP (P0-8).**

- `list_my_features` is under the existing `settings:read`.
- `list_feature_flags`, `list_feature_access` and `set_feature_access` are
  under the new scope `admin:features`. The scope is hidden on the consent
  page and stripped on the server for non-admins.
- No tool returns another user's email, name or grant reason.
  `set_feature_access` accepts an email or a user id and echoes only the
  id (C9).
- No tool changes a rule (`docs/mcp-server.md`, "What MCP does not do",
  item 6).

## 9. Flagship later (P0-10)

P0-10 is blocked until Flagship is GA with published pricing and plan
support.

- Flagship replaces only the rollout and variant steps (step 9 and the
  variant split), behind runtime config `featuresRolloutProvider: 'local' |
  'flagship'`.
- Grants, roles, opt-ins, objections, the kill switch and the audit log stay
  in D1, and the local provider stays the default for self-hosters.
- Flagship receives only an opaque targeting key (an HMAC of the user id
  with a server secret), never an email or other attributes (C14).
- Switching provider reshuffles cohorts once, because the hash is
  different.
- The C2 and C3 gates stay in front of the provider.

## 10. Adding a flag

1. Add the registry entry: dotted key, title and description, stage
   `internal`, `allowRoles: ['admin']`, `spend`, `optIn` (`required` when
   `spend !== 'none'`), `requires`, `exposeToClient`, and `parent` for a
   sub-flag. `variants` only when `spend === 'none'`.
2. Guard every server entry point: routes and chat tools with
   `requireFeature` (with `{ active: true }` when the feature spends keys),
   and crons and jobs with `evaluateFeature` (no request context).
3. MCP tools of the feature: check the flag inside the handler. Never use the
   toolkit's per-tool `enabled` guard.
4. Gate the UI with `useFeature(key)`. Use `.active` where the feature
   spends keys.
5. Make sure Labs shows the feature (opt-in switch and readiness hints come
   from the registry).
6. Tests: the registry spec, and a route test for the 404 when the flag is
   off. Register new specs in `scripts/test-affected-check.mjs`.
7. Update the status table in `docs/agentic-capabilities-roadmap.md`.
8. Roll out: internal, then named testers (grants), then beta percentage
   (only once `NUXT_FEATURES_ROLLOUT_ENABLED` is on in production), then GA
   (set `default: true` in the registry, then remove the flag once it is
   stable).
