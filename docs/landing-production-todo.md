# Landing page: production readiness to-do

CI auto-deploys the landing page in two phases:

- **Preview on PR open** — when a pull request is opened, Preview Build →
  Preview Deploy ships the branch to the **preview** Worker (the top-level
  block in `wrangler.jsonc`).
- **Production on merge to main** — when the PR merges, `production.yml`
  rebuilds and ships the **production** Worker (`env.production` in
  `wrangler.jsonc`).

Everything else — build, deploy, content SQL dump load on first request — is
automated. The steps below are **owner-only**: Cloudflare resources, account
plan, secrets, and content that the pipeline cannot create for you. Tick them
off in order; Phase 1 unblocks the PR preview, Phase 2 unblocks the production
deploy.

For how Studio editing works across environments, see
[`docs/landing-studio.md`](./landing-studio.md).

---

## Prerequisites / account-level

- [ ] Confirm the Cloudflare account is on the **Workers PAID** plan. Both the
  Analytics Engine (`ANALYTICS` binding) and the `swr: 3600` route cache on
  `/` (set in `nuxt.config.ts` `routeRules`) require it. A Worker that binds
  `analytics_engine_datasets` will **fail to deploy on the Free plan**.
- [ ] Enable **Cloudflare Web Analytics** in the dashboard (manual owner
  action).

---

## Phase 1 — Make the PREVIEW deploy succeed (before opening the PR)

The preview environment is the **top-level** block in `wrangler.jsonc`.

- [ ] Create the preview content D1 database (or reuse `besidka-content` if you
  prefer to share one):
  ```bash
  pnpm exec wrangler d1 create besidka-content-preview
  ```
  Paste the returned `database_id` into the preview `CONTENT_DB` block in
  `wrangler.jsonc`, replacing `"TO_BE_CREATED"`.
- [ ] Create the preview R2 bucket (bound as `R2_LANDING`):
  ```bash
  pnpm exec wrangler r2 bucket create besidka-landing-preview
  ```
- [ ] Upload the demo video to the preview bucket:
  ```bash
  pnpm run landing:video
  ```
  Then run the printed `wrangler r2 object put` commands.
- [ ] _(Optional)_ Enable Studio editing on the preview Worker:
  ```bash
  pnpm exec wrangler secret put STUDIO_GITHUB_CLIENT_ID
  pnpm exec wrangler secret put STUDIO_GITHUB_CLIENT_SECRET
  ```

---

## Phase 2 — Make the PRODUCTION deploy succeed (before/at merge to main)

The production environment is **`env.production`** in `wrangler.jsonc`.

- [ ] Create the production content D1 database:
  ```bash
  pnpm exec wrangler d1 create besidka-content
  ```
  Paste the returned `database_id` into the `env.production` `CONTENT_DB`
  block in `wrangler.jsonc`, replacing `"TO_BE_CREATED"`.
- [ ] Create the production R2 bucket (bound as `R2_LANDING`):
  ```bash
  pnpm exec wrangler r2 bucket create besidka-landing
  ```
- [ ] Upload the demo video to the production bucket (same `pnpm run
  landing:video` flow, targeting `besidka-landing`).
- [ ] Set the Studio production OAuth secrets:
  ```bash
  pnpm exec wrangler secret put STUDIO_GITHUB_CLIENT_ID --env production
  pnpm exec wrangler secret put STUDIO_GITHUB_CLIENT_SECRET --env production
  ```

---

## Content backlog (not deploy-blocking, but needed for a credible launch)

- [ ] **Legal pages**: fill in real privacy + terms content in
  `app/pages/(legal)/privacy.vue` and `app/pages/(legal)/terms.vue` — currently
  stubbed. The links are already wired.
- [ ] **Carousel mockups**: replace the placeholder SVG mockups
  (`public/preview-*.svg`) with real product screenshots.
- [ ] **Canonical host**: a Cloudflare redirect rule sends the apex
  (`besidka.com`) to `www.besidka.com`, so the canonical host is the **www
  subdomain**. The SEO modules plus robots/sitemap standardize on
  `https://www.besidka.com`, sourced from `NUXT_PUBLIC_BASE_URL`. Set
  `NUXT_PUBLIC_BASE_URL` to `https://www.besidka.com` in the production Worker
  env so sitemap, robots, and canonical URLs match the post-redirect host.
  (`nuxt.config.ts` `site.url` already defaults to `https://www.besidka.com`;
  the env var is the runtime override.)
