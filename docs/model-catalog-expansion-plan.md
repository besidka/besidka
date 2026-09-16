# Model catalog expansion plan

Status: Waves 0-5 EXECUTED and committed, local to this worktree, not yet
pushed. Written 2026-09-16.

- Wave 0 (merge `origin/main`) — `5347f57f`.
- Wave 1 (P0 DeepSeek retired ids) — `2f9324c6`.
- Wave 2a (xAI +4 text models) — `c94e46cf`.
- Wave 2b (Moonshot AI +2 models) — `4ddb4a75`.
- Wave 2c (Qwen +43 models) — `ed3dc5fb`.
- Wave 3 (`models:fetch`, snapshot committed at 110 entries) — `47488ace`.
- Wave 4 (xAI image generation) — `e7af9a71`.
- Wave 5 (re-run `models:fetch`, confirm the snapshot is unchanged with the
  image model exempt) — verified, no commit: re-running the fetch after
  wave 4 produced no diff, exactly as expected, so there was nothing to
  commit.

Remaining work: Wave 6a (tooling fixes, § 10 —
`scripts/detect-model-successors.mjs`,
`scripts/propose-model-successors.mjs`,
`tests/unit/scripts/detect-model-successors.spec.ts`) is in progress by a
separate concurrent agent as of this writing. Wave 6c (this document's own
§ 12 documentation updates, plus `docs/providers.md` and
`docs/models-data-fetching.md`) landed alongside it. Wave 7 (final
cross-wave verification per § 13) has not yet run and is the one remaining
gate before this plan is fully closed out.

Branch: `feat/add-more-providers`
Worktree: `/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers`

Two independent bodies of work in one document: **Part 1** merges `origin/main`
into this branch; **Part 2** fixes a confirmed DeepSeek production bug and then
expands the curated model catalogs for xAI, DeepSeek, Moonshot AI and Qwen,
including xAI image generation.

Governing architectural principle: this app reaches every LLM provider
**exclusively** through the Vercel AI SDK's provider packages. The AI SDK's
documented model-id typing, provider-options schemas and capability surface are
the feasibility boundary — not a provider's raw REST docs. Every capability
decision below was ground-truthed against `node_modules` and the live
models.dev catalog, not against memory.

Second governing principle: every capability wired for the four newer providers
must reuse the **existing shared shapes** already used for OpenAI and Google —
`tools: ModelTool[]`, `reasoning: { mode: 'toggle' | 'levels', levels? }`,
`reasoningAlwaysOn: true`, `imageGeneration: { controllerModel }`,
`getProviderGenerationOptions()`, the `ImageGenerationProvider` union, the
per-provider `getImageModel()` export. No bespoke per-provider mechanisms.

## How to use this document

Read § 1, § 3 (corrections — the research brief that produced this plan is wrong
in six places) and § 14 (wave order) before touching anything. § 2 is the merge
runbook and must complete before any § 4–§ 7 work starts. § 8 lists what needs
the owner rather than an executor.

| § | Section | Audience |
| --- | --- | --- |
| 1 | Goal and scope | everyone |
| 2 | Part 1 — merge `origin/main` | merge executor |
| 3 | Ground-truth corrections to the research brief | **everyone — read first** |
| 4 | P0 — DeepSeek retired model ids | executors |
| 5 | xAI — text catalog + image generation | executors |
| 6 | Moonshot AI — catalog | executors |
| 7 | Qwen — architecture decision + catalog | executors |
| 8 | Decision points | **owner** |
| 9 | Package versions | executors |
| 10 | Internal tooling fixes | executors |
| 11 | Tests and `test-affected` registration | executors |
| 12 | Documentation updates | executors |
| 13 | Verification gates (definition of done) | executors |
| 14 | Wave execution plan | orchestrator |
| 15 | Verified-clean surfaces (negative findings) | reference — do not re-search |

## 1. Goal and scope

**In scope**

1. Merge `origin/main` (59 commits: model-curation system, successor proposal
   pipeline, search indexing, PWA fixes) into this branch (131 commits: gateway
   removal + four new direct providers).
2. Replace DeepSeek's two retired model ids — a confirmed production bug that
   also breaks `pnpm run models:fetch` **today**.
3. Expand catalogs: xAI +4 text models +1 image model, Moonshot AI +2, Qwen +43.
4. Ship xAI image generation through the app's existing dedicated-image-model
   pattern.
5. Fix three internal tooling gaps that would otherwise make the weekly drift
   check silently useless for the new providers.

**Out of scope (explicitly)**

- Video models (`grok-imagine-video*`), realtime/voice models
  (`Experimental_XaiRealtimeModel`, `qwen-omni-*-realtime`,
  `qwen3-livetranslate-flash-realtime`), ASR (`qwen3-asr-flash`), and any model
  whose output modality includes `audio` or `video`. The app supports chat +
  image generation + deep research only.
- Qwen image generation — no AI SDK path exists (§ 7.4).
- Widening the app's reasoning-level vocabulary to `xhigh` / `none` / `max` (§ 3.1).
- Bumping `@ai-sdk/xai` to `5.0.0` (§ 9).
- Any database schema change. `pnpm run db:generate` must remain a no-op.

## 2. Part 1 — merge `origin/main`

### 2.1 Use merge, not rebase

`git merge origin/main`. This branch touched `scripts/test-affected-check.mjs`
in 36 commits and `server/api/v1/chats/[slug]/index.post.ts` in 17; a rebase
would re-present the same overlapping regions dozens of times. A merge resolves
each region exactly once.

Verified with `git merge-tree --write-tree HEAD origin/main`: **exactly one file
conflicts**, `scripts/test-affected-check.mjs`, with exactly three hunks.
Everything else auto-merges (`AGENTS.md`, `providers/merge.ts`,
`shared/types/providers.d.ts`, `providers/data/models-dev-snapshot.json`,
`scripts/fetch-models-metadata.mjs`,
`app/components/ChatInput/ModelsTrigger/ModelDetail.vue`,
`app/components/Chat/ContextMenu.client.vue`,
`server/api/v1/chats/[slug]/index.post.ts`, and five test files).

### 2.2 Conflict hunk 1 — `modelCatalogTests` (around line 118)

Pure union. Keep both sides, branch entries first, then main's:

```js
  const modelCatalogTests = [
    'tests/unit/providers/merge.spec.ts',
    'tests/unit/providers/anthropic.spec.ts',
    'tests/unit/providers/xai.spec.ts',
    'tests/unit/providers/deepseek.spec.ts',
    'tests/unit/providers/moonshotai.spec.ts',
    'tests/unit/providers/qwen.spec.ts',
    'tests/unit/providers/default-model.spec.ts',
    'tests/unit/providers/ordering.spec.ts',
    'tests/unit/scripts/audit-curated-models.spec.ts',
    'tests/unit/scripts/detect-model-successors.spec.ts',
    'tests/unit/utils/model.spec.ts',
    'tests/unit/utils/cost-map.spec.ts',
    ...modelsTriggerTests,
    'tests/e2e/chat/scroll-spacer.spec.ts',
  ]
```

(The `detect-model-successors.spec.ts` line already arrives from main outside
the conflict markers — do not add it twice.)

### 2.3 Conflict hunk 2 — `chatStreamBranchTests` (around line 155)

Pure union:

```js
  const chatStreamBranchTests = [
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/utils/filter-ui-message-stream.spec.ts',
    'tests/integration/api/chats-branch.spec.ts',
    'tests/integration/api/chats-duplicate-message.spec.ts',
    'tests/integration/api/chats-message-id-stream.spec.ts',
    'tests/integration/api/chats-single-step-characterization.spec.ts',
    'tests/integration/api/chats-tool-loop.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
    'tests/integration/api/chats-google-leading-assistant-placeholder.spec.ts',
  ]
```

### 2.4 Conflict hunk 3 — model-catalog regex (around line 422)

Hand-combine both alternation groups (branch adds four provider files, main adds
three script names):

```js
        /^(providers\/(index|merge|google|openai|anthropic|xai|deepseek|moonshotai|qwen)\.ts|providers\/data\/models-dev-snapshot\.json|scripts\/(fetch-models-metadata|audit-curated-models|detect-model-successors|propose-model-successors|models-dev-catalog)\.mjs|shared\/types\/providers\.d\.ts)$/,
```

### 2.5 🔴 The silent, non-conflicting bug the auto-merge introduces

**File: `server/api/v1/chats/[slug]/index.post.ts`. Git produces NO conflict
marker here. Only `pnpm run typecheck` catches it.**

Main added, inside the stream setup:

```js
        const messagesForModel = buildMessagesForModel(
          messagesForAI,
          providerId,
        )
```

`providerId` existed as a local at the merge base. This branch renamed it to
`errorProviderId` and retyped it from a three-literal union to
`SupportedProviderId` during gateway removal (see line ~392,
`let errorProviderId: SupportedProviderId | undefined`). The rename and main's
new usage sit in textually distant parts of the file, so the merge composes
cleanly into a file that references an undefined identifier.

Two mandatory edits immediately after the merge, before anything else:

1. Change the call site to `errorProviderId`:

```js
        const messagesForModel = buildMessagesForModel(
          messagesForAI,
          errorProviderId,
        )
```

2. Widen `buildMessagesForModel`'s second parameter (main defines this helper
   at the bottom of the same file, around line 1313):

```js
function buildMessagesForModel(
  messages: UIMessage[],
  providerId: SupportedProviderId | undefined,
): UIMessage[] {
```

The function body's `providerId !== 'google'` check is unchanged and stays
correct under the wider type. `SupportedProviderId` is already imported in this
file on the branch side.

### 2.6 Migrations

Main's two new D1 migrations are purely additive (`CREATE INDEX`,
`CREATE VIRTUAL TABLE … fts5`), sort after this branch's migration tail, and
contain no `DROP TABLE` — CLAUDE.md-safe. No special handling.

