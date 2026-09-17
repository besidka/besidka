# Model catalog: curated capabilities + fetched metadata

The model catalog is split in two halves that are merged at import time.

| Half | Lives in | Owner |
|---|---|---|
| Capabilities and product decisions | `providers/{anthropic,google,openai,xai,deepseek,moonshotai,qwen}.ts` | hand-curated |
| Objective metadata | `providers/data/models-dev-snapshot.json` | generated from [models.dev](https://models.dev) |

`providers/index.ts` joins them through `mergeModelMetadata()` in
`providers/merge.ts` and exports the same fully shaped `Providers` array
consumers have always read through `getProviders()`.

This is the **curated, direct-provider** catalog — the only catalog. Every
model the app can select is declared here; nothing is fetched at runtime.
`docs/providers/general.md` records the per-provider capability decisions
layered on top of this pipeline, and links out to each provider's own file.

## Refreshing the snapshot

```bash
pnpm run models:fetch
git diff providers/data/models-dev-snapshot.json
```

This is a manual maintenance step, like `pnpm run db:generate`. It is
deliberately **not** part of `pnpm run build` or the Cloudflare deploy: the
Workers build stays hermetic and offline, reading the committed snapshot.

## Per-field merge policy

| Field | Source |
|---|---|
| `id` | curated (the lookup key) |
| `name` | fetched, unless the model is a research agent or models.dev publishes the bare id as the name |
| `description` | fetched, unless the model is a research agent |
| `contextLength`, `maxOutputTokens`, `modalities` | fetched |
| `status` | fetched, unless hand-set in curated (curated wins — the owner can outrank models.dev) |
| `retiredAt` | curated only — the provider's official shutdown date; models.dev has no retirement dates |
| `price.input`, `price.output` | fetched, unless the model is a research agent (billed per task) |
| `price.display` | curated (per-image copy) |
| `price.tokens` | curated (the structural cost divisor) |
| `priceTier` | derived at merge time |
| `tools`, `reasoning`, `research`, `imageGeneration`, `forProjectMemory`, `default` | curated |

Research agents are recognised by their curated `research` block, so the
policy never hardcodes model ids.

Prices are rendered as strings with full precision, because
`getModelCostMap()` in `server/utils/ai/cost-map.ts` parses them back into
billing numbers. `providers/merge.ts` is covered by
`tests/unit/providers/merge.spec.ts`, which asserts that round trip against
the real catalog — keep that test passing before committing a refreshed
snapshot.

A `from $x` prefix marks context-tiered pricing (models.dev `cost.tiers`),
where the figure is the cheapest tier rather than the only one.

## Why a curated id can never pull in a junk model

The join only ever looks curated ids **up** in the remote catalog; it never
iterates models.dev outward. Embedding, video, music, TTS, realtime and
open-weights models that models.dev also lists therefore cannot reach the
app, regardless of what the remote catalog grows.

## Auditing curated vs. available models

The curated-id-driven join above is deliberately one-directional: it means a
junk model can never sneak in, but it also means a genuinely new, worthwhile
model silently never appears until a human adds its id to `providers/*.ts`
first. That's exactly what happened with GPT-5.6 — it existed on models.dev
and in OpenAI's own docs for weeks before anyone noticed it was missing from
the picker, because nothing was watching for it.

`pnpm run models:fetch` now always prints a second report after the normal
curated-id lookup: the full diff between every model id models.dev lists
under the `google` and `openai` namespaces and the set of ids currently
curated in `providers/google.ts` / `providers/openai.ts`. The report is
grouped by provider and sorted newest release date first, so a fresh release
worth reviewing surfaces near the top instead of being buried under years of
embedding/TTS/video/dated-snapshot noise.

This is informational only — it always prints and never fails the command.
An unreviewed upstream model is expected and normal (models.dev tracks many
models this app will never curate: embeddings, TTS, video, realtime,
open-weights, and OpenAI/Google-internal chat-latest aliases). The point is
visibility, not enforcement: read the printed list occasionally, decide what
(if anything) is worth curating, same as reading
`git diff providers/data/models-dev-snapshot.json` after a fetch.

The diff logic lives in `scripts/audit-curated-models.mjs` as pure functions
(`findUncuratedModels`, `formatUncuratedModelsReport`, and the deprecated-model
pair below), kept out of `scripts/fetch-models-metadata.mjs` itself because
that script fetches the network and writes the snapshot as a side effect of
being imported — a unit test can't import it directly. Covered by
`tests/unit/scripts/audit-curated-models.spec.ts`.

The same run also prints a second, more urgent warning ahead of the
uncurated-models report: any **currently curated** id whose models.dev
`status` is `"deprecated"` right now, prefixed `⚠ DEPRECATED` so it can't be
mistaken for the routine "not curated yet" list. This is still a report, not
a hard failure — a deprecated model isn't necessarily already broken for
BYOK users — but it's a stronger signal than "here's what's new upstream."
See "Model status" below for what this caught on this pass.

## Detecting same-family successors automatically

The audit report above is read-only: a human still has to notice a new id
and hand-add it to `providers/*.ts`. `scripts/detect-model-successors.mjs`
goes one step further for the narrow, mechanical case where that human
decision is actually trivial — a new upstream id that is obviously just the
next point release of a model already curated in the exact same product
shape (same price-tier divisor, same tool set, same reasoning shape).
Example: curated `gemini-3.7-flash` plus upstream `gemini-3.8-flash` ->
propose curating `gemini-3.8-flash`.

**The family-derivation rule is generic, not per-provider.**
`parseModelFamily(id)` finds the first run of digits (and `.`/`-`
separators) in an id and replaces it with a placeholder: `gemini-3.7-flash`
-> family `gemini-{v}-flash`, version `3.7`; `gpt-5.4-nano` -> family
`gpt-{v}-nano`; `o3` -> family `o{v}`; `claude-opus-4-8` -> family
`claude-opus-{v}`. One rule handles all three providers' current id shapes
with no hardcoded per-provider regex. A future provider's ids either form a
family this rule can work with, or they don't — and if they don't, nothing
matches and nothing is proposed for that family; it just falls through to
the existing human-read uncurated-models report above. The failure mode is
always "nothing proposed," never "the wrong thing proposed."

For each family, the **template** is the highest-version currently curated
model in that family (by segment-wise numeric comparison, so `3.10` sorts
above `3.9`). A template is only used as a copy source if it passes
`isProposableTemplate()`: no curated `status`, no curated `reasoningAlwaysOn`
(an explicit guard, not incidental — see below), a price shape of exactly
`{ tokens: 1_000_000 }` (no hand-set `input`/`output`/`display`), and if it
has a curated `reasoning` block, `mode` must be `'levels'`. A template that
fails this check makes its whole family sit out the run, reported as
"needs a human" — that family isn't silently skipped forever, it's just not
mechanically copyable *this* run (for example, if `retiredAt` were ever set
without `status`, that alone would not disqualify a template; only
`status`, `reasoningAlwaysOn`, a non-standard price shape, or a non-`'levels'`
reasoning mode do).

**`reasoning.mode: 'toggle'` models are permanently ineligible as
templates, by design — not a bug.** `renderCuratedEntry()` only ever emits
a `levels` array when generating a successor's curated code, so a toggle-mode
template would produce a successor that silently loses the toggle and shows
a reasoning control the model can't honor. Before the model catalog
expansion (`docs/model-catalog-expansion-plan.md`), this excluded only a
couple of models; after it, it permanently excludes **all of DeepSeek** (both
`deepseek-flash` and `deepseek-v4-pro`), **22 Qwen models** (19 Group A
`toggle`-mode models plus the three originally-curated `qwen3.7-plus`,
`qwen3.7-max`, and `qwen3.6-flash`), and Moonshot's **`kimi-k2.6`**. The
weekly drift check will therefore never auto-propose a successor for any
DeepSeek or Qwen model, nor for `kimi-k2.6` specifically — that family sits
out every run as "needs a human," permanently, not as a transient gap. This
is the intended trade-off
of a `renderCuratedEntry()` that only knows how to emit `levels`, recorded
here so it isn't later mistaken for the `modelsDevKey` bug below recurring.

**Similarly, `reasoningAlwaysOn: true` models are explicitly excluded from
ever being a template**, guarded directly in `isProposableTemplate()` rather
than left to fail incidentally on the price-shape check (a
`reasoningAlwaysOn` model has no `reasoning` object at all, so it would
otherwise pass the `mode !== 'levels'` check by having no mode to check).
This matters far more after the model catalog expansion than before it:
`reasoningAlwaysOn` goes from 2 curated models to **10** (1 pre-existing xAI
+ 1 new xAI + 3 Moonshot + 5 Qwen).

**Guardrails**, applied to every upstream candidate before it can become a
proposal — a hit on any of these is a skip, never a throw:

- Already curated, or listed in `DECLINED_IDS` (below).
- Doesn't parse into the same family, or isn't a strictly newer version than
  the template.
- **Duplicate-spec alias**: some *other* currently curated model on the same
  provider has upstream `cost.input`, `cost.output`, and `release_date` all
  identical to the candidate's. This is what correctly rejects bare
  `gpt-5.6` as a duplicate of curated `gpt-5.6-sol` (models.dev reports
  identical cost and release date for both) and rejects the dated Claude
  snapshot alias `claude-haiku-4-5-20251001` as a duplicate of curated
  `claude-haiku-4-5` — real cases this guard catches on the current
  catalog, not hypotheticals.
- Upstream `tool_call` isn't `true`.
- Upstream `reasoning` (boolean, from models.dev) doesn't match whether the
  template itself has a curated `reasoning` block.
- Upstream `status` is set to anything (deprecated/alpha/beta).
- Upstream `modalities.input`/`output` don't include `'text'`.
- Upstream metadata is missing any field `toSnapshotEntry()` in
  `scripts/fetch-models-metadata.mjs` requires — without this guard, a
  curated id with incomplete upstream data would make the very next
  `models:fetch` hard-fail.
- **Price-tier band**: for both input and output cost, if the candidate is
  more than 2x costlier or cheaper than the template (symmetric — either
  direction trips it), it is NOT skipped silently — it's collected into a
  separate, report-only `priceTierFlags` list. A new price tier (like the
  declined `gpt-5-pro`/`gpt-6-astra` ids) is exactly the kind of decision
  this detector must never make on its own.

Only the single highest-version surviving candidate per family is kept —
never more than one proposal per family in a run.

`DECLINED_IDS` in `scripts/detect-model-successors.mjs` is a plain list of
ids a human already reviewed and rejected (see "Ids deliberately not
auto-added" below); append to it whenever declining a future proposal so
the weekly job stops re-proposing the same id.

**`scripts/detect-model-successors.mjs` honors `modelsDevKey`, the same way
`scripts/fetch-models-metadata.mjs` already does.** `findSuccessorProposals()`
looks candidates up via `catalog[provider.modelsDevKey ?? provider.id]?.models
?? {}` rather than assuming `provider.id` always matches the models.dev
catalog key. Without this, Qwen — whose `provider.id` is `'qwen'` but whose
models.dev entry lives under the top-level key `alibaba` (see "models.dev
catalog key: `alibaba`, not `qwen`" in `docs/providers/alibaba.md`) — would
silently resolve to an always-empty `{}` and the detector would propose
nothing for Qwen, forever, with no error surfaced anywhere.

**`qwen` is nonetheless still deliberately absent from
`scripts/propose-model-successors.mjs`'s `providers` array**, even with the
`modelsDevKey` fix in place. The blocker isn't the lookup — it's that the
generic `parseModelFamily`/`compareModelVersions` machinery the detector
relies on is unsound for Qwen's id shapes. Concrete proof, computed with the
real parser over the real Qwen catalog: it groups parameter-count variants
and version variants into one "family" and produces
`qwen{v}b :: qwen3-32b(3-32) > qwen3-14b(3-14) > qwen3-8b(3-8) >
qwen3.6-27b(3.6-27) > qwen3.5-27b(3.5-27)` — ranking `qwen3-32b` as *newer*
than `qwen3.6-27b`, which is simply wrong. Turning the detector loose on
Qwen today would start silently proposing against families like that one.
Adding `qwen` to the provider list is a follow-up gated on fixing (or
special-casing) the family parser for Qwen's id shapes first, not on
anything in this pass.

This is a different mechanism from "Why a curated id can never pull in a
junk model" above, not the same one: `scanProviderCandidates()` in
`scripts/detect-model-successors.mjs` does iterate every id in the
provider's remote catalog — it has to, since finding a successor means
scanning for one. What stays tightly bounded is what can ever become a
*proposal*: a candidate must parse into a family that already has an
eligible, curated template; be strictly newer than it; and pass every
guardrail below — and even then, only the single highest-version survivor
per family is kept. An upstream id that doesn't fit an already-curated
family's exact placeholder shape can never become a proposal, no matter how
the scan finds it. So the detector's *output* still follows the same
curated-first philosophy as the rest of this file: nothing reaches
`providers/*.ts` unless it already resembles something a human already
chose to curate, and even then only as a pull request a human must still
review and merge.

`scripts/propose-model-successors.mjs` is the CLI entry point
(`node scripts/propose-model-successors.mjs`, or `--dry-run` to only print
the report). It fetches the catalog via the shared `fetchCatalog()` in
`scripts/models-dev-catalog.mjs` (also used by
`scripts/fetch-models-metadata.mjs`), calls `findSuccessorProposals()`,
and — outside dry-run, when there's at least one proposal — renders each
one with `renderCuratedEntry()` and splices it into the right
`providers/*.ts` file with `insertCuratedEntry()`, which always inserts
immediately before its template's opening brace — the curated files are
newest-first, and a successor is by definition newer than the template it
extends, so it belongs ahead of it in the array. All files are
built in memory first; if any insertion fails, nothing is written and the
process exits non-zero. `scripts/detect-model-successors.mjs` is covered by
`tests/unit/scripts/detect-model-successors.spec.ts`, kept side-effect-free
for the same reason `audit-curated-models.mjs` is — a unit test can import
it directly. `scripts/propose-model-successors.mjs` itself has top-level
side effects (the network fetch, the conditional file writes), the same as
`scripts/fetch-models-metadata.mjs`, so it is not unit tested directly.

## Catalog size and client payload growth

The model catalog expansion in `docs/model-catalog-expansion-plan.md` (xAI
+4 text +1 image, Moonshot AI +2, Qwen +43, plus the DeepSeek retired-id
replacement) grew `providers/data/models-dev-snapshot.json` from 61 to 110
entries. The merged catalog (curated files joined against this snapshot) is
injected into `runtimeConfig.public.providers` in `nuxt.config.ts`, which
Nuxt serializes into every page's client payload — there is no
server-only/client-only split for it. Client payload therefore grows by
roughly 25-30 KB uncompressed as a direct consequence of this catalog
expansion. Acceptable for a BYOK chat picker, but worth knowing before the
next large batch of curated models is added, so the growth is a deliberate
trade-off each time rather than a surprise noticed later in a bundle-size
regression.

## Model status (deprecated/beta/alpha)

Some models.dev entries carry a `status` field (`"deprecated"`, `"beta"`, or
`"alpha"`) alongside `release_date`/`last_updated`. It's a coarse, *current*
flag, not a forward-looking retirement date — models.dev never says a model
is "leaving on \<date\>," only that it currently is or isn't deprecated.
`toSnapshotEntry()` now captures it when present (validated against a known
value list, so an unrecognized future status string is dropped rather than
persisted as-is), `ModelSnapshotEntry`/`Model` carry it as an optional field,
and `mergeModelMetadata()` passes it through untouched — same fetched-metadata
category as `releaseDate`.

`status === 'deprecated'` is enforced two ways once a model reaches this
state:

- **Picker UI**: a deprecated model is removed from the normal selectable
  list and collected into a collapsed "N legacy models" disclosure at the
  bottom of the picker (`ModelsTrigger.vue`), mirroring t3.chat's own
  pattern. Legacy rows are `aria-disabled`, expose no select or favorite
  control, and their info button still opens the detail panel, which now
  explains that the provider retired the model and it can no longer be
  picked. A model that's deprecated but already the user's current
  selection keeps resolving normally everywhere else — only the picker's
  own selection surface stops offering it as a new pick.
- **Server guard**: `useChatProvider()` (`server/utils/chats/provider.ts`)
  rejects a deprecated model id with a structured 400 before any provider
  call, closing the gap a client-side-only gate leaves open (a
  `localStorage`/devtools edit could otherwise still send a deprecated
  model id straight to the API).

As of this pass, curated ids carry deprecation state from two sources:

- **`gemini-2.5-flash-image`** — models.dev does not flag it, but Google's
  official deprecations page schedules its shutdown for 2026-10-02. The
  curated entry hand-sets `status: 'deprecated'` (curated status now
  outranks the snapshot at merge time) plus `retiredAt: '2026-10-02'`, so
  it moves to the legacy picker section and the `useChatProvider()` guard
  blocks sending with it, in new and continued chats alike.
- **`gemini-3-pro-preview`** — fully retired from models.dev (it previously
  carried `status: 'deprecated'`). Kept in the catalog via `EXEMPT_IDS` and
  fully curated in `providers/google.ts` with `status: 'deprecated'`, a
  `releaseDate`, and its passed shutdown date `retiredAt: '2026-03-09'`,
  so a user with it persisted still resolves normally while the
  legacy-section picker UI and `useChatProvider()` guard stop offering it
  as a new pick. Its successor, `gemini-3.1-pro-preview`, is already
  curated separately. The next successful `models:fetch` drops the snapshot
  row for this id — that is expected and correct; the curated half is now
  the only source of its metadata.

**`gemini-3.1-flash-lite-preview`** was ALSO flagged deprecated on an
earlier pass of this audit, but that was a genuine bug, not a "leave it in
the legacy section" case: it had already been superseded two months earlier
by a stable, non-deprecated release, `gemini-3.1-flash-lite` (released
2026-05-07 vs. the preview's 2026-03-03). The curated id, both Deep Research
`assistModel` references (`deep-research-max-preview-04-2026` and
`deep-research-preview-04-2026`), and the `forProjectMemory: true` flag were
all swapped to the stable id in `providers/google.ts` — the deprecated
preview id is no longer curated at all. The lesson: a `status: 'deprecated'`
hit on a curated id should first be checked for a same-family successor
already available upstream (often just the same name minus `-preview`, or
the next point release) before assuming the legacy-section treatment is the
right fix — swapping the id is strictly better when a real successor
exists.

## Retirement dates and how we learn about them

models.dev has no retirement data at all — it flags none of our curated
models deprecated even when the provider officially schedules shutdown
(proven: the whole gemini-2.5 family). Retirement knowledge therefore
arrives through two layers:

1. **The models.dev `status` tripwire.** The weekly drift check and every
   manual `pnpm run models:fetch` print the deprecated-model warning (see
   "Auditing curated vs. available models" above), and a fetched
   `status: 'deprecated'` flows into the merge, driving the legacy picker
   tab and the server guard automatically. This catches OpenAI-style flags,
   where models.dev does mark a model deprecated.
2. **Hand-curated `status` + `retiredAt`.** When models.dev stays silent,
   the authoritative source is the provider's official deprecation page —
   for Gemini https://ai.google.dev/gemini-api/docs/deprecations , for
   OpenAI https://platform.openai.com/docs/deprecations , for Anthropic
   https://platform.claude.com/docs/en/about-claude/model-deprecations .
   The weekly cadence already forces a human look at the fetch output;
   these pages are that human's reading list. A hand-set curated
   `retiredAt` (`yyyy-mm-dd`, shown in the model detail panel) and, when
   shutdown is near or past, a hand-set curated `status: 'deprecated'`
   are set in `providers/*.ts`; curated status outranks the snapshot.

Scraping the deprecation pages on a schedule was rejected (fragile HTML
churn for little gain) and so was API probing (this repo is 100% BYOK and
holds no provider keys — see "Optional owner-run spot-check" below).

Semantics: `status: 'deprecated'` is the **gate** — legacy tab plus the
`useChatProvider()` server guard block new chats with the model.
`retiredAt` alone is **informational** — the model stays selectable but its
detail panel shows the scheduled retirement date (`gemini-3.1-flash-lite`,
retiring 2027-05-07, is the working example).

Beware product-scoped dates: Google's Vertex AI and Gemini API (AI Studio)
deprecate models on different schedules. The Oct 16 2026 shutdown date
circulating for the gemini-2.5 text models is a Vertex AI date; the AI
Studio page announces no shutdown date for them, so they stay untouched in
the catalog.

**Anthropic lineage** (updated 2026-08-26): the previous Claude
generations (opus-4-8/4-7/4-6/4-5, sonnet-4-6/4-5) are IN the catalog as
normal selectable models. The catalog is BYOK access, not taste
curation — the app is not the provider and does not decide what users
use — and it already keeps old Gemini generations (3.1/3.5/3.6
alongside 3.7), so the same principle now covers Anthropic too: every
active mainline chat generation upstream is offered. All six are
Active ("Deprecated: N/A") in Anthropic's deprecations table; when
Anthropic actually deprecates any of them, it moves to the legacy tab
via curated `status` + `retiredAt`, like `gemini-2.5-flash-image`.
Excluded on purpose: fable-5 ($10/$50 premium tier above Opus 5 —
price overkill for a chat-only app, owner declined) and the
dated-snapshot ids (`claude-opus-4-5-20251101`,
`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`), which are
the same models as their dateless aliases. Older generations (Sonnet
4, Haiku 4, Opus 4.1) are no longer listed on models.dev at all, so
there is nothing to add or retire for them. `claude-opus-4-5` and
`claude-sonnet-4-5` carry a curated `name` override because models.dev
names those aliases with a "(latest)" suffix. Curated retirement
floors ("not sooner than"): opus-5 ≥ 2027-07-24, sonnet-5 ≥ 2027-06-30,
haiku-4-5 (snapshot claude-haiku-4-5-20251001) ≥ 2026-10-15 — the
closest watch item.

## Hard failure on a retired model

If a curated id disappears from models.dev, `pnpm run models:fetch` prints
the full list and exits non-zero without writing the snapshot. That is the
point of fetching: a retired or renamed model becomes a loud, deliberate
edit instead of silently stale hardcoded values.

`EXEMPT_IDS` in `scripts/fetch-models-metadata.mjs` lists the ids that are
knowingly incomplete or absent upstream — three distinct reasons, not one:

- **Not tracked by models.dev at all.** Deep Research snapshots OpenAI
  bills separately but models.dev does not track (`o3-deep-research`,
  `o4-mini-deep-research`).
- **Retired-but-kept legacy ids** models.dev no longer publishes at all
  (`gemini-3-pro-preview`; see "Model status" below).
- **Tracked, but with no `cost` block.** `toSnapshotEntry()` requires
  `typeof model.cost?.input === 'number'`; a model whose models.dev entry
  omits `cost` entirely returns `null` from that function, which lands the
  id in `incompleteIds` and hard-fails the fetch exactly like a fully
  missing id would. `grok-imagine-image-2.0` is the first model in this
  category: models.dev lists it with `limit`, `modalities` and
  `release_date` fields but no `cost` object whatsoever. `gpt-image-2`
  doesn't need this treatment only because models.dev happens to carry a
  `cost` block for it — the exemption is triggered by the missing field,
  not by "being an image model" in general.

Exempt models carry their **full metadata in the curated file**
(`providers/*.ts`), not in the snapshot — `models:fetch` rebuilds the
snapshot from `{}` every run and skips exempt ids, so a hand-edited
snapshot row would be wiped on the next successful run. For a retired-but-
kept model, set curated `status: 'deprecated'` (and optionally
`releaseDate`) so the legacy picker section and `useChatProvider()` guard
keep working after the snapshot row disappears. The merge throws at import
time if any required curated field is missing.

## Optional owner-run spot-check

Provider-native list-model endpoints require a real provider API key, and
this project holds none — it is 100% BYOK, and adding a maintainer-side
provider credential was rejected: the models.dev hard-fail already catches
retirements, and key entitlement varies per key, tier and region anyway, so
one maintainer key proves nothing about what users can call.

If you want to verify by hand, swap in your own key:

```bash
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data[].id'

curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | jq '.models[].name'
```

## Scheduled drift check

A weekly cron (`.github/workflows/models-drift-check.yml`, `0 9 * * 1`,
also `workflow_dispatch`) runs `pnpm run models:fetch` so a stale
snapshot never silently ships. It also runs the successor detector above,
proposing same-family successors in the same weekly PR.

Step order in the job:

1. **Fetch model metadata** — `pnpm run models:fetch`, exit code captured
   without short-circuiting later steps.
2. **Commit snapshot refresh** — if the snapshot file is dirty, commits
   `providers/data/models-dev-snapshot.json` directly with `git commit`
   (bot identity, `chore(models): refresh models.dev metadata snapshot`).
3. **Propose same-family successors** —
   `node scripts/propose-model-successors.mjs`, writing its own
   `proposed_count`/`proposed_ids`/`flagged_count`/`commit_subject` step
   outputs and inserting any proposed entries into `providers/*.ts` on
   disk (uncommitted at this point).
4. **Refresh snapshot for proposed models** (only if a successor was
   proposed) — reruns `pnpm run models:fetch` so the newly curated id gets
   its own snapshot entry, or the next run would hard-fail on it as
   missing.
5. **Validate proposed curation** (same condition) — `pnpm run lint`,
   `pnpm run typecheck`, and a `pnpm exec vitest run` covering every path in
   `modelCatalogTests` from `scripts/test-affected-check.mjs` (the same set
   the repo's own test-affected mapping considers relevant to a
   `providers/*.ts` change), in sequence. This is the **only** validation a
   proposed curation gets
   before a human looks at the diff — the drift-check PR gets no
   `pull_request`-triggered CI, because `preview-build.yml` doesn't fire
   for PRs opened via `github.token`. A failure here halts the job before
   anything proposed is committed or opened as a PR, and re-uses the
   existing workflow-failure tracking issue (see below) — that week simply
   gets no PR.
6. **Commit proposed curation** (same condition) — a second `git commit`
   covering `providers/*.ts` and the re-refreshed snapshot, with the
   message the script computed (`feat(models): propose <id> as a
   same-family successor`, or the plural form for more than one).
7. Job summary gets both `models:fetch` and, when present,
   `propose-model-successors.mjs` output.
8. **Check for snapshot changes** — `changed=true` when *either* the
   snapshot commit happened *or* a successor was proposed. This closes a
   real gap: a purely-upstream-side new release with no snapshot diff used
   to produce no PR at all, because nothing local had changed; a successor
   proposal is exactly that case, and now trips `changed=true` on its own.
9. **Build pull request body** — the normal audit-output body, plus (when a
   successor was proposed) the successor report and a reviewer checklist:
   verify capability flags against the provider's own docs, no action
   needed if satisfied, add a rejected id to `DECLINED_IDS` in
   `scripts/detect-model-successors.mjs`, and a note that price-tier-flagged
   ids and "needs a human" families are informational only.
10. **Open pull request** — by this point the working tree is clean with
    one or two local commits already made (not left uncommitted for the
    action to stage). `peter-evans/create-pull-request@v8` picks up commits
    already made during the workflow, not only uncommitted changes, so it
    pushes them as-is; `add-paths` is deliberately **not** set, because with
    it, any change outside the listed paths gets stashed and restored
    rather than included — which would silently drop the already-committed
    `providers/*.ts` changes. Title and commit-message differ depending on
    whether a successor was proposed.

- **Success:** if the snapshot changed or a successor was proposed, the
  workflow opens a refresh PR (label `dependencies`) carrying one or two
  commits as above. A human still reads the diff — a refreshed snapshot can
  rename a model users already picked, and a proposed successor still needs
  its capability flags spot-checked against the provider's docs.
- **Failure:** the job stays a loud red X and a human-visible tracking issue
  is opened (or commented on, deduplicated). Two disjoint paths:
  - If a curated id is missing or incomplete on models.dev, the fetch script
    hard-fails (see below). The workflow captures the exit code, writes the
    full fetch log to the job summary, and opens or comments on a single
    tracking issue (deduped by a `<!-- models-drift-check -->` body marker).
    The script's hard-fail is **not** softened — the deliberate catalog edit
    is still made by hand.
  - If `models:fetch` exits 0 but any later step fails (the
    refresh-pull-request commit, or the successor-proposal validation gate),
    a separate catch-all step opens or comments on its own tracking issue
    (marker `<!-- models-drift-check-workflow-failure -->`). Bot commits in
    this workflow skip husky hooks via a job-level `HUSKY: 0`, so they never
    run dev-machine pre-commit tooling.

## Favorites are DB-persisted, not localStorage

Unlike the current-model selection (`useUserModel()`, localStorage-only),
favorited models are stored server-side on `user_settings.favoriteModels`
(a nullable JSON `string[]` column, additive migration, no SQL default)
so they sync across devices. `useUserSetting()` gained
`favoriteModels`/`setFavoriteModels`/`toggleFavoriteModel`, mirroring the
existing `sidebarPinned` field's server-value-with-localStorage-fallback
pattern exactly. The localStorage fallback key (`settings_favorite_models`,
used only while logged out or not yet synced) is declared in
`content/legal/cookie-policy.md`'s Preferences table; the DB side needs no
privacy-policy change, it's covered by that document's existing generic
"Your settings, such as your preferred model..." line.

The favorites list is computed against the *live* provider catalog, not
the raw stored ids — if a favorited model is later removed or renamed
upstream, its stale id is silently excluded from what's shown (the
favorites star tab, the favorited-models section) without ever being
deleted from what's persisted, so nothing is lost if that id ever
reappears.

## Owner action items

Nothing is required to deploy this. Specifically:

- **No new secrets or environment variables.** The picker, the fetch
  script, and the favorites feature all run with what's already
  configured.
- **No manual production migration step.** The `favoriteModels` column is
  a plain additive `ALTER TABLE ... ADD COLUMN`, no `DROP TABLE`, no
  cascade risk — CI applies D1 migrations on deploy the same as any other
  PR.
- **`pnpm run models:fetch` is a manual, occasional maintenance command**,
  not something you need to run regularly. Run it when you want to pull
  in a provider's latest pricing/context-window changes, or before adding
  a new curated model id (so its metadata is available at merge time
  instead of hitting the "no snapshot entry" hard failure). After running
  it, `git diff providers/data/models-dev-snapshot.json` and skim it
  before committing — a refreshed snapshot can rename a model users
  already picked (as happened with Nano Banana in this PR).
- **The optional provider-key spot-check** (two `curl` commands, above)
  is only useful if you suspect a specific model has quietly stopped
  working for BYOK users. It is not part of any regular workflow.

## Known trade-offs and deferred follow-ups (from the implementation review)

These were raised by an adversarial review pass, confirmed real, and
deliberately not fixed now — logged here instead of silently dropped:

- **Search only matches the model name.** Typing an old pre-rename name
  (e.g. "Gemini 2.5 Flash Image" for what's now "Nano Banana") or a
  provider name won't surface a match. Low value relative to the effort
  of indexing aliases; revisit if users report it.
- **Duplicated ARIA id construction.** `model-option-${id}` and
  `model-detail-${id}` are built independently in more than one component
  instead of through a shared helper. Nothing is broken today — tests
  pin the literal on both sides — but renaming the pattern later means
  updating every call site by hand.
- **Two independent price-string renderers** (the row tooltip vs. the
  detail panel) produce differently formatted output from the same model
  data. Cosmetic inconsistency only.
- **Capability-icon conditionals are duplicated** between the row and the
  detail panel for reasoning/web-search/deep-research (the
  image-generation one was deduplicated during review). A fifth
  capability would need adding in two places.
- **Staged Escape** (closes the detail panel, then clears search, then
  closes the picker) can take up to three presses to fully dismiss.
  Deliberate — matches a pattern several command-palette-style UIs use —
  but flagged in case it reads as unresponsive.
- **Favorite model ids are never validated against the real catalog
  server-side.** An id that doesn't match any known model is stored as-is
  and simply never rendered (see "Favorites are DB-persisted" above) —
  inert, not a correctness risk, so not worth rejecting at the API layer.
- **models.dev still has no retirement *date* field**, only `release_date`
  and `last_updated` — the coarse present-tense `status` it does carry
  drives the legacy-section UI and server guard, but any "leaving on
  \<date\>" countdown needs a hand-curated date. That gap is now filled by
  curated `retiredAt` (see "Retirement dates and how we learn about them"
  above); what remains deferred is surfacing it as anything richer than
  the detail-panel sentence.
- **`isDuplicateOfCuratedSibling` only checks against already-curated
  siblings, not against other candidates in the same run.** It exists to
  reject a candidate whose upstream cost and release date exactly match an
  already-curated sibling — the real `gpt-5.6`/`gpt-5.6-sol` case it was
  built for. But it never compares two *uncurated* candidates against each
  other: two ids that are both still uncurated, share identical upstream
  cost and release date (mirroring that same `gpt-5.6`/`gpt-5.6-sol` shape
  before either one is curated), and happen to parse into different
  families could each independently pass every guardrail and both show up
  in the same weekly proposal or flag report. Not a crash risk — a human
  still reviews and merges every proposal — but it is a real scope gap in
  the duplicate-spec-alias guardrail as currently written.

## New models added this pass — confidence on capability flags

`gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` (OpenAI) and
`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite` (Google) were
added to the curated files this pass, found via the audit report above.

**`tool_call`/`reasoning: true` are confirmed** for all six from
models.dev's own fields, and OpenAI's docs additionally confirm web search
for `gpt-5.6-sol`/`terra`/`luna` explicitly. **`tools: ['image_generation']`
on all six is a convention copy from sibling models in the same lineage
(every `gpt-5.x`/`gemini-3.x` mainline entry already gets it), not a
per-model capability confirmed against any field models.dev exposes.** If a
model in this set turns out not to actually support image generation, a user
picking that tool would only find out at generation time. Worth a spot-check
before relying on it for a model you haven't tried yet.

A later pass added `gemini-3.7-flash` — the same-family successor of
`gemini-3.6-flash`, curated with the identical structure and the same
$0.75/$3.75 pricing, with name/description/limits pulled from the snapshot
— and bare `gpt-5.6`, whose models.dev specs are identical to
`gpt-5.6-sol` apart from id and name. The bare alias was later removed
again as unnecessary duplication; only the explicit `gpt-5.6-sol` id
stays curated (see "Ids
deliberately not auto-added" below).

A further pass added `gemini-3.8-flash` — the same-tier successor of
`gemini-3.7-flash`, curated with the identical structure and the same
$0.75/$3.75 pricing — plus twelve OpenAI ids in one batch. Five are
active mainline models: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`,
and `o3`. The first four carry no curated `reasoning` block because
models.dev reports `reasoning: false` for them — confirmed safe, not new
risk: `getReasoningCapability()` (`shared/utils/reasoning.ts`) returns
`null` for a model with no `reasoning` field, which makes
`resolveReasoningLevelForModel()` always resolve to `'off'` for these
models regardless of what the UI requests, an already-existing code path.
`o3` does get a curated `reasoning` block, matching its sibling
`gpt-5.x`/`o1`-family entries.

The other seven are legacy adds, all flagged `⚠ DEPRECATED` by the audit
report and all retiring 2026-10-23 per OpenAI's deprecations page:
`o4-mini`, `gpt-4.1-nano`, `o3-mini`, `o1`, `gpt-4-turbo`, `gpt-4`, and
`gpt-3.5-turbo`. Each carries an explicit curated `status: 'deprecated'`
even though models.dev already flags all seven deprecated today — the
same precedent as `gemini-2.5-flash-image` above: curated status
outranks fetched, and it keeps the file self-describing if models.dev
ever flips the flag. `gpt-3.5-turbo` has `tool_call: false` upstream, so
it's curated with `tools: []`, same as `gpt-4-turbo` and `gpt-4`, which
carry no tool capability worth curating either.

## Ids deliberately not auto-added (owner review needed)

Found upstream via the audit report above but intentionally left out of
`providers/*.ts` in this pass — each needs a human product decision, not an
automatic add:

- **`gpt-5-pro`, `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro`** — a premium
  "Pro" tier positioned above the mainline model at several times the
  price; adding a whole new price tier to the picker is a bigger surface
  decision than adding the next point release.
- **`gpt-5.2-chat-latest`, `gpt-5.3-chat-latest`** — rolling aliases
  ("-latest") that repoint to whatever OpenAI currently ships under that
  name; curating a moving target breaks the assumption that a curated id
  is a stable, specific model.
- **`gpt-5.3-codex`, `gpt-5.3-codex-spark`** — coding-agent-specialized
  variants, a different product positioning than this app's general chat
  models (also: no plain `gpt-5.3` mainline model exists upstream at all).
- **`gpt-5.6-sol`** — the curated id for this model, not a distinct
  sibling: OpenAI's own docs state "Model ID: gpt-5.6-sol (aliased as
  gpt-5.6)", and its models.dev entry is identical to bare `gpt-5.6`
  apart from id and name (same cost, description, release date). The
  bare `gpt-5.6` alias was
  briefly curated too (#367), then removed again as unnecessary
  duplication — the owner prefers the explicit Sol id — so bare
  `gpt-5.6` stays on this deliberately-not-curated list.
- **`claude-fable-5`** — a premium tier above Opus 5 ($10/$50 vs the
  $5/$25 Opus pricing); it would add another price tier to the picker,
  and the owner declined.
- **`gpt-6-astra`** — $10/$50, 2.5x `gpt-5.6-sol`'s pricing; a genuine
  new price tier, not a same-tier successor, so it needs an explicit
  owner decision rather than an automatic add.
- **`gemini-omni-flash-preview`** — models.dev shows `tool_call: false`
  and a video-only output modality; not a chat model, and still preview
  status besides.
- **`claude-fable-5-1`** — the same declined premium tier as
  `claude-fable-5` above, just a later dated release (2026-09-01).

From the model catalog expansion (`docs/model-catalog-expansion-plan.md`):

- **xAI's retired slugs** (`grok-3`, `grok-4-0709`, `grok-code-fast-1`, and
  others) — not added, not even as `status: 'deprecated'` entries. xAI
  silently redirects a retired slug to a successor model **and bills at the
  successor's price**, so a picker entry for a retired slug would
  misrepresent both which model actually answers and what it costs. They
  are also absent from models.dev entirely, so each would need its own
  `EXEMPT_IDS` entry plus full hand curation.
- **xAI video and realtime models** (`grok-imagine-video`,
  `grok-imagine-video-1.5`, `Experimental_XaiRealtimeModel`) — video
  generation and realtime voice are outside this app's capability set (chat
  + image generation + deep research only).
- **`grok-imagine-image-quality`** — retires 2026-11-02, roughly seven
  weeks after this catalog change; adding a model that would need removing
  in the same quarter is pure churn.
- **`grok-imagine-image`** (1.0) — superseded by `grok-imagine-image-2.0`,
  same modality, strictly older.
- **Moonshot's 13 discontinued models** — Moonshot documents them as no
  longer maintained or supported, a harder cutoff than xAI/DeepSeek's
  silent-redirect pattern, and they're absent from models.dev, so each
  would need `EXEMPT_IDS` plus hand-curated metadata for a model that most
  likely hard-404s on every send. See `docs/providers/moonshotai.md`'s
  "Owner action items" for the unverified-without-a-live-key framing.
- **Qwen's omni/realtime/ASR models** (`qwen3-omni-flash`,
  `qwen3-omni-flash-realtime`, `qwen-omni-turbo`,
  `qwen-omni-turbo-realtime`, `qwen2-5-omni-7b`, `qwen3-asr-flash`,
  `qwen3-livetranslate-flash-realtime`) — every one carries `audio` or
  `video` in its output modalities, or is a realtime/ASR endpoint; same
  capability filter that already keeps embedding/TTS models out of every
  other provider's catalog.
- **Two Alibaba-hosted third-party model ids**, `deepseek-v4-flash-0731` and
  `glm-5.2` — both appear in the live `alibaba` models.dev catalog (Alibaba
  resells other vendors' models on DashScope) but are excluded under the
  standing rule against curating an Alibaba-hosted copy of an id another
  provider already curates under its own name; see
  `docs/providers/alibaba.md`'s Qwen bullet for the full id-collision
  reasoning.

Two ids originally listed here on an earlier pass of this audit were
subsequently added, not left out — corrected in a follow-up commit:

- **`gemini-3.5-flash-lite`** is curated alongside `gemini-3.5-flash`. The
  original exclusion reasoning ("scope call, not a capability concern") was
  wrong on its own terms: `gemini-2.5-flash-lite` is already curated
  alongside `gemini-2.5-flash`, so the lite-tier sibling is this app's
  established convention for this provider, not a new product decision.
- **`gemini-3.1-flash-lite`** is curated — it's the stable, non-preview
  successor of the now-fully-removed `gemini-3.1-flash-lite-preview` (see
  "Model status" above). `forProjectMemory: true` and both Deep Research
  `assistModel` references were repointed to it.
