# Auth security — rate limits, Turnstile, 2FA, and passkeys

Covers the account-security surface built across a 4-PR stacked series:
hardened per-endpoint rate limits and Turnstile captcha, the security
hub (sessions, linked accounts, account removal), two-factor
authentication (TOTP + backup codes), and passkeys (WebAuthn). All four
have landed; every section below, including the `/two-factor/*` and
`/passkey/*` rate-limit rows, reflects what is live today.

## Why the built-in `captcha` plugin, not a hand-rolled hook

Better Auth ships a first-party `captcha` plugin
(`better-auth/plugins`) that verifies a `x-captcha-response` request
header against Cloudflare's `siteverify` endpoint before the wrapped
auth endpoints run. A hand-rolled `beforeHandler`/API route doing the
same `fetch()` to `siteverify` would duplicate logic Better Auth already
maintains (error codes, endpoint matching, provider abstraction over
Turnstile/hCaptcha/reCAPTCHA/CaptchaFox), and would need its own tests
for exactly the same edge cases the plugin already covers. Using the
plugin keeps this PR to configuration plus a client-side widget, with no
new server route.

## The `turnstileEnforced` gate — not `import.meta.dev`

Cloudflare's Turnstile **test keys** (`1x0000...AA` secret /
`1x0000...BB` sitekey) are the recommended way to exercise the captcha
plugin in dev, CI, and e2e without solving a real challenge. Verified
directly against Cloudflare's `siteverify` endpoint with the test pair:
the response contains **no `action` field at all**, and `hostname` is
always the literal string `"example.com"` — never the real request
host.

`expectedAction`/`allowedHostnames` are Better Auth options that reject
a verification whose action or hostname doesn't match. If either were
enforced unconditionally, every dev/CI/e2e sign-in using the test keys
would 403, because the test-key response can never satisfy them.

The obvious gate — `import.meta.dev` — is wrong for a different reason:
`import.meta.dev` is `false` in **every deployed Worker**, including
preview deploys. Gating on it would enforce `expectedAction`/
`allowedHostnames` the moment a secret key is configured in a preview
environment, breaking every preview-deploy sign-in with no way to test
the change safely before it reaches production.

The fix is a dedicated, non-secret runtime config flag,
`turnstileEnforced` (`runtimeConfig.turnstileEnforced`, default
`false`), analogous to `emailNoopEnabled`. It is set to `true` in the
`env.production` block of `wrangler.jsonc`. Local dev and CI keep it
`false`, so `expectedAction`/`allowedHostnames` are only asserted where a
real widget and a real secret are configured.

Since the migration to Cloudflare Workers Previews (PR #430, see
`docs/cloudflare-previews.md`) PR and `main` Previews run as
`env.production`, so they inherit `turnstileEnforced: true` and get the real
secret. They therefore run the **real** captcha, same as production
(owner decision 2026-10-13), through a **dedicated** "Besidka (preview)"
widget: `env.production.previews.vars` carries its sitekey
`0x4AAAAAAEFM-2wD0PMvdy4q`, and the previews secret in `.dev.vars.preview` /
base-config must be that widget's secret. A sitekey paired with another
widget's secret (the production sitekey with the preview secret, or a test
sitekey with a real secret) renders and passes in the browser but can never
pass `siteverify`, so it returns 403 "Captcha verification failed" on every
sign-in. The preview widget's hostname list is `chernenko.workers.dev`
(covers all preview hosts); the production widget lists `besidka.com` only.

`allowedHostnames`, when enforced, reuses `getAllowedHosts()` (in
`server/utils/auth-hosts.ts`, used for Better Auth's
`baseURL.allowedHosts`) but strips any `:port` suffix and drops port
wildcards such as `localhost:*`, which don't apply to Turnstile's
hostname check (it reports bare hostnames).

Hostname wildcards (`*-besidka.chernenko.workers.dev`, set through
`NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS` on Previews) are kept. Better Auth's
Turnstile handler only supports exact matching —
`allowedHostnames.includes(response.hostname)` in
`verify-handlers/cloudflare-turnstile.mjs`, identical in 1.6.26 and 1.7.7 —
and the verification result is not exposed to the caller (the token is
single-use, so a second `siteverify` call is impossible). When at least one
wildcard is present, `toTurnstileHostnames()` in
`server/utils/auth-captcha.ts` therefore returns an array whose `includes`
is overridden to also match wildcard patterns via `matchesHostnamePattern()`
(`*` stands for one or more characters within a single DNS label, so
`pr-442-besidka.chernenko.workers.dev` matches but
`evil-besidka.chernenko.workers.dev.attacker.com` and
`besidka.chernenko.workers.dev` do not). Without wildcards (production)
the plain array is returned and behaviour is exact-match, byte-for-byte as
before. If a future Better Auth stops calling `.includes`, the override
stops being consulted and the check falls back to the literal entries,
which rejects wildcard hosts (403) rather than letting them through.
`tests/unit/utils/auth-captcha-plugin.spec.ts` exercises the real `captcha`
plugin so a Better Auth bump that changes this contract fails a test.

**Known limitation**: `getAllowedHosts()`'s apex/`www.` detection uses a
`parts.slice(-2)` heuristic (last two dot-separated labels = the
registrable domain). This is correct for `besidka.com` — the only
domain shape this app is ever deployed under — but would misclassify a
multi-label-TLD domain like `example.co.uk` (it would treat `co.uk` as
the "domain" and `example` as a subdomain). Fixing this generally
requires a public-suffix-list lookup, which is out of scope for a
single-domain app; this is accepted, not fixed.

## Plugin registration: `captchaEnabled` requires both keys

The `captcha` plugin is only registered when **both**
`config.turnstileSecretKey` (server secret) and
`config.public.turnstileSiteKey` (client-visible sitekey) are non-empty
— one combined boolean, not `Boolean(secretKey)` alone. If only the
secret key were checked, a missing or mistyped public sitekey would
register the plugin server-side while the client never renders a widget
or learns to send `x-captcha-response` — every sign-in in that
environment would 403 with no client-visible cause. Requiring both
non-empty makes a single missing env var fail *open* (no captcha
enforced) rather than fail *closed* (full auth lockout).

## Rate limit table

Replaces the previous blanket `3 requests / 10 seconds` burst clamp
(Better Auth's default special-case rule for `sign-in`/`sign-up`/
`change-password`/`change-email`) with per-endpoint windows and maxes.
Longer windows with lower per-window maxes bound *sustained* credential
stuffing / enumeration better than a short burst clamp — a 3-per-10s
limit resets so quickly that an attacker distributing requests slightly
below the burst rate is effectively unthrottled over an hour, whereas
e.g. `10 requests / 300 seconds` on `/sign-in/email` caps sustained
attempts at 120/hour regardless of pacing. This matters more now that
`/sign-up/email`, `/sign-in/email`, and `/request-password-reset` are
also captcha-protected: rate limiting no longer has to single-handedly
stop scripted abuse on those three, so it can be tuned for sustained-
abuse containment instead of raw burst suppression.