### 2.6a Tool-loop continuation sanity check (manual, not caught by typecheck)

The merged file has exactly one `convertToModelMessages` call site (§ 2.5's
fix point). Before moving on, the wave-0 executor must eyeball that the
branch's multi-step tool-loop continuation path (`withFollowUpTurn` /
`resolveToolLoopOptions`) still routes through `buildMessagesForModel`'s
output rather than reconstructing messages separately — a semantic
divergence here wouldn't produce a type error, only a wrong-messages bug at
runtime. `tests/integration/api/chats-tool-loop.spec.ts` (already registered
per § 2.2) is the test that would catch it if it's wrong; make sure that
spec passes as part of the § 2.7 gate, not just typecheck.

### 2.7 Merge exit gate

```
pnpm run format && pnpm run typecheck && pnpm vitest run
```

Several both-sides-edited files only auto-merged at the text level and need a
real run to prove correctness: `providers/merge.ts`,
`tests/unit/providers/merge.spec.ts`, `tests/unit/composables/chat.spec.ts`,
`tests/unit/components/ChatInput/ModelsTrigger/ModelDetail.spec.ts`,
`tests/unit/components/Chat/ContextMenu.client.spec.ts`.

**Do NOT add `pnpm run models:fetch` to this gate.** It already fails on this
branch for an unrelated reason (§ 4.1) and will keep failing until the P0 wave
lands. `models:fetch` is the P0 wave's exit gate, not the merge's.

### 2.8 What the merge gives us that Part 2 depends on

- `CuratedModel` gains `releaseDate?`, `status?`, `retiredAt?`; curated `status`
  now outranks the snapshot's, and `retiredAt` is curated-only.
- `Model` gains `retiredAt?`.
- `scripts/detect-model-successors.mjs`, `scripts/propose-model-successors.mjs`,
  `scripts/models-dev-catalog.mjs`, `tests/unit/providers/ordering.spec.ts`,
  `tests/unit/scripts/detect-model-successors.spec.ts`.

All § 4–§ 7 work edits files the merge resolution touches. **Part 1 must be
fully green before any Part 2 provider-file work begins.**

## 3. Ground-truth corrections to the research brief

The brief that commissioned this plan is wrong in six material places. Each was
verified directly against `node_modules` or the live `https://models.dev/api.json`
catalog fetched on 2026-09-16. Executors must follow this section, not the brief.

### 3.1 `xhigh` and `none` reasoning levels are NOT representable in this app

`shared/types/reasoning.d.ts`:

```ts
export type ReasoningEnabledLevel = 'low' | 'medium' | 'high'
export type ReasoningLevel = 'off' | ReasoningEnabledLevel
```

and `server/utils/providers/reasoning.ts`'s `toReasoningEffort()` returns
`'low' | 'medium' | 'high' | undefined`. `ReasoningLevelsCapability.levels` is
typed `ReasoningEnabledLevel[]`.

The brief's instruction to curate `grok-4.6` with `levels: […, 'xhigh']` and
`grok-4.3` with `levels: ['none', …]` **will not compile**, and making it
compile means widening `ReasoningEnabledLevel` through the shared types, the
picker UI, `shared/utils/reasoning.ts`, the DB-persisted reasoning value, and
`toReasoningEffort()` — a separate feature, not a catalog addition.

**Decision: curate every new levels-mode model as `['low', 'medium', 'high']`.**
The app's `'off'` state already sends no `reasoning_effort` param at all, which
is not quite the same as xAI's explicit `none` value — `'off'` leaves xAI to
apply its own per-model default (e.g. `grok-4.5` defaults to `'high'` when no
effort is sent), whereas `none` would explicitly disable reasoning. This is
pre-existing behavior (identical for the already-curated `grok-4.5`), not a
regression introduced here — note the distinction in `docs/providers.md` rather
than trying to fix it in this PR. `xhigh` is a genuine capability loss; record
it as a deferred follow-up in `docs/providers.md`.

Knock-on effect: `docs/providers.md` currently justifies excluding
`qwen3.8-max` with exactly this `xhigh` argument. Under the owner's
add-everything policy that exclusion is reversed — `qwen3.8-max` is curated as
`reasoning: { mode: 'toggle' }` (the app only ever wires `enable_thinking` for
Qwen; the effort axis is never sent), so the `xhigh` problem does not arise.
§ 12 requires that paragraph be rewritten rather than left contradicting the code.

### 3.2 `grok-imagine-image-2.0` breaks `models:fetch` unless it is EXEMPT

models.dev lists `grok-imagine-image-2.0` but its entry has **no `cost` object
at all**:

```json
{ "id": "grok-imagine-image-2.0", "limit": { "context": 64000, "output": 0 },
  "modalities": { "input": ["text","image","pdf"], "output": ["image","pdf"] },
  "release_date": "2026-08-07" }
```

`toSnapshotEntry()` in `scripts/fetch-models-metadata.mjs` requires
`typeof model.cost?.input === 'number'`; it returns `null`, the id lands in
`incompleteIds`, and the script prints "Snapshot NOT written" and
`process.exit(1)`.

**Therefore `grok-imagine-image-2.0` MUST be added to `EXEMPT_IDS` and fully
hand-curated**, exactly the way `o3-deep-research` is. Exact entry in § 5.4.
(`gpt-image-2` does not need this only because models.dev happens to carry a
`cost` block for it.)

### 3.3 `deepseek-v4-pro` pricing differs from the brief

models.dev: `deepseek-v4-pro` is **$0.435 in / $0.87 out** per 1M, not the
brief's $0.66/$1.98. The snapshot is the app's authoritative cost source
(`mergeModelMetadata` overwrites curated price strings for non-research models),
so the app will display and bill $0.435/$0.87 regardless of what this plan says.
Use models.dev; note the discrepancy for the owner (§ 8.6).

DeepSeek's off-peak/peak 2× pricing is **not modeled anywhere in this app** —
`server/utils/ai/cost-map.ts` has a single flat per-model rate. Document as a
known limitation; do not attempt to model it in this PR.

### 3.4 `@ai-sdk/deepseek@3.0.26` already supports `reasoningEffort`

Read directly from `node_modules/@ai-sdk/deepseek/dist/index.js`:

```js
  thinking: z2.object({ type: z2.enum(["adaptive", "enabled", "disabled"]).optional() …
  reasoningEffort: z2.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
```

The brief's claim that `reasoningEffort` arrives only in `3.0.45` is wrong. The
bump is optional hygiene, **not** a blocker for the P0 fix. Note also
`… thinking?.type !== "disabled" && reasoningEffort != null && { reasoning_effort: … }`
— the SDK already refuses to send both in the conflicting combination.

### 3.5 The `@ai-sdk/moonshotai` bump unlocks nothing today

`kimi-k3` is curated with `reasoningAlwaysOn: true`, and
`server/utils/providers/moonshotai.ts` returns `reasoning: undefined`
unconditionally — the app never sends a reasoning effort to Moonshot at all. The
`'low' | 'high'` schema widening in `3.0.50` therefore changes no behavior unless
`kimi-k3`'s curation changes, which this PR does not do. Recommend the bump as
hygiene; state plainly that it is a no-op.

### 3.6 `kimi-k2.7-code` and `kimi-k2.7-code-highspeed` are NOT toggle models

models.dev `reasoning_options` for both is `[]` (reasoning: true, zero adjustable
options) — the same shape as `grok-build-0.1`, which the brief itself agrees
maps to `reasoningAlwaysOn`. The brief's instruction to give them
`reasoning: { mode: 'toggle' }` "same as `kimi-k2.6`" contradicts the data;
`kimi-k2.6` is the only Moonshot model models.dev reports as `[{"type":"toggle"}]`.

Curating them as toggle would make `useMoonshotAi()` send
`providerOptions.moonshotai.thinking = { type: 'disabled' }` to a model that
does not accept the parameter — a live-key failure mode nothing in CI can catch.
**Curate both with `reasoningAlwaysOn: true`.** Flag for owner confirmation (§ 8.4).

## 4. P0 — DeepSeek retired model ids (highest priority task in Part 2)

### 4.1 Why this is P0 and self-evidencing

`providers/deepseek.ts` curates `deepseek-chat` and `deepseek-reasoner`. Neither
id exists in the live models.dev `deepseek` catalog any more — its only four
entries are `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`,
`deepseek-v4-pro`. The `@ai-sdk/deepseek` docs state both aliases were retired
on 2026-07-24.

Consequence beyond broken chat: `pnpm run models:fetch` **fails right now on
this branch** with "models.dev no longer lists 2 curated model(s)" and refuses to
write the snapshot. Every downstream catalog task in this plan is blocked on
fixing DeepSeek first. This is verifiable in one command before any code changes.

### 4.2 Exact replacement for `providers/deepseek.ts`

```ts
import type { CuratedProvider } from './merge'

export default {
  id: 'deepseek',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-flash',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'deepseek-v4-pro',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
```

`deepseek-flash` is listed first and is therefore DeepSeek's effective default
(the branch's documented convention: no model sets `default: true`; first-listed
wins). It is also the cheaper of the two and the vision-capable one.

Metadata that arrives automatically from the snapshot after `models:fetch`, for
reference — do not hand-write it:

| id | ctx | max out | in / out per 1M | modalities | release |
| --- | --- | --- | --- | --- | --- |
| `deepseek-flash` | 1,000,000 | 384,000 | $0.15 / $0.60 | text+image → text | 2026-09-10 |
| `deepseek-v4-pro` | 1,000,000 | 384,000 | $0.435 / $0.87 | text → text | 2026-08-12 |

### 4.3 Why toggle mode for both, and not levels

models.dev `reasoning_options`:

