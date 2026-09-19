# CI runners: Blacksmith → GitHub-hosted

**Status: applied 2026-09-20.** All workflows now use `runs-on: ubuntu-24.04`
(GitHub-hosted) instead of `runs-on: blacksmith-2vcpu-ubuntu-2404`.

## What happened

PR #362's "Build PR" job started failing CI on
`tests/integration/api/chats-tool-loop.spec.ts > multi-step tool loop >
stops at the step cap when the model keeps calling the tool` starting with
commit `80a3bdb9` (2026-09-19), and failed identically on 8 consecutive
pushes after that. The failure was always the same assertion
(`expect(assistantInsert).toBeDefined()`), always completed in 16-36ms (not
a timeout/hang), and never reproduced:

- Locally, across 1,500+ runs on macOS (arm64).
- In a `--platform linux/amd64` Docker container running the exact CI Node
  version (24.13.0), CPU count (2), and memory limit (7GB), across 100+ runs.

Deep instrumentation (see the commit history on `feat/add-more-providers`
around 2026-09-19 for the full diagnostic trail — logger markers bracketing
every branch of `persistAssistantMessageFromStream()`, immune shadow logs
that don't rely on Vitest's mock bookkeeping, an `execute()` lifecycle
tracker) systematically ruled out every code-level hypothesis:

- A stale/leaked `db` mock reference across tests — refuted by construction
  (`useDb()` is called exactly once per request and threaded by reference;
  the same reference's user-message insert always landed correctly).
- Vitest's own mock introspection lying about call history — refuted; a
  plain-array shadow log immune to `mockReset`/`clearAllMocks` matched the
  mock's `.mock.calls` exactly on every failure.
- The wrong `db` object reaching the persist function — refuted; a marker
  logged at function entry showed `input.db`'s insert-mock call count
  matched live reality.
- Cross-test dynamic-`import()` caching bypassing `vi.resetModules()` —
  tested by cache-busting the import with a unique query string; no change
  in behavior.
- Multiple `createUIMessageStream()` call sites racing on the wrong `ready`
  promise — refuted; only one call site is reachable given this test's
  mocked data, and `result.ready` was confirmed (locally) to be a real
  `Promise` tied to the correct `execute()` call.
- A hang or unhandled rejection — refuted; `execute()`'s promise reliably
  *resolves* (never rejects, never hangs) in every failing run.

## The decisive fact

`chats-tool-loop.spec.ts` last passed in CI on commit `ea0483e0`
(2026-09-16, 815ms, 7/7 green). Between that commit and the first failure
(`80a3bdb9`, 2026-09-19), **no commit touched
`server/api/v1/chats/[slug]/index.post.ts`, `chats-tool-loop.spec.ts`,
`server/utils/chats/insert-message.ts`, or `pnpm-lock.yaml`.** The
production and test code, and the full dependency lockfile, are byte-for-
byte identical between the last green run and the first red one. Both runs
used the same Blacksmith runner image release
(`ubuntu24/20260907.300`) and the same runner pool
(`blacksmith-2vcpu-ubuntu-2404`), just different ephemeral VM instances.

Since the code is provably unchanged and the failure is a fast (not hung),
clean (not thrown/rejected) divergence in async execution order that never
reproduces outside Blacksmith's fleet, this points at host-level
non-determinism on Blacksmith's infrastructure — most plausibly CPU
microarchitecture heterogeneity between the physical machines behind a
nominally-identical runner image, which can shift V8 Promise/microtask
scheduling in exactly the kind of tight-timing async code this test
exercises.

## Decision

Switch all workflows from the Blacksmith runner pool to GitHub's own
hosted `ubuntu-24.04` runners, matching Blacksmith's declared OS version
(`ubuntu-2404`) so this is a runner **provider** swap, not also an
opportunistic OS upgrade. No Blacksmith-specific actions or cache steps
were in use, so this is a pure `runs-on:` label change across:

- `.github/workflows/preview-build.yml`
- `.github/workflows/preview-deploy.yml`
- `.github/workflows/preview-fork-deploy.yml`
- `.github/workflows/production.yml`

## If this doesn't fix it

If `chats-tool-loop.spec.ts` still fails intermittently on GitHub-hosted
runners, that rules out Blacksmith specifically and points back at GitHub's
own runner fleet or at something in the Vitest/Node/V8 combination itself
under real hardware — worth revisiting with a live SSH session into a
failing runner (GitHub's hosted runners don't offer this directly; Blacksmith
did, via a `ssh -p <port> runner@<vm>.vm.blacksmith.sh` line printed in
every job log — a `tmate` step would be the GitHub-hosted equivalent) rather
than more static analysis, since 8 rounds of code-level diagnostics already
exhausted every hypothesis reachable that way.

## Reverting

If GitHub-hosted runners turn out to be slower or costlier than Blacksmith
for this repo's CI volume, revert by restoring `runs-on:
blacksmith-2vcpu-ubuntu-2404` in the four files above — no other changes
depend on the runner provider.
