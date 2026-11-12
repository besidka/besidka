# Feature flags, roles and Labs

Status: **partly built** (2026-11-08). Phase 0 tickets P0-2 to P0-8 build
it, and P0-10 adds the Flagship provider later. Each of those tickets updates
the section it implements with the final API. The roadmap is in
`docs/agentic-capabilities-roadmap.md`.

| Section | Ticket | State |
|---|---|---|
| 3. Tables | P0-2 (BES-234) | Built |
| 4. Registry, 5. Evaluation, 7. Exposure | P0-3 (BES-236) | Built |
| 8. Client access | P0-4 (BES-238) | Built |
| 11. Capability contract | P0-5 (BES-240) | Built |
| 6. `/admin`, 7. Admin ledger writers | P0-6 (BES-242) | Built |
| 7. Opt-in and objection writers, 8. Labs | P0-7 (BES-246) | Built |
| 8. MCP | P0-8 (BES-250) | Built |
| 12. Scheduled rollouts | P0-16 (BES-319) | Built |

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
| `feature_rule_schedules` | `id`, `flag`, `change` (JSON rule patch), `run_at`, `status` (`pending`, `blocked`, `applying`, `applied`, `failed`, `cancelled`), `requires_notice_id`, `created_by` (nullable admin id, nulled on account deletion), `claimed_at`, `applied_at`, `error`, `created_at` | `(status, run_at)`; `(flag, run_at)` |
| `feature_audit_log` | `id`, `actor_user_id` (null for env and for a scheduled apply), `actor_kind` (`ui`, `mcp`, `env`, `schedule`), `client_id` (MCP OAuth client), `action`, `flag`, `target_user_id`, `before` (JSON), `after` (JSON), `created_at` | `created_at`; `(flag, created_at)`; `target_user_id`; `actor_user_id` (account-deletion scrub) |

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
| `available` | `true` only once the feature's code ships (default `false`). An unavailable flag evaluates to off with reason `NOT_AVAILABLE` whatever the role, grant or rule, so Labs never lists it and an admin never sees a phantom "On"; `/admin` still lists it, marked "Not implemented". Set it to `true` in the registry in the PR that ships the feature |
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
`documents` (and `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.mcp`), `files.office`,
`code-execution`
(and `.files`, `.skills`), `research.custom` (and `research.custom.max`,
`research.export`, `research.mcp`), `connectors` (and `.oauth`, `.registry`,
`.native`), `google.drive` (and `google.calendar`, `google.byo`,
`google.gmail`), `skills` (and `.import-url`, `.scripts`), and
`ui.side-panel-demo`.

As built: `FEATURE_REGISTRY` (keyed by flag), the `FeatureKey` union,
`FEATURE_KEYS`, `isFeatureKey(key)` (own keys only, so `constructor` is
unknown) and `getFeatureDefinition(key)`. The reserved opt-in key is
`EXPERIMENTS_OPT_IN_KEY` (`experiments`); a spec asserts no flag uses it.
Seed choices, each to be confirmed by the ticket that builds the feature:

- `spend: 'foreground'` (so `optIn: 'required'`): `artifacts.llm-bridge`,
  `research.custom`, `research.custom.max`. Everything else spends nothing
  beyond a normal chat.
- `exposeToClient: false`: the `*.mcp` flags (`artifacts.mcp`,
  `documents.mcp`, `research.mcp`), which have no UI. Every other flag is
  exposed so later UI can gate on it.
- No seed flag has `variants`.

## 5. Evaluation (P0-3)

`evaluateFeature(flag, { userState, rules, config, hasBinding? })` in
`server/utils/features/evaluate.ts` is pure and async: it never calls
`useEvent()`, so crons and background jobs can use it with
`loadFeatureRules(kv, db)`, `loadUserFeatureState(db, userId)` and
`getFeatureEvaluationConfig()`. It returns an OpenFeature-like
`{ value, variant, reason, bucket?, flagMetadata }`
(`FeatureResolution` in `server/utils/features/provider.ts`, where the
`FeatureProvider` interface and `localFeatureProvider` live). The first step
that decides wins:

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
against the cumulative `weightBps` of the rule's `variants` (keys not in the
registry entry's `variants` are ignored; a bucket past the total weight gets
no variant). **Only rollout results (step 9) get a hash variant**
(`flagMetadata.variantSource: 'hash'`), so an experiment runs on the rollout
cohort and C1's "never for grant, role, default or anonymous" holds for
exposure too. Grant, role and default results get no variant, except a
grant's forced variant (`variantSource: 'grant'`). The variant split has the
same C2 and C3 gates as step 9. Rule rows are sanitised on load: basis points
are clamped to 0..10000, unknown roles and malformed variants are dropped.