- `deepseek-flash`: `[{"type":"toggle"},{"type":"effort","values":["low","high","max"]}]`
- `deepseek-v4-pro`: `[{"type":"toggle"},{"type":"effort","values":["high","max"]}]`

DeepSeek's effort axis has no `medium`, and the app has no `max`. There is no
lossless mapping onto `ReasoningEnabledLevel`, and `deepseek-v4-pro` has no `low`
either, so the two models would need *different* level sets. Toggle mode is an
exact fit for the axis both models share, and it reuses the wiring that already
works in `server/utils/providers/deepseek.ts` on the installed SDK version.

### 4.4 `server/utils/providers/deepseek.ts` — what changes

**Almost nothing. Do not restructure this file.** It branches on
`modelData.reasoning?.mode === 'toggle'`, not on model id. With both new models
curated as toggle, `isToggleCapability` is `true` for both, so the existing code
sets `providerOptions.deepseek.thinking = { type: 'enabled' | 'disabled' }` and
returns `reasoning: undefined` — which is exactly the intended behavior.

Required edit: **the doc comment only.** It names `deepseek-chat` and
`deepseek-reasoner` and explains the deliberate bypass of the SDK's automatic
top-level-`reasoning`→`reasoning_effort` mapping. Preserve that reasoning
verbatim; rewrite the model names and add that the levels-mode branch is now
unreachable for DeepSeek (no curated DeepSeek model uses levels) but is kept
because it is the generic contract every `use<Provider>()` shares. Reference
`node_modules/@ai-sdk/deepseek/dist/index.js`'s
`thinking?.type !== "disabled" && reasoningEffort != null` guard as the
confirmation that the bypass is still needed.

### 4.5 Retired-id fallout — verified, no code change needed

- **Stored selection**: `app/composables/model.ts`'s `useUserModel()` already
  guards with `if (!getModel(parsed).model) return defaultModel`. A user pinned
  to `deepseek-chat` silently falls back to `gemini-2.5-flash-lite`. No 400, no
  crash. Call it out in the release notes.
- **Historical messages**: `getModelName()` returns the literal `'Select Model'`
  for an unknown id, but `app/components/Chat/ContextMenu.client.vue:278` already
  falls back to the raw id (`model ? getModelName(…) : props.info.model`), so old
  messages keep showing `deepseek-chat`. Persisted per-message cost metadata is
  stored, not recomputed. No action.
- **`keys` table**: keyed by `provider: 'deepseek'`, not by model id. Untouched.

### 4.6 Should the old ids be kept as `status: 'deprecated'` entries?

**No — recommend removing outright.** Keeping them is impossible without also
adding them to `EXEMPT_IDS` and hand-curating their entire metadata (models.dev
no longer publishes them), and they would be picker entries that produce a hard
provider error on every send. See § 8.1 for the owner framing.

### 4.7 P0 exit gate

```
pnpm run models:fetch     # must now succeed and write the snapshot
pnpm run format && pnpm run typecheck && pnpm vitest run
```

## 5. xAI — `providers/xai.ts`

### 5.1 Four new text models

All four are present in models.dev with complete cost blocks, so no `EXEMPT_IDS`
handling is needed for any of them.

| id | ctx | max out | in / out per 1M | tool_call | models.dev `reasoning_options` | curated shape |
| --- | --- | --- | --- | --- | --- | --- |
| `grok-4.6` | 500,000 | 500,000 | $2.00 / $6.00 | true | effort `low,medium,high,xhigh` | `levels: ['low','medium','high']` |
| `grok-4.3` | 1,000,000 | 30,000 | $1.25 / $2.50 | true | effort `none,low,medium,high` | `levels: ['low','medium','high']` |
| `grok-build-0.1` | 256,000 | 256,000 | $1.00 / $2.00 | true | `[]` | `reasoningAlwaysOn: true` |
| `grok-4.20-multi-agent-0309` | 1,000,000 | 30,000 | $1.25 / $2.50 | **false** | effort `low,medium,high,xhigh` | `levels: ['low','medium','high']` |

`grok-4.20-multi-agent-0309` gets `tools: []` — models.dev reports
`tool_call: false`, confirming the brief. Every other new model gets
`tools: ['web_search']`, matching the three already curated.

### 5.2 Array order is load-bearing

`tests/unit/providers/ordering.spec.ts` (arriving from main) enforces
newest-first within a family. Running main's `parseModelFamily` over the xAI ids
gives one multi-member family:

```
grok-{v} :: grok-4.6(4.6) > grok-4.5(4.5) > grok-4.3(4.3)
```

`grok-4.20-0309-reasoning` → `grok-{v}-reasoning`;
`grok-4.20-0309-non-reasoning` → `grok-{v}-non-reasoning`;
`grok-4.20-multi-agent-0309` → `grok-{v}-multi-agent-0309`;
`grok-build-0.1` → `grok-build-{v}` — all singletons, unconstrained.
`grok-imagine-image-2.0` is excluded from family grouping entirely because it
carries an `imageGeneration` block.

### 5.3 Exact final `providers/xai.ts`

```ts
import type { CuratedProvider } from './merge'

export default {
  id: 'xai',
  name: 'xAI',
  models: [
    {
      id: 'grok-4.20-0309-non-reasoning',
      tools: ['web_search'],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.20-0309-reasoning',
      tools: ['web_search'],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.20-multi-agent-0309',
      tools: [],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.6',
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.5',
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.3',
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-build-0.1',
      tools: ['web_search'],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-imagine-image-2.0',
      name: 'Grok Imagine Image 2.0',
      description: 'Image model for prompt-driven generation, editing, and visual design workflows',
      contextLength: 64_000,
      maxOutputTokens: 0,
      releaseDate: '2026-08-07',
      modalities: {
        input: ['text', 'image', 'pdf'],
        output: ['image'],
      },
      price: {
        tokens: 1,
        display: '$0.04 / image',
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'grok-4.20-0309-non-reasoning',
      },
    },
  ],
} satisfies CuratedProvider
```

`grok-4.20-0309-non-reasoning` stays first — it remains xAI's effective default,
and the existing pinned test asserts it. The image model is **last**, mirroring
`gpt-image-2` in `providers/openai.ts` (pinned by `tests/unit/utils/model.spec.ts`
with `.at(-1)`) — main's successor detector documents this tail invariant at
length in `buildFamilyTemplates()`.

### 5.4 Notes on the hand-curated image entry

- `maxOutputTokens: 0` is correct and accepted: `gpt-image-2`'s snapshot entry
  has `limit.output: 0` today.
- `output: ['image']` deliberately drops models.dev's `'pdf'` — it matches
  `gpt-image-2`'s snapshot exactly, and `getModelKind()` /
  `hasVisionCapability()` only read `modalities.input`.
- `price.tokens: 1` keeps it out of the per-token cost map:
  `getModelCostMap()` in `server/utils/ai/cost-map.ts` skips any model where
  `model.price.tokens !== 1_000_000`. `price.input`/`price.output` resolve to
  `''`, which is never read for this model. This is exactly how `gpt-image-2`
  behaves — image cost comes from `getImageGenerationCost()` instead.
- `resolvePriceTier()` parses `'$0.04 / image'` → 0.04 ≤ 0.05 → tier `'$'`.
- `controllerModel: 'grok-4.20-0309-non-reasoning'` is the cheapest non-reasoning
  xAI chat model already in the catalog — the structural analogue of
  `gpt-5-nano` for `gpt-image-2`.

### 5.5 `EXEMPT_IDS` edit — `scripts/fetch-models-metadata.mjs`

**APPEND to the array — do not replace it.** The post-merge `EXEMPT_IDS` (from
`origin/main`) already contains `gemini-3-pro-preview` (the retired-but-kept
Gemini entry, § the internal merge audit). Overwriting the array with only the
three ids below would silently drop that entry and make `models:fetch` hard-fail
with "models.dev no longer lists 1 curated model." Add one line:

```js
// xAI's image models are listed by models.dev but with no `cost` block at
// all, which `toSnapshotEntry()` treats as incomplete — fully curated in
// providers/xai.ts instead.
const EXEMPT_IDS = [
  'o3-deep-research',
  'o4-mini-deep-research',
  'gemini-3-pro-preview',
  'grok-imagine-image-2.0',
]
```

(The first three entries are whatever the post-merge array already contains —
read the actual file after the merge and append to it; the list above is
illustrative of the expected post-merge shape, not a literal to paste over it.)

### 5.6 xAI image generation — implementation, modeled on OpenAI/Google

Mechanism decision, ground-truthed against the installed
`@ai-sdk/xai@4.0.33`: use the **dedicated image model constructor**
`xai.image(modelId)` with the AI SDK's standalone `generateImage()`. `require()`
confirms `xai.image` and `xai.imageModel` exist in the installed version — no
bump needed. Do **not** use `xai.tools.imageGeneration()`: that is a
conversational tool the chat model invokes mid-turn, it is absent from the
installed version, and it is the wrong shape for this app's controller-model
pattern.

**5.6.1 `shared/types/image-generation.d.ts`**

```ts
export type ImageGenerationProvider = 'openai' | 'google' | 'xai'
```

`ImageGenerationAspectRatio` stays `'1:1' | '2:3' | '3:2'` — all three are in
xAI's accepted set, so no UI change is needed.

**5.6.2 `server/utils/ai/image-generation.ts` — `getProviderGenerationOptions()`**

Insert an `xai` branch before the Google fall-through, and import the option
type alongside the existing OpenAI/Google ones:

```ts
import type { XaiImageModelOptions } from '@ai-sdk/xai'
```

