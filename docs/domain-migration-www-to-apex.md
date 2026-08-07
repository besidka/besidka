# Domain migration: `www.besidka.com` → `besidka.com`

Canonical production host moves from the `www` subdomain to the bare apex.
This doc records the pre-migration D1 Time Travel bookmarks, the read-only
scan that justified skipping a data migration, and the ordered manual
runbook for the parts of this migration that live outside this repo
(Cloudflare dashboard, OAuth app consoles, Google Search Console).

## Pre-migration D1 Time Travel bookmarks (2026-08-07)

`production.yml` auto-applies D1 migrations on every merge with **no human
gate** — so per this repo's D1 migration-safety doctrine (`AGENTS.md`), a
bookmark is taken before merge regardless of whether this PR touches
schema (it doesn't). Real database names are `besidka` / `besidka-consent`
/ `besidka-content` in production, `besidka-preview` /
`besidka-consent-preview` / `besidka-content-preview` in preview
(`wrangler.jsonc`) — this supersedes the stale `chat`/`chat-preview` naming
that was previously in `AGENTS.md`, now fixed.

These bookmarks were taken while writing this doc. **They are snapshots at
that moment, not a substitute for taking fresh ones immediately before the
actual merge** — re-run `wrangler d1 time-travel info <db> [--env production]`
right before clicking merge if meaningful time has passed, and update the
values below.

```
# production
wrangler d1 time-travel restore besidka --env production \
  --bookmark=00003681-00000000-000050c0-4d0dc14482f789da90c848f8bb63c020
wrangler d1 time-travel restore besidka-consent --env production \
  --bookmark=0000002b-00000000-000050c0-3e437a51a50793b32e901c7ef8832456
wrangler d1 time-travel restore besidka-content --env production \
  --bookmark=00000425-00000000-000050c0-c10bb06612a4756c9ce67d70c6e4e0d5

# preview
wrangler d1 time-travel restore besidka-preview \
  --bookmark=0000243c-00000000-000050c0-423a4117a22902bce6d0cbea9378283a
wrangler d1 time-travel restore besidka-consent-preview \
  --bookmark=000000f8-00000000-000050c0-5b7990b0d01feff3c91f81103ce39572
wrangler d1 time-travel restore besidka-content-preview \
  --bookmark=0000009f-00000000-000050c0-b514bfce4b946f7d84667d6a6befd072
```

## Read-only scan for stored `www.besidka.com` references

Searched every text-bearing column that could plausibly store an absolute
URL to our own domain (`push_subscriptions.endpoint`/`.origin`,
`chat_shares`, `files.storageKey`, `users.image`). Only one column had
hits:

```sql
SELECT origin, COUNT(*) FROM push_subscriptions GROUP BY origin;
-- null                      -> 2
-- https://www.besidka.com   -> 8
```

`push_subscriptions.endpoint` never contains our own domain — it's the
browser push service's URL (FCM/Mozilla autopush), not besidka.com.
`chat_shares` stores a ULID slug (relative), not an absolute URL.
`users.image` stores third-party OAuth avatar URLs, unrelated to this
domain. `origin` is written from `getRequestURL(event).origin` at
subscribe time (`server/api/v1/push/subscribe.post.ts`) purely to
disambiguate preview deployments that share one D1 database
(`server/utils/push.ts`); production only ever had one origin, so every
existing row reads `www.besidka.com`.

**No `UPDATE` needed.** `sendPushNotificationToUser()` already falls back
to the full subscription set whenever none match the caller's
`targetOrigin` (`server/utils/push.ts:275-280`), so a stale `origin` value
never silently drops a notification — it's cosmetic bookkeeping, not a
delivery gate. These 8 rows naturally roll over to `https://besidka.com` as
each user re-subscribes on the new origin. User-authored chat message
content is out of scope regardless — never rewrite user data.

## Blast radius (existing users, at cutover)

- **Sessions**: `www.besidka.com`-scoped cookies are host-only. Every
  signed-in user is logged out and must sign in again on `besidka.com`.
  One-time, expected, not a bug.
- **Push notifications / installed PWAs**: existing subscriptions are
  registered against the `www` origin's service worker scope. Expected to
  keep working with no user action — a service worker persists and keeps
  receiving pushes without a revisit, and a notification's click-through
  URL just 301s from `www` to the apex. Once a user does revisit and
  re-subscribes on the apex, `sendPushNotificationToUser()`'s per-user
  origin filter targets only the matching-origin subscription, so no
  duplicate notifications. Worst case (service-worker eviction or similar)
  is re-enabling notifications on the apex — the fallback, not the
  expected outcome.
- **Passkeys**: unaffected. `getRelyingPartyId()` already normalizes both
  `besidka.com` and `www.besidka.com` to the same RP ID `besidka.com`
  (`server/utils/auth-hosts.ts`, covered by
  `tests/unit/utils/auth-hosts.spec.ts`). No user re-registration.
- **SEO**: 301s preserve link equity; expect a short reindexing wobble
  while Google migrates the canonical.

## Why this is safe to ship as one PR

Everything in this repo derives canonical identity from one runtime value,
`NUXT_PUBLIC_BASE_URL`. Two host-normalizing utilities make the cutover
tolerant in both directions, so flipping that one value is the only code
change that alters behavior:

- `getAllowedHosts()` (`server/utils/auth-hosts.ts`) returns
  `[apex, www.apex]` for either input — both hosts stay valid Better Auth
  origins and Turnstile allowed hostnames throughout the migration.
- `getRelyingPartyId()` already strips a leading `www.` — the WebAuthn
  RP-ID is `besidka.com` today and stays `besidka.com` after.

The serving host itself is controlled by a **zone-level Cloudflare
redirect rule** (dashboard-only, not in this repo) that currently 301s
apex → www ahead of the Worker's routes. The Worker already binds both
hosts (`wrangler.jsonc` production `routes`) and this PR keeps both
bindings — the www route becomes a dormant fallback once the rule flips,
which costs nothing and avoids a www 522 if the rule is ever unset. The
only infrastructure change is flipping that one rule's direction.

## Manual runbook (owner, outside this repo — cannot be automated here)

The Cloudflare API token available in this environment has `zone:read`
only (confirmed via `wrangler whoami`) — no `Zone > Single Redirect > Edit`
or DNS-write scope — so every Cloudflare-dashboard step below is a manual
action. GitHub's OAuth Apps REST API also has no endpoint for changing
callback/homepage URLs — those are dashboard-only too.

### Phase 0 — any time before merge (de-risking, zero-cost)

1. **Google Cloud Console** (OAuth client for Better Auth's Google
   provider): add `https://besidka.com/api/auth/callback/google` as an
   additional authorized redirect URI, and `https://besidka.com` as an
   additional authorized JavaScript origin. Google supports multiple URIs
   simultaneously — both coexist, this is purely additive.
2. **Turnstile** dashboard: confirm the existing widget's allowed
   hostnames already include the bare apex `besidka.com` (repo docs
   suggest it may already be registered for both — verify live, add if
   missing). Keep `www.besidka.com` listed too.
3. **Locate the existing apex→www redirect** in the Cloudflare dashboard
   for the `besidka.com` zone — check **Rules → Overview** first (current
   product name: "Single Redirects", dashboard label "Redirect Rules");
   if it's not there, check legacy **Page Rules** and **Bulk Redirects**
   too, since this repo's docs assert the rule exists and fires ahead of
   the Worker but not which product implements it. Confirm you can edit
   it. **Do not change it yet.**

   GitHub OAuth Apps (both Better Auth's provider app and Nuxt Studio's,
   which is also a classic OAuth App) support only **one** callback URL
   each — unlike Google, there is no way to dual-register here, so their
   swap has to happen during the cutover itself (Phase 1), not now.

### Phase 1 — cutover: merge, flip, and swap, back-to-back

**This is not three loosely-ordered steps — it's one operation split
across three actions with no deliberate pause between them.** Do not
merge and then leave the apex→www rule live "for a bit" before flipping
it, and do not treat "canonical tags briefly disagree with the redirect
direction" as the only cost of a gap here. Better Auth's OAuth-proxy
plugin (`oAuthProxy({ productionURL: config.public.baseUrl })` in
`server/utils/auth.ts`) activates precisely when the *configured*
`NUXT_PUBLIC_BASE_URL` disagrees with the *actual* serving origin of the
current request (`checkSkipProxy`/`resolveCurrentURL` in Better Auth's
`plugins/oauth-proxy/utils.mjs`) — which is exactly the state that exists
the moment this PR's deploy completes but the redirect rule hasn't
flipped yet. In that window, the proxy forces the OAuth `redirect_uri`
sent to the provider onto the apex, but the still-active *old* apex→www
rule then bounces the provider's callback hit back to `www` before it
reaches the Worker — so the `redirect_uri` seen at token-exchange no
longer matches the one used at authorization, and the provider rejects
it. **This breaks both Google and GitHub sign-in for the duration of the
gap, not only GitHub** — Google's dual-registered redirect URI (Phase 0)
doesn't help, because the mismatch happens on a single attempt's two ends
disagreeing, not because either URI individually is unregistered. Take
fresh D1 bookmarks immediately before starting (see above), then:

1. **Merge this PR.** `production.yml` deploys with
   `NUXT_PUBLIC_BASE_URL=https://besidka.com`.
2. **The instant the deploy finishes, flip the redirect rule — edit it in
   place, do not delete-then-create** (a moment with both directions live
   is an infinite redirect loop). Reconfigure the existing rule directly:
   match `Hostname equals www.besidka.com`, action = dynamic 301 redirect
   to `concat("https://besidka.com", http.request.uri.path)` with
   **preserve query string** enabled (load-bearing: OAuth `code`/`state`
   params must survive the redirect), status **301**. Confirm the `www`
   DNS record stays **Proxied** (orange-cloud) — Single Redirects only
   fire on proxied traffic.
3. **Immediately after the flip**, swap both single-callback-URL OAuth
   apps — changing only the **host**, keeping the **path** exactly as
   currently registered (don't guess a new path; whatever's in the field
   today already works):
   - Better Auth's GitHub OAuth App (`github.com/settings/developers` →
     OAuth Apps): Authorization callback URL host → `besidka.com`,
     Homepage URL → `https://besidka.com`.
   - Nuxt Studio's GitHub OAuth App: Authorization callback URL host →
     `besidka.com` (keep its existing path, whether `/_studio` or
     `/__nuxt_studio/auth/github`), Homepage URL → `https://besidka.com`.

