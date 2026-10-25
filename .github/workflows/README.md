One production deployment at a time. A new merge queues behind the running
deploy (newest pending run wins) instead of cancelling it, because a cancel
between `migrations apply` and the Worker deploy can leave production with a
new schema and old code.

# GitHub Actions Workflows

CI/CD workflows for building, testing, and deploying Besidka to Cloudflare Workers.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      WORKFLOW ARCHITECTURE                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Pull Request (same-repo)                                        │
│  ├─ preview-build.yml (pull_request, unprivileged)               │
│  │   ├─ gate (PR open? build or reuse?)                          │
│  │   ├─ static | unit | integration | build (full suite)         │
│  │   ├─ e2e x3 shards (after build)                              │
│  │   └─ summary (PR comment + pending deploy status)             │
│  │                                                               │
│  ├─ scripts-check.yml (only when scripts/ or their tests change) │
│  │                                                               │
│  └─ preview-deploy.yml (workflow_run, privileged)                │
│      ├─ Checkout default branch (tooling, wrangler.jsonc)        │
│      ├─ Download artifacts into .output/ and .drizzle/ only      │
│      ├─ Apply DB migrations from PR .drizzle artifact            │
│      │   ├─ DB          (.drizzle/migrations)                    │
│      │   └─ CONSENT_DB  (.drizzle/migrations-consent)            │
│      ├─ wrangler preview --env production --name pr-{number}    │
│      └─ Comment preview URLs + metrics on PR                     │
│                                                                  │
│  Pull Request closed (merged or not)                             │
│  └─ preview-cleanup.yml (pull_request_target, any base branch)   │
│      └─ wrangler preview delete --name pr-{number}               │
│                                                                  │
│  Push to Main (Production)                                       │
│  └─ production.yml                                               │
│      ├─ gate (reuse the merged PR's full-suite result?)          │
│      ├─ static | unit | integration (skipped when reused)        │
│      ├─ build (always) → e2e x3 shards (skipped when reused)     │
│      ├─ deploy job (main only, after all of the above)           │
│      │   Migrates the DBs and deploys main's own build           │
│      │                                                           │
│      ├─ indexnow job (after deploy)                              │
│      │   No-op without INDEXNOW_KEY; else submits changed pages  │
│      │                                                           │
│      └─ deploy-preview job (after deploy)                        │
│          ├─ Apply DB + CONSENT_DB migrations to the preview DBs  │
│          └─ wrangler preview --env production --name preview     │
│              (long-lived Preview, rebuilt from main)             │
│                                                                  │
│  Preview URLs (Cloudflare Workers Previews, one Worker):         │
│    https://{deployment-id}-besidka.chernenko.workers.dev         │
│    https://pr-{number}-besidka.chernenko.workers.dev             │
│    https://preview-besidka.chernenko.workers.dev (main)          │
│  Production:                                                     │
│    https://besidka.com                                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Workflows

### `preview-build.yml` - PR Build & Test

Triggers on `pull_request` events targeting `main` only (`branches: [main]`).
An umbrella child PR (base is the parent feature branch) never triggers this
workflow, and since `preview-deploy.yml` only runs off this workflow's
`workflow_run` completion, it gets no build or deploy; the parent PR that
targets `main` builds everything. A native GitHub stacked PR is evaluated as if
it targeted the base of the stack, so every layer triggers the workflow, but the
`gate` job's guard (`stack == null || stack.position == stack.size`) skips
every job unless the PR is the top layer. `preview-deploy.yml` detects such a
run by the missing `preview-build` artifact and exits without deploying. CI runs
the full suite, so the top layer tests every layer below it. See
`docs/stacked-prs.md`. Runs in the PR author's context without access to
secrets.

The jobs form a parallel graph instead of one long serial job:

```
gate ─┬─ static ───────────────────────────────┐
      ├─ unit ─────────────────────────────────┤
      ├─ integration ──────────────────────────┼─ summary
      └─ build ─── e2e (shard 1/3, 2/3, 3/3) ──┘
```

1. `gate` checks the PR is still open, then runs
   `scripts/ci/resolve-preview-build-source.mjs` to decide between building
   and reusing an earlier build (see below). It replaces the former
   `check-pr-state` and `check-latest-commit` jobs, so a PR pays for one
   short job before the real work starts
2. `static` ("Lint & typecheck") runs ESLint and the Nuxt type check, then
   "Check that migrations are committed": it runs `pnpm run db:generate` and
   `pnpm run db:consents:generate` and fails the PR when `git status
   --porcelain -- .drizzle` is not empty, that is, when the Drizzle schema
   changed without a committed migration. The error points at the D1 migration
   safety rules (review the SQL for `DROP TABLE`)
3. `unit` and `integration` run the full suites on every PR (`pnpm run
   test:unit`, `pnpm run test:cookie-consent`, `pnpm run test:integration`).
   The affected-test selection (`scripts/test-affected*.mjs`) is no longer
   part of CI; it only drives the local hooks and `pnpm run test:affected`
4. `build` builds the application and uploads the `preview-build` and
   `preview-drizzle` artifacts. The `preview-drizzle` artifact holds the
   committed `.drizzle` directory; nothing generates migrations in CI
5. `e2e` runs after `build` as three parallel shards of the full suite
   (`playwright test --shard=i/3`). Each shard downloads the
   `preview-build` artifact and has its own `wrangler dev`, local D1 and
   `auth.setup` user, so shards never share state. `workers` stays at 1 inside
   a shard because most specs share the single `auth.setup` user. Every shard
   uploads `playwright-report-<i>` (always) and `wrangler-logs-<i>` (on
   failure). `fail-fast` is off so one failing shard does not hide the others
6. `summary` runs only when `gate` did not skip and every other job succeeded,
   `e2e` included. It reads the per-job timings from the GitHub API
   (the `job-durations` action), comments the build results on the PR (the
   E2E time is the slowest shard) and sets the pending `Preview Deploy`
   status

All jobs check out the PR head SHA (`github.event.pull_request.head.sha`),
never GitHub's ephemeral merge ref, at the default depth (only `gate` fetches
full history); see `docs/ci-pull-request-checkout-ref.md`.