```ts
  if (provider === 'xai') {
    /**
     * xAI's image model rejects the `size` option outright (the provider
     * emits an unsupported-setting warning: "This model does not support
     * the `size` option. Use `aspectRatio` instead."), so this is the one
     * image provider that takes the top-level `aspectRatio` and nothing
     * else. Deliberately no `providerOptions.xai` here: xAI's own docs for
     * `grok-imagine-image-2.0` only accept `quality: 'low' | 'medium' |
     * 'auto'` — NOT `'high'`, despite the AI SDK's TypeScript type
     * (`XaiImageModelOptions`) listing `'high'` as a valid literal. The SDK
     * passes `quality` straight through without validating it against the
     * specific model, so setting `'high'` type-checks but 400s at request
     * time against a real key — a failure mode no test in this repo can
     * catch. `resolution` isn't an xAI request parameter at all (only
     * `aspect_ratio`, `quality`, `output_format`, `sync_mode`, `user` are
     * documented) and does nothing if sent. Omitting the object leaves
     * xAI's default `quality: 'auto'`, which resolves to `'low'` for
     * generation — the tier `flatImageGenerationCostUsdByModelId`'s flat
     * $0.04 corresponds to (confirm against a live key, § 8.5).
     * @see https://ai-sdk.dev/providers/ai-sdk-providers/xai#image-models
     */
    return {
      aspectRatio,
    } as const
  }
```

