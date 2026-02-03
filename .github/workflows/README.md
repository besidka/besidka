# GitHub Actions Workflows

This directory contains CI/CD workflows for building, testing, and deploying Besidka to Cloudflare Workers.

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         WORKFLOW ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Pull Request (PR)                                              │
│  ├─ preview.yml                                                 │
│  │   └─ build.yml (full pipeline)                              │
│  │       ├─ Tests (unit, integration, e2e)                     │
│  │       ├─ Build                                              │
│  │       └─ Deploy to {hash}-besidka-preview                   │
│  │                                                              │
│  │  Result: Commit-specific versioned worker                   │
│  │  URL: https://{7-char-hash}-besidka-preview.workers.dev    │
│                                                                  │
│  Push to Main (Production)                                      │
│  ├─ production.yml                                              │
│  │   ├─ build-production job                                   │
│  │   │   └─ build.yml (full pipeline, skip_build=false)       │
│  │   │       ├─ Tests (all)                                    │
│  │   │       ├─ Build                                          │
│  │   │       ├─ Upload artifact                                │
│  │   │       └─ Deploy to production                           │
│  │   │                                                          │
│  │   └─ update-preview job (runs after build-production)       │
│  │       └─ build.yml (deploy-only, skip_build=true)          │
│  │           ├─ Download artifact                              │
│  │           └─ Deploy to preview                              │
│  │                                                              │
│  │  Result: Both environments updated with same build          │
│  │  Production: https://besidka.com                            │
│  │  Preview: https://besidka-preview.workers.dev               │
│                                                                  │
│  PR Close/Merge                                                 │
│  └─ cleanup.yml                                                 │
│      └─ Delete all {hash}-besidka-preview workers for PR       │
│                                                                  │
│  PR Update (commits, labels, etc.)                             │
│  └─ update.yml                                                  │
│      └─ Add labels based on file changes                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Workflows

### `build.yml` - Reusable Build & Deploy Workflow

The core workflow that runs tests, builds, and deploys the application. Used by both PR and production workflows.

**Inputs:**
- `environment` (string, default: `production`) - Target environment (production/preview)
- `worker_name_prefix` (string, optional) - Commit hash for versioned deployment
- `skip_build` (boolean, default: `false`) - Skip tests/build, download artifact instead

**Behavior:**

1. **Full Pipeline Mode** (`skip_build: false`):
   - Install dependencies
   - Run linters (ESLint, TypeScript)
   - Run tests (unit, integration, e2e)
   - Build application
   - Upload build artifact (`build-output-{run-id}`)
   - Deploy to Cloudflare Workers

2. **Deploy-Only Mode** (`skip_build: true`):
   - Download build artifact from previous job
   - Deploy to Cloudflare Workers
   - All test/build outputs return "skipped" or "reused"

**Deployment Logic:**

```bash
# Versioned deployment (PR)
if worker_name_prefix is set:
  Deploy to: {first-7-chars}-besidka-preview

# Environment-based deployment
elif environment == "production":
  Deploy to: production environment (custom domain)
else:
  Deploy to: preview environment (default worker domain)
```

**Outputs:**
- `url` - Deployment URL
- `bundle-size` - Bundle size or "reused from previous build"
- `duration` - Total pipeline duration
- `test-*-time` - Test durations or "skipped"
- `build-time` - Build duration or "skipped"
- `deploy-time` - Deployment duration

### `preview.yml` - PR Deployments

Triggers on pull requests to deploy commit-specific preview environments.

**Behavior:**
1. Calls `build.yml` with:
   - `environment: preview`
   - `worker_name_prefix: {commit-sha}` (full 40-char SHA, truncated to 7 in build.yml)
2. Posts deployment comment to PR with metrics and URL

**Result:**
- Each commit gets its own worker: `{hash}-besidka-preview.workers.dev`
- Old versions remain accessible until PR closes
- Shared preview resources (D1, KV, R2)

**Example:**
```
Commit abc1234... → https://abc1234-besidka-preview.workers.dev
Commit def5678... → https://def5678-besidka-preview.workers.dev
```

### `production.yml` - Production Deployments