Because every PR run is a full-suite run, `production.yml` can trust it: a push
to `main` skips its own test jobs when the merged PR passed this workflow and
only ignorable, non-blocking files differ from the pushed commit (see
`production.yml`).

**Skipping builds.** A run skips the `static`, `unit`, `integration`, `build`
and `e2e` jobs only when everything changed since the last commit that was
actually built successfully for this PR is ignorable. The resolver lists
successful `preview-build.yml` runs for the PR, takes the newest one whose
`preview-build` and `preview-drizzle` artifacts are still downloadable and
whose commit is an ancestor of the PR head, and diffs that commit against the
head. Non-ignorable files in that range, no qualifying run, expired artifacts,
rewritten history or any API/git error all resolve to a normal build. The
ignored list lives in the script and must stay identical to
`on.pull_request.paths-ignore` (a unit test enforces it).

When it skips, `reuse-build` ("Reuse previous build", which `needs: gate`)
downloads both artifacts from the source run and re-uploads them under the same
names with the same retention, comments which build was reused, and sets the
pending `Preview Deploy` status. `preview-deploy.yml` is unchanged and finds the
artifacts on the skipping run, so it re-deploys the last built code. This
also redeploys a preview whose earlier deploy was cancelled. All of this logic
lives in `preview-build.yml` because `workflow_run` workflows always execute
the copy on the default branch. See `docs/cloudflare-previews.md` →
"Skipping builds".

### `preview-deploy.yml` - PR Deploy

Triggers on `workflow_run` completion of Preview Build. Runs in the base repo's context with access to secrets, and never runs PR code or PR-selected tooling: it checks out the default branch, exactly like `preview-cleanup.yml`.

1. Check the build run's `preview-build` artifact. If the run uploaded none
   (a skipped non-top stack layer), set the `Preview Deploy` status to
   `success` with "Skipped (no build for this commit)" and stop. If it
   uploaded one that has since expired (a late re-run), fail the step with an
   error asking for a Preview Build re-run and set the `Preview Deploy` status
   to `failure`. Then extract
   PR number and SHA from `workflow_run` event context (not from artifacts). When `pull_requests` is empty (GitHub clears it once the PR is closed or merged), look up the open PR whose own head is that SHA in the head repository (so stacked PRs whose history merely contains the commit are never matched); if none is open, emit a notice, set the pending `Preview Deploy` status to `success` with a "Skipped" description, and end the run successfully without deploying
2. Check whether the PR changes `wrangler.jsonc` (`config-drift` step, via
   the paginated pulls files API, which lists every changed file). It records
   `true` (with a warning that the preview deploys with the default branch's
   `wrangler.jsonc`), `false`, or `unknown` when the API call fails; a failed
   check only warns and never fails the job
3. Check out the default branch (`persist-credentials: false`), then
   `rm -rf .drizzle` so main's tracked migrations cannot mix with the PR's
4. Download the `preview-build` artifact into `.output/` and the
   `preview-drizzle` artifact into `.drizzle/` from the same build run
5. Integrity check: before anything is installed, fail the job if
   `git status --porcelain --ignored --untracked-files=all` reports any
   change outside `.output/` and `.drizzle/` (an artifact trying to overwrite
   tooling, `package.json` or the lockfile)
6. Verify migrations: the artifact's `.drizzle/` must match the PR commit's
   tracked `.drizzle/` blob for blob (git blob SHAs from the GitHub trees API
   against `git hash-object` of each extracted file). A mismatch fails the job
   with instructions to run `pnpm run db:generate` and
   `pnpm run db:consents:generate` locally, review the SQL and commit it
7. Install `pnpm`, Node and dependencies from the default branch's
   `package.json` and lockfile
8. Apply preview D1 migrations from the PR's `.drizzle` artifact with plain
   `pnpm exec wrangler d1 migrations apply ... --remote` (no
   `cloudflare/wrangler-action`, so no third-party action holds the token)
   - `DB` from `.drizzle/migrations`
   - `CONSENT_DB` from `.drizzle/migrations-consent`
9. Create or update the Cloudflare Preview named `pr-{number}` with
   `pnpm exec wrangler preview --env production --name pr-{number} --json`,
   using the default branch's `wrangler.jsonc`; the per-deployment URL and the
   stable PR URL are read from the JSON output (falling back to the
   deterministic `pr-{number}-besidka` URL)
10. Comment preview URLs and metrics on PR, including a `Wrangler config` row
   that says `default branch` (`false`), `default branch (this PR's
   wrangler.jsonc changes are not deployed)` (`true`), or `not checked (default
   branch used; could not list PR files)` (`unknown`). The commit status reads
   `Deployed to preview`, `Deployed (default-branch wrangler.jsonc)` or
   `Deployed (wrangler.jsonc check skipped)` respectively

### `preview-cleanup.yml` - PR Preview Cleanup

Triggers on `pull_request_target` `closed` (merged or abandoned) for a
same-repository PR with any base branch; there is no `branches` filter, so
umbrella children and stack layers also run it (a missing Preview counts as
success, so they cost about one to two runner minutes each), and a PR
retargeted after it deployed still gets its Preview deleted. It runs with
secrets, which is safe here because the job checks out only the default branch
and never PR code. It runs `wrangler preview delete --name pr-{number} --env
production --skip-confirmation`; a preview that no longer exists is treated as
success. Concurrency is per PR.

### `production.yml` - Production Deploy