If a future model needs `providerOptions.xai`, the exported type name is
`XaiImageModelOptions` in `@ai-sdk/xai@4.0.33` (verify against
`node_modules/@ai-sdk/xai/dist/index.d.ts` if it doesn't resolve); the runtime
schema is
`{ aspect_ratio?, output_format?, sync_mode?, resolution?: '1k'|'2k', quality?: 'low'|'medium'|'high', user? }`
(`node_modules/@ai-sdk/xai/dist/index.js`, `xaiImageModelOptions`) — but per-model
accepted values are narrower than this shared type and must be checked against
that model's own docs page before use, exactly as this section found for
`grok-imagine-image-2.0`. Do **not** set `aspect_ratio` inside `providerOptions`
— the provider only reads it when the top-level `aspectRatio` is absent.

No change is needed to the `generateImage()` call itself or to
`validateGeneratedImage(image.uint8Array, image.mediaType)` — see 5.6.6.

**5.6.3 `server/utils/ai/image-generation-cost.ts`**

```ts
const flatImageGenerationCostUsdByModelId: Record<string, number> = {
  'gemini-3.1-flash-image': 0.067,
  'gemini-3.1-flash-lite-image': 0.0336,
  'gemini-3-pro-image': 0.134,
  'gemini-2.5-flash-image': 0.039,
  'grok-imagine-image-2.0': 0.04,
}
```

Extend the existing doc comment to say xAI is flat-priced per image like Google,
and cross-check it against `providers/xai.ts`'s `price.display`.

**5.6.4 `server/utils/providers/xai.ts`**

Mirror `server/utils/providers/google.ts` / `openai.ts` exactly:

```ts
  const controllerModelId = getControllerModelId(modelData)
  const imageModelId = getImageGenerationModelId(
    modelData,
    'grok-imagine-image-2.0',
  )

  function getInstance() {
    return xai(controllerModelId)
  }

  function getImageModel() {
    if (!requestedTools.includes('image_generation')) {
      return undefined
    }

    return xai.image(imageModelId)
  }
```

and add `imageModel: getImageModel(), imageModelId,` to the returned object.

**Parity fix in the same file**: `getTools()` currently lacks the
`|| requestedTools.includes('image_generation')` early-out that both
`useOpenAI()` and `useGoogle()` have. Without it an image request would still
attach `xai.tools.webSearch({})` alongside the image tool. Change:

```ts
  function getTools(): FormattedTools {
    if (
      !requestedTools?.length
      || requestedTools.includes('image_generation')
    ) {
      return {}
    }
```

Leave the existing `reasoningAlwaysOn` / `reasoningSummary` doc comment and logic
untouched.

**5.6.5 `server/api/v1/chats/[slug]/index.post.ts` — the `xai` case**

Destructure `imageModel: xaiImageModel, imageModelId: xaiImageModelId` from
`useXai(...)`, then append the image branch immediately before `break`, copied
structurally from the `google` case with the identifiers swapped:

```ts
          if (requestedTools.includes('image_generation')) {
            if (!xaiImageModel) {
              throw createError({
                message: 'Image generation is unavailable for this provider.',
                status: 400,
              })
            }

            const imageGenerationTool = createImageGenerationTool({
              userId,
              provider: 'xai',
              model: xaiImageModelId,
              imageModel: xaiImageModel,
              logger: aiLogger,
              requestId: getRequestId(event),
              onGenerated: ({ aspectRatio }) => {
                generatedImage = { modelId: xaiImageModelId, aspectRatio }
              },
            })
            parsedTools = {
              tools: {
                generate_image: imageGenerationTool,
              },
              toolChoice: {
                type: 'tool',
                toolName: 'generate_image',
              },
            }
          }
```

**5.6.6 Byte-format verification — already ground-truthed, downgrade to a test**

The brief asked for this as open research. It is resolved. From
`node_modules/@ai-sdk/xai/dist/index.js`, the image model hardcodes
`response_format: "b64_json"` in the request body, then:

```js
const hasAllBase64 = response.data.every((image) => image.b64_json != null);
const images = hasAllBase64
  ? response.data.map((image) => image.b64_json)
  : await Promise.all(response.data.map((image) => this.downloadImage(image.url, abortSignal)));
```

so the provider hands `generateImage()` base64 strings, with a binary-download
fallback if xAI ever returns URLs instead. `ai@7.0.56` wraps those into a
`GeneratedFile` whose `mediaType` is derived via `detectMediaType()` from the
bytes themselves. `image.uint8Array` and `image.mediaType` are therefore
populated exactly as they are for OpenAI and Google, and
`validateGeneratedImage()` (PNG/JPEG/WebP signature check) works unchanged.

**Remaining task**: a unit assertion in
`tests/unit/utils/ai/image-generation-xai.spec.ts` (§ 11) that stubs the image
model, returns a valid PNG byte array, and asserts the persisted file's media
type — plus the § 8.5 owner item to confirm with a real key that xAI's default
output format is one of the three the validator accepts. If xAI returns
something else, the fix is a one-key change: `output_format: 'png'` in the
`providerOptions.xai` object from 5.6.2.

### 5.7 xAI models deliberately NOT added — decision points

- **Retired slugs** (`grok-3`, `grok-4-0709`, `grok-code-fast-1`, …): not added,
  not even as `status: 'deprecated'` entries. xAI silently redirects a retired
  slug to a successor **and bills at the successor's price**, so a picker entry
  would misrepresent both which model answers and what it costs. They are also
  absent from models.dev, so each would need `EXEMPT_IDS` + full hand-curation.
- **`grok-imagine-image-quality`**: retires 2026-11-02, roughly seven weeks out.
  Adding a model we would remove in the same quarter is churn.
- **`grok-imagine-image`** (1.0): superseded by 2.0, same modality, older.
- **`grok-imagine-video`, `grok-imagine-video-1.5`**: video generation, outside
  the app's capability set.
- **`Experimental_XaiRealtimeModel`**: realtime voice, outside the app's set.

## 6. Moonshot AI — `providers/moonshotai.ts`

Moonshot's live catalog is exactly four models — it pruned its old line rather
than growing. The app has two; add the other two.

| id | ctx | max out | in / out per 1M | models.dev `reasoning_options` | curated shape |
| --- | --- | --- | --- | --- | --- |
| `kimi-k2.7-code` | 262,144 | 262,144 | $0.95 / $4.00 | `[]` | `reasoningAlwaysOn: true` |
| `kimi-k2.7-code-highspeed` | 262,144 | 262,144 | $1.90 / $8.00 | `[]` | `reasoningAlwaysOn: true` |

Both released 2026-06-12, both `tool_call: true`, both text+image+video in →
text out. Both ids are already in `@ai-sdk/moonshotai@3.0.30`'s typed model-id
union, so no SDK bump is needed to reach them.

See § 3.6 for why these are `reasoningAlwaysOn`, not toggle.

### 6.1 Exact final `providers/moonshotai.ts`

```ts
import type { CuratedProvider } from './merge'

export default {
  id: 'moonshotai',
  name: 'Moonshot AI',
  models: [
    {
      id: 'kimi-k2.6',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'kimi-k3',
      tools: ['web_search'],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'kimi-k2.7-code',
      tools: ['web_search'],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'kimi-k2.7-code-highspeed',
      tools: ['web_search'],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
```

All four keep `tools: ['web_search']` — Moonshot web search is hand-rolled
against the Formula API in `server/utils/providers/moonshotai-web-search.ts` and
is not model-specific.

`server/utils/providers/moonshotai.ts` needs **no logic change**: it branches on
`modelData.reasoning?.mode === 'toggle'`, which stays true only for `kimi-k2.6`.
Update its doc comment to name all four models and to state that three of the
four are now `reasoningAlwaysOn`.

### 6.2 The ordering-policy collision — RECOMMENDATION: keep `kimi-k2.6` first

Main's `parseModelFamily` puts `kimi-k2.6` (version `2.6`) and `kimi-k3`
(version `3`) in the **same** family `kimi-k{v}`, so newest-first would demand
`kimi-k3` before `kimi-k2.6`. The branch's `docs/providers.md` documents the
opposite: first-listed is the provider default, and Moonshot's intended default
is `kimi-k2.6`. If `ordering.spec.ts` were extended to `moonshotai` today, it
would fail.

The two new ids do **not** interact with this: they parse into the separate
families `kimi-k{v}-code` and `kimi-k{v}-code-highspeed`, each a singleton.

**Recommendation: keep `kimi-k2.6` first and scope `ordering.spec.ts` to
`anthropic`, `google`, `openai` and `xai` only.** Reasons:

1. "First-listed is the default" is a *product* decision this branch documents
   and tests; "newest-first" is an *ergonomic* convention main introduced for
   families where newest is also the one users want first. They collide only
   when the newest model is not the best default — which is exactly the
   `kimi-k2.6` ($0.95/$4.00, toggleable reasoning) vs `kimi-k3` ($3.00/$15.00,
   mandatory reasoning) case. Reordering would triple the cost of Moonshot's
   default silently.
2. The generic family parser is demonstrably unsound outside the
   OpenAI/Google/Anthropic id shapes. Concrete proof from Qwen, computed with
   main's own `parseModelFamily`/`compareModelVersions`:

   ```
   qwen{v}b :: qwen3-32b(3-32) > qwen3-14b(3-14) > qwen3-8b(3-8)
             > qwen3.6-27b(3.6-27) > qwen3.5-27b(3.5-27)
   ```

   The parser has grouped parameter-count variants and version variants into one
   "family" and ranked `qwen3-32b` as *newer* than `qwen3.6-27b`. A spec built on
   that would enforce a meaningless order.
3. Extending to `xai` **is** sound and worth doing: `grok-{v}` cleanly yields
   `grok-4.6 > grok-4.5 > grok-4.3`, which is a real invariant worth pinning.

Implementation: add an `xai` case to `ordering.spec.ts`'s
`describe('curated provider ordering')` block, and add a comment above it
recording why `moonshotai`, `deepseek` and `qwen` are deliberately excluded,
citing the `qwen{v}b` example verbatim.

### 6.3 Moonshot's 13 discontinued models — NOT added

Moonshot's docs say discontinued models are "no longer maintained or supported",
which reads as hard-404 rather than xAI/DeepSeek-style silent redirect. They are
also absent from models.dev, so each would need `EXEMPT_IDS` plus hand-curated
metadata. Not added. Unverifiable without a live key → § 8.3.

## 7. Qwen — `providers/qwen.ts` (`modelsDevKey: 'alibaba'`)

### 7.1 Architecture decision: **(a) stay on `@ai-sdk/openai-compatible`** — agreed

The brief discovered a first-party `@ai-sdk/alibaba@2.0.46` whose peer dep
(`zod: "^3.25.76 || ^4.1.8"`) is compatible with this app's `zod@^4.4.3`
(independently re-confirmed against the npm registry) and whose default chat
`baseURL` is the same `dashscope-intl.aliyuncs.com/compatible-mode/v1` endpoint
this app already targets. The existing code comment in
`server/utils/providers/qwen.ts` only knows about the incompatible third-party
`qwen-ai-provider` and is therefore out of date.

**Recommendation: do not migrate in this PR.** The risk/reward is clearly
negative:

- `@ai-sdk/alibaba`'s `providerOptions.alibaba` is a closed `z.object({...})`
  with exactly `enableThinking`, `thinkingBudget`, `parallelToolCalls` and no
  `.passthrough()`. Zod strips unknown keys silently.
- This app's Qwen web search depends entirely on `enable_search` and
  `search_options.search_strategy: 'agent'` being forwarded **verbatim** — which
  works today only because `@ai-sdk/openai-compatible` passes through unknown
  `providerOptions` keys. `server/utils/providers/qwen.ts`'s own doc comment
  documents this as deliberate.
- Migration would therefore break Qwen web search with **no error and no
  warning** — the flags would simply vanish from the request body. That is the
  single worst failure mode a change can have.
- `@ai-sdk/alibaba` exposes no image-generation capability either
  (`AlibabaProvider` has `languageModel`/`chatModel`, `embedding`, `video` — no
  `image`), so migrating buys nothing on that front.
- The only real gain is typed model-id autocomplete, and both packages accept
  arbitrary id strings anyway. The app passes ids as plain strings from the
  curated catalog, so the typing never engages.

If the owner later wants (b), it must be its own PR, preceded by DashScope
endpoint research and a hand-rolled Qwen web-search tool built the way
`server/utils/providers/moonshotai-web-search.ts` already is — explicitly **not**
bundled here.

**Required edit regardless**: update the doc comment at the top of
`server/utils/providers/qwen.ts` so it stops implying no first-party package
exists. Name `@ai-sdk/alibaba@2.0.46`, state that it is zod-4-compatible, and
record the closed-schema web-search regression as the reason it was declined.
Leaving the comment as-is invites a future agent to "fix" it and silently break
web search.

### 7.2 The 43 models to add

Derived from the live `alibaba` catalog (55 entries) minus: 7 out-of-scope
(audio/video output, realtime, ASR), 2 Alibaba-hosted third-party models, and
the 3 already curated. Reasoning shape is derived mechanically from each model's
models.dev `reasoning_options`:

- contains `{"type":"toggle"}` → `reasoning: { mode: 'toggle' }` (the app wires
  `enable_thinking`, which is exactly that toggle)
- `reasoning: true` but **no** toggle (either `[]` or `budget_tokens` only) →
  `reasoningAlwaysOn: true` — sending `enable_thinking: false` to these would be
  a live-key error
- `reasoning: false` → no reasoning field at all

**Group A — `reasoning: { mode: 'toggle' }` (19 models)**

`qwen3.8-max`, `qwen3.8-flash`, `qwen3.6-max-preview`, `qwen3.6-plus`,
`qwen3.6-27b`, `qwen3.6-35b-a3b`, `qwen3.5-plus`, `qwen3.5-397b-a17b`,
`qwen3.5-122b-a10b`, `qwen3.5-27b`, `qwen3.5-35b-a3b`, `qwen3-vl-plus`,
`qwen3-235b-a22b`, `qwen3-32b`, `qwen3-14b`, `qwen3-8b`, `qwen-plus`,
`qwen-flash`, `qwen-turbo`

**Group B — `reasoningAlwaysOn: true` (5 models)**

`qwq-plus`, `qvq-max`, `qwen3-next-80b-a3b-thinking`, `qwen3-vl-235b-a22b`,
`qwen3-vl-30b-a3b`

**Group C — no reasoning field (19 models)**

`qwen3-max`, `qwen3-next-80b-a3b-instruct`, `qwen3-coder-plus`,
`qwen3-coder-flash`, `qwen3-coder-480b-a35b-instruct`,
`qwen3-coder-30b-a3b-instruct`, `qwen-max`, `qwen-vl-max`, `qwen-vl-plus`,
`qwen-vl-ocr`, `qwen-plus-character-ja`, `qwen-mt-plus`, `qwen-mt-turbo`,
`qwen2-5-vl-72b-instruct`, `qwen2-5-vl-7b-instruct`, `qwen2-5-72b-instruct`,
`qwen2-5-32b-instruct`, `qwen2-5-14b-instruct`, `qwen2-5-7b-instruct`

Full per-model reference (ctx/out/cost arrive from the snapshot automatically;
this table exists so a reviewer can sanity-check without refetching):

| id | ctx | out | $ in / out | reasoning_options | curated |
| --- | --- | --- | --- | --- | --- |
| qwen3.8-max | 1,000,000 | 131,072 | 2 / 6 | toggle+effort+budget | toggle |
| qwen3.8-flash | 1,000,000 | 131,072 | 0.15 / 0.47 | toggle+effort+budget | toggle |
| qwen3.6-max-preview | 262,144 | 65,536 | 1.3 / 7.8 | toggle+budget | toggle |
| qwen3.6-plus | 1,000,000 | 65,536 | 0.5 / 3 | toggle+budget | toggle |
| qwen3.6-27b | 262,144 | 65,536 | 0.6 / 3.6 | toggle+budget | toggle |
| qwen3.6-35b-a3b | 262,144 | 65,536 | 0.248 / 1.485 | toggle+budget | toggle |
| qwen3.5-plus | 1,000,000 | 65,536 | 0.4 / 2.4 | toggle+budget | toggle |
| qwen3.5-397b-a17b | 262,144 | 65,536 | 0.6 / 3.6 | toggle+budget | toggle |
| qwen3.5-122b-a10b | 262,144 | 65,536 | 0.4 / 3.2 | toggle+budget | toggle |
| qwen3.5-27b | 262,144 | 65,536 | 0.3 / 2.4 | toggle+budget | toggle |
| qwen3.5-35b-a3b | 262,144 | 65,536 | 0.25 / 2 | toggle+budget | toggle |
| qwen3-vl-plus | 262,144 | 32,768 | 0.2 / 1.6 | toggle+budget | toggle |
| qwen3-235b-a22b | 131,072 | 16,384 | 0.7 / 2.8 | toggle+budget | toggle |
| qwen3-32b | 131,072 | 16,384 | 0.7 / 2.8 | toggle+budget | toggle |
| qwen3-14b | 131,072 | 8,192 | 0.35 / 1.4 | toggle+budget | toggle |
| qwen3-8b | 131,072 | 8,192 | 0.18 / 0.7 | toggle+budget | toggle |
| qwen-plus | 1,000,000 | 32,768 | 0.4 / 1.2 | toggle+budget | toggle |
| qwen-flash | 1,000,000 | 32,768 | 0.05 / 0.4 | toggle+budget | toggle |
| qwen-turbo | 1,000,000 | 16,384 | 0.05 / 0.2 | toggle+budget | toggle |
| qwq-plus | 131,072 | 8,192 | 0.8 / 2.4 | `[]` | alwaysOn |
| qvq-max | 131,072 | 8,192 | 1.2 / 4.8 | `[]` | alwaysOn |
| qwen3-next-80b-a3b-thinking | 131,072 | 32,768 | 0.5 / 6 | budget only | alwaysOn |
| qwen3-vl-235b-a22b | 131,072 | 32,768 | 0.7 / 2.8 | budget only | alwaysOn |
| qwen3-vl-30b-a3b | 131,072 | 32,768 | 0.2 / 0.8 | budget only | alwaysOn |
| qwen3-max | 262,144 | 65,536 | 1.2 / 6 | — | none |
| qwen3-next-80b-a3b-instruct | 131,072 | 32,768 | 0.5 / 2 | — | none |
| qwen3-coder-plus | 1,048,576 | 65,536 | 1 / 5 | — | none |
| qwen3-coder-flash | 1,000,000 | 65,536 | 0.3 / 1.5 | — | none |
| qwen3-coder-480b-a35b-instruct | 262,144 | 65,536 | 1.5 / 7.5 | — | none |
| qwen3-coder-30b-a3b-instruct | 262,144 | 65,536 | 0.45 / 2.25 | — | none |
| qwen-max | 32,768 | 8,192 | 1.6 / 6.4 | — | none |
| qwen-vl-max | 131,072 | 8,192 | 0.8 / 3.2 | — | none |
| qwen-vl-plus | 131,072 | 8,192 | 0.21 / 0.63 | — | none |
| qwen-vl-ocr | 34,096 | 4,096 | 0.72 / 0.72 | — | none |
| qwen-plus-character-ja | 8,192 | 512 | 0.5 / 1.4 | — | none |
| qwen-mt-plus | 16,384 | 8,192 | 2.46 / 7.37 | — | none |
| qwen-mt-turbo | 16,384 | 8,192 | 0.16 / 0.49 | — | none |
| qwen2-5-vl-72b-instruct | 131,072 | 8,192 | 2.8 / 8.4 | — | none |
| qwen2-5-vl-7b-instruct | 131,072 | 8,192 | 0.35 / 1.05 | — | none |
| qwen2-5-72b-instruct | 131,072 | 8,192 | 1.4 / 5.6 | — | none |
| qwen2-5-32b-instruct | 131,072 | 8,192 | 0.7 / 2.8 | — | none |
| qwen2-5-14b-instruct | 131,072 | 8,192 | 0.35 / 1.4 | — | none |
| qwen2-5-7b-instruct | 131,072 | 8,192 | 0.175 / 0.7 | — | none |

### 7.3 Web search on the new Qwen models: `tools: []` for all 43

The three currently curated models were scoped by reading Alibaba's own docs per
model, and `tests/unit/providers/qwen.spec.ts` asserts exactly that scoping
("the models whose chat-completions support DashScope documents for the
international endpoint"). No equivalent per-model verification exists for the 43
new ids, and models.dev carries no web-search field.

**Declaring `web_search` unverified would produce a picker toggle that silently
does nothing** (DashScope ignores `enable_search` on models that do not support
it). Every new Qwen model therefore gets `tools: []`, the three existing ones
keep their current tools, and a follow-up research task goes into
`docs/providers.md`'s Owner action items (§ 8.7). The qwen spec's test title and
body get updated to assert the new scoping explicitly.

### 7.4 Qwen image generation: DEFERRED, not in this PR

Confirmed: neither `@ai-sdk/openai-compatible` nor `@ai-sdk/alibaba` exposes any
image-generation capability for Alibaba. `AlibabaProvider` offers
`languageModel`/`chatModel`, `embedding`/`embeddingModel`,
`video`/`videoModel` — no `image`/`imageModel`. Alibaba's image generation runs
on a different native API entirely, likely requiring a second Workspace-ID
credential field, which would break the single-`apiKey` shape every provider in
this app shares. Record as an explicit "not in this PR" decision with this
reasoning for a future PR.

### 7.5 Qwen ids deliberately excluded — standing rules, not one-off choices

- **Audio/video/realtime**: `qwen3-omni-flash`, `qwen3-omni-flash-realtime`,
  `qwen-omni-turbo`, `qwen-omni-turbo-realtime`, `qwen2-5-omni-7b`,
  `qwen3-asr-flash`, `qwen3-livetranslate-flash-realtime`. Every one has `audio`
  or `video` in its **output** modalities or is a realtime/ASR endpoint. The app
  renders text and images only. This is the same capability filter that already
  keeps embedding/TTS models out.
- **Alibaba-hosted third-party models — STANDING RULE**: `deepseek-v4-flash-0731`
  and `glm-5.2` are excluded. This app's snapshot is keyed by a **flat model id
  with no provider namespace** (`getModel(id)` scans every provider and the last
  match wins). Curating an Alibaba-hosted copy of another vendor's model is a
  latent id collision — the moment Alibaba hosts an id this app already curates
  under its native provider, `getModel()` silently resolves to whichever entry
  the loop hits last, and requests route to the wrong provider with the wrong
  key. Applies to every provider, permanently, not just this PR.
- **CN-region-only ids**: absent from the international `alibaba` catalog this
  app calls.

### 7.6 Reversal of the documented rolling-alias exclusion

`docs/providers.md` currently says the bare `qwen-max`/`qwen-plus`/`qwen-flash`/
`qwen-turbo` ids were deliberately excluded because Alibaba silently repoints
them to newer dated snapshots. The owner's standing policy is now the opposite —
prefer the stable rolling/undated alias, skip dated-snapshot duplicates — and
models.dev lists **no** dated Alibaba snapshots at all, so the aliases are the
only reachable form of those models. They are included. § 12 requires that
paragraph be rewritten rather than left contradicting the code.

### 7.7 Catalog size impact

The snapshot grows from 42 to ~94 entries (20 KB → ~45 KB). The merged catalog
is injected into `runtimeConfig.public` via `nuxt.config.ts:209`, so the client
payload grows by roughly 25 KB uncompressed. Acceptable, but worth a line in
`docs/models-data-fetching.md` so it is not discovered as a surprise later.

## 8. Decision points (owner sign-off — do not decide silently)

| # | Question | Recommendation |
| --- | --- | --- |
| 8.1 | Remove `deepseek-chat`/`deepseek-reasoner` outright, or keep as deprecated safety-net entries? | **Remove.** Keeping them needs `EXEMPT_IDS` + full hand-curation, and they would be picker entries that hard-fail on every send. Stored selections already fall back safely (§ 4.5). |
| 8.2 | `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` — add alongside `deepseek-flash`? | **Skip both.** They are byte-identical to `deepseek-flash` in cost, context, limits and release date; main's own `isDuplicateOfCuratedSibling()` (same cost + same release date) classifies exactly this as a duplicate. The `-vision-exp` variant is additionally an explicitly experimental endpoint whose vision capability `deepseek-flash` already has. |
| 8.3 | Moonshot's 13 discontinued ids as legacy entries? | **No.** Moonshot documents them as unsupported (likely hard 404, unlike xAI/DeepSeek's redirect). Unverifiable without a live key. |
| 8.4 | `kimi-k2.7-code{,-highspeed}` as `reasoningAlwaysOn` (this plan) vs `toggle` (the brief)? | **`reasoningAlwaysOn`**, per models.dev `reasoning_options: []`. Confirm with a live key — toggle would send an unsupported `thinking` param. |
| 8.5 | xAI image output format | Confirm with a live key that `grok-imagine-image-2.0` returns PNG/JPEG/WebP. One-key fix if not (§ 5.6.6). |
| 8.6 | `deepseek-v4-pro` price band | models.dev says $0.435/$0.87, the commissioning research said $0.66/$1.98. Tier `'$$'` either way. No new price band — no owner decision needed unless the owner has contrary billing data. |
| 8.7 | Qwen web search on the 43 new models | Ships as `tools: []`. Needs a DashScope per-model research pass to enable. |
| 8.8 | `ordering.spec.ts` scope | Extend to `xai` only; exclude `moonshotai`/`deepseek`/`qwen` with the `qwen{v}b` counter-example as the stated reason (§ 6.2). |
| 8.9 | Qwen SDK: stay on `openai-compatible` vs migrate to `@ai-sdk/alibaba` | **Stay** (§ 7.1). Migration silently breaks web search. |

## 9. Package versions

| package | installed | action | reason |
| --- | --- | --- | --- |
| `@ai-sdk/deepseek` | 3.0.26 | `pnpm update @ai-sdk/deepseek` → 3.0.45 | Optional hygiene. **Not required** — 3.0.26 already has the full `reasoningEffort` enum and `thinking.type` (§ 3.4). |
| `@ai-sdk/moonshotai` | 3.0.30 | `pnpm update @ai-sdk/moonshotai` → 3.0.50 | Optional hygiene. **No behavior change** — the app never sends a Moonshot reasoning effort (§ 3.5). |
| `@ai-sdk/xai` | 4.0.33 | **no change** | `xai.image()` already works in 4.0.33 (verified by `require()`). Latest is **5.0.0**, outside `^4.0.33` — a major bump is not in scope. |
| `@ai-sdk/openai-compatible` | 3.0.27 | no change | Qwen stays on it (§ 7.1). |
| `@ai-sdk/alibaba` | not installed | do not add | § 7.1. |

Both recommended bumps stay inside the existing `^` ranges in `package.json`, so
**no `package.json` edit is required** — only `pnpm-lock.yaml` moves. If a bump
turns anything red, revert it: neither is load-bearing for any task in this plan.

## 10. Internal tooling fixes

### 10.1 `scripts/detect-model-successors.mjs` — honor `modelsDevKey`

`findSuccessorProposals()` does `catalog[provider.id]?.models ?? {}`. For Qwen
(`id: 'qwen'`, `modelsDevKey: 'alibaba'`) that is **always empty**, so the
detector proposes nothing for Qwen, forever, with no error. Apply the same fix
`scripts/fetch-models-metadata.mjs` already has:

```js
  for (const provider of providers) {
    const modelsDevKey = provider.modelsDevKey ?? provider.id
    const remoteModels = catalog[modelsDevKey]?.models ?? {}
```

### 10.2 `scripts/propose-model-successors.mjs` — extend the provider list

Currently `const providers = [anthropic, google, openai]`. Extend to include
`xai`, `deepseek` and `moonshotai` (plus the matching imports) so the weekly
`models-drift-check.yml` workflow covers them.

**Hold `qwen` back** until 10.1 lands *and* the family parser is evaluated
against Qwen id shapes — with 10.1 alone, the detector would start proposing
against families like `qwen{v}b`, where it ranks `qwen3-32b` as newer than
`qwen3.6-27b` (§ 6.2). Adding qwen to the list is a follow-up gated on a parser
fix; record it in `docs/models-data-fetching.md`.

### 10.3 `isProposableTemplate()` — explicit `reasoningAlwaysOn` guard

The function rejects a template when `model.reasoning && mode !== 'levels'`. A
branch-only `reasoningAlwaysOn: true` model has **no** `reasoning` object at all,
so it passes that check and is currently rejected only incidentally, by the
`hasOnlyTokensPrice` check. That is fragile: `renderCuratedEntry()` never emits
`reasoningAlwaysOn`, so a successor generated from such a template would silently
lose the flag and show a reasoning control the model cannot honor. Add an
explicit guard:

```js
  if (model.reasoningAlwaysOn) {
    return false
  }
```

This matters much more after this PR: `reasoningAlwaysOn` goes from 2 models to
**12** (2 xAI existing + 2 new xAI + 3 Moonshot + 5 Qwen).

### 10.4 Document the toggle-mode template exclusion as intentional

Every `reasoning.mode: 'toggle'` model is permanently ineligible as a successor
template (only `'levels'` qualifies). After this PR that covers all of DeepSeek,
21 Qwen models and `kimi-k2.6`. This is by design —
`renderCuratedEntry()` only emits a `levels` array — but it means the weekly
drift check will never auto-propose successors for DeepSeek or Qwen. Record it in
`docs/models-data-fetching.md` so it is not later mistaken for the 10.1 bug
recurring.

## 11. Tests

### 11.1 Rewrite — `tests/unit/providers/deepseek.spec.ts`

`expectedModelIds = ['deepseek-flash', 'deepseek-v4-pro']`, length 2,
`deepseek-flash` first. Replace the two reasoning-shape tests with one asserting
`{ mode: 'toggle' }` for both. Add a regression test:

```ts
  it('no longer curates the retired deepseek-chat/deepseek-reasoner aliases', () => {
    const ids = deepseek.models.map(model => model.id)

    expect(ids).not.toContain('deepseek-chat')
    expect(ids).not.toContain('deepseek-reasoner')
  })
```

Keep the "has a models.dev snapshot entry for every curated id" test.

### 11.2 Rewrite — `tests/unit/providers/xai.spec.ts`

- `expectedModelIds` → all 8 ids, length 8.
- Keep "lists the non-reasoning model first".
- Replace "has no model exposing image generation" with: exactly one model has
  an `imageGeneration` block; it is `grok-imagine-image-2.0`; it is
  `xai.models.at(-1)`; its `controllerModel` is `'grok-4.20-0309-non-reasoning'`
  and that id exists in the array; its `tools` is `[]`.
- Replace "exposes web search on every model" with a per-id tools map asserting
  `grok-4.20-multi-agent-0309` and `grok-imagine-image-2.0` have `[]` and the
  other six have `['web_search']`.
- Reasoning: `grok-4.5`, `grok-4.6`, `grok-4.3`, `grok-4.20-multi-agent-0309` →
  `levels: ['low','medium','high']`; `grok-4.20-0309-reasoning` and
  `grok-build-0.1` → `reasoningAlwaysOn: true`;
  `grok-4.20-0309-non-reasoning` and the image model → neither.
- Snapshot test must **exclude** `grok-imagine-image-2.0` (it is `EXEMPT_IDS`)
  and add a positive assertion that its curated entry carries `name`,
  `description`, `contextLength`, `maxOutputTokens` and `modalities` — i.e. that
  it satisfies `toFullyCuratedModel()` without throwing.
- New: the `grok-{v}` family order `grok-4.6` → `grok-4.5` → `grok-4.3`.

### 11.3 Rewrite — `tests/unit/providers/moonshotai.spec.ts`

Four ids, length 4, `kimi-k2.6` still first, all four `tools: ['web_search']`.
`kimi-k2.6` toggle; `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed` →
`reasoningAlwaysOn: true` with `reasoning` undefined. Keep the `kimi-k2.5` and
`moonshot-v1` negative tests. Add an explicit test pinning the § 6.2 decision:

```ts
  it('keeps the cheaper kimi-k2.6 as the first-listed default even though '
    + 'kimi-k3 is newer in the same parsed family', () => {
    expect(moonshotai.models[0]?.id).toBe('kimi-k2.6')
  })
```

### 11.4 Rewrite — `tests/unit/providers/qwen.spec.ts`

- 46 ids, length 46, `qwen3.7-plus` still first.
- Keep `modelsDevKey === 'alibaba'`.
- Replace "gives every curated model a toggle-only reasoning capability" with
  three group assertions matching § 7.2's Groups A/B/C.
- Update the web-search test: only `qwen3.7-plus` and `qwen3.6-flash` declare
  `['web_search']`; every other model — including all 43 new ones — declares
  `[]`. Retitle to say the new models ship unverified-by-default (§ 7.3).
- Keep "no model exposing image generation" and "no deep-research agent".
- New, encoding § 7.5's standing rule:

```ts
  it('never curates Alibaba-hosted third-party model ids, which would '
    + 'collide in the flat, provider-less id keyspace getModel() scans', () => {
    const ids = qwen.models.map(model => model.id)

    expect(ids).not.toContain('deepseek-v4-flash-0731')
    expect(ids).not.toContain('glm-5.2')
    expect(ids).not.toContain('kimi-k3')
  })
```

- New: no curated Qwen model declares `audio` or `video` in output modalities
  (guards the § 7.5 capability filter).

### 11.5 Update — `tests/unit/providers/ordering.spec.ts` (from main)

Add an `xai` case to the `curated provider ordering` describe block. Add a
comment above it recording the § 6.2 exclusion reasoning with the `qwen{v}b`
counter-example.

### 11.6 New — `tests/unit/utils/ai/image-generation-xai.spec.ts`

Mirrors whatever the existing OpenAI/Google image-generation coverage does.
Assert:

- `getProviderGenerationOptions('xai', ratio)` returns a top-level `aspectRatio`
  and **no** `size` key, for all three of `'1:1' | '2:3' | '3:2'`.
- The returned options carry **no** `providerOptions.xai` key at all (§ 5.6.2 —
  deliberately omitted rather than sending an unverified `quality`/`resolution`
  value).
- A stubbed image model returning valid PNG bytes flows through
  `validateGeneratedImage()` and persists with `image/png` (§ 5.6.6).

### 11.7 Update — `tests/unit/utils/image-generation-cost.spec.ts`

Add `getImageGenerationCost('grok-imagine-image-2.0', '1:1') === 0.04` and assert
it is aspect-ratio independent (unlike `gpt-image-2`).

### 11.8 Update — `tests/unit/utils/providers/{deepseek,moonshotai,xai,qwen}.spec.ts`

- `deepseek.spec.ts`: model ids in fixtures change; both models are now toggle,
  so the levels-mode branch of `useDeepSeek()` is no longer exercised by a real
  curated model — keep a synthetic-model test for it so the branch stays covered.
- `xai.spec.ts`: add coverage for `getImageModel()` returning `undefined` unless
  `image_generation` is requested, for `imageModelId` resolution via
  `getImageGenerationModelId()`, and for the new `getTools()` early-out
  returning `{}` on an image request.
- `moonshotai.spec.ts` / `qwen.spec.ts`: update fixtures for the new ids; assert
  `reasoningAlwaysOn` models receive neither `thinking` nor `reasoning_effort`.

### 11.9 `scripts/test-affected-check.mjs` registration (CLAUDE.md requirement)

New test files silently never run in CI unless registered.

1. Add `'tests/unit/utils/ai/image-generation-xai.spec.ts'` to the array the
   image-generation pattern at line ~370 maps to (the one already covering
   `server/utils/ai/image-generation(-lock|-cost)?.ts`,
   `server/utils/providers/(openai|google|anthropic|xai|deepseek|moonshotai|qwen).ts`,
   `shared/types/(image-generation|providers).d.ts`).
2. Verify `tests/unit/providers/ordering.spec.ts` is in `modelCatalogTests`
   (it is, via § 2.2) and that the § 2.4 regex covers every file this plan edits:
   all four provider files ✓, `merge.ts` ✓, the snapshot ✓,
   `fetch-models-metadata.mjs` ✓, `detect-model-successors.mjs` ✓,
   `propose-model-successors.mjs` ✓.
3. Confirm `providerReasoningWiringTests` (branch line ~401) still maps the four
   `server/utils/providers/*.ts` files edited here.

## 12. Documentation updates

### 12.1 `docs/providers.md` — "Curated capabilities and server wiring"

Rewrite the four provider bullets to the post-PR catalogs. Specifically:

- **xAI**: list all 8 models; explain the `grok-4.6`/`grok-4.20-multi-agent-0309`
  `xhigh` truncation (§ 3.1) and `grok-4.3`'s `none` → app `'off'` mapping;
  explain `grok-4.20-multi-agent-0309`'s empty `tools` (`tool_call: false`
  upstream); add a new subsection on image generation covering the
  `xai.image()`-vs-`xai.tools.imageGeneration()` decision, the `EXEMPT_IDS`
  requirement and why (no upstream `cost` block), the `size`-unsupported /
  `aspectRatio`-only constraint, and the `b64_json` byte path.