Triggers on push to `main` branch. Optimized to run tests once and deploy to both environments.

**Behavior:**

1. **Job 1: build-production**
   - Calls `build.yml` with `skip_build: false`
   - Runs full test suite
   - Builds application
   - Uploads artifact (`build-output-{run-id}`)
   - Deploys to production

2. **Job 2: update-preview** (runs after job 1)
   - Calls `build.yml` with `skip_build: true`
   - Downloads artifact from job 1
   - Deploys to preview (general staging domain)

**Optimization:**
- Before: Ran full pipeline twice (~16-24 minutes)
- After: Runs tests once, deploys twice (~9-11 minutes)
- **~50% time reduction**

**Result:**
- Production: `https://besidka.com`
- Preview: `https://besidka-preview.workers.dev`
- Both environments run identical build artifacts

### `cleanup.yml` - PR Worker Cleanup

Triggers when a PR is closed (merged or rejected). Deletes all versioned workers for that PR.

**Behavior:**
1. Fetch all commit SHAs from the PR via GitHub API
2. For each commit, delete worker: `{hash}-besidka-preview`
3. Ignore errors if worker doesn't exist

**Why:**
- Prevents worker accumulation (10,000 worker limit per account)
- Keeps Cloudflare dashboard clean
- Removes unused preview environments

### `update.yml` - PR Auto-Labeling

Triggers on PR events (open, synchronize, reopen) and workflow runs. Automatically adds labels based on changed files.

**Labels:**
- `dependencies` - Lockfile changes
- `ci/cd` - Workflow changes
- `documentation` - Markdown file changes

## Key Concepts

### Versioned PR Deployments

Each PR commit gets a unique worker URL using the first 7 characters of the commit SHA:

```
PR #123 with 3 commits:
├─ abc1234-besidka-preview.workers.dev  (commit 1)
├─ def5678-besidka-preview.workers.dev  (commit 2)
└─ 9abcdef-besidka-preview.workers.dev  (commit 3)  ← latest

All three remain accessible until PR closes.
```

**Benefits:**
- Test multiple versions simultaneously
- Share specific commit URLs with reviewers
- Compare behavior across commits
- No conflicts between concurrent PRs

**Trade-offs:**
- Shared preview resources (D1, KV, R2)
- Data conflicts possible if testing overlapping features
- Uses build minutes on every commit

### Build Artifact Reuse

Production deployments optimize CI time by building once and deploying twice:

```
┌─────────────────────────────────────────────────┐
│  Job 1: build-production                        │
│  ├─ Run tests (7-10 minutes)                    │
│  ├─ Build app (1-2 minutes)                     │
│  ├─ Upload .output/ artifact                    │
│  └─ Deploy to production                        │
│      ↓                                           │
│  .output/ artifact (retention: 1 day)           │
│      ↓                                           │
│  Job 2: update-preview                          │
│  ├─ Download .output/ artifact (10-20 seconds)  │
│  └─ Deploy to preview                           │
└─────────────────────────────────────────────────┘
```

**Why this works:**
- Nuxt `runtimeConfig` evaluated at runtime, not build time
- Cloudflare bindings accessed at runtime via `event.context.cloudflare.env`
- Environment selection happens during deployment (`--env production` vs default)
- Same build artifact works for both environments

**Artifact details:**
- Name: `build-output-{github.run_id}` (unique per workflow run)
- Contents: `.output/` directory (Nuxt build output)
- Retention: 1 day (auto-cleanup)
- Size: ~5-10 MB compressed

### Cloudflare Environments

The project uses two Cloudflare Worker environments defined in `wrangler.jsonc`:

**Production** (`--env production`):
- Domain: `besidka.com` (custom domain)
- Bindings: Production D1, KV, R2
- Triggered by: Push to `main`

**Preview** (default environment):
- Domain: `besidka-preview.workers.dev`
- Bindings: Preview D1, KV, R2 (shared by all PR workers)
- Triggered by: PR commits + production updates

**Versioned workers** inherit preview bindings but get unique names.

## Concurrency

### `preview.yml`
```yaml
concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```
- One deployment per PR at a time
- New commits cancel in-progress deployments
- Prevents resource conflicts