Triggers on push to `main`, and manually via `workflow_dispatch`. The jobs
form a parallel graph:

```
gate ─┬─ static ───────────────────┐
      ├─ unit ─────────────────────┤
      ├─ integration ──────────────┼─ deploy ─┬─ indexnow
      ├─ build ─── e2e (3 shards) ─┘          └─ deploy-preview ─┐
      └─ playwright-cache                                       └─ cleanup
```

**gate** ("Gate"): Decides whether the test jobs can be skipped, with
`scripts/ci/resolve-production-test-source.mjs`. On a push to `main` it finds
the merged PR that produced the commit (`commits/<sha>/pulls`, matching
`merge_commit_sha`), fetches `refs/pull/<n>/head` and looks through that PR's
successful Preview Build runs, newest first, at most ten. A run qualifies when
both hold:

- `git diff` between its head commit and the pushed commit lists only
  skip-safe paths: ignorable ones (the list `preview-build.yml` uses for
  `paths-ignore`, imported from `resolve-preview-build-source.mjs`) that are
  not skip-blocking. `SKIP_BLOCKING_PATTERNS` in the script names the ignorable
  paths that still change what CI does or checks: `scripts/**`,
  `.github/actions/**`, `preview-build.yml` and `production.yml`. Docs,
  `AGENTS.md` and the other workflows are skip-safe. The reason lists the
  blocking paths (the first five)
- It was a full-suite run: `Lint & typecheck` (ESLint, type check, migration
  check), `Unit tests` (all unit tests, cookie-consent module tests),
  `Integration tests` and `Build` succeeded with those steps, and every
  `E2E tests (i/N)` shard from 1 to N succeeded with `Run all E2E tests`

Runs made before PRs ran the full suite have different step names and never
qualify. A reuse-only run ("Reuse previous build") never qualifies either, its
test jobs were skipped, although the run it reused can. A manual dispatch, a
dry run, a direct push, no qualifying run, a force-pushed history or any API or
git error all resolve to `skip-tests=false`, so uncertainty always runs the
tests. The script never fails the job; it writes `skip-tests`, `source-run-id`,
`source-sha`, `pr-number` and `reason` outputs and a job summary section.

The `gate` job is not a single point of failure. The downstream jobs use
`!cancelled()` in their `if:`, so a failed `gate` (an empty `skip-tests`
output) does not skip them: the test jobs and `build` still run and `deploy`
still requires every test job to succeed. Only a cancelled run stops them.

**static**, **unit**, **integration**: Lint + typecheck and the "Check that
migrations are committed" step, the full unit suite plus the cookie-consent
module tests (`pnpm run test:cookie-consent`, which the single serial job never
ran), and the full integration suite. They run in parallel, need only `gate`,
and are skipped when `gate` outputs `skip-tests=true`.

**build**: Builds the application, extracts the bundle size and uploads the
`preview-build` artifact (retention one day). It always runs (unless the run
is cancelled), even when the tests are skipped: main builds and deploys its own
build, so the artifact's `buildId` is the `main` commit SHA.

**playwright-cache** ("Warm Playwright cache"): Runs only when the tests are
skipped, and does only the `playwright` composite action. Without it no E2E
job would run on `main`, `main` would never save a cache entry for a new
Playwright version, and a new PR branch can only restore the cache that `main`
saved. It is `continue-on-error`, so a failed install never reddens the run.

**e2e**: After a successful `build`, and skipped with the other test jobs when
`gate` outputs `skip-tests=true`, three parallel shards of the full Playwright
suite (`playwright test --shard=i/3`), each with its own `wrangler dev`, local
D1 and `auth.setup` user. Each shard downloads the `preview-build` artifact, so
E2E tests the exact bundle that `deploy` ships. Shards upload
`playwright-report-<i>` and, on failure, `wrangler-logs-<i>`.

**deploy** ("Deploy to Production"): Needs `gate`, `static`, `unit`,
`integration`, `build` and every `e2e` shard, and uses `!cancelled()` so skipped
test jobs do not skip it. It runs only for `github.ref == refs/heads/main` with
`dry-run` not set, when `build` succeeded, and either `gate` output
`skip-tests=true` or `static`, `unit`, `integration` and every `e2e` shard
succeeded. A failed or cancelled test job that ran therefore blocks the deploy.
It downloads the `preview-build` artifact (no rebuild), applies the committed
remote migrations to both production databases (`DB`, then `CONSENT_DB`) and
deploys the Worker. It then reads the job timings and writes a markdown run
summary (a `Tests` row saying `reused from PR #<n> (run <id>)` or `ran on
main`, stage durations, bundle size, total time, deployed URL) to the job
summary.

**Dry run and non-main dispatch.** `workflow_dispatch` takes a boolean
`dry-run` input (default `false`). With `dry-run: true`, or when dispatched
from any ref other than `main`, `deploy` is skipped, and `indexnow`,
`deploy-preview` and the migrations skip with it because they depend on
`deploy`, and `cleanup-preview-build-artifact` skips too, so the artifact
expires on its own after one day. A dry run never reuses a PR's tests, so
`static`, `unit`, `integration`, `build` and `e2e` all run and no remote
database or Worker is touched.

**indexnow**: Runs after `deploy`. A no-op unless the
`INDEXNOW_KEY` secret exists. When it does, and the push changed a public
page (`content/`, public `app/pages/`, landing components), it reads the live
sitemap, checks `https://besidka.com/indexnow-key.txt` serves the same key,
and submits the sitemap URLs to IndexNow. See `docs/seo.md` → "IndexNow".

