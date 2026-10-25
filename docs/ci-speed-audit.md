# CI/CD speed audit (2026-10-24)

An audit of every workflow that builds and deploys the app:
`preview-build.yml`, `preview-deploy.yml`, `production.yml`, plus the test
configs (`playwright.config.ts`, `vitest.config.mts`,
`scripts/test-affected*.mjs`). Goal: bring the build back to 5–7 min without
losing quality, on free GitHub-hosted runners or on Blacksmith 2 vCPU.

**Status:** stages 0, 1 and 2 of the plan below, and the migration check
from F6, are implemented in the PR that adds this document: the Playwright
cache, `--only-shell` and no `--with-deps`, the dropped duplicate
`nuxt prepare`, merged gate jobs, the cookie-consent module tests on main,
the parallel job graph with 3 job-level E2E shards, a full-suite run on every
PR (the affected selection is gone from CI), and a `gate` job on main that
skips lint, typecheck, unit, integration and E2E when the merged PR passed the
full suite on a matching tree (`scripts/ci/resolve-production-test-source.mjs`;
main still builds and deploys its own build). Instead of generating migrations
before applying them to production, `static` now fails a PR whose schema
changed without a committed migration. Stage 3 remains open. The "Now" column
and the measurements below describe the pipeline as it was before these
changes.

**Observed on PR #499 (GitHub-hosted, 2026-10-25):**

| Run | Wall time | Longest legs |
|---|---|---|
| Preview Build (all tests affected) | 6m58s | Build 2m12s → slowest E2E shard 4m18s; Unit 4m20s in parallel |
| `production.yml` dry run (no deploy job) | 6m06s | Build 2m10s → slowest E2E shard 3m44s; Unit 4m31s in parallel |

- E2E shards: setup 21–39 s, `prepare-e2e` 19–29 s (cold Playwright cache),
  tests 120–182 s per shard.
- Add Preview Deploy (~1.1 min), and push → preview URL is about 8 min
  (before: ~16.7 min). Add the deploy job (~1.2–1.5 min, not yet observed),
  and merge → production is about 7.5 min (before: ~14 min).
- The unit job is the second-longest leg: its vitest step took 230 s on both
  runs (the audit baseline on the same runner type was ~150 s). It finishes
  ~2 min before the critical path ends, so stage 3 (node environment and
  `--pool=threads`) becomes the next lever if the suite keeps growing.
- Not yet observed: the production `deploy` job (first runs on the first
  merge to main) and a Playwright cache restore (the cache was saved on this
  branch; `main` will save its own on its first run).

## TL;DR

| | Now (GitHub-hosted, `ubuntu-24.04`) | Target |
|---|---|---|
| PR: push → preview URL | ~15.6 min build + ~1.1 min deploy | **~6–7 min** |
| main: merge → production | ~14 min (p90 ~21 min) | **~3 min** (tree = PR) / **~7 min** (tree changed) |
| Random 7–8 min Playwright install | happens | **impossible** |

What actually costs time (in order of impact):

1. **E2E runs strictly sequentially** (`workers: 1`): 159 tests, 404 s of net
   test time, which is 45% of the whole job. The reason for `workers: 1`
   (Vite HMR) was removed back in #341, but parallelism was never turned on.
   Fix: shard E2E into 3 jobs.
2. **Everything runs in one sequential job**: lint → typecheck → unit →
   integration → browsers → build → e2e. On 4 vCPU most of the cores sit
   idle most of the time. Fix: a graph of parallel jobs.
3. **The Playwright cache on main is dead** (a `~` bug), so browsers are
   installed on every production run, and new PR branches miss the cache
   too. The 7.5 min case is an apt download of fonts from an Azure mirror at
   60 kB/s, not the browser.
4. **main repeats everything the PR already passed**: in 25 of the last 37
   merges, the tree of files that go into the build is identical to the PR
   head. Fix: on main, skip the tests when the tree matches (provided the PR
   runs the full suite).
5. **Unit tests**: all 332 files boot the Nuxt environment; on GitHub-hosted
   this takes 150 s. After parallelization they are not on the critical
   path, so this is stage 3.

