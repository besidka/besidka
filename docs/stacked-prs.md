# Grouping PRs: umbrella, native stack, or a plain PR

Three ways to ship a change, ordered by how much CI they cost. Pick the
cheapest one that fits. Merges are always done by the owner, not by an agent.

| Pattern | Shape | CI cost |
|---------|-------|---------|
| Plain PR | One branch, one PR into `main` | One build |
| Umbrella (U) | Parent PR into `main`; child PRs into the parent branch | One build, rebuilt per child merge |
| Native stack (S) | Linear chain of dependent PRs (`gh stack`) | One build, on the top layer only |

## When to use which

- **Plain PR** for anything small or unrelated to a bigger thread. This is the
  default.
- **Umbrella (U)** for parallel, independent sub-fixes found while building a
  feature, especially when they are done in separate Claude sessions or
  worktrees. Each fix is reviewed and merged into the parent branch on its own;
  `main` gets one commit when the parent lands.
- **Native stack (S)** for sequential layers where each one depends on the one
  below (schema, then API, then UI). Every layer is a small, separately
  reviewed diff and `main` gets one commit per layer.

If the sub-fixes do not depend on each other, do not stack them: a stack forces
a bottom-to-top order and a rebase cascade, an umbrella does not.

## Umbrella pattern (U)

The parent PR targets `main`. Children are branched from the parent branch and
target it with `--base`.

```bash
# parent: a normal PR
git fetch origin
git switch -c feat/search-rework origin/main
gh pr create --base main --title "feat(search): rework search"

# child, usually from another session or worktree
git fetch origin
git switch -c fix/search-empty-state origin/feat/search-rework
gh pr create --base feat/search-rework --title "fix(search): empty state"

# the parent merged first: retarget the child
gh pr edit <child-number> --base main
```

Children are squash-merged into the parent branch (`gh pr merge <n> --squash`,
run by the owner). Each merge is a push to the parent branch, so the parent PR
rebuilds. When every child is in, the parent is squash-merged into `main` with
a conventional-commit title, which becomes the single commit on `main`. The
children's own titles do not reach `main`.

Keep the parent branch updated from `main` with a merge or rebase as usual.
After a child lands in the parent, pull the parent into any other open child
(`git merge origin/<parent-branch>`) before pushing it.

## Merging an umbrella

Pushes to child branches cost nothing: the `branches: [main]` filter skips
`preview-build.yml` and `claude-code-review.yml` on them. Two workflows are not
filtered by base branch: `preview-cleanup.yml` runs when a child PR closes (see
`docs/cloudflare-previews.md`), and `update.yml` runs when a child PR opens.
The cost appears when a child merges, because that is a push to the parent
branch and runs one `preview-build.yml` and one `claude-code-review.yml` on the
parent PR. Both workflows use
`cancel-in-progress`, so a newer merge cancels the run of the previous one and
the newest state wins.

Rules:

- Merge the children in the agreed order, in one sitting.
- Rebase a child onto `origin/<parent-branch>` only after the previous child has
  landed. Never pre-rebase children onto each other's branches: a squash merge
  gives the commits new SHAs, so the replayed commits conflict.
- With `N` children merged back to back the cost is `N-1` cancelled partial runs
  (the Claude review included) plus one full run.
- The parent only builds once the first code child lands. A docs-only commit is
  in `paths-ignore`, and a docs-only change on top of a built commit reuses that
  build (`docs/cloudflare-previews.md`, "Skipping builds").

Escalation for large umbrellas (not implemented, documented only): replace the
`cancel-in-progress` value in `preview-build.yml` with
`${{ !contains(github.event.pull_request.labels.*.name, 'umbrella') }}` and put
the `umbrella` label on the parent PR. A labelled parent then queues instead of
cancelling, which gives at most one running and one pending build at a time.

## Native stack (S)

GitHub stacked PRs, driven by the `gh-stack` extension.

```bash
gh extension install github/gh-stack

gh stack init feat/schema-layer
git commit -am "feat(db): add column"
gh stack add -Am "feat(api): expose column" feat/api-layer
gh stack add -Am "feat(ui): show column" feat/ui-layer

gh stack submit
gh stack view
```

Day to day:

- `gh stack rebase` rebases every layer onto the one below (and onto `main`);
  `gh stack sync` fetches, rebases, force-pushes with lease and relinks.
- `gh stack link <bottom> ... <top>` builds a stack from existing branches or
  PR numbers.
- `gh stack unstack` dissolves a stack on GitHub.
- `gh stack merge --squash` merges the whole stack (or everything up to a given
  PR) atomically: all or nothing, one squash commit per layer, so `main` gets
  `n` commits. Each layer title must be a conventional commit.

## CI behaviour

