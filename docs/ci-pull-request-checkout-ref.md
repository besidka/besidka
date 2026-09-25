# CI was testing the wrong commit: `pull_request`'s default checkout ref

**Status: root cause found and fixed 2026-09-20.** This is the real
resolution to the investigation started in
`docs/ci-runner-blacksmith-to-github.md` — read that file first for the
timeline; this one has the actual answer.

## The bug

`.github/workflows/preview-build.yml`'s `build` job ("Build PR", the job
that runs the affected unit/integration tests) checked out the PR branch
with no explicit `ref:`:

```yaml
- name: Checkout PR code
  uses: actions/checkout@v7
  with:
    fetch-depth: 0
```

For a `pull_request`-triggered workflow, `actions/checkout` with no `ref`
defaults to `GITHUB_SHA`, which GitHub sets to the **merge commit preview**
(`refs/pull/<N>/merge`) — an ephemeral commit GitHub computes on the fly by
merging the PR branch onto the current tip of the base branch. It is
**not** the PR branch's own head commit, and it changes every time the base
branch (`main`) moves, with no new push to the PR required.

The sibling `check-latest-commit` job in the same file already did this
correctly:

```yaml
- name: Checkout PR head
  uses: actions/checkout@v7
  with:
    fetch-depth: 2
    ref: ${{ github.event.pull_request.head.sha }}
```

Only the `build` job was missing the pin.

## What this caused

PR #362's `tests/integration/api/chats-tool-loop.spec.ts > stops at the
step cap when the model keeps calling the tool` failed on every CI run
from 2026-09-19 17:32 UTC onward, always with the same
`AssertionError: expected undefined to be defined`, and was investigated
for most of a day as a CI-only, non-reproducible flake: ruled out a stale
mock `db` reference, mock-introspection bugs, cross-test dynamic-import
caching, racing `createUIMessageStream()` calls, a hung promise, and
Blacksmith-specific hardware (see the other doc) — all with hard evidence,
none of it explaining the symptom.

The actual cause: at 2026-09-19 ~15:38 UTC, an unrelated PR (#383,
"fix(chat): recover failed assistant retries") merged into `main`, adding
`hasMeaningfulAssistantParts()` and a new guard in
`persistAssistantMessageFromStream()`:

```ts
if (!hasMeaningfulAssistantParts(normalizedParts)) {
  return false
}
```

This intentionally declines to persist an assistant turn whose parts are
only tool calls (`step-start`/`tool-*`) with no text, file, source, or
generated image — exactly the shape of the step-cap test's scenario (the
model exhausts the step cap without ever producing a final text answer).
It returns `false` with no logging, by design (matching the equivalent new
tests in `chats-message-id-stream.spec.ts`, e.g. "does not persist an
assistant row for internal-only stream parts").

Because the `build` job's checkout defaulted to `refs/pull/362/merge`,
every CI run **after** #383 merged silently tested PR #362's branch
merged with #383's still-unmerged guard — code that existed in no real
checkout anywhere, not on the PR branch, not on `main` alone, and
certainly not reachable from a local `git checkout` or a Docker container
built from the branch. That is why:

- The failure was perfectly deterministic (not a race) once #383 landed.
- It could not be reproduced locally, in Docker (any architecture/CPU/
  memory combination), or by manually diffing the PR branch against its
  last-known-green commit — none of those ever construct the ephemeral
  merge ref.
- Every diagnostic added to the PR branch's own code (extensive — see the
  git history around 2026-09-19/20) showed the stream fully and correctly
  consumed, `execute()` resolving cleanly, and then... nothing, because
  the guard that explained it did not exist in the branch being read.
- Switching CI to GitHub-hosted `ubuntu-24.04` runners changed nothing,
  because the wrong ref was still being checked out — runner choice was
  never the variable.
- CI stopped triggering entirely once `main` advanced far enough that
  GitHub could no longer compute a merge preview at all (`mergeable:
  false`, `mergeable_state: "dirty"`) — the checkout had nothing to
  default to.

## The fix

1. Pin `ref: ${{ github.event.pull_request.head.sha }}` on the `build`
   job's checkout, matching `check-latest-commit`
   (`.github/workflows/preview-build.yml`).
2. Merge `origin/main` into this branch for real, bringing in #383's
   `hasMeaningfulAssistantParts()` guard.
3. Update `chats-tool-loop.spec.ts`'s "stops at the step cap" test (and
   a second test with the same latent gap, "never loops for the identical
   tool...") to assert `assistantInsert` is `undefined` — the new, correct
   contract — instead of asserting it must exist.
4. Remove the investigation's diagnostic instrumentation from
   `persistAssistantMessageFromStream()` and the test file; it served its
   purpose and does not belong in the final code.

## Lesson

When a CI-only failure resists every local/Docker/environment
reproduction attempt on a long-lived branch, check what the CI job
actually checked out before assuming the branch's own code is what ran.
`git log` on the PR branch is not sufficient — `gh api
repos/<org>/<repo>/pulls/<n> --jq '.mergeable, .mergeable_state'` and
fetching `refs/pull/<n>/merge` directly would have shown this in minutes,
not the many hours (and Blacksmith→GitHub-hosted runner switch) it
actually took.
