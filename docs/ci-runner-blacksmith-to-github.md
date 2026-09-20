# CI runners: Blacksmith → GitHub-hosted → reverted to Blacksmith

**Status: reverted 2026-09-20. This was a dead end — see
`docs/ci-pull-request-checkout-ref.md` for the real root cause and
resolution.** All workflows briefly used `runs-on: ubuntu-24.04`
(GitHub-hosted) instead of `runs-on: blacksmith-2vcpu-ubuntu-2404`, on the
hypothesis that Blacksmith's runner fleet had host-level non-determinism.
That hypothesis was wrong (see "Result" below), the actual bug was a
`pull_request` checkout defaulting to the wrong ref, unrelated to which
runner provider ran the job — so once the real fix landed and was
confirmed green on GitHub-hosted runners, the runner choice itself was
reverted back to Blacksmith to leave no unexplained infrastructure change
in place, and re-verified green there too (see "Reverted" below).

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

## Result: it did not fix the failure

The very next push (commit `64f9dfe`, the runner switch itself) failed CI
with the exact same assertion on the exact same test, on a confirmed
GitHub-hosted runner (`Current runner version: '2.337.0'`, no Blacksmith VM
in the job log). This **rules out Blacksmith-specific hardware** as the
cause — the non-determinism is either common to GitHub Actions-hosted
runners in general (both Blacksmith and GitHub's own fleets, vs. any local
dev machine or Docker-emulated environment), or something in the
Vitest/Node/V8 combination that only manifests under real (non-emulated)
CI-grade virtualization.

The runner switch is being kept anyway (GitHub-hosted is a reasonable
default and this rules out one variable), but it is not the fix. Revisiting
this needs a live session on an actual failing runner: GitHub-hosted
runners don't print an SSH command the way Blacksmith did, so a `tmate`
step (`mxschmitt/action-tmate`) added temporarily to the workflow would be
the equivalent — someone needs to be at the keyboard during a live,
failing run to inspect the process/thread state directly, since 9 rounds of
code-level diagnostics (see the commit history) already exhausted every
hypothesis reachable through logging and static analysis alone.

## Reverted

Once `docs/ci-pull-request-checkout-ref.md`'s fix (pinning the `build`
job's checkout `ref`) was confirmed green on GitHub-hosted `ubuntu-24.04`,
all four files were reverted back to `runs-on:
blacksmith-2vcpu-ubuntu-2404` — the runner switch was never the fix, so
there was no reason to keep it once the real cause was found. Verification
that CI is still green on Blacksmith with the real fix in place is
tracked in this same PR's check history for the commit that made this
revert.
