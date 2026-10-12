# Cloudflare Previews: why we replaced the `besidka-preview` Worker

Pull-request and `main` previews now run on Cloudflare's official
[Workers Previews](https://developers.cloudflare.com/workers/previews/) (open
beta) instead of a second Worker named `besidka-preview`. There is one Worker,
`besidka`; a Preview is a named, independently updatable copy of it with its
own vars and bindings.

## Why we migrated

The old setup used a separate Worker (`besidka-preview`, the top level of
`wrangler.jsonc`):

- PR previews were `wrangler versions upload --preview-alias pr-<n>` versions.
- On merge, `production.yml` found the PR's version (`versions list` + `jq`)
  and `versions deploy`-ed it to `besidka-preview`, with a fallback job that
  rebuilt and deployed when no alias existed (direct pushes, stacked merges
  where only the last commit's PR is consulted, cancelled uploads).
- Two Workers meant two sets of secrets and two configs to keep in sync.

Workers Previews removes the promotion machinery entirely: every PR gets its
own Preview, the long-lived `preview` is redeployed from `main` on every merge,
and deleting a Preview is one command. It is the supported path for this use
case, which is the reason for moving off the version-alias workaround.

## Configuration shape

`wrangler.jsonc` after the migration:

- **Top level is `besidka-local`.** Local development only, never deployed
  (`workers_dev: false`, `preview_urls: false`, `NUXT_PUBLIC_BASE_URL` is
  `http://localhost:3000`). It still points at the existing preview
  resources (`besidka-preview` D1, `besidka-consent-preview`, KV, R2), so
  `wrangler d1 migrations apply DB --remote` and `... CONSENT_DB --remote`
  with no `--env` keep migrating the preview databases. The CI migration steps
  rely on this and are intentionally unchanged.
- **`env.production`** is the real Worker, `besidka`.
- **`env.production.previews`** holds the preview-only vars and bindings:
  `NUXT_PUBLIC_BASE_URL`, `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS`, the search
  cost rates, feature toggles, and the preview D1/KV/R2/analytics/ratelimit/
  email bindings.
- **`env.production.preview_urls` is `true`.** Previews on `workers.dev` need
  it.

Rules for the `previews` block:

- **No inheritance.** A Preview does not inherit production's bindings, vars
  or secrets. Anything a Preview needs must be listed in `previews`, including
  bindings that look identical to production's.
- **Secrets are never in the file.** Only non-secret vars and binding
  definitions belong here.
- **No crons, queues or routes.** See the trade-offs below.
- Do not point a Preview at production data. The block deliberately lists the
  preview D1 databases, bucket and KV namespace.
- **The top-level `besidka-local` block is never deployed.** A bare
  `wrangler deploy` (no `--env`) would create a stray `besidka-local` Worker,
  so deploy with `pnpm run deploy` (long-lived preview) or
  `pnpm run deploy:prod`. The top-level `triggers.crons` remain only for local
  `wrangler dev --test-scheduled`.

## URL scheme

| URL | Meaning |
|-----|---------|
| `https://pr-<n>-besidka.chernenko.workers.dev` | Stable PR Preview, always the latest deployment |
| `https://<deployment-id>-besidka.chernenko.workers.dev` | One specific deployment, permanent while it exists |
| `https://preview-besidka.chernenko.workers.dev` | Long-lived Preview named `preview`, redeployed from `main` |

`workers.dev` Preview URLs get `X-Robots-Tag: noindex` from Cloudflare, so they
stay out of search indexes (see `docs/seo.md`).

Limits on the Paid plan: 500 Previews per Worker, 100 deployments per Preview;
the oldest are deleted automatically.

## Auth: why `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS` exists

Better Auth only accepts requests whose host is in its `allowedHosts` list, and
that list is derived from `NUXT_PUBLIC_BASE_URL`. A Preview's base URL is the
long-lived host (`https://preview-besidka.chernenko.workers.dev`), but a PR
Preview is served from `pr-<n>-besidka...` and a deployment URL from
`<deployment-id>-besidka...`. Without help every non-`preview` host would fail
the host check.

The preview vars therefore set
`NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS=*-besidka.chernenko.workers.dev`, which
makes Better Auth accept every Preview host.

OAuth sign-in on PR Previews goes through the long-lived host: `oAuthProxy`
(`productionURL` is `NUXT_PUBLIC_BASE_URL`) sends the provider callback to
`preview-besidka` and forwards the session back to the PR host. That is why
the OAuth apps only need the one callback host (see owner steps).

Consequences:

- **Passkeys work only on `https://preview-besidka.chernenko.workers.dev`.**
  The WebAuthn RP ID is that exact hostname; `pr-<n>-besidka...` and
  deployment hosts are different hostnames and the browser rejects the ceremony
  (same limitation as described in `docs/auth-security.md`). Passkeys
  registered on the old `besidka-preview.chernenko.workers.dev` host stop
  working because the RP ID changed.
- **Nuxt Studio sign-in works only on the long-lived host.** Its GitHub
  OAuth callback is `/_studio` on a single host and does not go through
  `oAuthProxy`.

## Secrets runbook

Secrets are **not** inherited from production and **not** managed by CI. CI
never handles runtime secret values.

Set them once for all future Previews from the local, gitignored
`.dev.vars.preview` file:

```bash
pnpm exec wrangler preview base-config secret bulk .dev.vars.preview --env production
```

Base-config secrets apply to Previews created afterwards. Existing Previews
keep what they had, so after rotating a value push it to each live Preview
explicitly:

```bash
pnpm exec wrangler preview secret bulk .dev.vars.preview --name preview --env production
pnpm exec wrangler preview secret bulk .dev.vars.preview --name pr-<n> --env production
```

Rules:

- `--env production` is required on every `wrangler preview` command (deploy,
  delete, secret). Without it wrangler targets the top-level `besidka-local`
  config.
- Never print secret values, never paste them into issues, PRs or logs, and
  never commit `.dev.vars.preview`.
- The file should contain the runtime secrets only (encryption keys, Better
  Auth secret, OAuth client secrets, `STUDIO_GITHUB_*`, VAPID private key,
  Turnstile secret, maintenance token, email/IndexNow keys as applicable).
  Public values belong in `env.production.previews.vars`.
- Changing `NUXT_ENCRYPTION_KEY` or `NUXT_BETTER_AUTH_SECRET` makes the
  data they protect undecryptable (see `docs/auth-security.md`); the shared
  preview D1 is affected for every Preview at once.

## CI flow

| Event | Workflow | What happens |
|-------|----------|--------------|
| PR build succeeds (same-repo) | `preview-deploy.yml` | Migrate preview D1s, then `wrangler preview --env production --name pr-<n> --message <PR url> --json`; URLs read from the JSON (`.preview.urls[0]`, `.deployment.urls[0]`) with the deterministic `pr-<n>-besidka` URL as fallback; PR comment and commit status |
| Maintainer comments `/deploy-preview` on a fork PR | `preview-fork-deploy.yml` | Same deploy for the fork's build artifact |
| PR closed (merged or not) | `preview-cleanup.yml` | `wrangler preview delete --name pr-<n> --env production --skip-confirmation`; missing Preview counts as success |
| Push to `main` | `production.yml` → `deploy-preview` | Migrate preview D1s, then `wrangler preview --env production --name preview --message main@<sha>` from the `preview-build` artifact |

`preview-cleanup.yml` triggers on `pull_request_target` so it has secrets for
fork PRs too. This is safe because it checks out only the default branch and
never PR code.

Local equivalents: `pnpm run deploy` builds and updates the long-lived
`preview`; `pnpm run deploy:prod` deploys production.

## Gotchas

- **`wrangler preview --json` stdout is not pure JSON.** Wrangler first prints
  asset-upload progress lines (`Building list of assets...`, `+ /_nuxt/...`,
  `Uploaded 15 of 45 assets`), then a blank line, then the pretty-printed JSON
  object starting at a line that is exactly `{`. CI extracts it with
  `sed -n '/^{/,$p'` into `preview-clean.json` before running `jq`, and fails
  with `::error::` if `.preview.id` is missing.
- **Never print the preview JSON to logs.** It contains `author_email` and
  every var under `.deployment.env`. The workflows redirect it to a file in
  `$RUNNER_TEMP` and only read individual fields with `jq`.
- **`.preview.urls` and `.deployment.urls` are empty arrays until the
  Worker-level `previews_enabled` (workers.dev previews) subdomain flag is
  on.** `wrangler deploy --env production` sets that flag from
  `preview_urls: true`; `wrangler preview` alone does not. After this
  migration merges, the first production deploy enables it. Until then CI
  falls back to the deterministic `pr-<n>-besidka` URL for the PR URL, emits a
  `::warning::`, and renders the deployment URL as `n/a` in the PR comment.
- **wrangler 4.149 moved esbuild 0.28.1 -> 0.28.2 transitively** (an optional
  vite peer). This is relevant to the pinned `vite.build.cssMinify: 'esbuild'`
  (see [`vite-css-minify.md`](./vite-css-minify.md)); the production build was
  verified locally after the bump.

## Accepted trade-offs

- **Cron triggers do not run on Previews.** The sweeps in `server/plugins/*`
  that are driven by scheduled triggers (file retention cleanup, deep-research
  job sweep, message-search index sweep, push-subscription sweep, landing cache
  refresh) never fire on a Preview, so their `*_ENABLED` vars in `previews`
  are inert there. Test them locally or in production, or trigger the
  maintenance endpoints by hand. Queue consumers do not run on Previews either.
- **`preview_urls: true` also applies to production.** Production versions
  now get `workers.dev` version-preview URLs. They serve production
  bindings, so treat them as production-grade access. Verified 2026-10-12:
  `https://<version-id-prefix>-besidka.chernenko.workers.dev/` answers 200
  only for a real version id (a random prefix returns 404), sends
  `X-Robots-Tag: noindex`, and canonicalizes to `https://besidka.com/`.
  Better Auth rejects the host (production sets no additional allowed hosts)
  and falls back to the apex base URL. Accepted, matching princess. The
  Worker-level flag behind this is the script subdomain setting
  `previews_enabled` (`GET/POST /accounts/<id>/workers/scripts/besidka/subdomain`);
  turning it off disables every Preview URL as well.
- **`wrangler tail` is not supported for Previews.** Use Axiom (evlog) and the
  dashboard for preview diagnostics.
- **All Previews share one set of preview resources** (`besidka-preview` D1,
  `besidka-consent-preview`, KV, R2). Concurrent PRs see each other's data and
  a destructive migration on one PR affects every Preview. Same as before the
  migration.
- **Passkeys registered on the old host are gone** (see the auth section).

## Bootstrap PR hazard

`preview-deploy.yml` runs from `workflow_run`, which always executes the
workflow file on the **default branch**. The PR that introduces this migration
therefore still runs `main`'s old `versions upload --preview-alias` flow, so its
"Preview Deploy" check and PR comment are not representative of the new
behavior. The first PR opened after merge is the real test. The same applies
to `preview-cleanup.yml`: it does nothing for PRs closed before it exists on
`main`.

## Owner manual steps

These cannot be automated from the repo.

1. Move OAuth callback URLs to the long-lived host
   `https://preview-besidka.chernenko.workers.dev`:
   - Preview GitHub OAuth app: `/api/auth/callback/github`
   - Google OAuth client (add alongside existing entries): `/api/auth/callback/google`
   - Studio GitHub OAuth app: `/_studio` (see `docs/landing-studio.md`)
2. Set the preview secrets (runbook above) before the first Preview deploy,
   otherwise Previews boot without them.
3. After a few PRs and a `main` deploy verify sign-in (password and OAuth),
   chat streaming and file upload on a PR Preview, then delete the old
   `besidka-preview` Worker in the Cloudflare dashboard. D1/KV/R2 resources are
   shared with the new Previews and must **not** be deleted with it.

## Revert criteria

Revert to the `besidka-preview` Worker if Workers Previews proves unusable
for this app: OAuth through the proxy cannot be made to work, Preview
deployments are unreliable enough to block merges, or the beta changes in
a way that removes `preview` secrets or bindings handling. Reverting means
restoring the previous `preview-deploy.yml`, `preview-fork-deploy.yml` and
`production.yml` from git history, deleting `preview-cleanup.yml`, and setting
the top-level `wrangler.jsonc` back to `besidka-preview` with
`workers_dev: true`.