A child flag is off whenever its parent is off. The child is evaluated
first; when it is on, the parent is evaluated, and a parent that is off turns
the child off with the **parent's reason** and `flagMetadata.decidedBy` set
to the parent key (no exposure is recorded for such a result).

An unknown `NUXT_FEATURES_HOST_MODE` value fails closed to `off`.
Host mode `byok` and `hosted` behave the same today: only `off` and missing
`requires.bindings` (read from `cloudflare:workers` `env`) turn features off.
A flag that spends host money will add the `hosted` distinction.

Runtime config: `adminEmails` (`NUXT_ADMIN_EMAILS`, secret),
`featuresDisabled` (`NUXT_FEATURES_DISABLED`, comma list or `*`, case
insensitive), `featuresHostMode` (`NUXT_FEATURES_HOST_MODE`, default
`byok`, unknown values fall back to `off`) and `featuresRolloutEnabled`
(`NUXT_FEATURES_ROLLOUT_ENABLED`, default empty: the rollout gate follows the
Privacy notice date, see below). The last three may be `wrangler.jsonc` vars.

A feature is **enabled** when the user has access, and **active** when it is
enabled and the user's Labs toggle is on. The toggle lives in the same
opt-in table for every feature: a feature with `optIn: 'required'` is on only
after the user opted in (`opted_in_at` set and newer than any `opted_out_at`);
any other feature is on until the user opted out (`opted_out_at` newer than or
equal to any `opted_in_at`, the same rule as the experiments objection). A
child is off whenever an ancestor's toggle is off.

There is no targeting on user attributes (country, email domain, usage). The
evaluator sees only the user id, roles, grants and opt-ins (C14). Adding
attribute targeting reopens the compliance pre-check, because it would turn
random assignment into profiling.

**The rollout gate** (C2) is computed, not configured. Rollouts and variants
run when the Privacy notice `2026-11-experimental-features` (the
`LEGAL_NOTICES` registry, effective 2026-12-19 at 00:00 UTC) is in force and
the environment does not force them off:
`computeFeatureRolloutGate` in `shared/utils/features/rollout-gate.ts`,
evaluated per request in `getFeatureEvaluationConfig`, so it opens on its own
at the effective instant with no deploy. `NUXT_FEATURES_ROLLOUT_ENABLED` is
now only an override: `on`, `true` or `1` force it open (self-host, local
testing), `off`, `false` or `0` force it closed, an empty value or `auto`
follows the notice, and any other value (a typo) fails closed. **If production still has the variable set to `false`, the gate never
opens: unset it.** Until the gate opens, production grants go only to the
owner and to named testers who were told individually what is recorded and
how to object (C2).

### Caching

- Rules: KV key `features:config:v1` with the JSON of every
  `feature_flag_rules` row, TTL 300 seconds, read on a miss from D1. Every
  admin write deletes the key. Other locations can serve the old rules for up
  to 300 seconds plus KV propagation, so the instant off switch is
  `NUXT_FEATURES_DISABLED` (needs a redeploy).
- User state: one indexed `db.batch` per request for the user's `users`
  row (email, `email_verified`, `two_factor_enabled`, read fresh for the
  admin check instead of trusting the cached session), roles, unexpired
  grants and opt-ins. `useFeatureContext(event)`
  (`server/utils/features/context.ts`) memoises rules, user state, config,
  `isAdmin` and the exposure set as one promise on `event.context.features`,
  so every guard in a request shares them. Nothing per-user is stored in KV,
  so a grant takes effect on the next request.
- A KV failure falls back to D1; a failed cache read or write is logged under
  `attributes.featureRulesCache` and never fails the request. A loader that
  read D1 just before an admin write can put the old rules back after the
  bust; the 300-second TTL bounds that.

### Guards

`server/utils/features/guards.ts`:

- `requireFeature(event, flag, { active? })` throws evlog `createError` with
  status 404, message `Not found` and `why: 'feature_unavailable'`, and
  otherwise returns the resolution plus `active`. It records the exposure.
  It also needs the user's Labs toggle on (an opt-in for `optIn: 'required'`,
  no opt-out for the rest) **by default**; pass `{ active: false }` only where
  access without the toggle is the point. (The Labs opt-in route calls `evaluateFeatureForEvent` with
  `recordExposure: false` instead, so a settings write records no exposure.) An opt-in counts only when every
  ancestor that needs one is opted in too.
