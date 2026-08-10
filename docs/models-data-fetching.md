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
`docs/providers.md` records the per-provider capability decisions layered on
top of this pipeline.

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
| `status` | fetched, present only when models.dev flags `deprecated`/`beta`/`alpha` |
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

As of this pass, one currently curated id is flagged deprecated:

- **`gemini-3-pro-preview`** — a standalone curated chat model whose
  successor, `gemini-3.1-pro-preview`, is already curated separately. Left
  in the catalog (not deleted — a user with it persisted would otherwise
  see `getModel()` silently resolve to nothing) and handled entirely by the
  legacy-section UI and server guard above.

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

## Hard failure on a retired model

If a curated id disappears from models.dev, `pnpm run models:fetch` prints
the full list and exits non-zero without writing the snapshot. That is the
point of fetching: a retired or renamed model becomes a loud, deliberate
edit instead of silently stale hardcoded values.

`EXEMPT_IDS` in `scripts/fetch-models-metadata.mjs` lists the ids that are
knowingly absent upstream — currently `o3-deep-research` and
`o4-mini-deep-research`, whose Deep Research snapshots OpenAI bills
separately but models.dev does not track. Exempt models carry their full
metadata in the curated file, and the merge throws at import time if any of
it is missing.

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

## No scheduled refresh workflow

There is no cron workflow opening a refresh PR. The repo has no
`create-pull-request` precedent in `.github/workflows/`, and a bot PR that
renames user-visible models needs a human reading the diff anyway. Run
`pnpm run models:fetch` when adding a model or when provider pricing
changes.

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
- **models.dev has no retirement *date* field**, only `release_date` and
  `last_updated` — so a "leaving on \<date\>" countdown badge isn't
  derivable from this data source; that would need a hand-curated
  retirement date per model. See "Model status" above for the coarse
  present-tense `status` field this data source does carry instead, and
  how it now drives the legacy-section UI and server guard.

## New models added this pass — confidence on capability flags

`gpt-5.6`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` (OpenAI) and
`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite` (Google) were
added to the curated files this pass, found via the audit report above.

**`tool_call`/`reasoning: true` are confirmed** for all seven from
models.dev's own fields, and OpenAI's docs additionally confirm web search
for `gpt-5.6-sol`/`terra`/`luna` explicitly. **`tools: ['image_generation']`
on all seven is a convention copy from sibling models in the same lineage
(every `gpt-5.x`/`gemini-3.x` mainline entry already gets it), not a
per-model capability confirmed against any field models.dev exposes.** If a
model in this set turns out not to actually support image generation, a user
picking that tool would only find out at generation time. Worth a spot-check
before relying on it for a model you haven't tried yet.

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
- **`gpt-5.6-sol`** — not a distinct model. OpenAI's own docs state
  "Model ID: gpt-5.6-sol (aliased as gpt-5.6)", and its models.dev entry is
  byte-identical to bare `gpt-5.6` (same cost, description, release date).
  Curating both would show two indistinguishable rows for one model; the
  bare `gpt-5.6` id was curated instead, matching how every other mainline
  release in this lineage (`gpt-5`, `gpt-5.1`, `gpt-5.2`, `gpt-5.4`) has no
  separate top-tier alias id.
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