Moving to Blacksmith 4 vCPU is not needed. The repository is **public**, and
for public repositories the standard GitHub-hosted runners (4 vCPU / 16 GB)
are free with no minute limit, so parallel jobs cost nothing there.

## How we measured

- 300 runs via `gh api .../actions/runs/<id>/jobs`: the last 100 each of
  `Preview Build` (2026-10-06…10-23), `Deploy to Production`
  (2026-07-19…10-23) and `Preview Deploy`. The duration of every step, split
  by runner type.
- The full log of production run `39945816805` (GitHub-hosted, 2026-10-23)
  with the 7.5 min Playwright install.
- The Playwright HTML report of the same run: the duration of each of the
  159 tests.
- Tree comparison `git diff <PR head> <merge commit>` for the last 37
  merges.
- A local vitest profile (see the unit tests section).

**Sample limitation:** there are few GitHub-hosted runs (PR n=3, production
n=10), because the runners moved from Blacksmith only on 2026-10-23 (#492).
The GitHub-hosted numbers below are approximate.

### Median step times by runner (successful runs)

| Step | PR @ BS 4vCPU (n=85) | PR @ GH (n=3) | PROD @ BS 2vCPU (n=73) | PROD @ BS 4vCPU (n=9, July*) | PROD @ GH (n=10) |
|---|---|---|---|---|---|
| Install deps | 9 s | 15 s | 9 s | 9 s | 21 s |
| ESLint | 18 s | 26 s | 16 s | 8 s | 18 s |
| Typecheck | 18 s | 26 s | 18 s | 12 s | 26 s |
| Unit | 47 s (affected) | 204 s (affected) | 167 s (all) | 33 s (all) | 97 s (all), p90 164 s |
| Integration | 16 s (affected) | 48 s (affected) | 56 s | 17 s | 39 s |
| Playwright install | 18 s (n=40 of 72) | 21 s | 21 s (every time) | 16 s | 25 s, **p90 453 s** |
| Nuxt build | 63 s | 90 s | 64 s | 38 s | 92 s |
| E2E | 211 s (affected) | 450 s | 244 s | 265 s | 466 s |
| **Whole job** | **7.0 min** | **15.6 min** | **11.2 min** | **7.6 min** | **14.2 min** |

What the table shows:

- **E2E does not speed up with more cores** (BS 2 vCPU 244 s versus 4 vCPU
  265 s): it is a single worker, so it is pure sequence. Only parallelism
  fixes it.
- **GitHub-hosted is roughly 1.7–2 times slower than Blacksmith per core**
  (E2E 466 s versus 244 s, build 92 s versus 64 s). That is why "the same
  pipeline on GitHub-hosted" gave 14–16 min.
- \*Do not compare the `PROD @ BS 4vCPU` column directly: all 9 runs are from
  2026-07-19…27, when the test suite was much smaller (2 vCPU:
  2026-08-08…10-22). The conclusion "4 vCPU is N times faster for unit
  tests" cannot be drawn from this data.

## Findings

### F1. The Playwright browser cache on main is never saved

`production.yml` sets `PLAYWRIGHT_BROWSERS_PATH: ~/.cache/ms-playwright`
through YAML `env:`. Nothing expands `~` there, so Playwright treats the path
as relative and installs the browsers into
`/home/runner/work/besidka/besidka/~/.cache/ms-playwright` (visible in the
log). `actions/cache`, on the other hand, does expand `~` and saves
`/home/runner/.cache/ms-playwright`, where nothing writes:

```
[warning]Path Validation Error: Path(s) specified in the action for caching
do(es) not exist, hence no cache is being saved.
```

Consequences:

- Browser installation runs on **every** production run (73/73 on Blacksmith,
  10/10 on GitHub-hosted).
- PR branches see only their own cache and the cache of `main`. There is no
  cache on `main`, so **the first build of every new PR always misses** (40
  of 72 PR builds with E2E).
- The key `hashFiles('pnpm-lock.yaml')` changes with every dependency bump,
  although the browser changes only with the Playwright version.

**Why 7.5 min.** The browsers downloaded in 7 s. The rest is `--with-deps`:
`apt-get` pulled fonts (`fonts-wqy-zenhei`, `fonts-unifont`,
`fonts-ipafont-gothic`, `xfonts-*`) and `xvfb` from
`azure.archive.ubuntu.com` at 59.9 kB/s (`Fetched 25.9 MB in 7min 13s`). All
the Chromium system libraries on the `ubuntu-24.04` image are already
installed (`already the newest version`), and fonts and xvfb are not needed
for headless tests without screenshot assertions (`tests/e2e` has no
`toHaveScreenshot`/`toMatchSnapshot`).

**Fix:**

1. Remove `PLAYWRIGHT_BROWSERS_PATH` entirely: on Linux Playwright already
   uses `~/.cache/ms-playwright`.
2. Cache key: `playwright-${{ runner.os }}-<@playwright/test version>`.
3. `pnpm exec playwright install chromium --only-shell` (headless uses only
   `chromium-headless-shell`; the full Chrome for Testing is not needed).
4. No `--with-deps` on `ubuntu-24.04`. This is already proven in practice: in
   `preview-build.yml`, on a cache hit the install step (together with
   `install-deps`) is skipped entirely, and 32 of 72 PR builds with E2E went
   through exactly that way. If the image ever loses a library, Chromium will
   fail with an explicit error at startup, not silently.
5. `timeout-minutes: 3` on the install step, so a mirror can never eat 8 min
   again.

Gain: ~20–25 s on every run, and the 2–8 min outliers disappear.

### F2. E2E is sequential (`workers: 1`)

Playwright report (GitHub-hosted, 2026-10-23): 159 tests, 404 s in total,
411 s for the run, which means everything runs strictly one after another.
The `wrangler dev` server starts in ~4 s, so almost all the time is the tests
themselves.

History: `workers: 1` was introduced because of the Vite HMR full-reload in
the dev server. #341 moved CI to `wrangler dev` on top of the built
`.output/`, which removed the root cause, but `workers` was left at 1 "until
a validation round in CI" that never took place.

The real constraint now is a different one: **almost all specs share one
user** from `auth.setup.ts` (storageState). Only `auth/signin`,
`attribution/utm-signup` and `cookies/consent` create their own. If you
simply raise `workers`, parallel tests will see each other's chats and
history (`search/pin`, `history/*`, `chat/*`).

Two ways:

| | Sharding by job (`--shard=i/N`) | `workers ≥ 2` in one job |
|---|---|---|
| Isolation | Full: each shard has its own `wrangler dev`, its own local D1, its own `auth.setup` | Needs a "user per worker" fixture (`test.extend` with a worker-scoped storageState) |
| Test changes | None | Moderate fixture refactoring |
| Overhead | ~50–60 s per shard (install, artifact, migrations) | None |
| Cost on GitHub-hosted (public repo) | 0 | 0 |
| Cost on Blacksmith | + overhead minutes for every shard | 0 |

Recommendation: **3 shards by job** now (zero changes in the tests), and add
a worker-scoped user later if `workers: 2` inside a shard is wanted as well.
The tests split evenly, because `fullyParallel: true` lets sharding divide by
test rather than by file. 3 shards ≈ 135 s of tests + ~60 s of setup ≈
**3.3 min** per shard instead of 7.5 min.

The shard reports are merged into one through `--reporter=blob` +
`playwright merge-reports` in a separate job that does not block deploy.

**Sharding and the known `wrangler dev` flake.**
`docs/ci-e2e-webserver-exit.md` describes how the server dies mid-suite in
about 4% of runs. With 3 shards a run has 3 `wrangler dev` processes. If the
failure is random per process, the chance of a red run rises to ~12%. If it
depends on duration (for example, memory after 400 s of work), shorter shards
reduce it instead. What changes for certain: today such a failure means
re-running the whole 15 min job, while with shards "Re-run failed jobs"
re-runs a single 3 min shard. After enabling it, it is worth counting these
failures per shard for 1–2 weeks to see which of the two options holds.

### F3. One sequential job instead of a graph

Both workflows do everything sequentially in one job. Lint, typecheck, unit,
integration and build do not depend on each other; E2E depends only on build.

Target graph (the same for PR and main):

```
gate (1 job: PR state + whether the build can be reused)       ~15 s
 ├── static:  lint + typecheck                                 ~1.2 min
 ├── unit:    vitest unit + cookie-consent module              ~3 min
 ├── integration                                               ~1.3 min
 └── build:   nuxt build → artifact .output + .drizzle         ~2 min
       └── e2e [shard 1/3, 2/3, 3/3]                           ~3.3 min
             └── (main) deploy: migrations + wrangler deploy   ~1 min
```

Critical path: gate → build → the longest e2e shard (→ deploy). Estimate for
GitHub-hosted:

| Segment | Time |
|---|---|
| gate | ~0.25 min |
| build: start + setup + install (~35 s) + `nuxt build` (~90 s) + upload | ~2.3 min |
| e2e shard: start + setup + install + artifact + local migrations + browser cache + `wrangler dev` (~75 s) + tests (404 s / N) | ~3.5 min at N=3, ~2.9 min at N=4 |
| **Preview Build total** | **~6 min** (N=3) / **~5.5 min** (N=4) |
| Preview Deploy | ~1.2 min |

So **~6.5–7 min to the preview URL**. Unit (~3 min) runs in parallel and does
not land on the critical path. (Observed on PR #499: unit took 4m20s, still
~2 min short of the critical path; the preview URL took ~8 min.) Start with N=3, and move to N=4 if the E2E
suite grows.

The repeated steps (checkout + pnpm + node + install) should move into a
**composite action** (`.github/actions/setup/action.yml`). This is not a
return to V1 from `README.md` (a reusable workflow with secrets and
`pull_request_target`): a composite action has no secrets and does not call
another workflow, it only removes 4 identical steps from 5 jobs.

### F4. main rebuilds and retests what the PR already passed

Tree comparison for the last 37 merges into `main`:

- **25/37 (68%)**: the files that affect the build (everything except
  `paths-ignore`) are identical to the PR head. Re-running the tests on main
  verifies nothing new.
- **12/37 (32%)**: `main` moved while the PR was waiting (for example, #488
  with `pnpm-lock.yaml`, #452 with a migration). Here the production run is
  the **only** CI run that sees the merged state. This is the lesson from
  `docs/ci-pull-request-checkout-ref.md`, and this check must not be removed.

The trap: a PR runs only the **affected** tests. If main skips the tests when
the tree matches, the full suite never runs at all. And for E2E the affected
selection gains almost nothing: E2E ran in 72 of 85 PR builds, with a median
of 211 s versus 244 s for the full suite.

**Recommendation:**

1. A PR always runs the **full** suite (unit, integration, cookie-consent,
   E2E). In the parallel graph this adds no time to the critical path.
2. On main, the gate job computes the tree (with the same `paths-ignore`
   filter) and looks for a successful `Preview Build` with the same tree
   (extend `scripts/ci/resolve-preview-build-source.mjs`). If it finds one,
   it skips lint, typecheck, unit, integration and e2e. If not, the full
   graph runs.
3. **Keep** the build on main (~1.5 min) rather than taking the PR artifact.
   Reason: `buildId` = `GITHUB_SHA` (`nuxt.config.ts`), and on
   `pull_request` that is the SHA of the ephemeral merge commit
   `refs/pull/N/merge`, not a commit on `main`. Technically the PR artifact
   would work (the production KV is separate from the preview one), but a
   clean build with `buildId` = the SHA of main is simpler to debug. Artifact
   reuse can be added later and would save another ~1.5 min.

Result on main: **~3 min** when the tree matches, **~7 min** when it differs
(full graph + deploy).

Side effect: `scripts/test-affected-check.mjs` (1950 lines of hand-written
mapping) stops being part of the CI gate. It stays for the local
`pnpm run test:affected` and the pre-push hook, so the rule "register every
new test in the mapping" stays in `AGENTS.md`, now to keep local runs honest.
A test missing from the mapping is a quality gap that the full suite closes
by itself in CI.

### F5. Unit tests

On CI (GitHub-hosted, 2026-10-23): `vitest run tests/unit`, 332 files, 6062
tests, `Duration 149.76s (transform 29.68s, setup 29.05s, import 38.74s,
tests 214.12s, environment 114.28s)`. Integration: 76 files, 36 s.

Local profile (vitest 4.1.10, 10-core Mac; absolute seconds do not carry over
to CI, proportions do):

- **The test bodies themselves take only ~25% of worker time.** The rest is
  eaten by the Nuxt environment (39–50%), setup and import. For the median
  file the test bodies take 36 ms, and in 173 of 332 files they take under
  50 ms. Nuxt preparation costs 0.2–0.5 s per file.
- **Cause:** `environment: 'nuxt'` globally for all files, and
  `tests/setup/vitest.setup.ts` touches `document.cookie`, `window.history`
  and `window.matchMedia` at module level. Because of this, no file can run
  in `node`, even with `@vitest-environment node`.
- **206 of 408 files (160 unit + 46 integration) also pass in `node`** if
  they are given a node-safe setup: almost all of `unit/utils`, `providers`,
  `config`, `scripts`, and part of `integration/api` and
  `integration/server`. Components, pages and most composables stay in the
  Nuxt environment.
  - Unit subset: 32 s → 12 s (CPU 157 → 61 s).
  - Integration subset: 11 s → 5 s.
  - Estimate for CI: unit minus ~27% (−30–45 s), integration minus ~30%
    (−12–17 s).
  - Another 36 files fail in `node` only on `NUXT_E1001` (`useRuntimeConfig()`
    without a Nuxt instance); a stub in the node setup would probably bring
    most of them back (not verified).
- **Mechanism:** vitest `projects`, that is, two projects: `node` with a
  separate setup file and `nuxt` for the rest. `environmentMatchGlobs` no
  longer exists in vitest 4.1.
- **`--pool=threads`** instead of `forks`: all 6062 tests pass; on 4 workers
  this is −5–8% wall time and −13% CPU. A small but free gain; it needs to be
  verified in CI, because a local run does not catch CI-specific failures.
- **Unit sharding** (2 shards ≈ 1.8×, 4 shards ≈ 3.3×) is not needed after
  F3: the unit job (~3 min) is shorter than build → e2e (~5.5 min) and is not
  on the critical path. It would be needed only if unit ever becomes longer
  than that chain.
- Every vitest run pays a fixed 3.5–5 s: `defineVitestConfig` boots Nuxt
  already while loading the config. So unit and integration are better run in
  a single invocation than in two.

Conclusion: after F3, unit tests stop affecting the time to preview. Stage 3
(a node project + threads) reduces runner minutes and local response time,
so it is hygiene, not the key to 5–7 min.

Found along the way: `tests/unit/config/seo.spec.ts` fails if
`NUXT_PUBLIC_BASE_URL` is set in the shell (run it with
`env -u NUXT_PUBLIC_BASE_URL`), and
`tests/unit/utils/research/sweep.spec.ts` depends on timings and flaked under
load.

### F6. Quality gaps found along the way

- **main does not run the cookie-consent module tests.** The PR "all" path in
  `scripts/test-affected.mjs` calls `pnpm run test:cookie-consent`, while
  `production.yml` runs only `test:unit` and `test:integration`. The graph
  from F3 puts the module into the unit job.
- **CI generates migrations before applying them to production.**
  `production.yml` runs `pnpm run db:generate` in `preCommands` and
  immediately after it
  `wrangler d1 migrations apply --remote --env production`. The migrations
  are committed (`.drizzle/`, 90 files), so generation normally does nothing
  (`No schema changes, nothing to migrate`). But if the schema changed
  without a committed migration, CI will generate the SQL itself and apply it
  to production, and nobody will review it for `DROP TABLE` (see the D1
  section in `AGENTS.md`). It is better to replace generation with a check:
  `drizzle-kit generate`, then `git status --porcelain .drizzle` must be
  empty, otherwise fail in the PR. This is a safety matter, not a speed one,
  but it is on the same path.
- **`scripts/**` is in `paths-ignore`**, but `tests/unit/scripts/` tests 5
  scripts (including `resolve-preview-build-source.mjs`, which the build
  reuse logic depends on). A PR that changes only these scripts does not run
  their tests. A cheap fix: a separate lightweight workflow on `scripts/**` +
  `tests/unit/scripts/**` that runs only those specs (~1 min).

### F7. Small overheads

| What | Loss | Fix |
|---|---|---|
| `pnpm run dev:prepare` in the typecheck step: `postinstall` already runs `nuxt prepare` | ~5 s | remove |
| 3 sequential jobs in `Preview Build` before the build starts (`check-pr-state` → `check-latest-commit` → `build`) | ~15–25 s | one gate job |
| `Preview Deploy` through `workflow_run`: a separate trigger + a full install | ~1.1–1.3 min | keep: it is part of the security model in `README.md` |
| `deploy-preview` on main installs dependencies again | ~25 s, not on the critical path | keep |
| `NODE_OPTIONS=--max-old-space-size=6144` on a 7 GB runner | OOM risk, not speed | GitHub-hosted has 16 GB, fine |

### F8. E2E scope (test audit)

| Spec | Tests | Time | Share |
|---|---|---|---|
| `cookies/consent.spec.ts` | 44 | 102 s | 25% |
| `chat/mermaid-diagram.spec.ts` | 25 | 66 s | 16% |
| `chat/scroll-spacer.spec.ts` | 11 | 39 s | 10% |
| `chat/new-chat-navigation.spec.ts` | 4 | 33 s | 8% |
| `settings/theme.spec.ts` | 14 | 24 s | 6% |
| the remaining 18 files | 65 | 140 s | 35% |

Two files account for 41% of E2E time. They are worth reviewing, not for
deletion, but for whether they sit at the right level: is this UI state that
a component test checks in seconds (for example, mermaid render variations by
diagram type), or can several scenarios share one page instead of a new
`page.goto` for each. Lower priority than parallelism: after sharding, these
168 s are divided by 3.

## Cost and runner choice

- **GitHub-hosted, public repository:** standard runners are free with no
  minute limit. The limit is 20 concurrent jobs on the Free plan; the graph
  takes ~8 jobs per run. Recommended option.
- **GitHub-hosted arm64 (`ubuntu-24.04-arm`):** also 4 vCPU and also free for
  public repositories. `workerd` and Playwright Chromium support linux-arm64.
  It is worth running the graph once on arm64 and comparing: if the cores are
  faster, it is a free gain. This is an experiment, not a default
  recommendation.
- **Blacksmith 2 vCPU:** faster per core (E2E 244 s versus 466 s), but every
  parallel job spends minutes from the 3000 free ones. The F3 graph on 2
  vCPU: critical path ~4 min, but ~14–15 billable min per run versus ~11
  now. If staying on Blacksmith, prefer 2 shards and merge static +
  integration into one job.
- **Blacksmith 4 vCPU:** not needed; it is billed at 2× the rate per minute,
  and E2E does not speed up with cores.

## Implementation plan

| Stage | Changes | Risk | Gain (GitHub-hosted) |
|---|---|---|---|
| **0. Quick wins** | F1 (cache and `--only-shell`, no `--with-deps`), F7 (`dev:prepare`, merged gate jobs), cookie-consent tests on main | low | −0.5 min typical, the 2–8 min outliers disappear |
| **1. Graph + sharding** | F3 + F2 in both workflows, composite action, blob reports | medium: needs 1–2 weeks of flake monitoring | PR 15.6 → ~6.5 min, main 14 → ~7 min |
| **2. No repeated tests on main** | F4: full suite on PR, tree gate on main | low after stage 1 | main ~7 → ~3 min in 68% of merges |
| **3. Tests** | F5 (Nuxt environment only where needed), F8 (E2E consolidation) | low | fewer minutes and flakes, the critical path barely changes |

## What not to do

- Do not migrate to Bun (the decision is closed,
  `docs/pnpm-to-bun-evaluation.md`).
- Do not go back to Blacksmith 4 vCPU for speed.
- Do not remove the check on main when the tree differs from the PR (32% of
  merges).
- Do not raise `workers` in a single job while the tests share one user.
