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
│  │   └─ Upload artifacts (build output + metrics)                │
│  │                                                               │
│  └─ preview-deploy.yml (workflow_run, privileged)                │
│      ├─ Download artifacts from build                            │
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
│      └─ update-preview job (parallel)                            │
│          ├─ Get merged PR number                                 │
│          └─ Promote PR version to preview                        │
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

Triggers on `pull_request` events. Runs in the PR author's context without access to secrets.

1. Check PR is still open
2. Install dependencies
3. Lint + typecheck
4. Run affected tests only (based on changed files vs base branch)
5. Build application
6. Upload build output and metrics as artifacts

### `preview-deploy.yml` - PR Deploy

Triggers on `workflow_run` completion of Preview Build. Runs in the base repo's context with access to secrets.

1. Extract PR number and SHA from `workflow_run` event context (not from artifacts)
2. Check if PR is from a fork - skip deploy if so
3. Download build artifact and metrics
4. Deploy to Cloudflare Workers with PR alias
5. Comment preview URLs and metrics on PR

### `preview-fork-deploy.yml` - Fork PR Deploy (Maintainer-Triggered)

Triggers when a maintainer comments `/deploy-preview` on a fork PR.

1. Verify commenter has write/maintain/admin access
2. Get PR HEAD SHA
3. Find the latest successful Preview Build run for that SHA
4. Download and deploy the build artifact
5. Comment preview URLs on PR

### `production.yml` - Production Deploy

Triggers on push to `main`. Two parallel jobs:

**build-production**: Full test suite, build, deploy to production.

**update-preview**: Finds the PR version by alias and promotes it to the preview environment. Skips gracefully if no PR found (direct push to main) or no version exists.

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

When a PR merges to main, `production.yml` promotes the existing PR version to the preview environment instead of rebuilding:

1. PR creates version with alias `pr-{number}` via `wrangler versions upload`
2. On merge, `wrangler versions deploy` promotes that version
3. No rebuild needed - exact same code from PR
4. Fast: API call only (~10-20 seconds)

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

| Variable | Description |
|----------|-------------|
| `WRANGLER_VERSION` | Wrangler CLI version (default: `4.62.0`) |

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

## Related Documentation

- Project setup: [`/CLAUDE.md`](/CLAUDE.md)
- Cloudflare configuration: [`/wrangler.jsonc`](/wrangler.jsonc)
