# Auth security — Turnstile captcha + Better Auth rate limits

PR1 of a 4-PR stacked series (rate-limit + Turnstile → security hub →
2FA → passkeys). This document covers what shipped here; the later PRs
extend the rate-limit table (`/two-factor/*`, `/passkey/*` rows already
exist below, inert until those endpoints exist).

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

`allowedHostnames`, when enforced, reuses `getAllowedHosts()` (already
in `server/utils/auth.ts`, used for Better Auth's `baseURL.allowedHosts`)
but strips any `:port` suffix and any entry containing `*` — Turnstile
matches bare hostnames only, and `getAllowedHosts()` can return
port/wildcard entries (`localhost:*`, `*-branch.rest`) for other,
legitimate reasons that don't apply to Turnstile's hostname check.

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
| `/request-password-reset` | 900s | 3 |
| `/reset-password` | 900s | 5 |
| `/send-verification-email` | 900s | 3 |
| `/change-password` | 900s | 5 |
| `/change-email` | 900s | 3 |
| `/delete-user` | 900s | 3 |
| `/verify-email` | 300s | 20 |
| `/two-factor/verify-totp` | 300s | 5 |
| `/two-factor/verify-otp` | 300s | 5 |
| `/two-factor/verify-backup-code` | 900s | 5 |
| `/two-factor/generate-backup-codes` | 900s | 3 |
| `/two-factor/enable` | 900s | 5 |
| `/two-factor/disable` | 900s | 5 |
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

`/two-factor/*` and `/passkey/*` rows exist now even though those
endpoints don't ship until PR3/PR4 — unmatched rules are inert, and it
keeps the entire policy reviewable in one file
(`server/utils/auth-rate-limit.ts`) instead of splitting it across PRs.

Better Auth resolves `customRules` with `Object.keys(...).find(...)`,
matching the **first** key (in object-literal insertion order) whose
path equals the request path exactly, or whose pattern (if it contains
`*`) glob-matches it. Every exact path that a wildcard could also match
(e.g. `/two-factor/verify-totp` vs. `/two-factor/*`) is listed **before**
that wildcard for this reason — reordering the object breaks the
per-endpoint overrides silently, falling back to the wildcard's looser
limit.

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
`true` in a real deployment (already set in `wrangler.jsonc`'s
production `vars`, but inert until real keys exist):

- [ ] Create a Turnstile widget in the Cloudflare dashboard for
      `besidka.com` (and `www.besidka.com`), widget mode "Managed" or
      "Invisible".
- [ ] Set the real secret key: `wrangler secret put NUXT_TURNSTILE_SECRET_KEY
      --env production` (never commit it to `wrangler.jsonc`).
- [ ] Set the real sitekey in `wrangler.jsonc`'s production `vars` as
      `NUXT_PUBLIC_TURNSTILE_SITE_KEY` (safe to commit — it's
      client-visible by design).
- [ ] Confirm the widget's configured hostnames match exactly what
      `getAllowedHosts()` returns for `https://www.besidka.com`
      (`www.besidka.com`, `besidka.com`) — a mismatch here is exactly
      the failure mode `allowedHostnames` exists to prevent, so it will
      403 real users if the widget's dashboard hostname list drifts
      from this.
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