| Path | Window | Max |
| --- | --- | --- |
| `/sign-in/email` | 300s | 10 |
| `/sign-up/email` | 900s | 5 |
| `/sign-in/social` | 300s | 20 |
| `/callback/*` (catch-all) | 300s | 30 |
| `/request-password-reset` | 900s | 3 |
| `/reset-password` | 900s | 5 |
| `/reset-password/*` (catch-all) | 900s | 10 |
| `/send-verification-email` | 900s | 3 |
| `/change-password` | 900s | 5 |
| `/verify-password` | 300s | 5 |
| `/change-email` | 900s | 3 |
| `/delete-user` | 900s | 3 |
| `/delete-user/*` (catch-all) | 900s | 10 |
| `/verify-email` | 300s | 20 |
| `/two-factor/verify-totp` | 300s | 5 |
| `/two-factor/verify-otp` | 300s | 5 |
| `/two-factor/verify-backup-code` | 900s | 5 |
| `/two-factor/generate-backup-codes` | 900s | 3 |
| `/two-factor/enable` | 900s | 5 |
| `/two-factor/disable` | 900s | 5 |
| `/two-factor/get-totp-uri` | 900s | 5 |
| `/two-factor/send-otp` | 900s | 5 |
| `/two-factor/*` (catch-all) | 300s | 10 |
| `/passkey/verify-authentication` | 300s | 10 |
| `/passkey/verify-registration` | 900s | 10 |
| `/passkey/delete-passkey` | 900s | 10 |
| `/passkey/*` (catch-all) | 60s | 20 |
| `/link-social` | 300s | 10 |
| `/unlink-account` | 900s | 5 |
| `/list-accounts` | 60s | 30 |
| `/revoke-session` | 300s | 20 |
| `/revoke-sessions` | 900s | 5 |
| `/revoke-other-sessions` | 900s | 5 |
| `/oauth2/register` | 60s | 60 |
| `/oauth2/token` | 60s | 300 |
| `/oauth2/authorize` | 60s | 60 |
| `/oauth2/consent` | 60s | 20 |
| `/oauth2/revoke` | 60s | 120 |
| `/oauth2/introspect` | 60s | 120 |
| everything else (default) | 60s | 60 |