- `requireAdmin(event)` answers 404 to non-admins and 401 to signed-out
  callers, and returns the request's feature context.
- `evaluateFeatureForEvent(event, flag, { recordExposure? })` is the
  non-throwing form for UI branches.

## 6. Admins

An admin is either a `user_roles` row with role `admin`, or a user whose
email is listed in `NUXT_ADMIN_EMAILS` **and** whose `emailVerified` is true.
The email check is never skipped, even in dev and CI, where email
verification is off. An account whose email was changed to an admin address
without verification is not admin (C13). In production an admin also needs
`twoFactorEnabled` (C13b), because the admin user search is the first place
where one account can see every user's email.

As built, `isAdminUser(userState, config)` in
`server/utils/features/evaluate.ts` applies the verified-email and 2FA rules
to **both** kinds of admin, and "production" is `isAdminTwoFactorRequired()`:
`!import.meta.dev && process.env.CI !== 'true'`, the same predicate
`server/utils/auth.ts` uses for email verification. Cloudflare Previews are
production in this sense, so an admin on `pr-<n>` needs a verified email, 2FA
and the secret in the previews base config. Without 2FA an admin is not even
an `admin` for `allowRoles`. The owner must turn on TOTP before the first
admin use.

Known limits, accepted for v1: `twoFactorEnabled` is enrolment, not proof
that this session passed a 2FA challenge (passkey and OAuth sign-ins skip the
challenge, `docs/auth-security.md`); and a `CI=true` var or secret on a
deployed Worker would drop the 2FA rule, as it already drops email
verification in `server/utils/auth.ts`. Never set `CI` on a deployed
Worker.

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

As built:

- **API** under `server/api/v1/admin/`. The first statement of every handler
  is `await requireAdmin(event)` (401 signed out, 404 for everyone else), and
  every write then calls `createFeatureAdminWriteContext`, which runs
  `assertNotCrossSiteRequest` and `assertSameOriginAdminRequest`: a
  `Sec-Fetch-Site` other than `same-origin` or `none` (so a `same-site`
  sibling host too) is a 403, and without that header an `Origin` must match
  the request origin. A client that sends neither (curl, server-side tests)
  carries no browser cookies to forge and passes. Bodies
  and queries are validated with the zod schemas in
  `shared/utils/features/admin-schemas.ts` (`.strict()`, so unknown keys are
  a 400).

  | Route | Purpose |
  |---|---|
  | `GET features` | Registry × rules, grant counts, `rolloutEnabled`, `hostMode`, env kill switch per flag |
  | `GET features/[flag]` | One flag with its rule and grant counts (404 for an unknown flag) |
  | `PATCH features/[flag]/rule` | `{ enabled?, rolloutBps?, allowRoles?, variants? }` |
  | `GET features/[flag]/grants?offset=` | Grants with the account email and name, 50 per page |
  | `POST features/[flag]/grants` | `{ userId, effect, variant?, expiresInDays? (1 to 365), reason? (≤ 200) }`, upsert on `(user_id, flag)` |
  | `POST features/grants/[id]/revoke` | Delete one grant |
  | `GET users/search?q=` | At least 3 characters: email prefix or name substring, 20 results, with roles and `isEnvAdmin` |
  | `GET roles`, `POST roles`, `POST roles/[id]/revoke` | Role rows plus the env admins; grant and revoke `tester` only |
  | `GET audit?cursor=&flag=&targetUserId=` | Audit rows newest first, 50 per page, with actor and target emails |

- **Writers** in `server/utils/features/admin.ts`: `setFeatureRule`,
  `setFeatureGrant`, `revokeFeatureGrant`, `setUserRole`, `revokeUserRole`.
  Each takes a `FeatureAdminContext` (`db`, `kv`, `actor { userId, kind:
  'ui' | 'mcp', clientId? }`, `rolloutEnabled`, `logger`), reads the current
  row, runs one `db.batch([write, auditInsert])`, and logs the ledger line.
  Only `setFeatureRule` busts `features:config:v1`; grants and roles are read
  per request, so they apply on the target's next request. P0-8 calls the
  same functions with `kind: 'mcp'`.
