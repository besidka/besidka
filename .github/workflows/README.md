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
│  │   ├─ Lint + typecheck                                         │
│  │   ├─ Affected tests (unit, integration, e2e)                  │
│  │   ├─ Build application                                        │
│  │   └─ Upload artifacts (build output + .drizzle + metrics)     │
│  │                                                               │
│  └─ preview-deploy.yml (workflow_run, privileged)                │
│      ├─ Download artifacts from build                            │
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
│      ├─ build-production job                                     │
│      │   ├─ All tests (unit, integration, e2e)                   │
│      │   ├─ Build application                                    │
│      │   └─ Deploy to production                                 │
│      │                                                           │
│      ├─ indexnow job (after build-production)                    │
│      │   No-op without INDEXNOW_KEY; else submits changed pages  │
│      │                                                           │
│      └─ deploy-preview job (after build-production)             │
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
`check-pr-state` guard (`stack == null || stack.position == stack.size`) skips
every job unless the PR is the top layer. `preview-deploy.yml` detects such a
run by the missing `preview-build` artifact and exits without deploying. The
affected-tests base is `stack.base.ref || base_ref`, so the top layer tests
every layer below it. See `docs/stacked-prs.md`. Runs in the PR author's
context without access to secrets.

1. Check PR is still open
2. `check-latest-commit` runs `scripts/ci/resolve-preview-build-source.mjs`
   to decide between building and reusing an earlier build (see below)