The `/oauth2/*` rows are explained in
[OAuth authorization server (MCP)](#oauth-authorization-server-mcp).

`/two-factor/*` and `/passkey/*` rows are active now that both plugins
are registered — keeping the entire policy in one file
(`server/utils/auth-rate-limit.ts`) rather than splitting it across
PRs made this straightforward to extend as each plugin shipped.

`/revoke-session`'s row above bounds requests that hit Better Auth's
HTTP router directly, but this app's own session-revoke route
(`server/api/v1/profiles/sessions/[id]/revoke.post.ts`) calls
`useServerAuth().api.revokeSession()` in-process rather than making an
HTTP request — Better Auth's rate limiting is applied at the HTTP
router level, so it never sees these calls, and the row currently has
no effect on this app's own revoke path. Practical exposure is low: the
route already scopes session lookups to the caller's own sessions, so
this can't be used to affect another account regardless.

`/verify-password` is gated only by `sensitiveSessionMiddleware` (any
valid session cookie), takes a plaintext `{ password }` body, and
responds `200`/`400 INVALID_PASSWORD` — a password-guessing oracle with
no dedicated rule before this fix, silently falling through to the
generic 60-per-60s default (3600 guesses/hour). It now gets its own row,
tighter than `/sign-in/email`'s.

`/two-factor/get-totp-uri` and `/two-factor/send-otp` used to fall
through to the `/two-factor/*` catch-all (300s/10), looser than their
password-gated siblings `/two-factor/enable`/`/two-factor/disable`.
`get-totp-uri` also requires the account password and returns the live
decrypted TOTP secret, so it now gets the same 900s/5 row as `enable`/
`disable` instead of the wildcard's looser limit.

`/reset-password/*`, `/delete-user/*`, and `/callback/*` are wildcard
rows for parameterized sibling routes (`GET /reset-password/:token`,
`GET /delete-user/callback`, `GET /callback/:id`) that `customRules`
cannot match by exact path. These are protected by high-entropy tokens
regardless, so the practical risk was already low — the wildcards exist
for table completeness rather than to close a real gap.

Better Auth resolves `customRules` with `Object.keys(...).find(...)`,
matching the **first** key (in object-literal insertion order) whose
path equals the request path exactly, or whose pattern (if it contains
`*`) glob-matches it. Every exact path that a wildcard could also match
(e.g. `/two-factor/verify-totp` vs. `/two-factor/*`) is listed **before**
that wildcard for this reason — reordering the object breaks the
per-endpoint overrides silently, falling back to the wildcard's looser
limit.

## Reused outside Better Auth: the gateway catalog route

`GET /api/v1/gateways/[gateway]/models` isn't a Better Auth endpoint and
isn't in the table above, but it reuses the same `createAuthRateLimitStorage()`
KV-backed limiter with its own key prefix (`gateway-catalog:rate-limit`) and
a dedicated per-user rule, verified against the route's current
`GATEWAY_MODELS_RATE_LIMIT` constant:

| Path | Window | Max |
| --- | --- | --- |
| `GET /api/v1/gateways/[gateway]/models` | 60s | 20 |

Unlike the table above, this rule is keyed by the authenticated
`session.user.id`, not by IP. It exists because the route triggers an
upstream fetch to Vercel AI Gateway, OpenRouter, or Cloudflare on every
cache miss (the catalog is cached in KV — one hour for Vercel/OpenRouter,
15 minutes for Cloudflare — with no request coalescing; see
`server/utils/gateways/catalog.ts`), so an unbounded client could drive
repeated concurrent upstream fetches. This is a cost/availability concern
for those upstreams rather than an auth-sensitive action.

## Reused outside Better Auth: the key-management routes

The `GET /api/v1/profiles/keys` summary endpoint, the gateway credential
routes added alongside gateway support (`GET/POST/DELETE
/api/v1/profiles/keys/{vercel-gateway,openrouter,cloudflare-gateway}`), and
the Brave/Exa search-key routes all reuse the same KV-backed
`createAuthRateLimitStorage()` factory via a small shared wrapper
(`server/utils/keys-rate-limit.ts`) rather than pasting the gateway catalog
route's inline enforcement function into each one. `enforceKeysRateLimit()`
takes a `keyPrefix` argument so every route/provider/method combination gets
an independent bucket keyed by `session.user.id`; sharing one bucket across
methods or providers would let one flow's traffic silently erode another's
budget. Every rule below is keyed by `session.user.id`, same as the gateway
catalog rule above:

| Path | Window | Max |
| --- | --- | --- |
| `GET /api/v1/profiles/keys` | 60s | 300 |
| `GET /api/v1/profiles/keys/vercel-gateway` | 60s | 30 |
| `POST /api/v1/profiles/keys/vercel-gateway` | 60s | 10 |
| `DELETE /api/v1/profiles/keys/vercel-gateway` | 60s | 10 |
| `GET /api/v1/profiles/keys/openrouter` | 60s | 30 |
| `POST /api/v1/profiles/keys/openrouter` | 60s | 10 |
| `DELETE /api/v1/profiles/keys/openrouter` | 60s | 10 |
| `GET /api/v1/profiles/keys/cloudflare-gateway` | 60s | 30 |
| `POST /api/v1/profiles/keys/cloudflare-gateway` | 60s | 10 |
| `DELETE /api/v1/profiles/keys/cloudflare-gateway` | 60s | 10 |
| `GET /api/v1/profiles/keys/brave` | 60s | 10 |
| `POST /api/v1/profiles/keys/brave` | 60s | 10 |
| `DELETE /api/v1/profiles/keys/brave` | 60s | 10 |
| `GET /api/v1/profiles/keys/exa` | 60s | 10 |
| `POST /api/v1/profiles/keys/exa` | 60s | 10 |
| `DELETE /api/v1/profiles/keys/exa` | 60s | 10 |

The summary route is read-mostly and fetched from chat pages, so it gets a
much looser 300-per-60s row (raised from 30 in `749473d`). Every gateway
`GET` is read-mostly, user-initiated, and low-frequency — a single DB lookup
with no secret decryption cost beyond one `crypto-shield` call — so they get
a generous 30-per-60s row,
looser than the gateway catalog route's 20-per-60s because there's no
upstream fetch on this hot path. Every gateway `POST`/`DELETE` gets a
tighter 10-per-60s row because those verbs mutate state, even though a
legitimate user is very unlikely to hit it: each gateway's key panel on the
keys page (`app/components/Profile/Keys/ProviderKeyCard.vue` for
Vercel/OpenRouter, `app/components/Profile/Keys/CloudflareGateway.vue` for
Cloudflare, since its credentials are a compound
`{accountId, apiKey, gatewayId}` blob rather than a single secret) triggers
one `POST` followed by one `GET` refresh per save, and issues one `GET`
when its tab is selected — every one of those lands in its own bucket,
because each route/method/provider combination is given a
distinct `keyPrefix` (e.g. `keys-rate-limit:vercel-gateway:post` vs.
`keys-rate-limit:vercel-gateway:get`). Sharing one bucket across methods or
providers would let a normal save-then-refresh flow, or switching between
gateway tabs, silently erode the mutation budget meant for abuse
containment.

The Brave and Exa key routes (`server/api/v1/profiles/keys/brave/index.
{get,post,delete}.ts` and their `exa` counterparts) follow the identical
pattern: each calls `enforceKeysRateLimit()` with its own `keyPrefix`,
giving all six routes an independent 10-per-60s bucket per verb — tighter
than the gateway `GET` rows' 30-per-60s for the same reason as the gateway
routes above, since these verbs also write and decrypt a secret rather than
just reading a boolean.

The seven pre-existing single-provider key routes
(`openai`/`anthropic`/`google`/`xai`/`deepseek`/`moonshotai`/`qwen`) remain
unrated-limited; extending them the same way is a follow-up, not part
of this change.

## KV rate-limit storage: the TTL fix and the `consume` caveat

The previous `customStorage` implemented only `get`/`set`, with `set`
hardcoding `expirationTtl: 60`. Any rule with a window longer than 60s
(all of them, now) would have its KV entry expire and reset mid-window,
silently widening the effective limit. The fix computes
`authRateLimitMaxWindow` (`Math.max` across every rule's window — 900)
and uses `Math.max(60, authRateLimitMaxWindow)` as the TTL, respecting
KV's 60-second `expirationTtl` floor while guaranteeing every rule's
window fits inside the TTL.

`createAuthRateLimitStorage()` also implements `consume` — an optional
member of Better Auth's `BetterAuthRateLimitStorage` type. Without it,
Better Auth falls back to `legacyConsume`, a non-atomic read-decide-write
across separate `get`/`set` calls, and logs a one-time warning that
concurrent requests can bypass the limit. Implementing `consume` closes
that specific gap (a single round trip per request, matching the shape
Better Auth's own memory/database backends use) and silences the
warning.

**Caveat that does not go away**: Cloudflare KV has no atomic increment
primitive. `consume` here still does a plain read-decide-write against
KV — it is *not* atomic the way the database-backed storage's
conditional `UPDATE ... WHERE count < max` is. Under genuine concurrency
(many requests for the same key landing in the same window at nearly
the same instant), two reads can both observe the same pre-increment
count and both write an allow decision, letting slightly more than
`max` requests through in the worst case. This is a best-effort
improvement over the previous `get`/`set`-only implementation (which had
the same gap, plus the TTL bug above) — not a hard guarantee. A truly
atomic implementation would need Durable Objects or D1, which is out of
scope for this PR.

## Rate limiting is explicit; password reset revokes sessions

`server/utils/auth.ts` sets `rateLimit.enabled` explicitly to
`!import.meta.dev && !(CI && e2eTestHooksEnabled)`: the limiter stays on
unless the build is a dev build or `process.env.CI === 'true'` and
`config.public.e2eTestHooksEnabled` are both set, so enabling the e2e hooks
alone does not switch it off. Better Auth's own
default is `isProduction`, which reads `NODE_ENV`; that is not reliably set
inside a Worker, so the limiter could be silently off in production. It stays
off only in dev and in CI e2e runs that enable the test hooks.

`emailAndPassword.revokeSessionsOnPasswordReset` is `true`: completing a
password reset signs out every other session. See
`docs/security-audit-2026-10.md`.

## Verification tokens: `getAndDelete` is not atomic on KV

Better Auth 1.7 consumes single-use verification tokens (password reset,
email verification, change-email, two-factor) through
`SecondaryStorage.getAndDelete`. Our Cloudflare KV adapter
(`createAuthSecondaryStorage` in `server/utils/auth-secondary-storage.ts`)
implements it as `get` followed by `delete`. That is not atomic, and KV
deletes are eventually consistent across colos, so a concurrent or
cross-colo replay of the same token inside the propagation window is
possible. Better Auth 1.6 had the same get-then-delete exposure, so this is
not a regression introduced by the 1.7 upgrade.

Considered and deferred: `verification: { storeInDatabase: true }`, which
routes consumption through D1's `consumeOne`. It was deferred because it
invalidates every verification token already issued at deploy time, and D1
transactional semantics for the adapter's consume lock are unverified.
Revisit it if single-use token replay becomes a concrete concern.

## Provider account ids live in `accounts.provider_account_id` (text)

Better Auth's `account.accountId` maps to the `TEXT` column
`provider_account_id`. The original `account_id` column (`INTEGER NOT NULL`
since the first migration) stays in the table as `legacyAccountId` and is
no longer read. New rows write `0` to it through `$defaultFn`, which only
satisfies its `NOT NULL`. The behavior is pinned by
`tests/unit/db/accounts-provider-account-id.spec.ts`.

### Why the integer column was wrong

INTEGER affinity coerced every numeric-looking provider id:

- Google's 21-digit subject ids are beyond the 64-bit range, so SQLite
  stored them as `REAL` and lost precision on write
  (`'123456789012345678901'` became `1.2345678901234568e+20`). The exact
  value is unrecoverable from that column.
- Ids of 16 to 19 digits were stored exactly, but the JS driver returned
  them as numbers above 2^53.
- Credential rows store the user id as `accountId`, and Better Auth 1.7.7
  email sign-in requires `account.accountId === user.id` as strings
  (`api/routes/sign-in.mjs`). A stopgap custom type, `authAccountId`, read
  the column back with `String(value)`. With a text column it is dead and
  has been removed.

Google sign-in did not visibly break, and it did not create duplicate rows.
`findAccountOwnerByKey` (`db/internal-adapter.mjs`) queries
`provider_id = ? AND account_id = ?` with the subject as a string. SQLite
applies the column's numeric affinity to the bound string, so it is rounded
to the same `REAL` and matches. The flaw is that a different subject which
rounds to the same double matches too: around 1e20 the double spacing is
16384. Two Google users within that range would resolve to the same account
row, so one could sign in as the other. Exact text comparison removes that
collision.

### Why an added column and not a rebuild

Changing the column type in place is a drizzle table rebuild
(`CREATE __new_accounts`, `DROP TABLE accounts`, rename). That is the
pattern the D1 migration safety section of `CLAUDE.md` warns about, and
the owner ruled out any `DROP TABLE` for this fix. Nothing references
`accounts`, so a rebuild would not have cascaded, but it was not needed.
Migration `20261013154526_yummy_penance` is a single
`ALTER TABLE accounts ADD provider_account_id text DEFAULT '' NOT NULL`.
The SQL `DEFAULT ''` exists only because `ADD COLUMN ... NOT NULL`
requires one. Better Auth always supplies the value.

Better Auth never sees `legacyAccountId`. The drizzle adapter's `create`
inserts only Better Auth's own fields (`db.insert(table).values(values)`),
so drizzle fills the legacy column from `$defaultFn`. The adapter factory's
`transformOutput` (`@better-auth/core` `db/adapter/factory.mjs`) emits only
schema fields, so the legacy value never reaches Better Auth or the client.

Dropping the legacy column later is a table rebuild and needs its own
migration plan. No index covered `account_id`, so none was recreated.
Better Auth looks accounts up by `provider_id` + `provider_account_id`, and
an index on that pair is an optional follow-up.

### Backfill and what happens to unrecoverable Google rows

Existing rows start with `provider_account_id = ''` and are filled by a
one-off, idempotent backfill run outside the repository. Every statement is
guarded by `WHERE provider_account_id = ''`, so re-running it never touches
a filled row or a row written by new code:

1. `INTEGER` legacy values (credential, GitHub, and Google ids that fit in
   64 bits) are copied with `CAST(account_id AS TEXT)`. This gives exact
   digits, never `9.0`, including 17 to 19 digit ids.
2. `TEXT` legacy values, if any, are copied as-is.
3. `REAL` Google rows are recovered from the plaintext `id_token` stored on
   the same row. `encryptOAuthTokens` covers only the access and refresh
   tokens, and Better Auth refreshes `idToken` on every sign-in. The script
   base64url-decodes the JWT payload in SQL and accepts `sub` only when:
   - the issuer is Google,
   - `sub` is all digits,
   - `CAST(sub AS REAL)` equals the stored lossy value.

   Any failure leaves the row at `''`.

Nothing is deleted. For a Google row left at `''`, the next Google sign-in
goes through `handleOAuthUserInfo` (`oauth2/link-account.mjs`):

1. `findAccountOwnerByKey` finds no row, because `''` never equals a real
   subject.
2. `findUserByEmail` looks the user up by the Google email. The `''` row
   fails the strict `acc.accountId === account.accountId` check.
3. Google is a trusted provider, and `requireLocalEmailVerified` defaults
   to `true`. So when `users.email_verified = 1`, `linkAccount` creates a
   correct row and the user is signed in. The `''` row stays as an inert
   duplicate.
4. `databaseHooks.account.create.after` sees at least two accounts and
   sends the "new sign-in method connected" email.

Two cases still lock a user out of Google sign-in:

- `users.email_verified = 0` returns "account not linked".
- A Besidka email that no longer matches the Google email (`changeEmail` is
  enabled) registers a brand-new user.

The pre-migration diagnostics list every `REAL` row with `email_verified`,
`has_password`, and whether it is recoverable, so these cases are known
before rollout.

### Rollout runbook

CI facts that set the order:

- Opening or pushing to a pull request against `main` runs Preview Build,
  then Preview Deploy. Preview Deploy runs
  `wrangler d1 migrations apply DB --remote` against `besidka-preview`.
  There is no draft gate.
- Merging to `main` runs `production.yml`. It applies the committed
  migrations to `besidka` with `--env production`, then to
  `besidka-preview`. It never generates migrations: the pull request's
  `static` job and `migrations-clean.spec.ts` already fail a schema change
  that has no committed migration.
- `wrangler d1 migrations apply` skips any migration already recorded in
  `d1_migrations`. A migration applied by hand from this branch under the
  same directory name is therefore skipped by CI.

Steps:

1. Run the read-only diagnostics against both databases. Take a Time
   Travel bookmark of each and record the row counts from the `CLAUDE.md`
   checklist plus `users` and `accounts`. All of this happens before the
   pull request is opened, because opening it migrates `besidka-preview`.

   ```bash
   npx wrangler d1 time-travel info besidka-preview
   npx wrangler d1 time-travel info besidka --env production
   ```

2. Apply the migration to `besidka-preview` (`pnpm run db:migrate:preview`,
   or let the PR's Preview Deploy do it). Run the backfill, run the
   post-migration diagnostics, and test credential, GitHub and Google
   sign-in on the PR preview.
3. Bookmark `besidka` again. Then, before merging, apply the migration
   (`pnpm run db:migrate:prod`) and the backfill to production. Verify the
   row counts are unchanged and that no `INTEGER` row is unfilled. The old
   code keeps reading `account_id` and is unaffected.
4. Merge. The deploy switches reads to `provider_account_id`. CI's
   migration step finds the migration already applied.
5. Re-run the backfill immediately after the deploy. Rows created by the
   old code between steps 3 and 4 have `provider_account_id = ''`, and their
   users cannot sign in until it runs. That includes a credential sign-up
   made in that window.

Recovery: restore the bookmark from step 1 or 3 with
`npx wrangler d1 time-travel restore <db> [--env production] --bookmark=<bookmark>`.
Because the migration only adds a column, rolling back the code is enough
when the data is intact. The old code ignores `provider_account_id`. If you
do restore, follow `docs/d1-restore-reconciliation.md` right after: a
restore revives revoked sessions through the D1 fallback, and you must clear
them in both D1 and KV.

## Turnstile owner checklist

Manual steps needed before `turnstileEnforced` can be safely flipped to
`true` in a real deployment (already set to `true` in `wrangler.jsonc`'s
production `vars`; the sitekeys below already exist in both
environments, but the flag stays practically inert until the secret
key is set):

- [x] Create a Turnstile widget in the Cloudflare dashboard for
      `besidka.com` (and `www.besidka.com`), widget mode **Managed** —
      not Invisible. See "Turnstile: verified against Cloudflare's
      official docs" below for why Invisible mode is the wrong choice
      here.
- [x] Set the real secret key: `wrangler secret put NUXT_TURNSTILE_SECRET_KEY
      --env production` (never commit it to `wrangler.jsonc`). Done
      2026-10-07: the widget secret was rotated through the Cloudflare
      API (`POST /accounts/{account_id}/challenges/widgets/{sitekey}/
      rotate_secret`; Wrangler's OAuth token needs the
      `challenge-widgets.write` scope, so run `wrangler login` to refresh
      it first) and the new value was piped into `wrangler secret put`.
      The local copy lives in the gitignored `.dev.vars.production`.
- [x] Set the real sitekey in `wrangler.jsonc`'s production `vars` as
      `NUXT_PUBLIC_TURNSTILE_SITE_KEY` (safe to commit — it's
      client-visible by design).
- [x] Confirm the widget's configured hostnames include
      `besidka.com` — a mismatch here is exactly the failure mode
      `allowedHostnames` exists to prevent, so it will 403 real users if
      the widget's dashboard hostname list drifts from this. Registering
      `www.besidka.com` too is harmless but, per the
      verification note below, not required. Verified 2026-10-07 with
      `wrangler turnstile widget get 0x4AAAAAAEFMAZiwbUuiy0qi`: mode
      `managed`, domains `[besidka.com]`.
- [ ] Previews run the real widget through the dedicated "Besidka (preview)"
      widget `0x4AAAAAAEFM-2wD0PMvdy4q` (see "The `turnstileEnforced` gate").
      Its hostname list is `chernenko.workers.dev` (Cloudflare dashboard,
      Turnstile, widget, Hostname management); adding a hostname authorizes
      all of its subdomains and wildcards are not supported, so that one
      entry covers `preview-besidka.chernenko.workers.dev` and every
      `pr-<n>-besidka.chernenko.workers.dev`. The previews secret
      (`.dev.vars.preview`, pushed via `wrangler preview base-config secret
      bulk`) must be this widget's secret; a sitekey/secret mismatch shows as
      "Captcha verification failed" (403) after the widget itself passed. The
      production widget must keep `besidka.com` only (remove
      `chernenko.workers.dev` from it). See `docs/cloudflare-previews.md`
      ("Turnstile on Previews"). Automation cannot pass a real challenge, so
      a human must test sign-in on a Preview.
- [ ] After the first real deploy with keys configured, manually
      exercise sign-up, sign-in, and reset-password in production to
      confirm the widget renders and the rate-limit windows above don't
      false-positive on normal traffic.
- [ ] Watch for a spike in 403s from the captcha plugin
      (`VERIFICATION_FAILED`/`MISSING_RESPONSE`) in the first days after
      enabling — that signals either a hostname mismatch or a client
      bundling issue where the widget script failed to load.

**Production ran unprotected until 2026-10-07.** Until the secret was
set, production had `turnstileEnforced: true` but no
`turnstileSecretKey`, so `captchaEnabled` was false and the Better Auth
`captcha` plugin was never registered — the endpoints failed open, with
no captcha check at all. `logCaptchaMisconfigured` in
`server/utils/auth-captcha.ts` reported it by emitting a status-500
"captcha misconfigured" wide event on every isolate boot (about 1.5k a
week in `besidka-prod`). That event is the signal to alert on: it must
be absent whenever enforcement is on and the secret is present.

## Turnstile: verified against Cloudflare's official docs

The client and server halves of this integration were checked
directly against Cloudflare's published Turnstile documentation, not
assumed from general knowledge:

- **Client-side rendering.** `app/composables/turnstile.ts` renders
  the widget with `appearance: 'interaction-only'` and
  `execution: 'execute'`, and `app/components/Auth/Turnstile.client.vue`
  only calls `window.turnstile.execute(widgetId)` once the surrounding
  form is actually submitted. This is Cloudflare's documented
  deferred-render pattern for a widget that stays invisible on a
  normal visit and only runs its challenge at the moment of
  submission — not a workaround.
- **Server-side validation.** The resulting token travels to the
  server as the `x-captcha-response` request header (set in
  `app/pages/(auth)/signin.vue`, `signup.vue` and
  `reset-password.vue`). That header name is **Better Auth's
  `captcha` plugin contract, not a Cloudflare requirement** —
  Cloudflare's own `siteverify` API expects the token under a
  `response` field in the POST body. Verified directly against the
  installed package: `plugins/captcha/index.mjs` reads
  `x-captcha-response` off the incoming request, and
  `verify-handlers/cloudflare-turnstile.mjs` forwards it to
  `siteverify` as `body: { secret, response: captchaResponse, ... }`.
  Nothing in this app talks to `siteverify` directly.

**Confirmed: Managed mode, not Invisible.** The dashboard widget
backing both sitekeys above is configured in **Managed** mode. This
matters because `appearance: 'interaction-only'` only has an effect —
escalating to a visible challenge for a visitor Cloudflare's risk
model flags — under Managed mode. Under Invisible mode,
`interaction-only` has no effect at all, so keeping the widget in
Managed mode is what makes this appearance setting do anything.

**Preview does not exercise strict enforcement.**
`NUXT_TURNSTILE_ENFORCED` (→ `runtimeConfig.turnstileEnforced`) is
`true` only in production's `wrangler.jsonc` `env` block. The preview
deploy's top-level `vars` carries its own
`NUXT_PUBLIC_TURNSTILE_SITE_KEY` but leaves `turnstileEnforced` at its
`false` default. A sign-up/sign-in/reset-password flow that passes on
the preview deployment only proves the widget renders and a token
reaches the server — it does **not** exercise
`expectedAction`/`allowedHostnames` enforcement, since Better Auth
only asserts those where `turnstileEnforced` is `true`. Treat a
working preview test as proof of wiring, not as proof that production
enforcement works — only a production test does that.

**The `www` host doesn't need its own hostname entry.** The
`wrangler.jsonc` production `routes` block binds the Worker to both
`besidka.com` and `www.besidka.com/*`, but a zone-level Cloudflare
redirect rule (see `docs/seo.md`) 301s `www.besidka.com` to the apex
ahead of that binding, before any HTML or JS loads. The Turnstile
widget itself is therefore never served from `www` — every real
`siteverify` response's `hostname` field will read
`besidka.com`, never `www.besidka.com`. Registering `www.besidka.com`
as an allowed hostname in the Cloudflare dashboard anyway is harmless
(hostname allowlisting only widens acceptance, never narrows it) but
not required for challenges to validate.

## Widget layout and client failure path

The widget (`app/components/Auth/Turnstile.client.vue`) sits **above**
the submit button on sign-in, sign-up and reset-password, so a
challenge that appears on submit pushes the button down instead of
rendering below it.

- **Size.** `renderWidget` passes `size: 'flexible'` (full width, 300px
  minimum). If the container is measurably narrower than 300px at render
  time it falls back to `'compact'`; the width is read once, so a later
  resize does not re-render the widget.
- **Collapsed until needed.** With `appearance: 'interaction-only'` the
  widget is invisible for most visitors. The wrapper stays collapsed
  (inert, `aria-hidden`, no gap) and expands only while Turnstile's
  `before-interactive-callback` has fired and its
  `after-interactive-callback` has not, so a normal visit shows no empty
  space.
- **Blocking tokenless requests.** `useCaptcha().requestToken()`
  (`app/composables/captcha.ts`) derives enablement from
  `runtimeConfig.public.turnstileSiteKey`. When a sitekey is configured
  and the token is empty, the widget is missing, or the Turnstile script
  failed to load (typically a content blocker), it toasts and returns
  `null`; the page then does not send the auth request. Sending it
  without a token would only reach the server's 400 `MISSING_RESPONSE`
  with a less useful message. The script-load failure gets its own
  "Verification unavailable" toast pointing at content blockers.
- **Single-use tokens.** The widget is reset after every request, failed
  or not, because a token verifies once. `reset` and `remove` also
  settle any pending `execute()` with an empty token so a submit cannot
  hang on a dead widget.
- **Testing the interactive path locally.** Cloudflare's dummy sitekey
  `3x00000000000000000000FF` always forces the interactive checkbox,
  which exercises the expand/collapse behaviour above. The other test
  keys never leave the invisible path.

## Changing an account's email address cannot lose any account data

`/change-email` (wired via `user.changeEmail` in `server/utils/auth.ts`,
consumed by `/profile/email`) never deletes or recreates anything. It
resolves to `internalAdapter.updateUserByEmail(oldEmail, { email:
newEmail })` — a single in-place `UPDATE` of the existing user row's
`email` column (or, for the already-registered-elsewhere case, no row
change at all until the confirmation link is opened) — the account's
underlying identity (its `id`, sessions, chats, projects, files, keys)
never changes. The session refresh that follows a change rewrites only
KV entries keyed by `active-sessions-${userId}` and the session token,
never by email.

`email` exists as a column on exactly one table in this codebase
(`users`, `server/db/schemas/auth.ts`); every foreign key across
`server/db/schemas/*.ts` references `users.id` (an integer), never
`users.email`. No other table, KV key, cache key, or storage key is
built from or looked up by a user's email address anywhere in `server/`
or `app/` — every other reference to a user is by numeric `id`.

The only place a user's email reaches structured logging is
`server/middleware/evlog-auth.ts`'s `maskEmail: true` option, passed to
evlog's own `better-auth` integration, which masks the address before
it is ever set on the logger — raw email is never passed to
`logger.set()`/`useLogger()` anywhere in `server/`. The `import.meta.dev`
branches in `server/utils/auth.ts` and `security-emails.ts` do
`console.log` the raw address, but only to the local dev console, never
through evlog and never in a deployed Worker.

## Ending a session doesn't revoke access on every device instantly

`/profile/security`'s "End session" and "Sign out of all other sessions"
actions (`Sessions.vue`, `/api/v1/profiles/sessions/:id/revoke`,
`revokeOtherSessions`) delete the underlying session row immediately —
that part is instant and unconditional. It is not the same as instantly
logging every open browser tab out everywhere, though: `session.cookieCache`
in `server/utils/auth.ts` (`maxAge: 60 * 5`) caches an already-verified
session in a signed cookie for up to 5 minutes. A device that already
holds that cookie can keep working with it — and keep passing the
cookie-cache check — until the cache window expires, even though the
session record it was verified against is already gone.

This is accepted as a documented limitation, not fixed with a faster
path (e.g. checking a live revocation list in KV on every cached-session
read): that would undo the point of the cache and is a much larger change
to the core session-verification path than this fix-up pass warrants. The
confirmation copy in `Sessions.vue` is worded to reflect this honestly
("it may take a few minutes to fully log the device out everywhere")
instead of promising immediate revocation.

## Two-factor authentication: TOTP and backup codes

Configured via Better Auth's `twoFactor` plugin in `server/utils/auth.ts`
(`totpOptions: { digits: 6, period: 30 }`, `backupCodeOptions: { amount:
10, length: 10, storeBackupCodes: 'encrypted' }`).

`storeBackupCodes: 'encrypted'` symmetrically encrypts the stored backup
codes using the same secret Better Auth uses everywhere else
(`config.betterAuthSecret`) — there is no separate 2FA-specific key. The
plugin's own schema stores the TOTP secret encrypted the same way. This
has one sharp edge: **rotating `betterAuthSecret` makes every already
-enrolled user's stored TOTP secret and backup codes permanently
undecryptable.** The plugin has no re-encryption or migration path for a
secret rotation — every 2FA-enabled account's authenticator codes would
stop validating and its backup codes could never be decrypted again.
Rotating this app's auth secret is not a routine operation as long as
any account has two-factor authentication enabled; it would need a
forced disable-and-re-enroll for every 2FA user, not a transparent key
swap.

The same secret also encrypts the `jwks.private_key` column: the `jwt()`
plugin that signs MCP access tokens stores its private signing key
encrypted with `betterAuthSecret`. Rotating the secret makes that key
undecryptable too: every token request fails with "Failed to decrypt
private key" until the `jwks` rows are deleted and the plugin mints a new
key pair, which invalidates every access token already issued to
connected apps. The OAuth `sig` on pending
authorization links is an HMAC with the same secret, so those links
break as well.

The Security page's TOTP setup QR is rendered by a from-scratch,
dependency-free client-side QR encoder (`app/utils/qr-code.ts`): byte
mode only (input is always UTF-8), error correction levels L and M
only, versions 1 through 10 only — enough for a `totpauth://` URI, not a
general-purpose encoder. `encodeQrCode()` returns a boolean matrix,
`qrMatrixToSvg()` renders it as an inline SVG in `TwoFactor.vue`. Both
run entirely in the browser: the freshly-issued TOTP secret returned by
`/two-factor/enable` is encoded straight into the QR and the
manual-entry fallback text without ever leaving the client or crossing
any additional network hop.

Regenerating backup codes (`/two-factor/generate-backup-codes`) requires
the account password — the same trust level as `/two-factor/enable`
and `/two-factor/disable` — and immediately invalidates every
previously issued code. Like every other security-sensitive action in
this file, it notifies the account owner by email
(`sendTwoFactorBackupCodesRegeneratedEmail`).

## Why `defaultCookieAttributes` and not `useSecureCookies`

With the dynamic `baseURL` (`protocol: 'auto'`), Better Auth derives its
`__Secure-` cookie prefix and `secure` flag from `NODE_ENV === 'production'`,
which is false in the Worker runtime, so production auth cookies shipped
without `Secure`. `advanced.useSecureCookies: true` would fix the flag but also
add the prefix, renaming every cookie and signing every user out. Instead
`advanced.defaultCookieAttributes: { secure }` in `server/utils/auth.ts` is
spread after the getter's own `secure`, so it overrides only the flag. It is
true when `config.public.baseUrl` starts with `https://` (production
`https://besidka.com`, preview `https://preview-besidka.chernenko.workers.dev`)
and false for `http://localhost` in dev and CI, where browsers, WebKit in
particular, may drop `Secure` cookies. `oAuthProxy` is unaffected: the preview
host sets its own session cookie in its own https response. PR previews
(`pr-<n>-besidka.chernenko.workers.dev`) proxy OAuth through the long-lived
preview host; `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS` lets Better Auth accept
every preview host. See `docs/cloudflare-previews.md`. Cookie names are
pinned unchanged by `tests/unit/utils/auth.spec.ts`.

## Passkeys (WebAuthn)

Configured via `@better-auth/passkey` in `server/utils/auth.ts`, with
`rpID` derived per environment by `getRelyingPartyId()` and resident/
preferred user verification. The plugin's own `/passkey/*` endpoints
handle registration and sign-in; `Profile/Security` surfaces add,
list, and remove.

### Known limitation: passkeys don't work on versioned preview URLs

Preview hosts changed with the move to Cloudflare Workers Previews (see
`docs/cloudflare-previews.md`): the stable host is now
`preview-besidka.chernenko.workers.dev`, and `pr-<n>-besidka...` and
`<deployment-id>-besidka...` hosts are the "other" hosts below. The reasoning
that follows still holds with those names substituted.

`server/utils/auth-hosts.ts` has two functions that both derive a trust
decision from the same `baseUrl`, for two different purposes, and they
deliberately disagree on any host that isn't the apex domain or `www`:

- `getRelyingPartyId()` returns the **bare hostname** for any host that
  isn't `localhost`/`127.0.0.1` and doesn't start with `www.` — it only
  ever strips a leading `www.`. For a branch-level preview host such as
  `preview-feat-x.<subdomain>.workers.dev`, the RP ID is that exact
  hostname, unchanged.
- `getAllowedHosts()` for that same host instead returns a **wildcard**
  entry, `*-${subdomain}.${rest}`, built by treating the hostname's
  first label as an arbitrary-prefix wildcard. This is what lets Better
  Auth's `baseURL.allowedHosts` trust request Origins from Cloudflare's
  per-commit/per-version preview URLs
  (`<version-hash>-preview-feat-x.<subdomain>.workers.dev`) as the same
  logical preview, without listing every version explicitly.

WebAuthn's relying-party-ID check has no concept of a wildcard: the
navigator's actual origin hostname must equal the RP ID, or be a
registrable-domain suffix of it at a whole-label boundary. A version
hash prepended to the branch host's first label
(`<hash>-preview-feat-x...`) is a different first label, not a label
-boundary suffix of `preview-feat-x...` — so the browser rejects the RP
ID for that origin and the WebAuthn ceremony never starts. The two
functions aren't out of sync with each other by mistake; they solve
different problems that happen to diverge here (`allowedHosts` widens
deliberately to cover every version of one preview; `getRelyingPartyId`
answers a spec-constrained question that cannot be widened the same
way). The accepted consequence: **passkey registration and sign-in only
work on the stable branch-level preview host and in production — never
on a per-commit/per-version preview URL.** Test passkeys against the
branch preview host or production, not a version-pinned preview link.

## The 2FA requirement gates password sign-in only

This app's two-factor requirement does not apply to every sign-in on a
2FA-enabled account — only to signing in with a password. Verified
directly against the installed `better-auth` package
(`node_modules/better-auth/dist/plugins/two-factor/index.mjs`): the
plugin's own `hooks.after` matcher that redirects a sign-in into the 2FA
challenge is

```js
matcher(context) {
  return context.path === "/sign-in/email"
    || context.path === "/sign-in/username"
    || context.path === "/sign-in/phone-number"
}
```

Signing in with a passkey (`/passkey/verify-authentication`) or a linked
OAuth provider (`/sign-in/social`, `/callback/*`) never passes through
this matcher, so neither path ever triggers a 2FA challenge — even for
an account that has two-factor authentication enabled. This is Better
Auth's own by-design behavior, not a gap introduced by this app's
configuration. The same hook also skips the challenge outright when a
valid "trust this device" cookie is present from an earlier password
sign-in — a second, independent reason a 2FA-enabled account may not
see a challenge on a given sign-in.

This is a deliberate, accepted trade-off, not a gap to close:

- A passkey already requires possession of a specific hardware- or
  platform-bound credential — a strong factor on its own, arguably a
  stronger guarantee than a TOTP code copied out of an app that could be
  running on any device.
- A linked OAuth provider is trusted to have already authenticated the
  same principal: this app's account linking (`account.accountLinking`
  in `server/utils/auth.ts`) only links a provider to an existing
  account when its email matches and is verified
  (`allowDifferentEmails: false`), so signing in via Google or GitHub is
  never a weaker authentication path than the credential one, just a
  different one.

Closing this would mean reimplementing a meaningful slice of the
two-factor plugin's own private session-handling internals — the
pending-2FA cookie, the trust-device verification flow, the redirect
contract with the client — outside of what the plugin exposes for
exactly that purpose. That is judged disproportionate for the security
benefit here, especially given both bypass paths already require a
strong, independent credential of their own.

The Security page's own copy (`app/components/Profile/Security/
TwoFactor.vue`) is worded to match this: it states the code is required
"when signing in with your password," not on every sign-in, so a user
who has also added a passkey isn't told something that would be
misleading for their account.

## OAuth authorization server (MCP)

Besidka is an OAuth 2.1 authorization server for its own `/mcp`
endpoint. `mcp()` from `@better-auth/mcp` (built on
`@better-auth/oauth-provider`) and `jwt()` are registered in
`server/utils/auth.ts`; the tables live in `server/db/schemas/oauth.ts`.

### Configuration

| Setting | Value | Why |
| --- | --- | --- |
| `resource` | `${siteUrl}/mcp` | RFC 8707 resource; becomes the JWT `aud` |
| `scopes` | `MCP_OAUTH_SCOPES` | identity scopes plus `chats:read`, `projects:read`, `memory:read`, `projects:write`, `memory:write` |
| `accessTokenExpiresIn` | 900 (15 min) | access tokens are JWTs verified offline; disconnecting is still immediate because `/mcp` also checks the consent row |
| `refreshTokenExpiresIn` | 2,592,000 (30 days) | library default, set explicitly; rotated on every refresh, 30s reuse overlap from `mcp()` |
| PKCE | required, S256 only | library default |
| `allowDynamicClientRegistration` + `allowUnauthenticatedClientRegistration` | on | MCP clients (claude.ai, Claude Code, Cursor) register themselves |
| `clientRegistrationDefaultScopes` | `MCP_OAUTH_SCOPES` | every DCR client may ask for every scope; the user decides on the consent page |
| `clientRegistrationDefaultApplicationType` | `infer` | native clients with loopback or custom-scheme callbacks register without loosening web redirect rules |
| `skipConsent` | never | consent is required for every client |
| `loginPage` / `consentPage` | `/signin` / `/oauth/consent` | |

`jwt({ disableSettingJwtHeader: true, jwt: { issuer: siteUrl } })` sets
`iss` and stops the plugin from putting a session JWT in a `set-auth-jwt`
header on every `get-session` response. `grantTypes` is
`['authorization_code', 'refresh_token']`: `client_credentials` is not
offered, so a dynamically registered client cannot mint a token without a
user. The plugin's default also lists it in discovery metadata.

**Disabled endpoints.** `DISABLED_AUTH_PATHS` in `server/utils/auth.ts`
returns 404 at the router for `/token` and for the plugin's own client and
consent management: `/oauth2/get-client`, `get-clients`, `create-client`,
`update-client`, `delete-client`, `client/rotate-secret`, `get-consent`,
`get-consents`, `update-consent` and `delete-consent`. Besidka reads
clients and consents through its own routes. Left on, any signed-in user
could create clients they own (ownership is what the account purge and the
connected-apps list key on), delete a consent row without ending the
tokens, or widen a consent's scopes. `disabledPaths` is router-only, so
`auth.api.*` calls from server code keep working. Everything the consent
page and clients need stays reachable: authorize, consent, continue,
register, token, revoke, introspect, userinfo, end-session, public-client
and public-client-prelogin. `get-client` is not in the original request but
belongs to the same read family.

**Audience caveat.** The JWT `aud` is `${siteUrl}/mcp` only when the client
sends `resource=` on the authorize and token requests (the MCP spec
requires it). A client that omits it gets an opaque access token with no
audience, stored in `oauth_access_tokens`, which a JWT-verifying `/mcp`
route rejects. There is no option to default the resource.

### Dynamic client registration and its rate limits

`POST /oauth2/register` is open, so the only cost to an attacker is the
rate limit. Every claude.ai user registers and refreshes from Anthropic's
shared egress range `160.79.104.0/21`, and Better Auth's limiter keys on
IP plus path, so a per-IP limit is effectively a limit for all claude.ai
users together. The plugin defaults (register 5/min, token 20/min) would
lock out the second claude.ai user in a busy minute. The `customRules`
override them (custom rules win over plugin rules in Better Auth's
resolver): register 60/min and token 300/min leave room for many users
behind one IP while still bounding a scripted flood from one address.
`/oauth2/authorize` and `/oauth2/consent` come from the user's own
browser, so they keep tighter per-user-IP limits. `/oauth2/revoke` and
`/oauth2/introspect` require client authentication and get 120/min.

Unauthenticated registration cannot set privileged client fields. The
plugin's registration schema rejects `skip_consent` (`z.never()`) and
strips unknown keys such as `enable_end_session`. As defence in depth
against a library change, a `hooks.before` on `/oauth2/register`
(`stripPrivilegedClientRegistrationFields`) removes `skip_consent`,
`skipConsent`, `enable_end_session` and `enableEndSession` from the body
before validation.

**Registration bounds.** The same `hooks.before` also rejects, with
`400 invalid_client_metadata`, a registration whose body is over 16 KiB
(the `content-length` header, or the serialised body when there is none),
whose `client_name` is over 120 characters, whose `client_uri`, `logo_uri`,
`tos_uri`, `policy_uri`, `jwks_uri` or `backchannel_logout_uri` is over
2048 characters, with more than 10 `redirect_uris` or
`post_logout_redirect_uris` (or one over 2048 characters), more than 5
`contacts` (or one over 254), any `software_statement`, or a `software_id`
or `software_version` over 128 characters. The limits are named constants
in `server/utils/oauth/registration-limits.ts`. Registration is
unauthenticated and the name is shown on the consent page, so unbounded
metadata is both a storage and a spoofing lever.

### Sign-in and consent flow

`/oauth2/authorize` redirects to `/signin` or `/oauth/consent` with a
signed query (`sig`, `exp`, `ba_iat`, `ba_param` plus the authorize
parameters). `oauthProviderClient()` in `app/composables/auth.ts` adds
that query as `oauth_query` to every Better Auth `POST` made from such a
page, and the provider's after hook turns any response that sets a
session cookie into the next authorize step.

- `/signin` to `/2fa` and `/signin` to `/signup` carry the signed query
  (`pickSignedOAuthQuery`, `appendSignedOAuthQueryToPath`), so the
  second-factor and sign-up requests still resume the flow.
- When a response is an OAuth continuation (`{ redirect: true, url }`), the
  passkey and 2FA handlers do not navigate themselves; Better Auth's
  redirect fetch plugin does.
- Social sign-in resumes through the provider's own server context, which
  `/sign-in/social` stores with the OAuth state.
- `00.auth.global.ts`: a signed-in user on `/signin` with a signed query is
  sent back to `/api/auth/oauth2/authorize` instead of `/chats/new`, unless
  the request has `prompt=login` or `max_age`, in which case the sign-in
  form stays so the user can sign in again. A signed-out user on
  `/oauth/consent` goes to `/signin` with the signed query, because `next`
  only allows two paths. An expired query (`exp` is 10 minutes after the
  redirect) is dropped with a toast, since the server rejects every request
  that carries an expired `oauth_query`.

`/oauth/consent` verifies the signed query server-side through
`GET /api/v1/profiles/connected-apps/authorization-request`
(`verifyOAuthQueryParams` with the live auth secret), then shows the app's
name, homepage link and redirect host. The name comes from the app's own
registration and is marked as unverified. The app's `logo_uri` is never
loaded, on the consent page or on `/profile/connected-apps`: fetching it
would send the user's IP address to whoever registered the client, before
they approve anything, so both pages show a generic icon. Read scopes start
checked; write scopes (`isMcpWriteScope`) start unchecked with a warning.
Identity scopes are always sent. Approve posts only the chosen scopes to
`/oauth2/consent`, which accepts any subset of the requested scopes. The
page also states that chats, projects and memory can hold sensitive and
third-party data, that approving is explicit consent to send it to the
app, and that the app may be outside the EU without a contract with
Besidka (`/privacy-policy#connected-ai-apps`). `/oauth/**` is disallowed
in robots, excluded from the sitemap, `noindex`, `no-store`, and cannot be
framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). The page adds
no cookies or browser storage.

Grant and denial are logged by the `/oauth2/consent` after hook, and
revocation by the revoke route, under `attributes.legalConsent` with the
client id and scopes only, never a token.

### Connected apps and revocation

`/profile/connected-apps` lists every client the user has a consent for
or a live (not revoked, not expired) refresh token for, so a grant whose
consent row is gone still shows up and can be revoked. Scopes come from
the consent, or from the newest live refresh token when there is none (a
bare `max()` aggregate in SQLite takes the other columns from the max
row). **Disconnect**
(`POST /api/v1/profiles/connected-apps/[clientId]/revoke`) deletes, in one
D1 batch and in foreign-key order, the user's access tokens, refresh
tokens and consents for that client, unconditionally, and answers 404 only
when none of the three existed. The plugin's own `/oauth2/delete-consent`
is disabled.

The MCP server checks for a live consent row on every call, so
disconnecting takes effect at once even though access tokens are JWTs
verified without a database read. The UI no longer promises a delay.

### Recovery ends every grant

A refresh token outlives the browser sessions that account recovery
revokes, so a stolen grant would keep minting access tokens for 30 days
after the password changed. `revokeUserOAuthGrants`
(`server/utils/account/revoke-user-oauth-grants.ts`) deletes the user's
access tokens, refresh tokens and consents in one batch. It runs after a
successful `/reset-password` (from `emailAndPassword.onPasswordReset`,
because that flow has no session), after `/change-password` with
`revokeOtherSessions: true`, and after `/revoke-sessions`. A failure is
logged under `attributes.legalConsent` (`oauth_revoke_all_failed`) and not
thrown, because the credential change already happened. Success logs
`oauth_revoked_all` with the trigger path.

### New-app email and sweep

Approving an app sends "A new app was connected to your Besidka account"
(`notifyOAuthAppConnected`): the app name (control characters stripped,
capped at 120, labelled unverified), the scopes in plain words, the time
and a link to `/profile/connected-apps`.

`server/plugins/oauth-grant-sweep.ts` runs on the hourly cron
(`0 * * * *`) and deletes, in batches of 100 (up to 10 batches per table
per run, D1 has no `DELETE ... LIMIT`, so each delete selects its ids with
a limited subquery): access tokens expired for a day; refresh tokens
expired or revoked for a day, after the access tokens that reference them
(`refresh_id` foreign key); and owner-less clients older than 7 days with
no consent and no token. **Trade-off:** a client that cached its
`client_id` and was never approved, or whose user revoked it and then
waited 7 days, gets `invalid_client` at authorize and has to register
again. Counts go under `attributes.oauthSweep`.

### Account deletion

None of the OAuth tables cascade from `users`, so a leftover row blocks
the user delete. `purgeUserOAuthData` runs in `deleteUser.beforeDelete`
before `purgeUserData`, so a failing OAuth batch aborts the deletion
before any content is purged, and deletes, in one batch: access tokens, refresh
tokens and consents of the user or of any client the user owns, then the
clients the user owns (`oauth_client_resources` cascades from them).
Clients registered without a session have no owner; the sweep removes
them when they are unused.