- **DeepSeek**: replace the `deepseek-chat`/`deepseek-reasoner` bullet entirely;
  record that both ids were retired upstream on 2026-07-24, that `models:fetch`
  was failing as a result, and why both replacements are toggle-mode (no shared
  effort vocabulary). Note the unmodeled peak-hour 2× pricing.
- **Moonshot AI**: four models; `reasoningAlwaysOn` for three of them with the
  models.dev `reasoning_options: []` evidence; the § 6.2 ordering decision.
- **Qwen**: 46 models; the § 7.1 `@ai-sdk/alibaba` evaluation and why it was
  declined; the Group A/B/C reasoning-shape derivation rule; `tools: []` default
  with the § 8.7 follow-up; the § 7.5 standing rule on Alibaba-hosted
  third-party ids.
- **Reverse two now-stale exclusions**: the `qwen3.8-max` `xhigh` paragraph
  (§ 3.1) and the rolling-alias paragraph (§ 7.6). Do not delete them — rewrite
  each as "previously excluded for X; reversed because Y", so the history stays
  legible.
- **Package version note**: correct it — `@ai-sdk/deepseek@3.0.26` already
  carries the full reasoning-effort schema (§ 3.4).

### 12.2 `docs/providers.md` — "Owner action items"

Add entries for § 8.1, § 8.3, § 8.4, § 8.5, § 8.7 — each stated as "unverifiable
without a live key" with the specific check to run.

