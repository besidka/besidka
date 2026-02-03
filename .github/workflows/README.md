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
│  │       └─ Deploy version with alias pr-{number}             │
│  │                                                              │
│  │  Result: Two preview URLs (commit hash + PR alias)         │
│  │  URLs: https://{hash}-besidka-preview.chernenko.workers.dev│
│  │        https://pr-{number}-besidka-preview.chernenko.workers.dev│
│                                                                  │
│  Push to Main (Production)                                      │
│  ├─ production.yml                                              │
│  │   ├─ build-production job                                   │
│  │   │   └─ build.yml (full pipeline)                         │
│  │   │       ├─ Tests (all)                                    │
│  │   │       ├─ Build                                          │
│  │   │       └─ Deploy to production                           │
│  │   │                                                          │
│  │   └─ update-preview job
│  │       ├─ Get merged PR number                               │
│  │       └─ Promote PR version to preview                      │
│  │           └─ wrangler deploy --alias pr-{number}           │
│  │                                                              │
│  │  Result: Production updated, PR version promoted to preview │
│  │  Production: https://besidka.com                            │
│  │  Preview: https://besidka-preview.chernenko.workers.dev     │
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
- `pr_number` (number, optional) - PR number for alias

**Behavior:**

1. Install dependencies
2. Run linters (ESLint, TypeScript)
3. Run tests (unit, integration, e2e)
4. Build application
5. Deploy to Cloudflare Workers

**Deployment Logic:**

```bash
# Versioned deployment (PR)
if worker_name_prefix is set:
  Command: wrangler versions upload --preview-alias pr-{pr_number}
  Worker: besidka-preview (version)
  URLs: auto-hash + pr-{number} alias

# Environment-based deployment
elif environment == "production":
  Deploy to: production environment (custom domain)
else:
  Deploy to: preview environment (default worker domain)
```

**Outputs:**
- `url` - Deployment URL
- `preview-hash-url` - Version preview URL (auto hash)
- `preview-alias-url` - Version preview alias URL (PR number)
- `bundle-size` - Bundle size information
- `duration` - Total pipeline duration
- `test-*-time` - Test durations
- `build-time` - Build duration
- `deploy-time` - Deployment duration

### `preview.yml` - PR Deployments

Triggers on pull requests to deploy commit-specific preview environments.

**Behavior:**
1. Calls `build.yml` with:
   - `environment: preview`
   - `worker_name_prefix: {commit-sha}` (signals PR deployment)
   - `pr_number: {number}` (for preview alias)
2. Posts deployment comment to PR with metrics and both URLs

**Result:**
- Each commit creates a version with two URLs
- Auto-hash URL: permanent commit-specific link
- PR alias URL: stable URL for entire PR
- Shared preview resources (D1, KV, R2)

**Example:**
```
PR #123, Commit abc1234:
├─ Auto hash: https://10a5f53f-besidka-preview.chernenko.workers.dev
└─ PR alias:  https://pr-123-besidka-preview.chernenko.workers.dev
```

### `production.yml` - Production Deployments

Triggers on push to `main` branch. Deploys to production, then promotes PR version to preview.

**Behavior:**

1. **Job 1: build-production**
   - Calls `build.yml` with full pipeline
   - Runs all tests
   - Builds application
   - Deploys to production

2. **Job 2: update-preview** (runs in parallel)
   - Gets merged PR number via GitHub API
   - Uses `wrangler deploy --alias pr-{number}` to promote PR version to preview
   - No rebuild needed - reuses version from PR deployment
   - Skips if no PR found (direct push to main)

**Optimization:**
- No artifacts needed
- No rebuild for preview
- Promotes existing PR version
- Fast: just API call + deployment (~10-20 seconds)

**Result:**
- Production: `https://besidka.com`
- Preview: `https://besidka-preview.chernenko.workers.dev`
- Preview runs the exact code that was in the merged PR

### Preview Alias Cleanup (Automatic)

Preview aliases automatically clean up when exceeding 1,000 deployments (Cloudflare retention limit).

**How it works:**
- Each PR commit creates a Worker version with alias: `pr-{number}-besidka-preview.chernenko.workers.dev`
- Versions belong to the single `besidka-preview` worker (not separate workers)
- Cloudflare automatically deletes oldest aliases when limit reached
- Typical PR volume (1-5 commits) means 200+ PRs before cleanup needed

