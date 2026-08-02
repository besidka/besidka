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
│      ├─ Deploy to Cloudflare Workers (version with PR alias)     │
│      └─ Comment preview URLs + metrics on PR                     │
│                                                                  │
│  Pull Request (fork)                                             │
│  ├─ preview-build.yml (same as above, no secrets)                │
│  ├─ preview-deploy.yml (detects fork, skips deploy, comments)    │
│  └─ preview-fork-deploy.yml (issue_comment /deploy-preview)      │
│      ├─ Verify commenter has write access                        │
│      ├─ Find successful build artifact for PR HEAD               │
│      ├─ Download + deploy to Cloudflare Workers                  │
│      └─ Comment preview URLs on PR                               │
│                                                                  │
│  Push to Main (Production)                                       │
│  └─ production.yml                                               │
│      ├─ build-production job                                     │
│      │   ├─ All tests (unit, integration, e2e)                   │
│      │   ├─ Build application                                    │
│      │   └─ Deploy to production                                 │
│      │                                                           │
│      ├─ update-preview job (parallel)                            │
│      │   ├─ Get merged PR number                                 │
│      │   └─ Promote PR version to preview (if alias found)       │
│      │                                                           │
│      └─ deploy-preview-fallback job (after update-preview)        │
│          Direct push OR no PR-alias version found: build+deploy  │
│          the fallback build fresh instead of silently skipping   │
│                                                                  │
│  Preview URLs:                                                   │
│    https://{hash}-besidka-preview.chernenko.workers.dev          │
│    https://pr-{number}-besidka-preview.chernenko.workers.dev     │
│  Production:                                                     │
│    https://besidka.com                                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Workflows

### `preview-build.yml` - PR Build & Test

Triggers on `pull_request` events targeting `main` only (`branches: [main]`). A
stacked PR whose base is another feature branch never triggers this workflow,
and since `preview-deploy.yml` only runs off this workflow's `workflow_run`
completion, stacked sub-PRs get no build or deploy — only the PR targeting
`main` does. Runs in the PR author's context without access to secrets.

1. Check PR is still open
2. Install dependencies
3. Lint + typecheck
4. Run affected tests only (based on changed files vs base branch)
5. Build application
6. Upload build output, `.drizzle`, and metrics as artifacts

### `preview-deploy.yml` - PR Deploy

Triggers on `workflow_run` completion of Preview Build. Runs in the base repo's context with access to secrets.

1. Extract PR number and SHA from `workflow_run` event context (not from artifacts)
2. Check if PR is from a fork - skip deploy if so
3. Download build and `.drizzle` artifacts from the same build run
4. Apply preview D1 migrations from the downloaded `.drizzle` artifact
   - `DB` from `.drizzle/migrations`
   - `CONSENT_DB` from `.drizzle/migrations-consent`
5. Deploy to Cloudflare Workers with PR alias
6. Comment preview URLs and metrics on PR

### `preview-fork-deploy.yml` - Fork PR Deploy (Maintainer-Triggered)

Triggers when a maintainer comments `/deploy-preview` on a fork PR.

1. Verify commenter has write/maintain/admin access
2. Get PR HEAD SHA
3. Find the latest successful Preview Build run for that SHA
4. Download and deploy the build artifact
5. Comment preview URLs on PR

### `production.yml` - Production Deploy

Triggers on push to `main`. Two parallel jobs:

**build-production**: Full test suite, build, deploy to production. Applies
remote migrations to both production databases (`DB`, then `CONSENT_DB`)
before deploy, unconditionally on every run (see below).

**update-preview**: Finds the PR version by alias (`pr-{number}`) and, when
found, promotes it to the preview environment — reusing the exact build that
was already deployed and reviewed on the PR, instead of rebuilding.