### 12.3 `docs/models-data-fetching.md`

- Extend the `EXEMPT_IDS` section: it now covers two distinct reasons — "not
  tracked by models.dev at all" (deep-research) and "tracked but with no `cost`
  block" (`grok-imagine-image-2.0`). Name `toSnapshotEntry()`'s numeric-cost
  requirement as the trigger.
- Document the `modelsDevKey` fix in the successor detector (§ 10.1) and that
  `qwen` is deliberately still absent from `propose-model-successors.mjs`
  pending a parser fix (§ 10.2).
- Document that toggle-mode models are permanently ineligible as successor
  templates, by design (§ 10.4).
- Document the § 7.7 catalog-size/payload growth.
- Add to "Ids deliberately not auto-added": xAI retired slugs, xAI video/realtime,
  `grok-imagine-image-quality`, `grok-imagine-image`, Moonshot's discontinued
  line, Qwen omni/realtime/ASR, and the two Alibaba-hosted third-party ids.

### 12.4 This document

Flip the Status line from PLANNED to EXECUTED with per-wave results, mirroring
`docs/gateway-removal-plan.md`'s header.

## 13. Verification gates (definition of done)

**Per-wave gate** (every wave):

```
pnpm run format
pnpm run typecheck
pnpm vitest run
```

**Catalog gate** (waves 3 and 5 only, see § 14):