3. Install dependencies
4. Lint + typecheck
5. Run affected tests only (based on changed files vs the base branch, or
   the stack's base branch for a stacked PR)
6. Build application
7. Upload build output, `.drizzle`, and metrics as artifacts

**Skipping builds.** A run skips the `build` job only when everything changed
since the last commit that was actually built successfully for this PR is
ignorable. The resolver lists successful `preview-build.yml` runs for the PR,
takes the newest one whose `preview-build` and `preview-drizzle` artifacts
are still downloadable and whose commit is an ancestor of the PR head, and
diffs that commit against the head. Non-ignorable files in that range, no
qualifying run, expired artifacts, rewritten history or any API/git error all
resolve to a normal build. The ignored list lives in the script and must stay
identical to `on.pull_request.paths-ignore` (a unit test enforces it).

When it skips, `reuse-build` ("Reuse previous build") downloads both
artifacts from the source run and re-uploads them under the same names with
the same retention, comments which build was reused, and sets the pending
`Preview Deploy` status. `preview-deploy.yml` is unchanged and finds the
artifacts on the skipping run, so it re-deploys the last built code. This
also redeploys a preview whose earlier deploy was cancelled. All of this logic
lives in `preview-build.yml` because `workflow_run` workflows always execute
the copy on the default branch. See `docs/cloudflare-previews.md` →
"Skipping builds".

### `preview-deploy.yml` - PR Deploy

Triggers on `workflow_run` completion of Preview Build. Runs in the base repo's context with access to secrets.

1. Check the build run's `preview-build` artifact. If the run uploaded none
   (a skipped non-top stack layer), set the `Preview Deploy` status to
   `success` with "Skipped (no build for this commit)" and stop. If it
   uploaded one that has since expired (a late re-run), fail the step with an
   error asking for a Preview Build re-run and set the `Preview Deploy` status
   to `failure`. Then extract
   PR number and SHA from `workflow_run` event context (not from artifacts). When `pull_requests` is empty (GitHub clears it once the PR is closed or merged), look up the open PR whose own head is that SHA in the head repository (so stacked PRs whose history merely contains the commit are never matched); if none is open, emit a notice, set the pending `Preview Deploy` status to `success` with a "Skipped" description, and end the run successfully without deploying
2. Download build and `.drizzle` artifacts from the same build run
3. Apply preview D1 migrations from the downloaded `.drizzle` artifact
   - `DB` from `.drizzle/migrations`
   - `CONSENT_DB` from `.drizzle/migrations-consent`
4. Create or update the Cloudflare Preview named `pr-{number}` with
   `wrangler preview --env production --name pr-{number} --json`; the
   per-deployment URL and the stable PR URL are read from the JSON output
   (falling back to the deterministic `pr-{number}-besidka` URL)
5. Comment preview URLs and metrics on PR

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

Triggers on push to `main`. Three jobs:

**build-production**: Full test suite, build, deploy to production. Applies
remote migrations to both production databases (`DB`, then `CONSENT_DB`)
before deploy, unconditionally on every run (see below).
The job has `timeout-minutes: 30`: unit (~7m), integration (~1.5m), build
(~2m) and E2E (~8m, with its own 15-minute step timeout) together exceeded
the former 20-minute limit. `deploy-preview` runs no tests and stays at 20.

**indexnow**: Runs after `build-production`. A no-op unless the
`INDEXNOW_KEY` secret exists. When it does, and the push changed a public
page (`content/`, public `app/pages/`, landing components), it reads the live
sitemap, checks `https://besidka.com/indexnow-key.txt` serves the same key,
and submits the sitemap URLs to IndexNow. See `docs/seo.md` → "IndexNow".

**deploy-preview**: Runs after `build-production`. Downloads the
`preview-build` artifact (the build already validated by the full test suite
for this exact `main` HEAD), applies remote migrations to both preview
databases (`DB`, then `CONSENT_DB`) and updates the long-lived Preview named
`preview` with `wrangler preview --env production --name preview`. There is
no version lookup or PR-alias promotion any more: the previous
`resolve-preview-context`, `update-preview` and `deploy-preview-fallback`
jobs (and the stacked-merge edge case they handled) are gone because every
push to `main` redeploys the same Preview from its own build. The job
installs dependencies with a plain `pnpm install --frozen-lockfile` (not
`--ignore-scripts`) so `postinstall`'s `nuxt prepare` runs and
`.nuxt/tsconfig.json` exists — `drizzle-kit generate` loads the root
`tsconfig.json`, which `extends` that file, and hard-fails without it.

Both `build-production` and `deploy-preview` apply migrations to
`DB` and `CONSENT_DB` unconditionally on every run — an earlier git-diff-based
`drizzle-changed` gate was removed because a diff of only the current push's
before/after SHAs could permanently miss a migration if an unrelated prior
run failed before reaching the migration step. `wrangler d1 migrations apply`
is idempotent — it only runs migrations not yet recorded in each database's
`d1_migrations` table, so applying both every time (even when neither
changed) is a harmless no-op.

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

### Key Security Properties

**PR metadata from event context, not artifacts**: The PR number and SHA are extracted from `github.event.workflow_run` properties. This prevents command injection via tampered artifact files (e.g., a malicious `pr_number.txt` containing shell commands).

**Same-repository guard**: `preview-deploy.yml` runs only when `workflow_run.head_repository.full_name` equals the repository. `preview-build.yml`, `claude-code-review.yml` and `preview-cleanup.yml` apply the same check to `pull_request.head.repo.full_name`. There is no fork deploy path: the former `/deploy-preview` comment workflow ran Cloudflare secrets against fork code and was removed.

**Migration source consistency**: `preview-build.yml` uploads `.drizzle` as an
artifact (both `migrations/` and `migrations-consent/`), and
`preview-deploy.yml` applies migrations for both `DB` and `CONSENT_DB` from
that exact artifact before deploy. This keeps both preview DB schemas aligned
with the deployed PR build.

**Artifact trust boundary**: only artifacts built from same-repository branches are ever deployed.

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
group: production
cancel-in-progress: true
```
One production deployment at a time.

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

Build-time workflows (`preview-build.yml`) require no secrets. Deploy-time workflows do not declare a GitHub `environment:`; they use Actions secrets (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are inherited from the `besidka` organization, not set on the repository) and `github.token`. CI never handles runtime secret values for Previews; those are set out-of-band (see [`/docs/cloudflare-previews.md`](/docs/cloudflare-previews.md)).

No repository variables are required. The Wrangler CLI version is pinned as a `devDependency` in `pnpm-lock.yaml` and installed via `pnpm install --frozen-lockfile`; deploy steps use that pinned binary directly, so no `wranglerVersion` input or `WRANGLER_VERSION` variable is needed.

## Path Filters

Both `preview-build.yml` and `production.yml` use:
```yaml
paths-ignore:
  - '**/*.md'
```
Markdown-only changes skip CI.

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
| `production.yml` → `build-production` | Merge / push to `main` | `… apply DB --remote --env production` | `… apply CONSENT_DB --remote --env production` | Regenerated in-step via `preCommands` |
| `production.yml` → `deploy-preview` | Merge / push to `main` (after `build-production`) | `… apply DB --remote` | `… apply CONSENT_DB --remote` | Regenerated in-step via `preCommands` |

**Regeneration source.** Preview-deploy applies the exact migration files from
the uploaded `.drizzle` artifact (no regeneration). The production jobs
regenerate before applying via `preCommands`: `pnpm run db:generate` for `DB`
and `pnpm run db:consents:generate` for `CONSENT_DB`.

**Gating.** Both DB and CONSENT_DB apply steps in `production.yml` run
unconditionally on every push, in both `build-production` and
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