**deploy-preview**: Runs after `deploy`. Downloads the
`preview-build` artifact (the build of this exact `main` HEAD, whose tests ran
on `main` or reused from the merged PR's full-suite run), applies the committed
remote migrations to both preview databases (`DB`, then `CONSENT_DB`) and
updates the long-lived Preview named
`preview` with `wrangler preview --env production --name preview`. There is
no version lookup or PR-alias promotion any more: the previous
`resolve-preview-context`, `update-preview` and `deploy-preview-fallback`
jobs (and the stacked-merge edge case they handled) are gone because every
push to `main` redeploys the same Preview from its own build. The job
installs dependencies through the shared `setup` action, a plain
`pnpm install --frozen-lockfile` (not `--ignore-scripts`), so `postinstall`'s
`nuxt prepare` runs and `.nuxt/tsconfig.json` exists — `drizzle-kit generate`
loads the root `tsconfig.json`, which `extends` that file, and hard-fails
without it.

**cleanup-preview-build-artifact**: Runs only after `deploy` and
`deploy-preview` both succeed and deletes the run's `preview-build` artifact.
It has no `if: always()` on purpose: the E2E shards and `deploy` download that
artifact, so keeping it after a failed, cancelled or dry run lets "Re-run
failed jobs" re-run a failed E2E shard or deploy job without an "Artifact not
found" error. A failed run, a cancelled run or a dry run leaves the artifact in
place until its one-day retention expires it, and a failed-jobs re-run that
then succeeds also re-runs this skipped cleanup job.

Both `deploy` and `deploy-preview` apply migrations to
`DB` and `CONSENT_DB` unconditionally on every run — an earlier git-diff-based
`drizzle-changed` gate was removed because a diff of only the current push's
before/after SHAs could permanently miss a migration if an unrelated prior
run failed before reaching the migration step. `wrangler d1 migrations apply`
is idempotent — it only runs migrations not yet recorded in each database's
`d1_migrations` table, so applying both every time (even when neither
changed) is a harmless no-op.

### Shared composite actions

Four local composite actions in `.github/actions/` hold the steps the workflows
share. Callers must run `actions/checkout` first because a local
action is read from the checked-out workspace.

- **`setup`** installs pnpm, Node.js 24 (with the `pnpm` store cache) and runs
  `pnpm install --frozen-lockfile`. The optional `install-args` input is
  appended to the install command. It runs `postinstall`, so `nuxt prepare`
  has already generated `.nuxt`; typecheck needs no separate `dev:prepare`.
- **`playwright`** resolves the Playwright version, restores Playwright
  Chromium from the cache and installs it on a cache miss (see "Playwright
  cache" below). It needs `pnpm install` to have run, so call it after `setup`.
  `prepare-e2e` uses it, and so does the `playwright-cache` job of
  `production.yml`.
- **`prepare-e2e`** downloads the `preview-build` artifact into `.output/`,
  runs the `playwright` action, applies the committed `DB` and `CONSENT_DB`
  migrations to the local D1 (it generates nothing, so E2E tests exactly the
  migrations in the PR), and writes the `.dev.vars` file that `wrangler dev`
  reads. It assumes checkout and `setup` already ran.
- **`job-durations`** reads this run's jobs from the GitHub API
  (`actions/runs/{id}/attempts/{attempt}/jobs`) and outputs `static`, `unit`,
  `integration`, `build`, `e2e` and `total`. Each value is `Xm Ys`, or
  `skipped` when no job with that name succeeded. `e2e` is the slowest
  successful shard (jobs whose name starts with `E2E tests`). The calling job
  needs `actions: read`.

**Playwright cache.** `playwright` caches `~/.cache/ms-playwright` under the
key `{os}-{arch}-playwright-{Playwright version}-chromium-headless-shell`. The
version comes from `playwright --version`, so the cache follows the installed
Playwright instead of the whole lockfile. Only the headless shell is
installed (`playwright install chromium --only-shell`) because headless runs
use it, and without `--with-deps`: the `ubuntu-24.04` image already has the
Chromium libraries, and `--with-deps` once spent 7 minutes downloading fonts
from a slow apt mirror. The install is wrapped in `timeout 180` (composite
steps cannot set `timeout-minutes`). Do not set `PLAYWRIGHT_BROWSERS_PATH` in
YAML `env`: the runner never expands `~` there, so the browsers landed in
`<repo>/~/.cache/ms-playwright` and the cache step never saved anything. The
Linux default is already `~/.cache/ms-playwright`.

### `scripts-check.yml` - Scripts Check

Triggers on `pull_request` events targeting `main` (`opened`, `synchronize`,
`reopened`) only when the PR changes `scripts/**`, `tests/unit/scripts/**`,
`tests/unit/providers/**` or the workflow itself, and only for same-repository
PRs. `scripts/**` is in the `paths-ignore` of `preview-build.yml` and
`production.yml`, so without this workflow a scripts-only PR would get no CI at
all, although `resolve-preview-build-source.mjs` and
`resolve-production-test-source.mjs` now decide what CI builds and tests. One
job ("Lint & test scripts", `ubuntu-24.04`, read-only `contents`) checks out the
PR head, runs the `setup` action, then `pnpm exec eslint scripts` and
`pnpm exec vitest run tests/unit/scripts tests/unit/providers`. Concurrency is
per PR and cancels in-progress runs. A PR that also changes application code
runs this workflow next to `preview-build.yml`, which already runs the same
specs in its full unit suite.

### `claude-code-review.yml` - Claude Code Review

Triggers on `pull_request` events `opened`, `synchronize`,
`ready_for_review` and `reopened`, only for PRs targeting `main`
(`branches: [main]`). Umbrella children are not reviewed, the parent reviews the
combined diff; every native stack layer is reviewed (see
`docs/stacked-prs.md`). Runs the `/code-review:code-review --comment` plugin
through `anthropics/claude-code-action@v1` and posts inline review comments on
the PR. Requires the `ANTHROPIC_API_KEY` secret.

Cost controls:

- `concurrency` cancels a stale review when a newer push arrives
- Draft PRs are skipped; the review starts at `ready_for_review`
- `timeout-minutes: 20`, `--max-turns 40`
- `--allowedTools` lists the `gh` Bash commands the code-review plugin
  declares (`gh pr view|diff|list|comment`, `gh issue view|list`,
  `gh search`) next to the inline-comment tool. Without them every `gh` call
  is permission-denied in CI and the review silently posts nothing
- No `--model` override: the review stays on Claude Code's default
  model (Opus 5.5 at time of writing). A PR review is open-ended bug
  finding, and the code-review plugin picks its own sub-agent models
- The "Summarize review run" step prints the tool calls, failed tool
  results, permission denials and final review summary from the action's
  execution file. The action hides its transcript by default
  (`show_full_output: false`), so without it a run can report success while
  posting nothing
- The review step sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` because the
  code-review plugin launches its review subagents in the background by
  default. Under `claude-code-action`, which drives the Agent SDK rather than
  `claude -p`, the session then ended with "Three review agents are still
  running." and never posted, while the job still reported success. See
  [sub-agents](https://code.claude.com/docs/en/sub-agents) and
  [environment variables](https://code.claude.com/docs/en/env-vars)

Runs only for same-repository PRs (`head.repo.full_name == github.repository`).

### `claude.yml` - Claude Code Mentions

Triggers when `@claude` appears in an issue or PR comment, a PR review, a PR
review comment, or an issue body or title. Claude performs the request in the
comment through `anthropics/claude-code-action@v1`. Requires the
`ANTHROPIC_API_KEY` secret.

Cost controls: `timeout-minutes: 30` and `--max-turns 60`, with the default
model because mentions are open-ended. There is deliberately no
`cancel-in-progress`: each mention is a distinct request.

Notes for both Claude workflows:

- **Prompt caching is automatic.** Claude Code applies Anthropic prompt
  caching with no configuration, and `DISABLE_PROMPT_CACHING` would turn it
  off. `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` exists, but 1h cache writes cost 2x
  versus 1.25x for 5m, and runs are rarely less than an hour apart on the
  same prefix, so the 5m default is kept.
- **Workflow-file PRs are skipped.** The action skips itself with
  "Workflow validation failed" on any PR that modifies these workflow files,
  so changes only take effect after merge to `main`.
- **Usage is hidden in default logs.** Only `total_cost_usd` is printed.
  `show_full_output: true` exposes raw token and cache usage, but may leak
  secrets in public logs.

### `cleanup-runs.yml` - Workflow Run Cleanup

Triggers once per day (`cron: 23 3 * * *`) and manually via
`workflow_dispatch`.

1. Checks out the repository
2. Runs `./scripts/clean-gh-runs.sh --yes --limit 500`
3. Deletes skipped runs and runs matching cleanup title patterns

### `linear-docs-sync.yml` - Sync Docs to Linear

Triggers on pushes to `main` that touch `docs/**` (or the sync script), and
manually via `workflow_dispatch` (tick **full** to re-sync every document).

1. Runs `scripts/linear-docs-sync.mjs`, which mirrors `docs/**/*.md` into
   Linear team documents (team BES) and rebuilds the "Docs index" document.
   Only files changed since the last synced commit (recorded in the Docs
   index) are synced, so cancelled or skipped runs are caught up; renames keep
   the same Linear document, deleted files delete their Linear document
   (restorable from Linear's "Recently deleted" for 30 days).
2. Commits `docs/.linear-docs.json` (path → Linear document id) back to
   `main` when a document was created or deleted, with `[skip ci]`. The job
   always checks out the latest `main`, so a queued run never works from a
   stale map.

The repo is the source of truth: edits made in Linear are overwritten on
the next sync. Without the `LINEAR_API_KEY` secret the job exits with a
warning and changes nothing.

## Security Model

### The Split Workflow Pattern

The repository accepts pull requests only from collaborators (repository
setting `pull_request_creation_policy=collaborators_only`), and every PR
workflow also guards on `head.repo.full_name == github.repository`, so fork code
never reaches a job that holds secrets. The guard compares the head repository,
never `author_association`: bot PRs (Dependabot, the models drift PR) come from
the same repository and must keep working.

Build and deploy are still split in two phases:

1. **`preview-build.yml`** runs on `pull_request` - executes the PR code without secrets
2. **`preview-deploy.yml`** runs on `workflow_run` - deploys with secrets after build succeeds

`preview-cleanup.yml` is the one workflow that uses `pull_request_target`. It
is safe because it only checks out the default branch, never PR code, and the
only thing it does with the PR is read its number.

`preview-deploy.yml` follows the same rule. It never runs PR code or
PR-selected tooling with the token: `pnpm`, `wrangler`, `wrangler.jsonc`,
`package.json` and the lockfile all come from the default branch checkout. The
only PR-controlled inputs are the two build artifacts, `preview-build`
(extracted into `.output/`) and `preview-drizzle` (extracted into
`.drizzle/`). They are deployed to the preview Worker and applied to the
shared preview D1, never executed on the runner. Bot PRs must keep working
(Dependabot included), and this layout keeps them working with no actor
filter: Dependabot-actor runs do receive the Cloudflare secrets, so the
protection is the default-branch tooling, not who opened the PR.

### Key Security Properties

**PR metadata from event context, not artifacts**: The PR number and SHA are extracted from `github.event.workflow_run` properties. This prevents command injection via tampered artifact files (e.g., a malicious `pr_number.txt` containing shell commands).

**Same-repository guard**: `preview-deploy.yml` runs only when `workflow_run.head_repository.full_name` equals the repository. `preview-build.yml`, `claude-code-review.yml` and `preview-cleanup.yml` apply the same check to `pull_request.head.repo.full_name`. There is no fork deploy path: the former `/deploy-preview` comment workflow ran Cloudflare secrets against fork code and was removed.

**Default-branch tooling**: `preview-deploy.yml` checks out the default
branch with `persist-credentials: false` and installs dependencies from its
lockfile, so a compromised dependency in a PR (for example a Dependabot bump)
never runs next to `CLOUDFLARE_API_TOKEN`. Migrations and deploy use the plain
`pnpm exec wrangler` from that install; no third-party action ever holds the
token. The job requests no `id-token: write` because nothing uses OIDC.

**Artifact confinement and integrity check**: the build artifact is extracted
only into `.output/` and the drizzle artifact only into `.drizzle/` (never the
workspace root). Before `pnpm install`, a step fails the job if
`git status --porcelain --ignored --untracked-files=all` shows any file
outside those two directories differing from the default-branch checkout.
A second step then requires the artifact's `.drizzle/` to equal the PR commit's
tracked `.drizzle/` blob for blob, so build-generated, uncommitted migrations
and anything planted by build-time code never reach the shared preview D1.

**SHA-pinned third-party actions in secret-bearing workflows**: in workflows
that reference `secrets.*` (`preview-deploy.yml`, `preview-cleanup.yml`,
`production.yml`, `claude.yml`, `claude-code-review.yml`, `update.yml`,
`linear-docs-sync.yml`), every non-`actions/` action is pinned to a full commit
SHA. `.github/dependabot.yml`
has the `github-actions` ecosystem, which updates SHA pins. A unit test
(`tests/unit/workflows/preview-deploy.spec.ts`) enforces the rule and the
`preview-deploy.yml` invariants above. It runs locally through the pre-push
hook's affected-test mapping, not in CI, because `.github/**` is path-ignored
by the build workflows.

**`production` environment**: the `deploy` and `deploy-preview` jobs in
`production.yml` declare `environment: production`, so the owner can restrict
which branches may run them (see "Secrets & Environments"). The test and build
jobs hold no secrets and run outside the environment.

**Migration source consistency**: `preview-build.yml` uploads `.drizzle` as an
artifact (both `migrations/` and `migrations-consent/`; the artifact root is
the contents of `.drizzle/`). `preview-deploy.yml` removes the default
branch's tracked `.drizzle/` and extracts the artifact into `.drizzle/` (never
the repository root, so artifact files cannot overwrite checked-out files such
as `wrangler.jsonc`), so the applied migration set is exactly the PR's
artifact and not an overlay on main's files. The `wrangler.jsonc`
`migrations_dir` paths (`.drizzle/migrations`, `.drizzle/migrations-consent`)
resolve to those files, so `DB` and `CONSENT_DB` migrations are applied from
that artifact before deploy, keeping both preview DB schemas aligned with the
deployed PR build. The "Verify migrations match the PR commit" step requires
that artifact to equal the PR commit's tracked `.drizzle/` blob for blob.
`preview-build.yml` runs `db:generate` and `db:consents:generate` before
uploading, so the artifact could otherwise carry generated-but-uncommitted
migrations (possibly `DROP TABLE` rebuilds that cascade-wipe children on D1).
A PR with uncommitted schema changes fails its preview deploy with
instructions.

**Artifact trust boundary**: only artifacts built from same-repository branches are ever deployed.

### Accepted Residual Risk

- PR artifacts still run on the preview Worker with the preview
  secrets/bindings, and PR migrations hit the shared preview D1. Both are
  bounded to preview resources because bindings and database ids come from
  the default branch's `wrangler.jsonc`.
- Trade-off: a PR that changes `wrangler.jsonc` previews with main's config
  until it merges. The deploy warns, the PR comment shows a `Wrangler config`
  row and the commit status says so. The `main` long-lived preview
  (`production.yml` → `deploy-preview`) is where config changes are first
  exercised.

### Decision Log

**V1 (monolithic)**: Single reusable `build.yml` called by `preview.yml` and `production.yml`.

- Used `pull_request_target` which runs base branch code, not PR code
- Reusable workflow had 18+ conditional steps for PR vs. main test logic
- Fork PRs with `secrets: inherit` could exfiltrate secrets
- 368 lines of duplicated conditional logic

**V2 (current)**: Split into purpose-specific inline workflows.

- `pull_request` trigger correctly runs PR code
- No secrets during build phase
- Clean separation of concerns
- Each workflow is self-contained and readable
- Fork PRs are not accepted (repository setting plus same-repository guards)

## Concurrency

### `preview-build.yml`
```yaml
group: preview-build-{pr_number}
cancel-in-progress: true
```
One build per PR. New commits cancel in-progress builds.

### `preview-deploy.yml`
```yaml
group: preview-deploy-{pr_number || run_id}
cancel-in-progress: true
```
One deploy per PR. Falls back to run ID if PR number unavailable. This group
is separate from the cleanup group, so a deploy never cancels a cleanup (and
vice versa). To avoid orphaning a Preview, the deploy checks the PR state via
the GitHub API before migrating/deploying and skips everything if the PR is no
longer open. After `wrangler preview` succeeds it checks again; if the PR was
closed meanwhile, it runs `wrangler preview delete` itself (a missing Preview
counts as success) and skips the PR comment and success status.

Remaining window: a run cancelled (`cancel-in-progress` by a newer build) after
`wrangler preview` finished but before its post-deploy PR state check ran,
while the PR closed and cleanup already ran in between, can leave an orphaned
Preview. Delete it by hand with
`pnpm exec wrangler preview delete --name pr-<n> --env production --skip-confirmation`;
Previews also auto-expire at the 500-per-Worker limit.

### `production.yml`
```yaml
group: ${{ github.ref == 'refs/heads/main' && !inputs.dry-run && 'production' || format('production-dry-run-{0}', github.ref) }}
cancel-in-progress: false
```
Pushes to `main` and non-dry-run dispatches from `main` share the `production`
group. A dry run, or a dispatch from any other ref, gets its own
`production-dry-run-{ref}` group so it can never queue behind, or replace a
pending, deploy from `main`. One production deployment at a time. A new merge
queues behind the running deploy instead of cancelling it, because a
cancellation between `migrations apply` and the Worker deploy can leave
production with a new schema and old code. GitHub keeps at most one pending
run; a newer pending run replaces the older one, so the newest commit still
deploys last.

### `preview-cleanup.yml`
```yaml
group: preview-cleanup-{pr_number}
cancel-in-progress: false
```
One cleanup per PR, in its own group (not shared with `preview-deploy`); a
queued deploy can no longer cancel a delete in progress.

### `claude-code-review.yml`
```yaml
group: claude-code-review-{pr_number}
cancel-in-progress: true
```
One review per PR. New pushes cancel the in-progress review instead of paying
for parallel full reviews.

## Cloudflare Previews

Previews use Cloudflare's [Workers Previews](https://developers.cloudflare.com/workers/previews/)
(open beta). There is one Worker, `besidka`; every Preview is a named,
independently updatable copy of it, configured by `env.production.previews`
in `wrangler.jsonc`. See [`/docs/cloudflare-previews.md`](/docs/cloudflare-previews.md)
for the decision log and runbook.

```
PR #123 with 3 commits (one Preview, three deployments):

Commit 1 (abc1234):
├─ Deployment: https://3f9c1d2e-besidka.chernenko.workers.dev (permanent)
└─ PR Preview: https://pr-123-besidka.chernenko.workers.dev (updated)

Commit 2 (def5678):
├─ Deployment: https://8a47b6c0-besidka.chernenko.workers.dev (permanent)
└─ PR Preview: https://pr-123-besidka.chernenko.workers.dev (updated)

main (long-lived):
└─ https://preview-besidka.chernenko.workers.dev (Preview named `preview`)
```

- **Deployment URL**: unique per deployment, permanent while the deployment exists
- **PR Preview URL**: stable per PR, always points at the latest deployment
- **`preview-besidka` URL**: stable, rebuilt from `main` on every merge
- Every call with the same `--name` updates that Preview with a new deployment
- Limits: 500 Previews per Worker and 100 deployments per Preview on the Paid
  plan; the oldest are deleted automatically
- `--env production` is required on every `wrangler preview` command
  (deploy, delete, secret); without it wrangler targets the local-only
  top-level config
- PR Previews are deleted by `preview-cleanup.yml` when the PR closes
- Previews do not run cron triggers or queue consumers and get no routes

## Cloudflare Environments

**Production** (`--env production`):
- Domain: `besidka.com`
- Bindings: Production D1, KV, R2
- Triggered by: Push to `main`

**Previews** (`env.production.previews`):
- Hosts: `*-besidka.chernenko.workers.dev`
- Bindings: Preview D1, KV, R2 (shared by all Previews)
- Triggered by: PR commits (`pr-{number}`) and merges to `main` (`preview`)
- Secrets are not inherited from production; they are set once with
  `wrangler preview base-config secret bulk` (see the runbook)

**Top-level config** (`besidka-local`):
- Local development only, never deployed
- Still points at the preview D1 databases so `wrangler d1 migrations apply
  DB --remote` (no `--env`) keeps migrating the preview databases

## Secrets & Environments

| Secret | Used In | Phase |
|--------|---------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | preview-deploy, preview-cleanup, production | Deploy |
| `CLOUDFLARE_API_TOKEN` | preview-deploy, preview-cleanup, production | Deploy |
| `LINEAR_API_KEY` | linear-docs-sync | Docs sync (Linear personal API key, write access to team BES) |
| `github.token` | All workflows | Build + Deploy |

Build-time workflows (`preview-build.yml`) require no secrets. Only the `deploy` and `deploy-preview` jobs of `production.yml` declare a GitHub `environment:` (`production`); the other deploy-time workflows (`preview-deploy.yml`, `preview-cleanup.yml`) do not. They use Actions secrets (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are inherited from the `besidka` organization, not set on the repository) and `github.token`. CI never handles runtime secret values for Previews; those are set out-of-band (see [`/docs/cloudflare-previews.md`](/docs/cloudflare-previews.md)).

### The `production` environment

`deploy` and `deploy-preview` in `production.yml` run with
`environment: production`. The environment does not exist yet: the first
`production.yml` run on `main` auto-creates it unprotected, and it gives no
protection until the owner sets Deployment branches to `main` (checklist
below). It has no secrets of its own; `CLOUDFLARE_*` stay organization Actions
secrets, and Dependabot-actor runs receive them (verified on run
39229739041), so the default-branch tooling in `preview-deploy.yml` is what
protects them. Every push to `main` now also shows GitHub Deployment records
for `production`, including one for the `deploy-preview` job; this is
cosmetic.

Owner checklist (repository settings, not automatable from the repo):

1. Settings > Environments > production: set Deployment branches to `main`
   only. This blocks `workflow_dispatch` of `production.yml` from any other
   branch. Do not add required reviewers: they would gate every merge.
2. Moving `CLOUDFLARE_*` into environment-scoped secrets is NOT done yet,
   because `preview-deploy.yml` and `preview-cleanup.yml` also need the token.
   That would be a separate change (a separate preview-scoped token, or an
   environment for those two workflows).

### Verifying on the next PR

`preview-deploy.yml` is a `workflow_run` workflow, so it always runs the
default branch's copy: the PR that introduces this layout still deploys with
the old flow, and the change first takes effect on the first PR preview after
it merges. On that run check that:

- the "Checkout default branch" log shows `main`
- "Verify artifacts stayed inside .output and .drizzle" passes
- the preview comment lands with the `Wrangler config` row
- the migrations and `wrangler preview` steps succeed under
  `pnpm install --frozen-lockfile --ignore-scripts`, a configuration that has
  not run a deploy before
- the next Dependabot PR still gets a preview

No repository variables are required. The Wrangler CLI version is pinned as a `devDependency` in `pnpm-lock.yaml` and installed via `pnpm install --frozen-lockfile`; deploy steps use that pinned binary directly, so no `wranglerVersion` input or `WRANGLER_VERSION` variable is needed.

## Path Filters

`preview-build.yml` and `production.yml` share one `paths-ignore` list: agent
and editor directories (`.agents/**`, `.claude/**`, `.cursor/**` and similar),
`.github/**`, `.husky/**`, `docs/**`, `lib/**`, `scripts/**`, `.gitignore`,
`commitlint.config.ts`, root `*.md` and `skills-lock.json`. Nested markdown is
not ignored because `content/*.md` is the landing page source. The `.*rc` dot
files are deliberately not ignored: `.npmrc` and `.nuxtrc` change installs and
the Nuxt build. `IGNORED_PATH_PATTERNS` in `resolve-preview-build-source.mjs`
must stay identical to the list in `preview-build.yml` (a unit test enforces
it). A PR that only touches `scripts/**` runs `scripts-check.yml` instead.

## Local Testing

```bash
# Long-lived preview (build + wrangler preview --env production --name preview)
pnpm run deploy

# Production environment
pnpm run deploy:prod

# Throwaway Preview (PR simulation); delete it afterwards
pnpm exec wrangler preview --env production --name pr-test
pnpm exec wrangler preview delete --name pr-test --env production --skip-confirmation
```

## Database Migrations

The app uses **two** independent Cloudflare D1 databases, each with its own
Drizzle config, migrations directory, and binding:

| Binding | Migrations dir | Drizzle config | Purpose |
|---------|----------------|----------------|---------|
| `DB` | `.drizzle/migrations` | `drizzle.config.ts` | Main app schema (users, chats, projects, files, …) |
| `CONSENT_DB` | `.drizzle/migrations-consent` | `drizzle-consent.config.ts` | Cookie-consent receipts (system of record) |

CI applies migrations for **both** databases at every deploy. Each binding is
migrated with a separate step so a failure is attributable to one database:

| Workflow / job | Trigger | DB step | CONSENT_DB step | Source |
|----------------|---------|---------|-----------------|--------|
| `preview-deploy.yml` → `deploy` | Same-repo PR build success | `wrangler d1 migrations apply DB --remote` | `wrangler d1 migrations apply CONSENT_DB --remote` | Downloaded `preview-drizzle` artifact (committed migrations) |
| `production.yml` → `deploy` | Merge / push to `main` | `… apply DB --remote --env production` | `… apply CONSENT_DB --remote --env production` | Committed `.drizzle` from the checkout |
| `production.yml` → `deploy-preview` | Merge / push to `main` (after `deploy`) | `… apply DB --remote` | `… apply CONSENT_DB --remote` | Committed `.drizzle` from the checkout |

**Migration source.** No job generates migrations before applying them.
Preview-deploy applies the exact migration files from the uploaded `.drizzle`
artifact, which is the committed directory, and the production jobs apply the
committed `.drizzle` of the checkout. The `static` job of both
`preview-build.yml` and `production.yml` has a "Check that migrations are
committed" step that runs `pnpm run db:generate` and
`pnpm run db:consents:generate` and fails when
`git status --porcelain -- .drizzle` is not empty. The step also fails with an
explanation when drizzle-kit itself exits non-zero, which it does when it needs
an interactive answer (for example whether a column was renamed or created) that
a non-TTY CI cannot give: run it locally and commit the migration. A schema
change without a committed migration therefore fails its PR instead of
generating SQL nobody reviewed (for `DROP TABLE`, see the D1 rules) right
before it reaches a remote database. The E2E jobs apply the committed
migrations to the local D1 for the same reason.

**Gating.** Both DB and CONSENT_DB apply steps in `production.yml` run
unconditionally on every push, in both `deploy` and
`deploy-preview` — there is no `.drizzle/`-change gate. An earlier
git-diff-based gate (comparing only the current push's before/after SHAs)
was removed because it could permanently miss a migration if an unrelated
prior run failed before reaching the migration step. Because
`wrangler d1 migrations apply` only runs migrations missing from each
database's `d1_migrations` tracking table, running both steps on every push
regardless of what changed is an idempotent no-op.

**Local commands** (mirror the CI steps; run these yourself for remote DBs —
never let CI touch a remote DB you have not migrated locally first):

```bash
# Main DB
pnpm run db:generate            # generate migrations from schema
pnpm run db:migrate             # apply to local
pnpm run db:migrate:preview     # apply to remote preview
pnpm run db:migrate:prod        # apply to remote production

# Consent DB
pnpm run db:consents:generate         # generate from server/db/consent/schema.ts
pnpm run db:consents:migrate          # apply to local
pnpm run db:consents:migrate:preview  # apply to remote preview
pnpm run db:consents:migrate:prod     # apply to remote production
```

> [!WARNING]
> Read the D1 migration-safety rules in [`/CLAUDE.md`](/CLAUDE.md) before
> generating or applying any migration. SQLite/D1 table rebuilds can trigger
> cascade deletes; always inspect the generated `.sql` for `DROP TABLE` first.

## Related Documentation

- Project setup: [`/CLAUDE.md`](/CLAUDE.md)
- Cloudflare configuration: [`/wrangler.jsonc`](/wrangler.jsonc)
- Previews decision log and runbook: [`/docs/cloudflare-previews.md`](/docs/cloudflare-previews.md)
- Cookie-consent / `CONSENT_DB` details: [`/docs/cookie-consent.md`](/docs/cookie-consent.md)