### `production.yml`
```yaml
concurrency:
  group: production
  cancel-in-progress: true
```
- One production deployment at a time
- New pushes cancel in-progress deployments
- Ensures deployment consistency

### `cleanup.yml`
```yaml
concurrency:
  group: cleanup-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```
- One cleanup per PR at a time
- Prevents race conditions

## Secrets Required

Configured in GitHub repository settings:

- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account identifier
- `CLOUDFLARE_API_TOKEN` - API token with Workers, KV, R2, D1 permissions

**Note:** `GITHUB_TOKEN` is auto-generated and used for API access (PR comments, label management).

## Path Filters

### `production.yml`
```yaml
paths-ignore:
  - '**/*.md'
```
- Markdown-only changes don't trigger deployments
- Reduces unnecessary builds for documentation updates

### `update.yml`
```yaml
paths:
  - 'pnpm-lock.yaml'
  - '.github/workflows/**'
  - '**/*.md'
```
- Only runs when files matching these patterns change
- Efficient label management without full CI runs

## Monitoring & Debugging

### View Deployment Status

**PR deployments:**
- Check PR comments for deployment URL and metrics
- GitHub Actions tab → "Build" workflow run
- Cloudflare dashboard → Workers → `{hash}-besidka-preview`

**Production deployments:**
- GitHub Actions tab → "Deploy to Production" workflow run
- Check both `build-production` and `update-preview` jobs
- Cloudflare dashboard → Workers → `besidka` (production), `besidka-preview` (preview)

### Common Issues

**Issue: "script will never generate a response"**
- Cause: Exceeded 6 simultaneous Cloudflare connections
- Solution: Use batch operations or sequential processing (see `CLAUDE.md`)

**Issue: Artifact not found (deploy-only mode)**
- Cause: First job failed or didn't upload artifact
- Solution: Check `build-production` job logs, ensure tests passed

**Issue: Worker not deleted during cleanup**
- Cause: Worker name mismatch or already deleted
- Solution: Check cleanup logs, verify worker name pattern in Cloudflare dashboard

**Issue: Type errors in workflows**
- Cause: Modified `.yml` files without validation
- Solution: Run `pnpm run format` (lints YAML syntax)

## Local Testing

### Test build workflow locally (requires [act](https://github.com/nektos/act))

```bash
# Simulate PR deployment
act pull_request -W .github/workflows/preview.yml

# Simulate production deployment
act push -W .github/workflows/production.yml

# Note: Requires Docker and Cloudflare secrets in .secrets
```

### Manual deployment

```bash
# Preview environment (default)
pnpm run deploy

# Production environment
pnpm run deploy --env production

# Versioned worker (PR simulation)
pnpm run deploy --name abc1234-besidka-preview
```

## Performance Metrics

Typical workflow durations:

| Workflow | Tests | Build | Deploy | Total |
|----------|-------|-------|--------|-------|
| PR (preview.yml) | 4-6 min | 1-2 min | 30-60s | 6-9 min |
| Production (before optimization) | 8-12 min (×2) | 2-4 min (×2) | 1-2 min (×2) | 16-24 min |
| Production (after optimization) | 4-6 min (×1) | 1-2 min (×1) | 30-60s (×2) | 9-11 min |

**Optimization savings:** ~50% reduction in production deployment time.

## Future Improvements

Potential enhancements:

1. **Separate preview resources per PR** - Use Cloudflare namespaces for isolated testing
2. **E2E tests on deployed preview** - Run Playwright against actual preview URL
3. **Performance budgets** - Fail builds if bundle size exceeds threshold
4. **Automated rollback** - Deploy previous version if production healthcheck fails
5. **Preview environment cleanup schedule** - Daily cron to delete stale workers
6. **Build cache optimization** - Cache node_modules between runs (limited benefit on Cloudflare Workers)

## Related Documentation

- Project setup: [`/CLAUDE.md`](/CLAUDE.md)
- Cloudflare configuration: [`/wrangler.jsonc`](/wrangler.jsonc)
- Deployment guide: [`/README.md`](/README.md)
