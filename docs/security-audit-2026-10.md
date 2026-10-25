# Security audit, 2026-10-24

**Status: fixes merged in #496 and deployed to production on 2026-10-25.**
This is a decision log: what the audit found, what was fixed, what was
deliberately left, and how each owner action was resolved.

## OWNER ACTIONS

All five were resolved on 2026-10-25:

- Items 1 and 2 are done. Both secrets are set on the production Worker, the
  Preview base config and the live `preview` Preview, and recorded in the
  local `.dev.vars*` files.
- Item 3 was checked, and the answer is yes. Preview Deploy run 39229739041,
  for Dependabot PR #454, migrated and deployed with the Cloudflare token. The
  repository has no Dependabot secrets, but the **organization** Dependabot
  secrets hold `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and
  `PROJECT_ACTIONS_GITHUB_TOKEN`, each scoped to one repository. They stay,
  because Dependabot PRs get previews through them. besidka/besidka#498 removes
  the dangerous path: the deploy job now runs pnpm, wrangler, the lockfile and
  `wrangler.jsonc` from the default branch, so dependencies chosen by a PR never
  run next to the token.
- Item 4 is done, with one combined rule. The zone is on the Free plan, which
  allows exactly one rate-limiting rule. That slot previously held "Leaked
  credential check" (`cf.waf.credential_check.password_leaked`, 5 per 10 s per
  IP, block). It now holds "API flood limit" instead:
  - Expression: `http.request.uri.path eq "/api/_evlog/ingest"`, or the path
    starts with `/__nuxt_content/`, `/api/v1/chats/` or `/api/v1/files/`.
  - Limit: 100 requests per 10 s per IP, then block for 10 s.

  Sign-in no longer needs the old rule: Better Auth now enforces its own limits
  (`/sign-in/email` 10 per 300 s per IP) and Turnstile. Zone rules do not cover
  `*.workers.dev` Preview hosts.
- Item 5: the owner decided to leave `preview_urls: true`. The `CONTENT_DB`
  re-import exposure below is accepted.

The original action list:

1. **Set `NUXT_STUDIO_AUTH_SESSION_SECRET` (random, 32+ characters) on the
   production Worker and on the preview base config BEFORE deploying this
   change.** Without it `server/middleware/00.studio-guard.ts` returns 404 for
   `/_studio` and `/__nuxt_studio/**` (fail closed). Production:
   `pnpm exec wrangler secret put NUXT_STUDIO_AUTH_SESSION_SECRET --env production`.
   Previews: add it to `.dev.vars.preview` and run
   `pnpm exec wrangler preview base-config secret bulk .dev.vars.preview --env production`,
   then push it to the live `preview` and any `pr-<n>` Previews (see
   `docs/cloudflare-previews.md`).
2. **Set `STUDIO_GITHUB_MODERATORS`** (who may publish through Studio) next to
   the existing `STUDIO_GITHUB_*` secrets. See `docs/landing-studio.md`.
3. **Check whether `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` also exist in
   the GitHub Dependabot secrets tab.** Dependabot PRs run workflows with that
   secret store; if the deploy credentials are there, a malicious dependency
   update reaches them.
4. **Add WAF / rate-limit rules** in Cloudflare for: `/api/_evlog/ingest`,
   `/__nuxt_content/*/query`, `/api/v1/chats/*`, `/api/v1/files/*`. The code
   fixes below cap payload size and shape, not request volume.
5. **Decide on production `preview_urls`.** The production env in
   `wrangler.jsonc` sets `preview_urls: true`. Superseded versioned URLs keep
   serving old builds bound to the same bindings, so an old version can re-import
   `CONTENT_DB`. Turn it off, or accept the exposure explicitly.

### Open policy questions (not decided, not changed)

- **Trusted providers.** `accountLinking.trustedProviders` is
  `['google', 'github', 'email-password']`, which links accounts by email
  without a local verification step. `docs/auth-security.md` (the Google
  `accountId` section) describes the current linking behavior as intended; the
  audit asks whether `google` and `github` should stay trusted.
- **Passkey enrollment without password step-up.** A fresh session can enroll a
  passkey without re-entering the password, so a stolen session cookie becomes a
  durable credential. Decide whether enrollment needs step-up.

## The run

- Tool: the `security-audit` skill (installed in a previous PR, `#491`).
- Artifacts are **outside the repo**: `~/security-audit-skill/besidka/run-1/`.
- Profile: standard. **Source-only**, no live probing, so every record is
  `needs_validation`; none is a confirmed exploit.
- Outcome: 21 leads and 2 rejected. One unit deferred: D1 Time Travel restore
  reviving revoked sessions and expired or revoked shares (a restore rolls back
  `sessions` and `chat_shares` rows; no code fix exists, so it is a runbook note
  for the restore procedure in `CLAUDE.md`).

## Fixed

| Item | Where | What changed |
| --- | --- | --- |
| Auth rate limiting could be off in prod | `server/utils/auth.ts` | `rateLimit.enabled` is explicit and is disabled only when `CI === 'true'` and the e2e test hooks are both set: `!import.meta.dev && !(isCiEnvironment && e2eTestHooksEnabled)`, so an e2e flag alone never turns it off |
| Reset left old sessions alive | `server/utils/auth.ts` | `emailAndPassword.revokeSessionsOnPasswordReset: true` |
| MDC `v-bind` / directive injection from Studio content | `shared/utils/mdc/rehype-strip-directive-props.ts`, `nuxt.config.ts` (`mdc.rehypePlugins`) | Rehype plugin strips `v-*`, `@*`, `on*` and `innerHTML` / `outerHTML` / `srcdoc` / `formaction` props from every hast element, after `rehype-raw`; a single leading `:` (plus an optional `.` / `^`) is removed before matching, so `:v-bind`, `:onclick` and `:innerHTML` go too while plain `:prop` bindings survive (remark-mdc emits `:primary="{...json}"` for YAML block props holding objects, arrays, numbers and booleans, which the landing and guide components depend on; `@nuxtjs/mdc` `validateProp` and `propsToData` bind `:name` to that one prop only). `v-slot` / `v-slot:<name>` is the single exemption, and only on `template` (and `component-slot`, which MDC renames to `template`) elements, so MDC named slots (`#title`) keep working; `v-bind`, `v-model:*`, `v-html`, `v-on` and the rest are still stripped there. It also walks the `content` fragment hast keeps for `<template>`, so props nested inside a `<template>` are stripped too. It is registered for Nuxt Content as `{ src, instance }` under `mdc.rehypePlugins` in `nuxt.config.ts` |
| Unauthenticated evlog client ingest could pollute Axiom schema and compliance datasets | `server/utils/evlog-drains.ts`, `server/plugins/00.evlog-client-ingest-guard.ts` | Client-sourced events (`source: 'client'`) are confined: `audit` and `consent` keys dropped; a client `attributes` object and a short scalar `action` stay addressable as-is, and every other unknown key moves under `attributes.client`; audit and consent drains skip client-sourced events |
| Upload size and name abuse | `server/utils/files/upload-request.ts`, `server/api/v1/files/{upload.put,create.post}.ts` | The body is read through a capped stream: a 413 is returned as soon as the running total exceeds the remaining quota, so `Content-Length` is optional (when present it is validated and checked up front); invalid or over-255-char `x-filename` rejected; type check moved before the body read |
| Retention cleanup starved by one batch | `server/plugins/file-retention-cleanup.ts` | Runs multiple batches within the runtime budget; stops on zero deletions; logs `batchCount` |
| Unbounded chat message payloads | `server/utils/chats/request-schema.ts` | Caps: text 200,000 chars per part and 200,000 chars aggregate across all text parts, 50 parts, file `url` 2048, filename and media type 255, message id 128 |
| Research start accepted `z.any()` parts | `server/api/v1/chats/[slug]/research/index.post.ts` | Uses `userMessagePartsSchema` and the id cap |
| One bad user poisoned the search sweep | `server/utils/search/sweeper.ts`, `server/utils/search/text.ts` | Per-user backfill wrapped in try/catch with logging; `extractMessageSearchText` skips null parts and non-string `text` instead of throwing |
| Expired share slug reused on re-share | `server/api/v1/chats/[slug]/share/index.post.ts` | Re-sharing a share whose `expiresAt` has passed rotates the slug (new ULID) in the upsert, so the old link stays dead |
| Non-http(s) research links | `app/composables/research-links.ts` | `openResearchLink` returns early unless `isHttpUrl(url)` |
| Push subscription abuse | `server/utils/push.ts`, `server/api/v1/push/{subscribe,unsubscribe}.post.ts` | Limits: endpoint 2048, `p256dh` 128, `auth` 64, 20 subscriptions per user (oldest by `lastSeenAt` pruned); endpoint must be `https:` |
| Studio guard | `server/middleware/00.studio-guard.ts`, `shared/utils/safe-redirect-path.ts` | Matches both the raw and the percent-decoded path, so encoded variants of `/_studio` and `/__nuxt_studio/**` cannot bypass it. Fail closed with 404 on an empty or md5-of-empty session secret (not in dev); `/__nuxt_studio/ipx/**` rejects absolute-URL and scheme resource ids and adds `Content-Security-Policy: sandbox; default-src 'none'` and `X-Content-Type-Options: nosniff`; `/_studio?redirect=` is only honored for a safe same-origin path, otherwise a 302 to `/_studio` |
| Preview artifact could overwrite checked-out files | `.github/workflows/preview-deploy.yml`, `.github/workflows/README.md` | `preview-drizzle` artifact downloads into `.drizzle/`, not the repo root |
| `/` cache could grow without bound | `nuxt.config.ts` (`$production.routeRules`) | `'/': { cache: { swr: false, maxAge: 3600, name: buildId } }`. Nitro writes `swr` entries to KV with no TTL and the key includes the query string, so `?x=<random>` created immortal entries |
| Browser caching of `/` | `server/plugins/landing-cache-control.ts` | Rewrites the browser `cache-control` for `/` to `no-cache` while the Nitro KV route cache keeps its 1h TTL; relies on h3 v1 `event.node.res.setHeader` and is guarded by a drift test (`tests/unit/server/plugins/landing-cache-control.spec.ts`) |
| Icon route as an outbound fetcher | `nuxt.config.ts` (`icon.fallbackToApi`) | `'client-only'`; see `docs/nuxt-icon-collections.md` |

Tests added or extended for each row are registered in
`scripts/test-affected-check.mjs`.

## Not fixed (accepted or deferred)

- **Content DB re-import.** Studio publishing writes through `CONTENT_DB`; a
  superseded Worker version with a live URL can re-import content. Tied to the
  `preview_urls` decision above.
- **Content query amplification.** `/__nuxt_content/*/query` builds `LIKE` / `OR`
  SQL from the client query. Mitigation is a WAF rule (owner action 4), not code.
- **Icon KV key cardinality.** `serverBundle.remote` caching still creates a KV
  key per distinct icon name requested server-side.
- **`preview-deploy.yml` tooling comes from the default branch.** Fixed later in
  besidka/besidka#498: default-branch checkout and install, artifact integrity
  and migration-match checks, SHA-pinned third-party actions. See
  `.github/workflows/README.md` "Security Model".
- **D1 Time Travel restore** reviving revoked sessions and shares (deferred unit).

## Lesson: `NODE_ENV` is not set inside the Worker

Better Auth decides `isProduction` from `NODE_ENV`. In a Cloudflare Worker that
variable is not reliably defined, so any Better Auth default keyed on
`isProduction` (rate limiting among them) can silently take its development
value in production. Never rely on those defaults: set the option explicitly from
`import.meta.dev` or a config flag, as `rateLimit.enabled` now does. Audit other
`isProduction`-gated Better Auth defaults when upgrading.
