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
`false`), analogous to `emailNoopEnabled`. It is set to `true` only in
the production Worker's `wrangler.jsonc` `vars` block. Preview deploys,
local dev, and CI all keep it `false`, so `expectedAction`/
`allowedHostnames` are only ever asserted where a human has explicitly
confirmed the deployed hostname and action match — production.

`allowedHostnames`, when enforced, reuses `getAllowedHosts()` (in
`server/utils/auth-hosts.ts`, used for Better Auth's
`baseURL.allowedHosts`) but strips any `:port` suffix and any entry
containing `*` — Turnstile matches bare hostnames only, and
`getAllowedHosts()` can return port/wildcard entries (`localhost:*`,
`*-branch.rest`) for other, legitimate reasons that don't apply to
Turnstile's hostname check.

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
| everything else (default) | 60s | 60 |

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

`GET /api/v1/gateways/[gateway]/models` (providers/gateways initiative)
isn't a Better Auth endpoint and isn't in the table above, but it reuses
the same `createAuthRateLimitStorage()` KV-backed limiter with its own
key prefix (`gateway-catalog:rate-limit`) and a dedicated per-user rule:

| Path | Window | Max |
| --- | --- | --- |
| `GET /api/v1/gateways/[gateway]/models` | 60s | 20 |

Unlike the table above, this rule is keyed by the authenticated
`session.user.id`, not by IP. It exists because the route triggers an
upstream fetch to Vercel AI Gateway or OpenRouter on every cache miss
(the catalog is cached in KV for 1 hour, with no request coalescing —
see `server/utils/gateways/catalog.ts`), so an unbounded client could
drive repeated concurrent upstream fetches. This is a cost/availability
concern for those upstreams rather than an auth-sensitive action.

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
- [ ] Set the real secret key: `wrangler secret put NUXT_TURNSTILE_SECRET_KEY
      --env production` (never commit it to `wrangler.jsonc`).
- [x] Set the real sitekey in `wrangler.jsonc`'s production `vars` as
      `NUXT_PUBLIC_TURNSTILE_SITE_KEY` (safe to commit — it's
      client-visible by design).
- [ ] Confirm the widget's configured hostnames include
      `besidka.com` — a mismatch here is exactly the failure mode
      `allowedHostnames` exists to prevent, so it will 403 real users if
      the widget's dashboard hostname list drifts from this. Registering
      `www.besidka.com` too is harmless but, per the
      verification note below, not required.
- [ ] Any preview/staging environment that ever gets its own
      `turnstileSecretKey`/`turnstileSiteKey` for testing must NOT also
      get `turnstileEnforced: true` (already the default in this repo:
      only the production `env` block sets it) — its hostname will
      never match the production Turnstile widget's allow-list.
- [ ] After the first real deploy with keys configured, manually
      exercise sign-up, sign-in, and reset-password in production to
      confirm the widget renders and the rate-limit windows above don't
      false-positive on normal traffic.
- [ ] Watch for a spike in 403s from the captcha plugin
      (`VERIFICATION_FAILED`/`MISSING_RESPONSE`) in the first days after
      enabling — that signals either a hostname mismatch or a client
      bundling issue where the widget script failed to load.

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

## Passkeys (WebAuthn)

Configured via `@better-auth/passkey` in `server/utils/auth.ts`, with
`rpID` derived per environment by `getRelyingPartyId()` and resident/
preferred user verification. The plugin's own `/passkey/*` endpoints
handle registration and sign-in; `Profile/Security` surfaces add,
list, and remove.

### Known limitation: passkeys don't work on versioned preview URLs

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