- **Audit rows** keep `before` and `after` flat. The only user id in them is
  `userId` (the target, which is also `target_user_id`); grantor ids are left
  out because they can name a third account that neither audit column
  covers. The grant `reason` is stored under `reason`, which the purge scrub
  removes. A write that changes nothing (granting a role the user already
  has) writes no audit row.
- **Rule validation**: an unknown flag is 404; `rolloutBps` is 0 to 10000;
  `allowRoles: null` resets to the registry default; `variants` only for a
  flag with registry `variants` and `spend === 'none'`, keys from the
  registry, no repeats, weights summing to 10000 (`variants: []` or `null`
  clears them); an empty patch is a 400 (`why: 'empty_patch'`). A failed
  cache bust after the committed write is logged under
  `attributes.featureRulesCache`, not thrown. While
  `NUXT_FEATURES_ROLLOUT_ENABLED` is off the writer
  refuses to set `rolloutBps` above 0 or to set variants (409,
  `why: 'rollout_disabled'`); setting them back to 0 is allowed. The UI
  disables both controls with a one-line note, so the server check is the
  backstop for C2.
- **Roles (C7)**: `ASSIGNABLE_FEATURE_ROLES = ['tester']`. The schema accepts
  only `tester`, and the writers refuse `admin` with 403
  (`why: 'role_not_assignable'`) on grant and revoke, so a `user_roles` admin
  row (only ever created by hand) is never removed here and the last admin
  cannot lock themselves out. The ticket's "last admin" 409 is therefore
  unreachable and not implemented; the env admin is the escape hatch.
- **Reads (C15)**: the feature list, flag detail, grant list, user search,
  role list and audit view log `{ action: 'admin.read', resource,
  resultCount }`. The search text is never logged: the
  `evlog-request-observability` enrich hook drops the query string from
  every `/api/v1/admin/` path in the wide event's `path` and `message`
  (`toLoggedPath`). The search uses SQLite `LIKE`, which ignores case only
  for ASCII letters, so a Cyrillic name must be typed with its own case.
- **Retention (C6)**: `server/plugins/feature-audit-sweep.ts` runs on the
  hourly cron (`0 * * * *`) without an off switch and deletes audit rows
  older than 365 days, 100 rows per statement and at most 10 statements per
  run.
- **UI**: `app/layouts/admin.vue` (the profile chrome without the avatar;
  tabs Features, Users, Audit), `app/middleware/admin.ts` (named; refreshes
  the feature state when it is empty, then 404s non-admins with a fatal
  error, so the area is not revealed), pages `app/pages/admin/index.vue`
  (redirects to `/admin/features`), `features/index.vue` (table from `md`,
  cards below), `features/[flag].vue` (rule form with explicit Save, a
  confirmation before turning a feature off, grants with a user search),
  `users.vue` (add a tester, roles with env admins marked "from env" and no
  revoke), `audit.vue` (before and after as compact JSON, Load more). Every
  page sets `noindex, nofollow`; `/admin` is in `robots.disallow`, the
  sitemap `exclude` and the agent-discovery `excludePrefixes`. A signed-out
  visitor is redirected to `/signin` by the global auth middleware, like
  every other signed-in route.
- **Entry**: the Search popup shows "Admin" (`search-option-admin`, last in
  Settings) only when `useIsAdmin()` is true. Admin never gets a nav pill
  slot.
- Rule changes take effect within 5 minutes on other locations (the KV TTL);
  the UI says so.

## 7. Telemetry and the replay ledger

**Exposure** (C1), only for hash-based decisions (reason `ROLLOUT`, which is
also the only result that carries a hash variant), at most once per flag per
request:

- Analytics Engine (`ANALYTICS` binding, `server/utils/analytics.ts`):
  `blobs: ['feature_exposure', flag, variant, reason]`. No bucket, no path,
  no user id, and no indexes holding ids. Filter on `blob1` as described in
  `docs/analytics-utm.md`.
- Axiom: `attributes.features[flag] = { value, variant, reason }` on the
  request's wide event (`docs/axiom-map-fields.md`). The wide event already
  carries the user id, so this is personal data under operational logging.

As built: `recordFeatureExposure` in `server/utils/features/exposure.ts`,
called by `requireFeature` and `evaluateFeatureForEvent`, with the per-request
set on the feature context. `variant` is an empty string when there is none.
A missing `ANALYTICS` binding skips that sink; a throwing one is logged under
`attributes.featureExposure.error` and never fails the request.

`GET /api/v1/features` (a listing) records no exposure.