**deploy-preview-fallback**: Runs after `update-preview` when either (a) the
push was direct to `main` with no associated PR, or (b) a PR was found but no
`pr-{number}` alias exists for it. Case (b) is not just a theoretical edge
case: `resolve-preview-context` resolves `github.sha` — the HEAD commit of
the push — to find "the" merged PR. When several squash-merge commits land
on `main` in one push (e.g. a stack of PRs merged back-to-back), only the
*last* commit's PR is ever consulted, even though earlier commits' PRs may
have their own valid, unrelated aliases. That last PR can easily have no
alias of its own: restack churn on a stacked branch can get its preview
build cancelled outright, or get a successful build's deploy cancelled
mid-upload by `preview-deploy.yml`'s own concurrency group when a later
restack push supersedes it before the upload finishes. Either way, this job
builds+deploys the `preview-build` artifact from `build-production` fresh —
the same artifact already validated by the full test suite for this exact
`main` HEAD — rather than silently leaving `besidka-preview` on stale code.
It regenerates and applies remote migrations to both preview databases
(`DB`, then `CONSENT_DB`) unconditionally, same as `build-production`. This
job installs dependencies with a plain `pnpm install --frozen-lockfile` (not
`--ignore-scripts`) specifically so `postinstall`'s `nuxt prepare` runs and
`.nuxt/tsconfig.json` exists — `drizzle-kit generate` loads the root
`tsconfig.json`, which `extends` that file, and hard-fails without it.

Both `build-production` and `deploy-preview-fallback` apply migrations to
`DB` and `CONSENT_DB` unconditionally on every run — an earlier git-diff-based
`drizzle-changed` gate was removed because a diff of only the current push's
before/after SHAs could permanently miss a migration if an unrelated prior
run failed before reaching the migration step. `wrangler d1 migrations apply`
is idempotent — it only runs migrations not yet recorded in each database's
`d1_migrations` table, so applying both every time (even when neither
changed) is a harmless no-op.

### `cleanup-runs.yml` - Workflow Run Cleanup

Triggers once per day (`cron: 23 3 * * *`) and manually via
`workflow_dispatch`.

1. Checks out the repository
2. Runs `./scripts/clean-gh-runs.sh --yes --limit 500`
3. Deletes skipped runs and runs matching cleanup title patterns

## Security Model

### The Split Workflow Pattern

Fork PRs pose a security challenge: they need CI (tests, build) but must not access repository secrets. GitHub's `pull_request` event from forks runs without secrets, but `pull_request_target` gives secrets while running base branch code (not the PR code).

The solution is a two-phase approach:

1. **`preview-build.yml`** runs on `pull_request` - executes the fork's code without secrets
2. **`preview-deploy.yml`** runs on `workflow_run` - deploys with secrets after build succeeds

### Key Security Properties

**PR metadata from event context, not artifacts**: The PR number, SHA, and fork status are extracted from `github.event.workflow_run` properties. This prevents command injection via tampered artifact files (e.g., a malicious `pr_number.txt` containing shell commands).

**Fork detection**: Compares `workflow_run.head_repository.full_name` with `workflow_run.repository.full_name`. External contributors can only create PRs from forks, never push branches directly.

**Maintainer-gated fork deployment**: Fork PRs skip automatic deployment. A maintainer must explicitly approve by commenting `/deploy-preview`, which triggers a permission-checked workflow.

**Migration source consistency**: `preview-build.yml` uploads `.drizzle` as an
artifact (both `migrations/` and `migrations-consent/`), and
`preview-deploy.yml` applies migrations for both `DB` and `CONSENT_DB` from
that exact artifact before deploy. This keeps both preview DB schemas aligned
with the deployed PR build.

**Artifact trust boundary**: Build artifacts from forks contain untrusted code. The `/deploy-preview` command means "I reviewed this PR and trust it enough to deploy to preview" - analogous to clicking "Approve and Run" on fork workflow runs.

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
- Fork PRs are gated with maintainer approval

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
One deploy per PR. Falls back to run ID if PR number unavailable.

### `production.yml`
```yaml
group: production
cancel-in-progress: true
```
One production deployment at a time.

## Versioned PR Deployments

Each PR commit creates a Worker version with two preview URLs:

```
PR #123 with 3 commits:

Commit 1 (abc1234):
├─ Auto hash: https://10a5f53f-besidka-preview.chernenko.workers.dev (permanent)
└─ PR alias:  https://pr-123-besidka-preview.chernenko.workers.dev (updated)

Commit 2 (def5678):
├─ Auto hash: https://2b7e4a9c-besidka-preview.chernenko.workers.dev (permanent)
└─ PR alias:  https://pr-123-besidka-preview.chernenko.workers.dev (updated)
```

- **Auto-hash URL**: Unique per commit, permanent
- **PR alias URL**: Stable per PR, updates with each commit
- All versions belong to the same `besidka-preview` worker
- Cloudflare automatically cleans up oldest aliases at 1,000 versions

## Alias-Based Version Promotion

When a PR merges to main, `production.yml` promotes the existing PR version
to the preview environment instead of rebuilding:

1. PR creates version with alias `pr-{number}` via `wrangler versions upload`
2. On merge, `wrangler versions deploy` promotes that version
3. No rebuild needed - exact same code from PR
4. Fast: API call only (~10-20 seconds)

For direct pushes to `main` without an associated PR, `production.yml` falls
back to a standard `wrangler deploy` for preview.

## Cloudflare Environments

**Production** (`--env production`):
- Domain: `besidka.com`
- Bindings: Production D1, KV, R2
- Triggered by: Push to `main`

**Preview** (default environment):
- Domain: `besidka-preview.workers.dev`
- Bindings: Preview D1, KV, R2 (shared by all PR versions)
- Triggered by: PR commits + production merges

## Secrets & Environments

| Secret | Used In | Phase |
|--------|---------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | preview-deploy, preview-fork-deploy, production | Deploy |
| `CLOUDFLARE_API_TOKEN` | preview-deploy, preview-fork-deploy, production | Deploy |
| `github.token` | All workflows | Build + Deploy |

Build-time workflows (`preview-build.yml`) require no secrets. Deploy-time workflows use the `preview` or `production` GitHub Environment.

No repository variables are required. The Wrangler CLI version is pinned as a `devDependency` in `pnpm-lock.yaml` and installed via `pnpm install --frozen-lockfile`; deploy steps use that pinned binary directly, so no `wranglerVersion` input or `WRANGLER_VERSION` variable is needed.

## Fork PR Handling

1. Contributor opens PR from fork
2. `preview-build.yml` runs tests and build (no secrets)
3. `preview-deploy.yml` detects fork, skips deploy, comments:
   > Preview deployment skipped for fork PRs (security policy).
   > A maintainer can comment `/deploy-preview` to trigger deployment.
4. Maintainer reviews PR code
5. Maintainer comments `/deploy-preview`
6. `preview-fork-deploy.yml` verifies permissions, deploys, comments preview URL

## Path Filters

Both `preview-build.yml` and `production.yml` use:
```yaml
paths-ignore:
  - '**/*.md'
```
Markdown-only changes skip CI.

## Local Testing

```bash
# Preview environment (default)
pnpm run deploy

# Production environment
pnpm run deploy --env production

# Versioned deployment with alias (PR simulation)
wrangler versions upload --preview-alias pr-test
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
| `production.yml` → `deploy-preview-fallback` | Direct push, or PR merge with no preview alias found | `… apply DB --remote` | `… apply CONSENT_DB --remote` | Regenerated in-step via `preCommands` |

**Regeneration source.** Preview-deploy applies the exact migration files from
the uploaded `.drizzle` artifact (no regeneration). The production jobs
regenerate before applying via `preCommands`: `pnpm run db:generate` for `DB`
and `pnpm run db:consents:generate` for `CONSENT_DB`.

**Gating.** Both DB and CONSENT_DB apply steps in `production.yml` run
unconditionally on every push, in both `build-production` and
`deploy-preview-fallback` — there is no `.drizzle/`-change gate. An earlier
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
- Cookie-consent / `CONSENT_DB` details: [`/docs/cookie-consent.md`](/docs/cookie-consent.md)
