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
  OAuth callback is `/__nuxt_studio/auth/github` on a single host and does
  not go through `oAuthProxy`.

## Turnstile on Previews

Previews run the **real** Turnstile widget (owner decision 2026-10-13), but a
**dedicated** one: "Besidka (preview)", sitekey `0x4AAAAAAEFM-2wD0PMvdy4q`
(public by design). Previews inherit `NUXT_TURNSTILE_ENFORCED: true` from
`env.production`, so `env.production.previews.vars` sets
`NUXT_PUBLIC_TURNSTILE_SITE_KEY` to that preview sitekey. Production keeps its
own widget (`0x4AAAAAAEFMAZiwbUuiy0qi`) and previews do not share it.

A Turnstile sitekey and secret are a pair. The previews secret in
`.dev.vars.preview` (pushed with `wrangler preview base-config secret bulk`)
must be the secret of the **"Besidka (preview)"** widget. A mismatched pair
(for example the production sitekey with the preview secret, which is what PR
#444 shipped, or a test sitekey with a real secret) lets the widget itself
render and pass in the browser, but `siteverify` rejects the token, so every
sign-in, sign-up and reset-password on a Preview returns 403 "Captcha
verification failed". The old `besidka-preview` Worker had the test key and no
enforcement, so captcha was effectively off there.

Server side, `allowedHostnames` accepts the wildcard host set in
`NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS`, so `pr-<n>-besidka...` tokens pass the
hostname check (details in `docs/auth-security.md`).

Dashboard hostnames: the "Besidka (preview)" widget lists
`chernenko.workers.dev`. Cloudflare's hostname management docs state that
wildcards are not supported, but "adding a hostname automatically authorizes
all of its subdomains" and the widget "will work on that exact hostname and
all of its subdomains"
(<https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/>).
`pr-<n>-besidka` is a single label, so `besidka.chernenko.workers.dev` would
not cover it; the one entry that covers `preview-besidka.chernenko.workers.dev`,
every `pr-<n>-besidka.chernenko.workers.dev` and deployment hosts is
`chernenko.workers.dev`. Registering each `pr-<n>` host is not viable (10
hostnames per widget on the free plan).

The production widget `0x4AAAAAAEFMAZiwbUuiy0qi` lists only `besidka.com`. It
briefly also carried `chernenko.workers.dev` while previews wrongly used it;
that entry is removed once this change is deployed, which is the intended end
state. Using a dedicated preview widget means production never has to authorize
a `workers.dev` host.

Testing: automation always fails the real challenge, so a human must test
sign-in on Previews. CI e2e is unaffected: it runs `wrangler dev` with no
`--env` against a `.dev.vars` that sets no Turnstile secret, so
`getCaptchaOptions()` returns `null` and the captcha plugin is not registered.
The Preview sitekey lives only under `env.production.previews.vars`.

Setting Cloudflare's always-pass test secret on a single Preview
(`pnpm exec wrangler preview secret put NUXT_TURNSTILE_SECRET_KEY --name
pr-<n> --env production`) is not recommended; use the real widget. If such an
override was applied, remove it with `pnpm exec wrangler preview secret delete
NUXT_TURNSTILE_SECRET_KEY --name pr-<n> --env production` so the Preview falls
back to the base-config secret.

## Web Analytics on Previews

`NUXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` is the Cloudflare Web Analytics
site token for `besidka.com`. It is set **only** in `env.production.vars` and is
explicitly set to an empty string in `env.production.previews.vars`, so a
Preview never inherits it. An empty token makes the consent-gated loader do
nothing, so a Preview never requests the beacon and never sends page views or
performance data to the production site in Cloudflare's dashboard, even when a
tester allows the `analytics` category. Local development leaves it empty for
the same reason.

If this ever needs verifying on a Preview, check the page source and the network
panel for `static.cloudflareinsights.com` after allowing `analytics`; there must
be none. How the beacon is loaded, why it must stay behind consent and the
dashboard setting it depends on are in
[cookie-consent.md](cookie-consent.md#cloudflare-web-analytics).

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
| PR build succeeds (same-repo) | `preview-deploy.yml` | Check out the default branch, drop its `.drizzle/`, download the PR artifacts into `.output/` and `.drizzle/`, verify nothing else changed, install with `pnpm` from the default branch, migrate preview D1s, then `wrangler preview --env production --name pr-<n> --message <PR url> --json`; URLs read from the JSON (`.preview.urls[0]`, `.deployment.urls[0]`) with the deterministic `pr-<n>-besidka` URL as fallback; PR comment and commit status |
| PR closed (merged or not) | `preview-cleanup.yml` | `wrangler preview delete --name pr-<n> --env production --skip-confirmation`; missing Preview counts as success |
| Push to `main` | `production.yml` → `deploy-preview` | Migrate preview D1s, then `wrangler preview --env production --name preview --message main@<sha>` from the `preview-build` artifact |

`preview-deploy.yml` holds the production-capable `CLOUDFLARE_API_TOKEN`
(Previews live on the production `besidka` Worker), so it never runs PR code
or PR-selected tooling. Like `preview-cleanup.yml`, it checks out the default
branch (`persist-credentials: false`) and installs `pnpm`, `wrangler`,
`wrangler.jsonc`, `package.json` and the lockfile from there. The only inputs
that come from the PR are the `preview-build` artifact (extracted into
`.output/`) and the `preview-drizzle` artifact (extracted into `.drizzle/`
after `rm -rf .drizzle` removed the default branch's copy, so the applied
migration set is exactly the PR's). A step before `pnpm install` fails the job
if `git status --porcelain --ignored --untracked-files=all` shows any change
outside those two directories. Migrations and deploy run through the plain
`pnpm exec wrangler`; no third-party action ever holds the token, and
third-party actions in secret-bearing workflows are pinned to commit SHAs. No
actor filter is needed: Dependabot and other bot PRs get previews through the
same path (Dependabot-actor runs do receive the org secrets, verified on run
39229739041). See `.github/workflows/README.md` → "Security Model".

A PR that changes `wrangler.jsonc` still deploys with the default branch's
`wrangler.jsonc`. The deploy warns when the PR touches it (`config-drift`
step), the PR comment gets a `Wrangler config` row and the commit status reads
"Deployed (default-branch wrangler.jsonc)".

`preview-cleanup.yml` triggers on `pull_request_target` so it has secrets. This
is safe because it checks out only the default branch and never PR code, and it
runs only for same-repository PRs (`head.repo.full_name == github.repository`).
It has no `branches` filter, so it runs for every closed PR whatever its base:
umbrella children and stack layers run it too and find no Preview to delete,
and a PR retargeted after it deployed still gets its Preview removed. An
unfiltered run costs about one to two runner minutes, which is why it is not
filtered.

Grouped PRs (umbrella parent with children, native GitHub stacks) only ever get
one Preview, `pr-<n>`, for the parent or the top layer. `preview-build.yml`
builds only a PR that is not part of a stack or is its top layer, and
`preview-deploy.yml` exits before deploying when the build run has no
`preview-build` artifact. Umbrella children (base is not `main`) never trigger
the build at all. See `docs/stacked-prs.md` for the full per-workflow table.

Deploy/cleanup race: `preview-cleanup.yml` runs in its own concurrency group
(`preview-cleanup-<n>`, `cancel-in-progress: false`), so a deploy queued after
the PR closes cannot cancel a delete mid-flight. `preview-deploy.yml`
reads the PR state (`gh api repos/<repo>/pulls/<n> --jq .state`) before
migrating/deploying and skips all deploy, comment and status steps when the PR
is not `open`. After `wrangler preview` succeeds it checks again; if the PR
closed during the deploy, it runs the same
`wrangler preview delete` (missing Preview counts as success) and skips the PR
comment and success status.

Remaining window: a preview-deploy run cancelled (`cancel-in-progress` by a
newer build) after `wrangler preview` finished but before its post-deploy PR
state check ran, while the PR closed and cleanup already ran in between, can
leave an orphaned Preview. Delete it by hand with
`pnpm exec wrangler preview delete --name pr-<n> --env production --skip-confirmation`.
Previews also auto-expire at the 500-per-Worker limit.

## Skipping builds

`preview-build.yml` skips the heavy `build` job when a commit changes only
ignorable paths, but it never skips without a build to point at.

The original check diffed only `HEAD^..HEAD`. That has a trap: the workflow's
concurrency group cancels a superseded run (`cancel-in-progress: true`), and a
build can also fail. If code commit A was cancelled or failed and a docs-only
commit B arrived next, `A..B` looked docs-only, the build was skipped, and the
PR never received artifacts or a preview for A's code. The skipping run also
had no artifacts for `preview-deploy.yml` to download.

Current behavior, implemented in `scripts/ci/resolve-preview-build-source.mjs`
(job `check-latest-commit`, output `should-skip`, `source-run-id`,
`source-sha`):

1. List successful `preview-build.yml` runs on the PR head branch, keep the
   ones belonging to this PR (by PR number; runs without
   `pull_requests` match head repo + branch), and exclude the current
   run.
2. Walk them newest first. A candidate qualifies when both `preview-build`
   and `preview-drizzle` exist with `expired: false` and its `head_sha` is an
   ancestor of the PR head. A previous relay run qualifies too because it
   re-uploads the same artifacts.
3. Diff the candidate's `head_sha` against the head with `--no-renames` (a
   rename out of a built path must not look ignorable). If every changed path
   is ignorable, or nothing changed (a re-run of the same SHA), the run skips
   and records the source. Otherwise it builds.

Only successful runs are candidates; cancelled and failed runs never become the
baseline even when they uploaded artifacts. A successful run that built nothing
(for example a skipped non-top stack layer) has no artifacts and is passed over,
and a PR with no earlier built commit falls through to a full build
(`tests/unit/scripts/resolve-preview-build-source.spec.ts` covers all three).

Any failure (no candidate, artifacts expired, force-push or rebase making the
source a non-ancestor, API or git error) resolves to a normal build. Because
the diff base is the last built commit and not the previous commit, a docs
commit on top of an unbuilt code commit now sees the code in range and builds.

When skipping, `reuse-build` downloads both artifacts from `source-run-id` and
re-uploads them under the same names and `retention-days: 1`, so the skipping
run looks like a build run to its consumers: `preview-deploy.yml`
re-deploys the last built code. This also heals a preview whose deploy was
cancelled by a newer `workflow_run`. Each relay refreshes the one-day artifact
clock; once the source artifacts have expired the next run builds.

Why it lives in `preview-build.yml`: `preview-deploy.yml` runs on
`workflow_run`, and GitHub always executes the default-branch copy of such
workflows, so a change to it cannot be exercised from a PR. A `pull_request`
workflow runs from the PR branch, so the resolver and relay are testable there
and the deploy workflow needs no change.

The ignored-paths list exists twice because `on.pull_request.paths-ignore`
cannot be shared with a script: `IGNORED_PATH_PATTERNS` in the resolver and the
workflow list. `tests/unit/scripts/resolve-preview-build-source.spec.ts` fails
if they drift. Do not add `**/*.md`: `content/*.md` is the landing page source.
The earlier inline list also carried `.ai/**` (no such directory) and lacked
`.agents/**`, `.agent/**`, `.cursor/**`, `.windsurf/**`, `.gitignore` and
`skills-lock.json`; the resolver now matches the workflow exactly.

Dry run against a real PR (read-only, needs `gh` auth and the commits locally):

```bash
node scripts/ci/resolve-preview-build-source.mjs --dry-run --pr=<n> \
  --head-ref=<branch> --head-sha=<sha> --current-run-id=0
```

Known limits: `.github/**` and `scripts/**` are ignored paths, so a PR that
only changes this machinery gets no Preview Build run and cannot exercise it;
the first real exercise is the next code PR after merge. A source run whose
artifacts expire between selection and download fails `reuse-build`; re-run
the workflow to build.

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
  on.** `wrangler preview` alone does not toggle it. On 2026-10-12 the flag
  was turned on for the `besidka` Worker through the script subdomain API
  (`POST /accounts/<id>/workers/scripts/besidka/subdomain
  {"enabled":false,"previews_enabled":true}`), and
  `wrangler deploy --env production` keeps it on via `preview_urls: true`.
  If the flag is ever off, CI falls back to the deterministic
  `pr-<n>-besidka` URL for the PR URL, emits a `::warning::`, and renders the
  deployment URL as `n/a` in the PR comment.
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
- **`wrangler tail` is not supported for Previews.** Previews do not drain to
  Axiom by design: they carry no `NUXT_AXIOM_*` vars or secrets (same as the
  old `besidka-preview` Worker), so evlog ships nothing there. Use Workers
  Observability logs in the Cloudflare dashboard (observability is enabled in
  `previews`).
- **All Previews share one set of preview resources** (`besidka-preview` D1,
  `besidka-consent-preview`, KV, R2). Concurrent PRs see each other's data and
  a destructive migration on one PR affects every Preview. Same as before the
  migration.
- **A PR that changes `wrangler.jsonc` previews with the default branch's
  config until it merges.** Bindings, vars and compatibility settings from the
  PR are not in its Preview; binding and database ids always come from
  `main`, which bounds what PR code can reach. The long-lived `main` Preview
  (`production.yml` → `deploy-preview`) is where config changes are first
  exercised.
- **PR artifacts still run on the Preview Worker** with the preview
  secrets and bindings, and PR migrations hit the shared preview D1. Both stay
  within preview resources; neither executes on the CI runner.
- **Passkeys registered on the old host are gone** (see the auth section).

## Bootstrap PR hazard

`preview-deploy.yml` runs from `workflow_run`, which always executes the
workflow file on the **default branch**. The PR that introduces this migration
therefore still runs `main`'s old `versions upload --preview-alias` flow, so its
"Preview Deploy" check and PR comment are not representative of the new
behavior. The first PR opened after merge is the real test. The same applies
to `preview-cleanup.yml`: it does nothing for PRs closed before it exists on
`main`.

After PR #430's runs it was checked on 2026-10-12 that no stray
`besidka-local` Worker exists (`wrangler deployments list --name
besidka-local` returns code 10007 "This Worker does not exist"). Re-check that
way if any old-style run executes.

## Owner manual steps

These cannot be automated from the repo.

1. Done 2026-10-12. OAuth apps moved to the long-lived host
   `https://preview-besidka.chernenko.workers.dev` (homepage URL, origin and
   callback):
   - GitHub OAuth app "Besidka (preview)" (org `besidka`):
     `/api/auth/callback/github`
   - Google OAuth client "Preview" (project `chernenko-chat`):
     `/api/auth/callback/google`; the stale `files-besidka-preview` entries
     were left in place
   - GitHub OAuth app "Besidka Nuxt Studio (Preview)" (personal account):
     `/__nuxt_studio/auth/github`
2. Done 2026-10-12. Preview secrets set via the base-config runbook above.
3. After a few PRs and a `main` deploy verify sign-in (password and OAuth),
   chat streaming and file upload on a PR Preview, then delete the old
   `besidka-preview` Worker in the Cloudflare dashboard. D1/KV/R2 resources are
   shared with the new Previews and must **not** be deleted with it.

## Revert criteria

Revert to the `besidka-preview` Worker if Workers Previews proves unusable
for this app: OAuth through the proxy cannot be made to work, Preview
deployments are unreliable enough to block merges, or the beta changes in
a way that removes `preview` secrets or bindings handling. Reverting means
restoring the previous `preview-deploy.yml` and
`production.yml` from git history, deleting `preview-cleanup.yml`, and setting
the top-level `wrangler.jsonc` back to `besidka-preview` with
`workers_dev: true`.