**Ledger** (C8). Every write logs `attributes.featureAccess` with ids only,
never an email or a reason:

| Writer | Fields |
|---|---|
| Admin UI and MCP writes | `{ action, flag, targetUserId, effect, expiresAt, actorKind }`, plus `role` for role writes; MCP writes also carry the client id. `action` is `rule.set`, `grant.set`, `grant.revoke`, `role.set`, `role.revoke`, `schedule.create` or `schedule.cancel` (`scheduleRunAt` lists the step times); a scheduled apply is a `rule.set` with `actorKind: 'schedule'` and `scheduleId`, logged on its own wide event per step; for a rule write `effect` is `enabled` or `disabled`, and `rule: { before, after }` carries `enabled`, `rolloutBps`, `allowRoles` and `variants` (before is null for a new rule), so a restore can rebuild the rollout share and variants |
| Opt-in route | `{ action: 'opt_in.set', flag, optedIn }` |
| Objection switch | `{ action: 'experiments.set', objected }` |
| Admin reads (C15) | `{ action: 'admin.read', resource, resultCount }`, never the search text |

After a D1 restore, replay the window from these lines in this order:
opt-outs and objections, role revocations, deny grants and grant
revocations, then rule changes.

## 8. Client access and Labs

**Client (P0-4).**

- `GET /api/v1/features` (`server/api/v1/features/index.get.ts`) returns
  `ClientFeaturesPayload` (`shared/types/features.d.ts`):
  `{ features: { [flag]: { enabled, active, variant } }, isAdmin }` for every
  flag with `exposeToClient`, with `Cache-Control: private, no-store`. Signed
  out, it returns 200 with every exposed flag at its registry default
  (`ANONYMOUS`), never 401, because landing and auth pages render too. The
  `variant` is null whenever the flag is off. No bucket and no reason leave
  the server.
- The listing records **no exposure**: it calls `evaluateFeature` directly,
  not `evaluateFeatureForEvent`. Exposure is recorded where a server route
  actually branches (`requireFeature`, `evaluateFeatureForEvent`).
