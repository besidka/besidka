# pnpm to Bun evaluation: why the project stays on pnpm

**Status: closed, 2026-10-23.** The project stays on pnpm. The owner asked
for everything to remain on pnpm and for this record to stop the question
from coming back. Do not reopen it unless one of the conditions under
"Revisit when" is met; name that condition when you do.

Evaluated on 2026-10-22 against pnpm 12.10.1, Bun 1.3.14 (local) and Bun
1.4.3/1.4.4 (1.4.4 was published the same day), then trialled in CI the same
day on Bun 1.4.3 (draft PR besidka/besidka#489, closed unmerged).

## Verdict

Stay on pnpm. A migration is technically feasible as a package manager swap
only, but the measurable gain is a few seconds per CI job. There is one policy
blocker (Dependabot security updates are not available for Bun) and several
friction points. The CI trial confirmed this on real runs: the experiment
measured no speed advantage anywhere; the decision is cost versus a gain of
roughly zero. Nothing outside the documentation changed: `main` has no Bun
files, workflow steps or `package.json` fields, and the trial branch was
deleted.

## The ceiling: what a package manager can speed up

`bun run` and `bunx` honour the `#!/usr/bin/env node` shebang of `nuxt`,
`vitest`, `wrangler`, `eslint` and `playwright`, so those tools still run on
Node unless `--bun` is passed. Swapping the package manager therefore only
moves the install step and per-script startup.

Real GitHub Actions step timings, production workflow run on 2026-10-22
(`Build and Deploy to Production`, total about 15m47s):

| Step | Time |
| --- | --- |
| Setup PNPM | 3s |
| Install Node.js (cache restore) | 1s |
| Install dependencies | 8s |
| Post Install Node.js (cache save) | 7s |
| ESLint | 15s |
| Typecheck | 15s |
| All unit tests | 3m43s |
| All integration tests | 55s |
| Playwright install | 17s |
| Build | 85s |
| All E2E tests | 7m38s |
| Deploy | 25s |

Preview build (`preview-build.yml`, recent successful run): Setup PNPM 5s,
Install Node.js 4s, Install dependencies 10s, ESLint 24s, typecheck 22s,
affected unit tests 28s, affected integration tests 7s, build 69s.

The pnpm-attributable time is about 18-19s of about 950s on production (around
2%) and about 19s of about 3 minutes on a preview build. Even a 2x faster
installer saves single-digit seconds per job.

### Local benchmark

Apple Silicon, same commit, `--frozen-lockfile --ignore-scripts`,
`node_modules` deleted between runs, warm global store and cache:

| Run | pnpm 12.10.1 | Bun 1.3.14 |
| --- | --- | --- |
| First run (Bun cache mostly cold, pnpm store warm) | 5.4s | 7.4s |
| Warm reinstall | 2.3s | 1.5s / 1.5s |

Script startup: 10 consecutive `pnpm run <noop>` calls took 0.86s in total
(about 86ms per call). Bun's per-call overhead is a few milliseconds; at tens
of script invocations per CI job that is under a second.

The CI install step already includes store restore through
`actions/setup-node` with `cache: pnpm`. Bun would need `oven-sh/setup-bun@v2`
plus a manual `actions/cache` on `~/.bun/install/cache` keyed on `bun.lock`, so
the CI delta is smaller than the local one. The CI trial below measured it.

### Bun as a runtime is out of scope

The other Bun features (fast runtime, `bun test`, bundler) would require
switching the runtime, which is not viable here:

- `bun test` cannot replace Vitest: there is no `.vue` SFC support
  (oven-sh/bun#5967, open) and no equivalent of `@nuxt/test-utils`,
  `mockNuxtImport` or `vitest-environment-nuxt`.
- Vitest's documentation only says to use `bun run test`, which runs Vitest on
  Node. It does not list Bun as a supported runtime.
- Nuxt documents the Bun runtime (`bun --bun run dev`) as optional. Open Bun
  issues include #16898 (10 GB allocation in dev) and #19139 (dev server
  crashes).
- Wrangler and Miniflare under the Bun runtime are undocumented.
  cloudflare/workers-sdk#16300 (open, 2026-10-15) reports intermittent
  "Controller is already closed" errors under Bun 1.4.3.
- Playwright under `bun --bun`: oven-sh/bun#28609 (test runner fails) and
  oven-sh/bun#30652 (`recordHar` deadlock) are open.

Production code is unaffected either way: it runs on workerd, not on Node or
Bun.

## Blockers

### 1. Dependabot security updates are not supported for `bun`

GitHub's supported-ecosystems table (checked 2026-10-22) lists Bun with version
updates supported, security updates not supported, and a minimum of Bun 1.1.39.
npm and pnpm support both.

This is an open-source app that holds users' provider API keys. Losing
automated security pull requests is a regression that a few seconds of CI time
does not justify.

Source:
https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories

### 2. The nested override needs Bun 1.4 or newer

`pnpm-workspace.yaml` contains the nested override
`fontless>esbuild: '>=0.28.1'`. Bun supports nested overrides only from 1.4.0
(bun.sh/docs/install/overrides; one parent level only) and writes a `bun.lock`
with `lockfileVersion` 3 that older Bun cannot read. Bun 1.3.14 accepted the
key silently.

Observed in the trial: a fresh resolve wrote `lockfileVersion` 1 on 1.3.14 and
3 on 1.4.3. In both, every esbuild resolution matched pnpm's: root
`esbuild@0.28.2`, and `drizzle-kit`, `mkdist`, `unbuild` and
`@intlify/bundle-utils` on `esbuild@0.25.12`. The override is therefore
currently a no-op for resolution, but a silent loss on an old Bun would go
unnoticed on the day it starts to matter.

Every contributor, every CI job and Cloudflare Workers Builds (which defaults
to Bun 1.2.15 and is overridden with `BUN_VERSION`) would need Bun 1.4 or newer
pinned. Bun 1.4.4 was published on the day of this evaluation. pnpm's
`minimumReleaseAge` does not gate the Bun binary itself (it arrives via
`oven-sh/setup-bun`, `BUN_VERSION` or Homebrew), but the project's practice of
waiting a day on new releases means 1.4.4 would not be adopted on release
day.

## Friction found in the scratch trial

Fixable, but each item is work with no offsetting gain:

- **`bun pm migrate` fails on pnpm 12's lockfile with Bun 1.3.14.** The error
  is `pnpm-lock.yaml root must be an object, got e_array`
  (`PnpmLockfileNotObject`). pnpm 12 writes a two-document YAML file: a leading
  `packageManagerDependencies` document for pnpm itself, then the real
  lockfile. The workaround was to strip the first document (lines 1-157) before
  migrating. Bun 1.4.3 migrates the unmodified two-document file (3.3s), so this
  only affects Bun 1.3.x.
- **Workspace layout.** The migrator moved `packages: ['.', 'modules/*']` to
  `"workspaces": [".", "modules/*"]`, listing the root as its own workspace
  (removed by hand), and copied `overrides` verbatim.
- **`allowBuilds` is not translated.** It must be converted by hand to
  `trustedDependencies: ["@parcel/watcher", "better-sqlite3", "esbuild",
  "sharp", "unrs-resolver", "workerd"]`. The `false` entries need nothing:
  lifecycle scripts of unlisted packages are blocked by default, and an
  explicit list replaces Bun's built-in default list.
- **The release-age cooldown must be set explicitly.** Use
  `[install] minimumReleaseAge = 86400` in `bunfig.toml`, plus
  `minimumReleaseAgeExcludes`. The unit is seconds, while pnpm's is minutes.
  pnpm 11 and newer defaults to 1440 minutes; Bun defaults to none.
- **Isolated linker.** Bun uses the isolated linker (`node_modules/.bun/...`)
  for a workspace migrated from pnpm (`configVersion` 1). The trial build and
  tests worked with it.
- **Hardcoded `pnpm` call sites** that would all need changing:
  - `package.json` scripts (`pnpm run`, `pnpm exec`,
    `pnpm --filter @besidka/nuxt-cookie-consent ...`, which becomes
    `bun run --filter ...`)
  - `playwright.config.ts` webServer commands
  - `.husky/pre-commit` and `.husky/commit-msg`
  - `scripts/test-affected.mjs`
  - `tests/unit/db/migrations-clean.spec.ts`, which executes
    `pnpm exec drizzle-kit generate`
  - 67 `pnpm` references across 5 workflow files (`pnpm/action-setup`,
    `setup-node` with `cache: pnpm`, and `cloudflare/wrangler-action` with
    `packageManager: pnpm`; wrangler-action v4.1.3 does accept `bun`)
  - `.npmrc` (`save-exact`) and the Dependabot cooldown comment
  - the "use pnpm exclusively" rule in `AGENTS.md`
  - more than 80 markdown files that mention pnpm

## Scratch trial results

Bun 1.3.14 on an isolated copy outside the repository, Node 24.18 as the
runtime:

| Step | Result |
| --- | --- |
| `bun install --frozen-lockfile` (with lifecycle scripts) | pass, 9s |
| `bun run --filter @besidka/nuxt-cookie-consent dev:prepare` | pass |
| `nuxt prepare` | pass |
| `bun run lint` | pass, 16s |
| `bun run typecheck` | pass, 20s |
| `bun run test:unit` | 5989/5992 pass, 3 failures, none Bun-related |
| `bun run test:integration` | 829/830 pass, 1 failure, not Bun-related |
| cookie-consent module tests | pass |
| `bun run build` | pass, 51.5s, 14 MB (3.4 MB gzip) |

The failures, explained:

- `tests/unit/db/migrations-clean.spec.ts` (2 failures): the spec hardcodes
  `pnpm exec`, and pnpm refused with `ERR_PNPM_OTHER_PM_EXPECTED` because
  `packageManager` was `bun@...`.
- `tests/unit/config/seo.spec.ts` (1 failure) and
  `tests/integration/api/chats-share-create.spec.ts` (1 failure):
  `NUXT_PUBLIC_BASE_URL` leaked from the evaluator's shell, a known pitfall.
  Run these with `env -u NUXT_PUBLIC_BASE_URL`.

Not run in the scratch trial: E2E (needs `.dev.vars`), `wrangler dev`,
`wrangler preview` and `deploy`. The CI trial below covers E2E and the build.

## Local comparison

Same commit, same Apple Silicon machine, isolated copies, Node 24.18 as the
runtime, two rounds. pnpm always ran before Bun in each round, so Bun ran with
warmer OS file caches: an ordering bias in Bun's favour.

| Command | pnpm r1 / r2 | Bun r1 / r2 |
| --- | --- | --- |
| lint | 17.3s / 15.2s | 14.8s / 13.9s |
| typecheck | 16.4s / 13.8s | 13.9s / 12.5s |
| test:unit | 60.5s / 49.1s | 57.9s / 49.6s |
| test:integration | 15.0s / 14.8s | 14.6s / 15.5s |
| cookie-consent tests | 2.9s / 2.4s | 2.2s / 2.2s |
| nuxt build (cold, cold, warm, warm) | 55.5 / 54.1 / 52.8 / 51.8s | 51.1 / 53.8 / 51.6 / 52.1s |
| nuxt dev to first 200 (cold / warm, single run) | 38.0s / 21.5s | 35.1s / 20.1s |

The two Bun `test:unit` failures in those local copies came from the old
scratch copy still calling `pnpm exec drizzle-kit`. On the trial branch all
5992 tests pass. E2E was not run locally (it needs `.dev.vars`); the CI trial
covers it.

The differences are within noise and the ordering bias. No tool here runs on
Bun, so there is nothing for the faster installer to speed up.

## CI trial (besidka/besidka#489)

Setup: branch `experiment/bun-ci-trial`. Only the `Build PR` job in
`preview-build.yml` was switched to `oven-sh/setup-bun@v2` (Bun 1.4.3),
`actions/cache@v6` on `~/.bun/install/cache` keyed on `bun.lock`, and
`bun install --frozen-lockfile`, with scripts run through `bun run` and `bunx`
(still Node). The repository was a hybrid: `pnpm-lock.yaml`,
`pnpm-workspace.yaml` and `packageManager: pnpm` were kept, because
`preview-deploy.yml` is a `workflow_run` workflow that always runs main's
(pnpm) copy against the PR head. Changing `package.json` forced the full unit,
integration and e2e suites, so every step below is a full-suite number.

Build PR job, full suites:

| Step | Bun cold cache (attempt 1) | Bun warm cache (attempt 2) | pnpm `8a2baf7c` (#484) | pnpm `e6e9dce9` |
| --- | --- | --- | --- | --- |
| Setup Bun / Setup PNPM | 2s | 0s | 5s | 6s |
| Install Node.js (pnpm: incl. store cache restore) | 0s | 1s | 1s | 7s |
| Cache restore (Bun only) | 0s (miss) | 10s | - | - |
| Install dependencies | 6s | 7s | 10s | 12s |
| Cache save (post step) | 17s | 0s (hit, no save) | 3s | 0s |
| Package-manager total | 25s | 18s | 19s | 25s |
| ESLint | 26s | 22s | 23s | 26s |
| Typecheck | 24s | 18s | 26s | 20s |
| Unit tests (full) | 2:26 | 2:15 | 2:58 | 2:21 |
| Integration tests (full) | 33s | 31s | 39s | 43s |
| Build | 1:35 | 1:04 | 1:17 | 1:52 |
| E2E (full) | 7:47 | 6:04 | 6:27 | 7:45 |
| Whole job | 14:42 | 11:28 | 13:32 | 14:32 |

Baseline context: across 50 successful pnpm `preview-build` runs
(2026-10-13..22) the package-manager steps had a median of 17s (max 104s, one
76s `Setup PNPM` outlier). Across 14 production runs the median was 19s (max
32s) of a 15m11s median job, where unit tests (3:58), e2e (7:26) and build
(1:09) dominate.

Reading:

- Warm Bun is about equal to pnpm on the install path. Cache restore dominates
  both.
- Cold Bun is slower because `actions/cache` spends about 17s saving the cache
  on a miss.
- Every other step falls within pnpm's own run-to-run spread, because the tools
  run on Node either way.
- The warm attempt finished in 11:28, faster than both pnpm baselines, but the
  whole difference sits in build (1:04) and e2e (6:04), which run on Node
  regardless of package manager. The cold attempt of the same commit took
  14:42. A three-minute swing between two runs of identical code on the same
  runner type is runner variance, an order of magnitude larger than anything
  the package manager can move, so the whole-job totals are not evidence for
  either tool.

Gotcha: re-running a finished `Preview Build` deletes and replaces its
artifacts, so the `Preview Deploy` already triggered by the first attempt
failed with "Artifact not found for name: preview-build". This is not
Bun-related; the deploy for the re-run is the valid one. The deploy of the
warm re-run succeeded: main's pnpm 12 workflow installed the hybrid tree with
`pnpm install --frozen-lockfile --ignore-scripts` in 5s, applied both D1
migration sets and deployed `pr-489`. This confirms the hybrid branch stays
pnpm-compatible in CI, not only locally.

Friction the trial needed (12 files touched):

- `package.json` needed `workspaces`, `overrides` and `trustedDependencies`.
- `bunfig.toml` needed `minimumReleaseAge = 86400`.
- `bun.lock` is `lockfileVersion` 3. Main's `.gitignore` deliberately ignores
  `bun.lock*`, so the trial un-ignored it on the branch only.
- The 1.4.3 migrator injects `"."` into `workspaces` (removed by hand).
- Bun's bin shims do not set `NODE_PATH` the way pnpm's do, so
  `tests/unit/db/migrations-clean.spec.ts` could not resolve `drizzle-kit`
  until `NODE_PATH` was set explicitly.
- Every hardcoded `pnpm` in `postinstall`, `playwright.config.ts`,
  `scripts/test-affected*.mjs` and three e2e/unit specs had to become
  `node --run` or `node_modules/.bin`.
- pnpm 12 still installs the hybrid tree, but warns that `workspaces` differs
  from `pnpm-workspace.yaml`.

## Should Bun be used in general here?

No. Production runs on workerd, and every dev, test and build tool runs on Node
under both package managers. Bun as a runtime is not viable (see "Bun as a
runtime is out of scope" above). The remaining package-manager-level gain is
about 0s per CI job and about 1s per local install.

Against that gain stand:

- Dependabot has no security updates for `bun`.
- The Bun 1.4 floor (Workers Builds defaults to 1.2.15).
- Recreating pnpm 12's supply-chain defaults in `bunfig.toml`: a one-day
  release age by default, `allowBuilds` and lockfile policy verification.
- The friction list above.

## Revisit when

- Dependabot supports security updates for the `bun` ecosystem (re-check the
  supported-ecosystems table linked above).
- Bun 1.4 or newer is the long-established floor everywhere (the Workers Builds
  default, contributor machines), and `bun pm migrate` translates `allowBuilds`
  (pnpm 12 lockfiles already migrate on 1.4.3).
- CI time becomes install-bound. Today it is test- and build-bound: unit tests
  (3m43s) and E2E (7m38s) account for about 11 of roughly 16 minutes. Those are
  the real levers (sharding, affected-only runs) and are independent of the
  package manager.
- A concrete Bun runtime need appears. That is a separate and much larger
  evaluation.