```
pnpm run models:fetch
git diff providers/data/models-dev-snapshot.json
```

Must exit 0 and write the snapshot. Expected result after wave 5: ~94 entries,
with `grok-imagine-image-2.0` **absent** from the snapshot (it is exempt) and
`deepseek-chat`/`deepseek-reasoner` removed.

**Final gate**:

1. `pnpm run format && pnpm run typecheck` — clean.
2. `pnpm vitest run` — 100% pass, no skips introduced.
3. `pnpm run models:fetch` — exits 0; the diff shows only the expected
   additions/removals; the script's own "uncurated models" report shrinks as
   expected.
4. `pnpm run db:generate` — **must produce no new migration**. No schema change
   is expected anywhere in this plan; a new migration file means something went
   wrong.
5. `node scripts/propose-model-successors.mjs --dry-run` — runs without throwing
   and reports sensible families for xai/deepseek/moonshotai (§ 10.2). A crash
   here means the § 10.1/10.3 fixes are incomplete.
6. Manual smoke, owner, live keys: one send per new provider default
   (`grok-4.20-0309-non-reasoning`, `deepseek-flash`, `kimi-k2.6`,
   `qwen3.7-plus`), plus one xAI image generation at each of the three aspect
   ratios.

## 14. Wave execution plan

**Hard sequencing rule**: Part 1 (wave 0) must be fully green before ANY Part 2
provider-file work starts. Part 2 edits the exact files the merge resolution
touches.

**Snapshot rule**: `providers/data/models-dev-snapshot.json` is a single
generated file. Parallel workers must **never** run `pnpm run models:fetch` —
they would each regenerate it and conflict. Regeneration happens only in the
dedicated sequential waves 3 and 5. Parallel workers edit their provider file and
their spec only, and accept that their spec's "has a models.dev snapshot entry"
test is red until wave 3.

| Wave | Parallel? | Scope | Files | Gate |
| --- | --- | --- | --- | --- |
| **0** | no — one agent | Merge `origin/main`; resolve the three § 2.2–2.4 hunks; apply the § 2.5 `errorProviderId` fix | `scripts/test-affected-check.mjs`, `server/api/v1/chats/[slug]/index.post.ts` | § 13 per-wave |
| **1** | no — one agent | 🔴 P0 DeepSeek (§ 4) | `providers/deepseek.ts`, `server/utils/providers/deepseek.ts` (comment only), `tests/unit/providers/deepseek.spec.ts`, `tests/unit/utils/providers/deepseek.spec.ts` | per-wave + **`models:fetch` must now pass** |
| **2a** | ∥ | xAI text models (§ 5.1–5.3) | `providers/xai.ts`, `tests/unit/providers/xai.spec.ts`, `tests/unit/providers/ordering.spec.ts` | typecheck + own specs (snapshot test red until w3) |
| **2b** | ∥ | Moonshot (§ 6) | `providers/moonshotai.ts`, `server/utils/providers/moonshotai.ts` (comment only), `tests/unit/providers/moonshotai.spec.ts`, `tests/unit/utils/providers/moonshotai.spec.ts` | same |
| **2c** | ∥ | Qwen (§ 7.2–7.3, 7.6) | `providers/qwen.ts`, `server/utils/providers/qwen.ts` (comment only), `tests/unit/providers/qwen.spec.ts`, `tests/unit/utils/providers/qwen.spec.ts` | same |
| **3** | no — one agent | Run `pnpm run models:fetch` **once**; commit the snapshot; confirm waves 2a–2c specs go green | `providers/data/models-dev-snapshot.json` | full § 13 per-wave gate |
| **4** | no — one agent | xAI image generation (§ 5.4–5.6) — touches the shared image-gen infra files, all single-writer | `scripts/fetch-models-metadata.mjs` (`EXEMPT_IDS`), `providers/xai.ts` (image entry, appended last), `shared/types/image-generation.d.ts`, `server/utils/ai/image-generation.ts`, `server/utils/ai/image-generation-cost.ts`, `server/utils/providers/xai.ts`, `server/api/v1/chats/[slug]/index.post.ts`, new + updated tests (§ 11.2, 11.6, 11.7, 11.8) | per-wave |
| **5** | no — one agent | Re-run `pnpm run models:fetch`; confirm exit 0 and that the snapshot is **unchanged** (the image model is exempt) | snapshot (expect no diff) | per-wave |
| **6a** | ∥ | Tooling (§ 10) | `scripts/detect-model-successors.mjs`, `scripts/propose-model-successors.mjs`, `tests/unit/scripts/detect-model-successors.spec.ts` | per-wave |
| **6b** | ∥ | `test-affected` registration (§ 11.9) | `scripts/test-affected-check.mjs` | per-wave |
| **6c** | ∥ | Docs (§ 12) | `docs/providers.md`, `docs/models-data-fetching.md`, this file | format only |
| **7** | no — one agent | Final verification (§ 13) | — | all six checks |

Waves 6a and 6b both touch script files but **different** ones; 6b is the only
writer of `test-affected-check.mjs` after wave 0. Wave 4 is deliberately
sequential and single-agent because five of its seven files are shared,
touched-once infrastructure.

## 15. Verified-clean surfaces (negative findings — do not re-search)

Each of these was checked and needs **no** change. Recorded so a later agent does
not re-investigate.

- **`server/utils/chats/errors.ts`** — `normalizeChatError({ providerId })`
  already accepts `SupportedProviderId`, which includes `'xai'`. Adding `'xai'`
  to `ImageGenerationProvider` type-checks against
  `getSafeImageGenerationError()` with no widening.
- **`server/utils/ai/image-generation-errors.ts`** — message classification is
  string-matching on the exception text, not a per-provider switch. No xAI branch
  needed.
- **`server/utils/ai/cost-map.ts`** — `getModelCostMap()` skips any model with
  `price.tokens !== 1_000_000`, so the hand-curated xAI image entry's empty
  `price.input`/`price.output` strings are never parsed. `parsePrice('')` returns
  `NaN`, but is never reached for this model. Same as `gpt-image-2` today.
- **Image-generation UI** — `app/composables/chat-input.ts`,
  `app/utils/models-picker.ts` and `app/components/ChatInput.client.vue` gate on
  `model.tools.includes('image_generation')` and `model.imageGeneration`, never
  on provider id. Adding an xAI image model needs no client change.
- **`ImageGenerationAspectRatio`** — all three app values (`1:1`, `2:3`, `3:2`)
  are in xAI's accepted aspect-ratio set. No UI or type change.
- **`shared/utils/model.ts`** — `getControllerModelId()` and
  `getImageGenerationModelId()` are provider-agnostic; they work for xAI as-is.
- **`app/composables/model.ts`** — already falls back to `defaultModel` for an
  id missing from the catalog, so removing the DeepSeek ids cannot 400 a user.
- **`providers/index.ts`** — all seven providers are already registered.
  `defaultModel` resolves to `gemini-2.5-flash-lite` and is unaffected by every
  change in this plan (no model gains `default: true`, and Anthropic stays
  first). `tests/unit/providers/default-model.spec.ts` needs no change.
- **`shared/utils/provider-meta.ts`** — all seven providers already have key
  metadata entries.
- **D1 schema** — nothing here touches a schema file. `db:generate` must stay a
  no-op; treat any new migration as a defect.

---

### Critical files for implementation

- `/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers/providers/xai.ts`
- `/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers/providers/qwen.ts`
- `/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers/providers/deepseek.ts`
- `/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers/server/utils/ai/image-generation.ts`
- `/Users/inevix/dev/main/besidka/.herdr/worktrees/feat-add-more-providers/scripts/fetch-models-metadata.mjs`