- `app/plugins/10.features.ts` (universal, after `00.auth.server.ts`): during
  SSR it calls `useRequestFetch()('/api/v1/features')` and stores the result
  in `useState('features')`, skipped on cached and prerendered responses
  (the SWR-cached landing `/`), so per-user state never enters a shared
  cache; a failure leaves the state null. The internal fetch is a second
  request through the middleware, so it costs one more session lookup
  (Better Auth's KV read) plus the rules KV read and the user-state D1
  batch; it does not share `event.context` with the page request.
- On the client it watches `useAuth().user.id`: every change (sign-in,
  account switch, sign-out) clears the state first, so one account's flags
  never show for another, then loads the new state (anonymous defaults after
  a sign-out). When SSR left the state null (cached landing page, SSR
  failure) it refreshes once on `app:mounted`; on the cached landing page a
  signed-in visitor can therefore cost two requests, because the client
  session fetch flips the user at mount too (the newer response wins). A
  failed refresh keeps the last known state and logs a `features-refresh`
  warning through the evlog client logger; a failed SSR fill leaves the
  state null (the internal request logs its own error). Every successful
  refresh calls the `features:changed` runtime hook with the payload; a
  refresh that finishes after a newer one or after a clear is dropped. The
  refresh counter lives per Nuxt app, not per module, so SSR requests in one
  isolate never share it.
- Flagged UI on the cached landing page renders as off during SSR and flips
  after mount; gate it behind `onMounted` or `<ClientOnly>`.
- `useFeatures()` returns `{ features, refreshFeatures, clearFeatures,
  prefillServerFeatures }`;
  `useFeature(key)` returns a computed `{ enabled, active, variant }` that is
  all false while the state is null or the key is missing; `useIsAdmin()` is
  a computed boolean (for the admin-only Search row in P0-6).
- Feature state never goes into cookies, localStorage, sessionStorage or
  IndexedDB (C11).
- The client check only hides UI. The server guard is the security boundary.

**Labs (P0-7).** The `/profile/labs` tab (the sixth profile tab, plus a
Search popup row) lists the features the user can access:

- each feature with its stage, a plain description, "Uses your API keys" for
  spend features, and readiness hints that link to `/profile/keys`;
- a switch on every feature: an opt-in, default OFF, for `optIn: 'required'`
  features, and an opt-out, default ON, for the rest;
- the switch "Include my account in gradual rollouts and experiments" (on by
  default), with one sentence on the right to object (C3).

The opt-in route is `server/api/v1/profiles/features/[flag]/opt-in.post.ts`.
Opt-ins and the objection switch are never exposed over MCP: opting in
authorises spend.

As built (P0-7):

- `GET /api/v1/profiles/features` (`private, no-store`, 401 signed out)
  returns `LabsPayload` (`shared/types/features.d.ts`):
  `{ features: LabsFeature[], objectedToExperiments }`. Each feature carries
  `key`, `title`, `description`, `stage`, `spend`, `optIn`,
  `requires.keyKinds`, `parent`, `optedIn` (the switch state) and `active`.
  Only `available` flags with `exposeToClient` that the user **has**
  (`evaluateFeature(...).value`) are listed, so Labs never advertises a feature the user cannot use. It records
  no exposure.
- `POST /api/v1/profiles/features/[flag]/opt-in` with `{ optedIn }`:
  same-origin only (`assertSameOriginAdminRequest`), 401 signed out, 404
  `feature_unavailable` when the user lacks the flag **or** the flag has no
  `exposeToClient` (Labs never shows it, so it never takes consent for it;
  a registry spec asserts every `optIn: 'required'` flag is exposed). It
  accepts every listed feature: `optedIn: false` on a non-spending feature
  records an opt-out. It evaluates
  with `evaluateFeatureForEvent(event, flag, { recordExposure: false })`: a
  settings write is not an exposure. Answers `{ flag, optedIn, active }` read
  back from D1 after the write.
- `POST /api/v1/profiles/features/experiments` with `{ objected }`: the
  objection switch. Objecting stamps `opted_out_at` on the reserved
  `experiments` row; withdrawing stamps `opted_in_at`.
- Both writers live in `server/utils/features/opt-ins.ts`. They stamp only
  the timestamp that changed (the other one stays as evidence). D1 keeps
  whole seconds and an equal pair reads as "off" (and as "objected"), so a
  switch-on in the same second as the last switch-off stamps one second
  later, and a switch-off never stamps earlier than the last switch-on.
  They write a `feature_audit_log` row (`actor_kind 'ui'`, actor and target are the
  user, action `opt_in.set` or `experiments.set`, before and after as unix
  seconds) in the same `db.batch`, and log the ledger line from section 7.
- The page `app/pages/profile/labs.vue` groups children under their parent
  card (`app/utils/labs.ts`), shows a "Uses your API keys" note for spend
  features, and a readiness link to `/profile/keys` for each required key
  kind with no saved key. A `provider` requirement is met by a model
  provider **or** a gateway key; a hint shows only when every provider of the
  kind reports `missing` (`keyStatusForProvider`), never while the key
  summary loads. Toggles listen to `change` (a `click.prevent` toggle stays
  visually stuck after the browser restores the pre-click state) and use
  `aria-busy`, not `disabled`, while saving, so keyboard focus stays put.
  They update optimistically, roll back on error, then
  refresh the page data and `refreshFeatures()` (which fires
  `features:changed`). The objection card is shown even with no features.
- The tab is always visible (the empty state explains); it is the sixth
  profile tab with `lucide:flask-conical`, plus the `search-option-labs` row
  in the Search popup after Connected apps.

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

As built (P0-8, MCP server 2.0.0): logic in
`server/utils/mcp/private/features.ts`, tools in `server/mcp/tools/`
(`list-my-features.ts`, `list-feature-flags.ts`, `list-feature-access.ts`,
`set-feature-access.ts`). Every admin tool re-checks `isAdminUser` first and
answers a generic 404 otherwise. `set_feature_access` builds a
`FeatureAdminContext` with `actor: { kind: 'mcp', clientId }` and calls
`setFeatureGrant` or `revokeFeatureGrant`, so the audit row and the
`featureAccess` ledger line are the same as the admin UI's. The consent
strip and the scope details are in `docs/mcp-server.md`, "The
`admin:features` scope".

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
   (only once the rollout gate is open in production, or as a scheduled
   step, section 12), then GA
   (set `default: true` in the registry, then remove the flag once it is
   stable).

## 11. Capability contract (P0-5)

Every Phase 1 to 4 capability (artifacts, documents, code execution,
research, connectors, Google, skills) is one module that declares its flag
and every surface it adds, so a conformance spec can prove that each surface
is gated. The contract stays small on purpose: no lifecycle hooks until a
second capability needs one.

### Declaring a capability

`defineCapability(definition)` in `server/capabilities/types.ts` freezes the
definition and registers it for `listCapabilities()`
(`server/capabilities/index.ts`):

| Field | Meaning |
|---|---|
| `feature` | The capability's `FeatureKey` from the registry |
| `aiTools?` | `(context) => ToolSet`, the chat tools. Gets a `CapabilityToolContext` (`userId`, `chatId`, `db`, `kv`, `model`, `logger`, `isFeatureActive`) captured before any fan-out; a factory never reads the request event |
| `routesPrefix?` | Directories under `server/api/v1/` that belong to the capability |
| `mcpTools?` | `McpPrivateToolName`s the capability adds |
| `jobs?` | `{ kind, feature }` background jobs; `feature` is the capability flag or a child of it |
| `clientChunk?` | Name of the lazy client chunk |

To add a capability, create `server/capabilities/<name>.ts` that calls
`defineCapability`, and import it explicitly in
`server/capabilities/index.ts` (no auto-discovery, so the module graph stays
visible). A spec fails when a module file is not imported there, so the
conformance run cannot miss one. A second definition for the same feature
replaces the first. `getCapabilityTools(context)` merges the `aiTools` of every
capability whose flag `context.isFeatureActive` reports as active, one
factory after another. It is the seam the chat send path will call from its
tool-assembly block; the first consumer (A-3) wires it in. Until then the
send path is unchanged.

### Conformance rules

`checkCapabilityConformance` (`server/capabilities/conformance.ts`) runs in
`tests/unit/server/capabilities/conformance.spec.ts` over every registered
capability and reports:

| Rule | Fails when |
|---|---|
| `unknown_feature` | `feature` is not a registry key |
| `route_prefix_without_routes` | A `routesPrefix` directory has no route files |
| `route_without_feature_guard` | A `.ts` file under `server/api/v1/<prefix>/` does not call `requireFeature(event, '<flag>')` with the capability's flag or a child of it (comments are ignored) |
| `mcp_tool_without_scope` | An `mcpTools` name is missing from `MCP_PRIVATE_TOOL_SCOPES` |
| `mcp_tool_without_private_wrapper` | `server/mcp/tools/<name-with-dashes>.ts` is missing or does not call `withMcpPrivateTool(` |
| `job_without_feature` | A job has no `feature`, or one outside the capability's flag tree |

The checks read source text, so they are a heuristic: a guard inside a
string literal still passes. Routes are found only in the directory form
(`server/api/v1/<prefix>/**/*.ts`, the CLAUDE.md layout rule), and every
`.ts` file there counts as a route, so keep helpers out of route
directories. A later improvement can register
handlers through a `defineGuardedHandler(feature, handler)` helper and check
that instead. The spec also runs the checker over fixtures that break each
rule (`tests/unit/server/capabilities/fixtures/demo.ts`), so it cannot pass
just because no real capability exists yet. A job still checks its flag at
run time with `evaluateFeature` (it has no request context for
`requireFeature`); the conformance rule only proves the flag is declared.

### Host interfaces

`server/utils/platform/types.ts` holds the host-agnostic interfaces; adapters
live in `server/utils/platform/<host>/`. Only Cloudflare adapters exist.

- **`BlobStore`** (`put`, `get`, `delete(keys[])`, `signedUrl`).
  `createR2BlobStore(bucket)` (`cloudflare/blob-store.ts`) takes the bucket
  as an argument, for example `useFileStorage()` captured before any
  fan-out, and never reads the request context. `delete` is one R2 batch
  call per 1000 keys (the R2 limit), sent one after another, which keeps a
  Worker under its six simultaneous connections.
  `signedUrl` answers 501 with `why: 'not_supported'`: the existing
  file-share token helper (`server/utils/files/file-share-access.ts`) signs
  with the request event, which a background job does not have. The first
  consumer that needs signed URLs adds an event-free signer.
- **`JobRunner`** (`enqueue`, `get`, `cancel`, `step`). `step` requires an
  explicit `retries` with no default, so a step that spends the user's money
  says `retries: 0` and no adapter retries it silently (Cloudflare Workflows
  default to five). `createCloudflareJobRunner()`
  (`cloudflare/job-runner.ts`) answers 501 with
  `why: 'job_runner_not_configured'` until R-1 and R-5 add the orchestrator
  Workflow Worker with HMAC callbacks. Nitro cannot export a
  `WorkflowEntrypoint`, so the Workflow runs in that separate Worker.

Host portability: a VPS, Vercel or AWS host adds its own `BlobStore` and
`JobRunner` adapters next to `cloudflare/` and picks them at startup;
capability code depends only on the interfaces. Durable Objects and the
Cloudflare Agents SDK are not part of the contract (lock-in).

## 12. Scheduled rollouts (P0-16)

The owner plans feature changes once and they apply on their own, through the
same audited path as a manual edit.

- **Steps.** `feature_rule_schedules` holds one row per step: a `change` (the
  `featureRulePatchSchema` fields `enabled`, `rolloutBps`, `allowRoles`,
  `variants`; there is no `stage` field on a rule) and a `run_at` stored as
  UTC seconds. The UI shows and takes local time with the time zone named.
  A step that raises the rollout above 0 or sets variants records
  `requires_notice_id`.
- **Validation** (`validateScheduleSteps`, shared by the form and the
  server): every step changes something, lies in the future, is strictly
  after the step before it and shares no second with an open step of the
  flag; at most 12 steps per request and 24 open steps per flag; no further than two
  years ahead; variants are validated like a manual write. "Give it to
  all testers" is `grantRoles: ['tester']`, never `admin` (C7); it is stored
  as `allowRoles: ['admin', 'tester']` because a rule's `allowRoles` replaces
  the registry default. Testers cannot be removed by a step, only by a
  manual rule edit.
- **API** (admin only, same guards and same-origin check as rule writes):
  `POST /api/v1/admin/features/<flag>/schedules` (`{ steps: [...] }`),
  `POST .../schedules/<id>/cancel` (only `pending` or `blocked`),
  `GET /api/v1/admin/features/<flag>` now also returns `schedules` and the
  computed `rolloutGate`. Create and cancel write `schedule.create` and
  `schedule.cancel` audit rows and ledger lines. There are no MCP scheduling
  tools; rollout and global changes stay UI-only.
- **Applier** (`server/plugins/feature-schedule-applier.ts`, cron
  `*/5 * * * *`, `applyDueFeatureSchedules` in
  `server/utils/features/schedules.ts`). It selects `pending` and `blocked`
  steps with `run_at <= now`, oldest first, and applies each with
  `setFeatureRule`, the function the `rule.patch` route calls: validation,
  audit row (`actor_kind 'schedule'`, `actor_user_id` null), the
  `featureAccess` ledger line (with `scheduleId`) and the KV rules cache
  bust. It never calls `useEvent()`. Each step has its own wide event and
  the job has one with the counts.
- **No double run.** A step is claimed with
  `UPDATE ... SET status = 'applying' WHERE id = ? AND status IN ('pending',
  'blocked') AND NOT EXISTS (another 'applying' step of the flag) RETURNING`.
  Overlapping runs cannot apply a step twice, and steps of one flag never run
  out of order or race on the rule row. Once a step of a flag is blocked,
  later due steps of that flag wait behind it, so a 0% rollback cannot
  overtake an earlier blocked 50%. Status writes are conditional on the
  expected status, so a cancel is never overwritten. A claim older than 10 minutes means
  the Worker died mid-write: it becomes `failed` with a note to check the
  rule and the audit log, and is never re-run.
- **Failure.** A step that throws becomes `failed` with a short reason (the
  error `why` code; unexpected errors show a generic text and keep the detail
  in the wide event) and admins are notified; the cron never retries it. The owner schedules it again.
- **The gate.** A rollout step that comes due while the gate is closed
  becomes `blocked` with the reason and is re-checked on every run; once the
  notice is in force (or the override is `on`) it applies. A forced `off`
  keeps it blocked. The UI shows "Applies after 2026-12-19" for such a step.
- **Notifications.** On apply or failure each admin (env admins with a
  verified email, plus `admin` role holders) gets a `NoticeEmail` and, when
  push is configured and they subscribed, a web push with a generic body.
  The message names the flag, the change and the time and links to the audit
  log; it carries no account id or email.
- **E2E hook.** `POST /api/v1/admin/features/schedules/apply-due` runs the
  applier on demand and answers 404 unless
  `NUXT_PUBLIC_E2E_TEST_HOOKS_ENABLED=true`, the flag the Playwright web
  server and the CI `.dev.vars` already set.
- **Restore.** The table is rolled back with D1, so replay `schedule.create`
  and `schedule.cancel` ledger lines (`docs/d1-restore-reconciliation.md`).
  Account deletion nulls `created_by`.