GitHub runs Actions for a stacked PR as if it targeted the base of the whole
stack, so `on.pull_request.branches: [main]` matches every layer. The
`pull_request.stack` object (`number`, `size`, `position` with 1 = bottom,
`base.ref`, `base.sha`) exists only on stacked PRs; `pull_request.base.ref` is
still the real direct base (the branch below).

| Workflow | Umbrella child | Umbrella parent | Stack non-top layer | Stack top layer | Plain PR |
|----------|----------------|-----------------|---------------------|-----------------|----------|
| `preview-build.yml` | Not triggered (base is not `main`) | Full build | Triggered, every job skipped | Full build of the combined head | Full build |
| `preview-deploy.yml` | Not triggered | Deploy `pr-<n>` | Triggered, exits at the no-build gate, deploys nothing | Deploy `pr-<n>` | Deploy `pr-<n>` |
| `claude-code-review.yml` | Not triggered (`branches: [main]`) | Reviews the combined diff | Reviews the PR diff | Reviews the PR diff | Reviews |
| `preview-cleanup.yml` | Runs on close, nothing to delete | Deletes `pr-<n>` | Runs on close, nothing to delete | Deletes `pr-<n>` | Deletes `pr-<n>` |
| Cloudflare preview | None | `pr-<n>` | None | `pr-<n>` | `pr-<n>` |

How the non-top skip works:

- `check-pr-state` in `preview-build.yml` carries the guard
  `stack == null || stack.position == stack.size`. Every other job `needs` it
  and uses the implicit `success()`, so a false guard skips the whole run.
- A run whose jobs are all skipped still completes, and `preview-deploy.yml`
  fires on `workflow_run` completed with `conclusion == 'success'`, then would
  fail downloading the `preview-build` artifact. The first step of the deploy
  job therefore lists the build run's artifacts: no live `preview-build`
  artifact means set the `Preview Deploy` commit status to success with
  "Skipped (no build for this commit)" and exit before any download, migration
  or deploy. The check does not depend on whether GitHub reports an all-skipped
  run as `success` or `skipped`.
- Affected tests diff against `stack.base.ref || base_ref` (the `main` base of
  the whole stack), so the top layer tests every layer below it. The build still
  checks out the PR head commit (see `docs/ci-pull-request-checkout-ref.md`).
- `preview-cleanup.yml` is left unfiltered on purpose. It handles a PR that was
  retargeted after it deployed, and an unfiltered run costs about one to two
  runner minutes.
- `edited` is deliberately not a `preview-build.yml` trigger type: the
  workflow-level `cancel-in-progress` would let a title edit cancel an
  in-flight build.

## Warnings

- **"Add to stack" banner.** GitHub shows it when PR bases form a chain, which
  is exactly an umbrella child on its parent. Clicking it turns the child into a
  native stack member, after which it passes `branches: [main]` and gets the
  stack treatment. The top-only guard still builds only the top PR, but the
  umbrella's "no CI on children" property is gone, and the merge semantics
  change. Do not click it unless you want a stack.
- **Parent merged while a child is open.** GitHub retargets the child to `main`
  (the repository deletes merged branches). That event is only `edited`, which
  `preview-build.yml` ignores, so the child does not build until it is closed
  and reopened or receives a push. Merge children first, or retarget and push.
- **Cloudflare previews.** Only the umbrella parent and the stack top get
  `pr-<n>`. Umbrella children and lower stack layers have no preview; take
  screenshots from a local dev server.
- **Unverified: creation build.** A third-party source says `opened` fires
  before a PR joins a stack, so `stack` is absent at that moment and the bottom
  layer may get one full build when it is created. Verify with a throwaway stack
  before relying on the zero-build claim. If true, the cost is one full build
  and a `pr-<n>` preview for the bottom layer, because later events carry
  `stack`.
- **Unverified: path filter on lower layers.** It is not confirmed whether
  `paths-ignore` is evaluated against the direct base or the stack base for
  lower layers. It only affects whether a lower layer's (skipped) run fires.
- **Stale preview after a layer is added.** A PR that was the top (and
  deployed) keeps its `pr-<n>` preview when a layer is stacked above it, until
  that PR closes. It simply stops being rebuilt.
- **Database migrations.** Children must not add D1 migrations without
  following the migration rules in `CLAUDE.md` (never rebuild a table with
  cascade children, no `DROP TABLE`). Migrations are applied to the shared
  preview database by the parent or top-layer preview deploy, so a migration in
  a child is only exercised once it is inside the parent.
- **The workflow edits cannot test themselves.** `.github/**` and `docs/**` are
  in `paths-ignore`, so the PR that introduced this setup was not built, and
  `workflow_run` workflows always run the default-branch copy. The first real
  exercise is the first native stack after merge.