Expect any social sign-in attempted between steps 1 and 2 to fail — that
is this migration's one unavoidable outage, and it is expected and
self-resolving the moment the flip lands, not a sign of a bug. Keeping
steps 1-3 tight (minutes, ideally less) is what bounds it. Email/password,
2FA, and passkeys are unaffected throughout — only the social-provider
round trip depends on serving-origin/baseURL agreement.

### Phase 2 — verification (immediately after the flip)

```bash
curl -sI https://www.besidka.com/                  # expect 301 -> https://besidka.com/
curl -sI "https://www.besidka.com/chats/new?x=1"    # expect 301 preserving path+query
curl -sI https://besidka.com/                       # expect 200 from the Worker
curl -s https://besidka.com/robots.txt              # sitemap line uses apex
curl -s https://besidka.com/sitemap.xml | head       # <loc> uses apex
```

Then manually: sign in on `https://besidka.com` with email/password,
Google, GitHub, and a passkey; confirm Turnstile renders on sign-in/sign-up;
view page source for the apex canonical tag and JSON-LD `@id`s; load
`/_studio` (Nuxt Studio OAuth).

### Phase 3 — post-cutover (same day / following days)

- **Google Search Console**: if the property is a *Domain* property
  (`besidka.com`), it already covers both hosts — just submit
  `https://besidka.com/sitemap.xml`. If it's a URL-prefix property on
  `https://www.besidka.com`, add a new apex URL-prefix property, submit
  the apex sitemap there, and keep (don't delete) the www property to
  watch the 301s drain. Optionally use Search Console's Change of Address
  tool (www property → apex property).
- **Cleanup**: after ~1–2 weeks of confirmed-stable apex sign-ins,
  optionally remove the now-unused www callback URLs from Google/GitHub/
  Studio. Keeping them costs nothing and preserves a rollback path.
- **Rollback**, if anything goes wrong: re-flip the redirect rule (edit in
  place, back to the www-canonical direction), revert this PR (restores
  `NUXT_PUBLIC_BASE_URL=https://www.besidka.com`), redeploy — the www
  OAuth callbacks are still registered throughout, so auth recovers
  immediately. D1 bookmarks above exist in case anything unexpected
  touched data.
