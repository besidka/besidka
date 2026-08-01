# Model catalog: curated capabilities + fetched metadata

The model catalog is split in two halves that are merged at import time.

| Half | Lives in | Owner |
|---|---|---|
| Capabilities and product decisions | `providers/google.ts`, `providers/openai.ts` | hand-curated |
| Objective metadata | `providers/data/models-dev-snapshot.json` | generated from [models.dev](https://models.dev) |

`providers/index.ts` joins them through `mergeModelMetadata()` in
`providers/merge.ts` and exports the same fully shaped `Providers` array
consumers have always read through `getProviders()`.

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