**No manual cleanup workflow required** - Cloudflare handles this automatically.

The previous `cleanup.yml` workflow has been removed as it's no longer needed.

### `update.yml` - PR Auto-Labeling

Triggers on PR events (open, synchronize, reopen) and workflow runs. Automatically adds labels based on changed files.

**Labels:**
- `dependencies` - Lockfile changes
- `ci/cd` - Workflow changes
- `documentation` - Markdown file changes

## Key Concepts

### Versioned PR Deployments

Each PR commit creates a Worker version with two preview URLs:

```
PR #123 with 3 commits:

Commit 1 (abc1234):
├─ Auto hash: https://10a5f53f-besidka-preview.chernenko.workers.dev (permanent)
└─ PR alias:  https://pr-123-besidka-preview.chernenko.workers.dev (updated)

Commit 2 (def5678):
├─ Auto hash: https://2b7e4a9c-besidka-preview.chernenko.workers.dev (permanent)
└─ PR alias:  https://pr-123-besidka-preview.chernenko.workers.dev (updated)

Commit 3 (9abcdef):
├─ Auto hash: https://8f3d1c7e-besidka-preview.chernenko.workers.dev (permanent)
└─ PR alias:  https://pr-123-besidka-preview.chernenko.workers.dev (updated)
```

**Two URLs per commit:**
1. **Auto-hash URL**: Unique per commit, never changes, permanent link
2. **PR alias URL**: Stable per PR, updates with each commit, easy to remember

**Benefits:**
- Share single PR URL with reviewers (`pr-123-besidka-preview.chernenko.workers.dev`)
- Permanent commit-specific URLs for comparison
- ONE worker in dashboard (besidka-preview) instead of many
- No manual cleanup needed (auto-expires after 1,000 aliases)
- No conflicts between PRs (separate PR numbers)

**How it works:**
- `wrangler versions upload --preview-alias pr-{number}` creates a version
- All versions belong to the same `besidka-preview` worker
- Versions share worker bindings (D1, KV, R2)

### Alias-Based Version Promotion

Production deployments optimize CI time by promoting existing PR versions instead of rebuilding:

```
┌─────────────────────────────────────────────────┐
│  PR #123 Deployment (preview.yml)               │
│  └─ wrangler versions upload --preview-alias pr-123 │
│      ↓                                           │
│  Version created with two URLs:                 │
│  ├─ Hash: {hash}-besidka-preview.workers.dev   │
│  └─ Alias: pr-123-besidka-preview.workers.dev  │
│                                                  │
│  PR Merged to Main (production.yml)             │
│  ├─ Job 1: Build + deploy to production         │
│  └─ Job 2: Promote PR version                   │
│      └─ wrangler deploy --alias pr-123          │
│          ↓                                       │
│  Preview updated without rebuild (10-20 sec)    │
│      besidka-preview.chernenko.workers.dev      │
└─────────────────────────────────────────────────┘
```

**Why this works:**
- PR creates version with alias `pr-{number}`
- `wrangler deploy --alias pr-{number}` promotes that version to main preview
- No rebuild needed - exact same code from PR
- Environment selection happens at deployment (bindings differ between preview/prod)

**Benefits:**
- Simple workflow (no artifacts)
- Fast preview updates
- Guaranteed consistency (exact PR code)
- No wasted build time

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
- Check PR comments for deployment URLs (both hash and alias) and metrics
- GitHub Actions tab → "Build" workflow run
- Cloudflare dashboard → Workers → `besidka-preview` (single worker with versions)

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

# Versioned deployment with alias (PR simulation)
wrangler versions upload --preview-alias pr-test
```

## Performance Metrics

Typical workflow durations:

| Workflow | Tests | Build | Deploy | Total |
|----------|-------|-------|--------|-------|
| PR (preview.yml) | 4-6 min | 1-2 min | 30-60s | 6-9 min |
| Production (artifact-based, deprecated) | 4-6 min (×1) | 1-2 min (×1) | 30-60s (×2) | 9-11 min |
| Production (alias-based, current) | 4-6 min (×1) | 1-2 min (×1) | 30-60s + 10-20s | 7-10 min |

**Optimization savings:** Alias-based approach is ~1-2 minutes faster and simpler than artifact-based.

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
