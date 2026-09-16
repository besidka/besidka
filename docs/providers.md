# Direct providers: xAI, DeepSeek, Moonshot AI, Qwen

Besidka's BYOK model catalog is a single curated, build-time,
models.dev-backed data structure — `docs/models-data-fetching.md` documents
the catalog machinery itself. This doc is the permanent record of the four
providers added alongside the pre-existing Anthropic/Google/OpenAI ones, of
the mechanisms they needed (openai-compatible wiring, per-provider web
search, the multi-step tool loop) and of the decisions behind them.

## Curated capabilities and server wiring

Added alongside the pre-existing Anthropic/Google/OpenAI providers, following
the exact same pattern documented in `docs/models-data-fetching.md`:
`providers/{xai,deepseek,moonshotai,qwen}.ts` hold curated capabilities,
merged at import time against `providers/data/models-dev-snapshot.json`.

- **xAI** (8 models — 7 text + 1 image): `grok-4.20-0309-non-reasoning`
  (default/first-listed), `grok-4.20-0309-reasoning`,
  `grok-4.20-multi-agent-0309`, `grok-4.6`, `grok-4.5`, `grok-4.3`,
  `grok-build-0.1`, and the image model `grok-imagine-image-2.0` (see "xAI
  image generation" below). Note the dated model ids on the `-0309` pair —
  the undated `grok-4.20-non-reasoning`/`grok-4.20-reasoning` forms do not
  exist on models.dev or in xAI's own docs. `tools: ['web_search']` via
  `xai.tools.webSearch({})` on every text model except
  `grok-4.20-multi-agent-0309`, which is curated with `tools: []` because
  models.dev reports `tool_call: false` for it upstream — sending a tool
  declaration to a model that can't call tools would be a live-key error,
  not a picker cosmetic. `grok-4.20-0309-reasoning` and `grok-build-0.1`
  don't accept xAI's `reasoning_effort` param at all (fixed behavior,
  confirmed via xAI's own docs) — both are curated with
  `reasoningAlwaysOn: true` instead of a `reasoning` toggle/levels
  capability, so the picker shows the brain icon without offering a control
  the model can't actually honor.
  - **`xhigh`/`none` reasoning levels don't exist in this app's vocabulary.**
    `shared/types/reasoning.d.ts`'s `ReasoningEnabledLevel` is exactly
    `'low' | 'medium' | 'high'`. models.dev reports `grok-4.6` and
    `grok-4.20-multi-agent-0309` with an effort axis of
    `low,medium,high,xhigh` — both are curated as
    `levels: ['low', 'medium', 'high']`, truncating `xhigh` off entirely.
    Widening the level type to add `xhigh` would touch the picker UI, the
    DB-persisted reasoning value, and `toReasoningEffort()` — a separate
    feature, not a catalog addition — so it's recorded here as a deferred
    follow-up rather than attempted in this PR.
  - **`grok-4.3`'s `none` level and the app's `'off'` state are not quite
    the same thing.** models.dev reports `grok-4.3`'s effort axis as
    `none,low,medium,high`; it's curated the same as every other levels-mode
    xAI model, `levels: ['low', 'medium', 'high']`. The app's `'off'`
    reasoning state sends no `reasoning_effort` param at all, which lets xAI
    apply its own per-model default (e.g. `grok-4.5` defaults to `'high'`
    when nothing is sent) rather than explicitly disabling reasoning the way
    `none` would. This is pre-existing behavior, identical for the
    already-curated `grok-4.5` — not a regression introduced by this PR —
    and is left as-is rather than plumbing an explicit `none` value through.
- **DeepSeek**: `deepseek-flash` (default/first-listed) and `deepseek-v4-pro`
  — a full replacement of the previously curated `deepseek-chat` and
  `deepseek-reasoner`, which were retired upstream on 2026-07-24 and no
  longer exist in models.dev's `deepseek` catalog at all. The retirement
  wasn't cosmetic: it broke `pnpm run models:fetch` outright ("models.dev no
  longer lists 2 curated model(s)"), blocking every other catalog change in
  this PR until it was fixed first. Both replacements are curated with
  `reasoning: { mode: 'toggle' }`, not levels — DeepSeek's own effort axis
  (`deepseek-flash`: `low,high,max`; `deepseek-v4-pro`: `high,max`, no `low`
  at all) has no `medium` and no shared shape between the two models, so
  there's no lossless mapping onto this app's `low`/`medium`/`high` levels;
  the on/off toggle both models share is the only exact fit. DeepSeek also
  bills a 2x peak/off-peak pricing multiplier that
  `server/utils/ai/cost-map.ts`'s single flat per-model rate does not model
  — a known, disclosed limitation, not something this PR attempts to fix.
  Still no native web_search or image_generation — re-verified against
  DeepSeek's official API docs, see "Web search across the direct providers"
  below.
- **Moonshot AI** (4 models): `kimi-k2.6` (default/first-listed), `kimi-k3`,
  `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`. The `moonshot-v1-*` classic
  line is deliberately not curated — Moonshot is sunsetting it. `kimi-k2.5`
  (originally the product owner's explicit pick) was removed after real
  users hit "Not found the model kimi-k2.5 or Permission denied" in the live
  app — Moonshot has an active sunset notice for it on their platform.
  **Three of the four models — `kimi-k3`, `kimi-k2.7-code`, and
  `kimi-k2.7-code-highspeed` — are curated with `reasoningAlwaysOn: true`,
  not a toggle**: models.dev reports an empty `reasoning_options: []` for
  all three, meaning reasoning is always on with zero adjustable options, no
  disable switch included. Sending `providerOptions.moonshotai.thinking =
  { type: 'disabled' }` to a model with no `thinking` parameter at all would
  be a live-key failure mode nothing in CI can catch. `kimi-k2.6` is the
  *only* Moonshot model models.dev reports a real `[{"type":"toggle"}]` for,
  so it's the only one curated with `reasoning: { mode: 'toggle' }`. Both
  new code-focused models are ordinary singleton families
  (`kimi-k{v}-code`, `kimi-k{v}-code-highspeed`) and don't interact with the
  ordering question below. All four declare `tools: ['web_search']` — see
  "Moonshot AI — implemented via the Formula API" below.
  - **Ordering: `kimi-k2.6` deliberately stays first, ahead of the
    newer-by-version `kimi-k3`.** Main's generic `parseModelFamily` groups
    `kimi-k2.6` and `kimi-k3` into the same family `kimi-k{v}` and would rank
    `kimi-k3` (version `3`) ahead of `kimi-k2.6` (version `2.6`) under a
    strict newest-first rule. This app's actual convention is "first-listed
    is the provider default," a *product* decision, not the *ergonomic*
    newest-first convention the generic family parser encodes — and here
    they collide: `kimi-k2.6` ($0.95/$4.00, reasoning toggleable off) is the
    intended cheaper default, while `kimi-k3` ($3.00/$15.00, reasoning
    mandatory) is the newer release. Reordering to satisfy the generic parser
    would silently triple the cost of Moonshot's default. `kimi-k2.6` stays
    first, and `tests/unit/providers/ordering.spec.ts`'s newest-first
    invariant is scoped to `anthropic`, `google`, `openai` and `xai` only —
    `moonshotai`, `deepseek` and `qwen` are deliberately excluded. The
    clinching counter-example for why the generic parser can't be trusted
    outside those four providers: run it over Qwen's ids and it produces
    `qwen{v}b :: qwen3-32b(3-32) > qwen3-14b(3-14) > ... > qwen3.6-27b(3.6-27)
    > qwen3.5-27b(3.5-27)` — ranking `qwen3-32b` as *newer* than
    `qwen3.6-27b`, which is simply wrong. A spec built on that parser for
    Qwen would enforce a meaningless order.
- **Qwen** (46 models — 3 previously curated plus 43 new): the full list is
  in `providers/qwen.ts`, ordered by the same "first-listed is the default"
  convention as every other provider. Each new model's reasoning shape is
  derived mechanically from its models.dev `reasoning_options`, not
  hand-guessed per model:
  - contains `{"type":"toggle"}` → `reasoning: { mode: 'toggle' }` (19 of
    the 43 — this app only ever wires the `enable_thinking` boolean, which
    is exactly that toggle);
  - reports reasoning but **no** toggle (either `[]` or `budget_tokens`
    only) → `reasoningAlwaysOn: true` (5 of the 43) — sending
    `enable_thinking: false` to one of these would be a live-key error, the
    same failure class as the Moonshot case above;
  - no reasoning at all → no `reasoning` field, no `reasoningAlwaysOn` (19
    of the 43).

  **Web search (updated 2026-09-16).** A dedicated DashScope-docs research
  pass (both the English and Chinese doc pages) found the Singapore-region
  `enable_search` supported-model table covers 13 of the 46 curated models,
  not the 2 this document originally shipped with — `qwen3.7-max` was
  wrongly excluded on a stale reading, and 10 of the "43 new" ids from this
  expansion are on the table too. All 13 are curated with
  `tools: ['web_search']`; every other model, including the remaining 33 of
  the 43 newly added ids, still ships `tools: []` because it genuinely does
  not appear in DashScope's web-search allowlist. See "Web search across
  the direct providers" below for the full list, the Qwen3.8 exclusion
  rationale, and citations.

  **Standing rule: never curate an Alibaba-hosted third-party model id.**
  `deepseek-v4-flash-0731` and `glm-5.2` both appear in the live `alibaba`
  models.dev catalog (Alibaba resells other vendors' models on DashScope) and
  are deliberately excluded, permanently, not just for this PR. This app's
  model catalog is keyed by a **flat id with no provider namespace**
  (`getModel(id)` scans every provider and the last match wins), so curating
  an Alibaba-hosted copy of a model this app already curates under its
  native provider (DeepSeek, in this case) would be a latent id collision:
  the moment two curated entries share an id, `getModel()` silently resolves
  to whichever the provider loop hits last, and a request could route to the
  wrong provider with the wrong key. This rule applies to every provider
  going forward, not only DeepSeek/GLM (Zhipu) today.
  - **First-party `@ai-sdk/alibaba@2.0.46` was evaluated and declined.** It
    exists, its peer `zod: "^3.25.76 || ^4.1.8"` is compatible with this
    app's `zod@^4`, and its default `baseURL` matches the endpoint this app
    already targets — but its `providerOptions.alibaba` is a *closed*
    `z.object({...})` (`enableThinking`, `thinkingBudget`,
    `parallelToolCalls`, `cacheControl`, no `.passthrough()`). This app's
    Qwen web search
    depends entirely on `enable_search` and
    `search_options.search_strategy: 'agent'` being forwarded verbatim,
    which works today only because `@ai-sdk/openai-compatible` passes
    through unrecognized `providerOptions` keys. Migrating to
    `@ai-sdk/alibaba` would silently strip both flags — Zod drops unknown
    keys with no error and no warning — breaking Qwen web search with
    nothing in CI able to catch it. `@ai-sdk/alibaba` also exposes no
    image-generation capability at all, so migration buys nothing there
    either. Qwen stays on `@ai-sdk/openai-compatible`; see "Qwen:
    openai-compatible mechanism, not a dedicated SDK" below for the rest of
    that wiring.
  - **Reversal — `qwen3.8-max`'s `xhigh` exclusion.** This document
    previously excluded `qwen3.8-max` because its reasoning is a three-way
    `toggle`/`effort` (`low`/`medium`/`xhigh`)/`budget_tokens` choice and
    mapping DashScope's `xhigh` onto this app's `low`/`medium`/`high` levels
    had no prior art. **Reversed**, because that concern never actually
    applies to Qwen: this app only ever wires the `enable_thinking` boolean
    for every Qwen model — the effort axis (including `xhigh`) is never
    sent regardless of which model is selected. `qwen3.8-max` is curated as
    plain `reasoning: { mode: 'toggle' }`, identical in shape to every other
    Group A Qwen model, and the `xhigh` incompatibility that blocks xAI's
    `grok-4.6`/`grok-4.20-multi-agent-0309` above simply doesn't arise here.
  - **Reversal — the rolling-alias exclusion.** This document previously
    excluded the bare `qwen-max`/`qwen-plus`/`qwen-flash`/`qwen-turbo` ids
    because Alibaba's release notices describe them as rolling aliases that
    get silently repointed to a newer dated snapshot over time (e.g.
    `qwen-plus` → `qwen-plus-2025-07-28`), the same "moving target" problem
    this document rejected OpenAI's `-latest` aliases for. **Reversed**:
    models.dev's live `alibaba` catalog carries **no dated Alibaba
    snapshots at all** — the rolling aliases are the only reachable form of
    these models through the endpoint this app calls. Excluding them would
    mean excluding the models entirely, not picking a more stable id for the
    same model. All four are now curated as ordinary Group C (no reasoning
    field) entries.

Server-side wiring lives in
`server/utils/providers/{xai,deepseek,moonshotai,qwen}.ts`, matching the
existing `use<Provider>()` contract. **Moonshot needs one non-obvious
guard**: its API rejects a request that sends both a `thinking` param and an
auto-derived `reasoning_effort` — this app avoids the conflict by never
setting the top-level `reasoning` streamText option for Moonshot models,
only `providerOptions.moonshotai.thinking` directly.

**Package version note**: `@ai-sdk/deepseek@3.x` and `@ai-sdk/moonshotai@3.x`
ship on a lower major than this app's `ai@7`/`@ai-sdk/provider@4` line
(`@ai-sdk/xai@4.x` matches). Verified compatible via typecheck/build/full test
suite, but this was never proven with a real live API call — see "Owner
action items" below. **Correction**: an earlier draft of this plan assumed
`@ai-sdk/deepseek` needed a bump to `3.0.45` before it could support
`reasoningEffort`. That's wrong — the installed `3.0.26` already ships the
full `reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"])`
schema and the `thinking.type` field, read directly from
`node_modules/@ai-sdk/deepseek/dist/index.js`. Bumping either package stays
optional hygiene, not a blocker for anything in this catalog expansion:
`@ai-sdk/deepseek`'s bump only affects the unreachable `mode: 'levels'`
branch (see `server/utils/providers/deepseek.ts`'s doc comment), and
`@ai-sdk/moonshotai`'s bump changes nothing because this app never sends a
Moonshot reasoning effort at all — `server/utils/providers/moonshotai.ts`
returns `reasoning: undefined` unconditionally.

### xAI image generation

`grok-imagine-image-2.0` is xAI's first image model in this catalog, wired
through the same dedicated-image-model pattern as OpenAI (`gpt-image-2`) and
Google — a hand-curated `imageGeneration: { controllerModel }` entry, never
a chat tool the model invokes mid-turn.

- **`xai.image(modelId)`, not `xai.tools.imageGeneration()`.** The installed
  `@ai-sdk/xai@4.0.33` exposes both `xai.image`/`xai.imageModel` (confirmed
  via `require()` — no SDK bump needed) and a conversational
  `xai.tools.imageGeneration()` tool the chat model can call mid-turn. Only
  the former fits this app's controller-model pattern: a dedicated image
  model invoked once, outside the chat loop, the same shape
  `server/utils/providers/xai.ts`'s `getImageModel()` already uses for
  OpenAI/Google. `xai.tools.imageGeneration()` is also absent from the
  installed SDK version regardless.
- **`grok-imagine-image-2.0` is in `EXEMPT_IDS`.** models.dev lists the id,
  but its entry carries **no `cost` object at all** — `toSnapshotEntry()` in
  `scripts/fetch-models-metadata.mjs` requires `typeof model.cost?.input ===
  'number'`, so without the exemption `pnpm run models:fetch` would hard-fail
  with "models.dev no longer lists 1 curated model." The entry is instead
  fully hand-curated in `providers/xai.ts` — `maxOutputTokens: 0` (matching
  `gpt-image-2`'s own snapshot shape), `price.tokens: 1` to keep it out of
  the per-token cost map (`getModelCostMap()` skips any model where
  `price.tokens !== 1_000_000`), and `price.display: '$0.04 / image'` so
  `resolvePriceTier()` still resolves a `'$'` tier.
- **`size` is rejected outright; only top-level `aspectRatio` is sent.**
  xAI's image model emits an unsupported-setting warning ("This model does
  not support the `size` option. Use `aspectRatio` instead.") if `size` is
  passed, making xAI the one image provider in this app that takes
  `aspectRatio` and nothing else in `getProviderGenerationOptions()`
  (`server/utils/ai/image-generation.ts`). All three of this app's
  `ImageGenerationAspectRatio` values (`1:1`, `2:3`, `3:2`) are in xAI's
  accepted set, so no UI change was needed.
- **No `providerOptions.xai` is sent at all — deliberately.** The AI SDK's
  own `XaiImageModelOptions` type lists `quality: 'low' | 'medium' | 'high'`
  as valid, but xAI's own docs for `grok-imagine-image-2.0` accept only
  `'low' | 'medium' | 'auto'` — **not** `'high'` — for this specific model.
  The SDK passes `quality` straight through with no per-model validation, so
  setting `'high'` type-checks cleanly and then 400s at request time against
  a real key, a failure mode nothing in this repo's test suite can catch.
  Omitting the object entirely leaves xAI's own default, `quality: 'auto'`,
  which resolves to the `'low'` generation tier — the tier
  `flatImageGenerationCostUsdByModelId`'s flat $0.04 is believed to
  correspond to, unconfirmed without a live key (see "Owner action items"
  below). `resolution` isn't a real xAI request parameter at all (only
  `aspect_ratio`, `quality`, `output_format`, `sync_mode`, `user` are
  documented) and does nothing if sent.
- **Byte format**: xAI's image model hardcodes `response_format: "b64_json"`
  in its request body (read from
  `node_modules/@ai-sdk/xai/dist/index.js`), with a binary-download fallback
  if xAI ever returns URLs instead. `generateImage()` therefore receives
  base64 image bytes exactly the same way it does for OpenAI and Google, and
  the existing `validateGeneratedImage()` PNG/JPEG/WebP signature check works
  unchanged — no xAI-specific branch needed there.

### Qwen: openai-compatible mechanism, not a dedicated SDK

Alibaba's community `qwen-ai-provider` npm package pins `zod@^3.25.49`
(confirmed via `npm view qwen-ai-provider peerDependencies` at the time this
was added), which conflicts with this app's `zod@^4` line — the same
incompatibility a prior round of this initiative already found and rejected.
DashScope (Alibaba's Model Studio API) has a genuine OpenAI-compatible mode,
so Qwen is wired through the generic `@ai-sdk/openai-compatible` package
instead: a `createOpenAICompatible({ baseURL, apiKey })` client wrapped in
`useXai`/`useDeepSeek`'s direct-provider function contract (its own `keys`
table lookup scoped to `provider: 'qwen'`, returning `{ instance,
generateChatTitle, tools, providerOptions, reasoning }`), so a
generically-wired provider stays interchangeable with the dedicated-SDK ones
at every call site.

The base URL is `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
(`server/utils/providers/qwen.ts`'s `QWEN_BASE_URL`), Alibaba's international
region endpoint. Verified three ways: Alibaba's own current docs
(`https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope`),
which confirm this exact domain is "fully functional" even though a newer
per-workspace domain (`https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`)
is now recommended for performance; a third-party mirror (liteLLM's DashScope
provider docs) independently listing the same URL; and — most decisively —
models.dev's own `alibaba` provider entry, whose `api` field is literally
`https://dashscope-intl.aliyuncs.com/compatible-mode/v1` with `npm:
"@ai-sdk/openai-compatible"`. The newer per-workspace domain was deliberately
not used: it needs a Workspace ID collected as a second credential field,
while the existing domain keeps Qwen on the single-`apiKey`-field shape every
other direct provider in this app uses. DashScope's China-mainland endpoint
(`https://dashscope.aliyuncs.com/compatible-mode/v1`) is not used — Besidka
is not China-region-specific.

DashScope's thinking mode is a plain `enable_thinking` boolean forwarded
directly in the request body (via `extra_body` in Alibaba's own Python/Node
SDK examples, but just a normal body field over raw HTTP), not an
OpenAI-style `reasoning_effort` string. `@ai-sdk/openai-compatible` forwards
any `providerOptions.qwen` key it doesn't itself recognize (`user`,
`reasoningEffort`, `textVerbosity`, `strictJsonSchema`) straight into the
JSON body untouched, so `useQwen()` sets `providerOptions.qwen.enable_thinking`
directly — same `Object.assign`-into-a-typed-`{}` pattern `useXai()` uses to
route around `SharedV2ProviderOptions`'s `Record<string, Record<string,
JSONValue>>` shape rejecting a flat boolean value at the type level.

### Web search across the direct providers (round-3 investigation, 2026-08)

A round-3 review challenged the empty `tools` declarations on Qwen, DeepSeek
and Moonshot AI ("I don't believe it doesn't support web_search. their docs
mentioned they do"). Each was verified against the provider's official docs
on 2026-08-09; the outcomes deliberately differ per provider.

**Round 4 re-verification (2026-08-09).** The user raised the same suspicion
again for Qwen's `qwen3.7-max` exclusion, prompting a fresh, independent
re-check against each vendor's current documentation rather than trusting the
round-3 record. Both conclusions below held with no code change required:

- **Qwen `qwen3.7-max`** — Alibaba's current docs still state
  `qwen3.7-max` supports web search "only" through the Responses API, a
  different surface from the `/compatible-mode/v1/chat/completions`
  endpoint this app calls via `@ai-sdk/openai-compatible` (which has no
  Responses API support at all). The exclusion is a real, verified
  per-tier capability difference, not a mapping bug — closing it for real
  would mean a bespoke second DashScope Responses wiring for one model's
  badge. The product owner explicitly signed off (2026-08-09) on accepting
  the gap rather than funding that wiring.

  **Reversed (2026-09-16).** This conclusion was wrong. A dedicated
  research pass re-read Alibaba's Singapore-region "Supported models"
  table directly instead of trusting the round-4 summary above, and found
  `qwen3.7-max` plainly listed there with no annotation at all. The
  "(supported only by the Responses API)" annotation Alibaba's docs do use
  is attached to specific *other* models (`glm-5.2` and `kimi-k3` as they
  appear in DashScope's `alibaba` catalog — `glm-5.2` is an Alibaba-hosted
  third-party model this app never curates under any provider; `kimi-k3`
  is curated, but under `moonshotai`'s own native Moonshot API, never
  under Qwen/DashScope), not to `qwen3.7-max`. There is no per-tier
  capability gap: `qwen3.7-max`
  supports `enable_search` on the same
  `/compatible-mode/v1/chat/completions` endpoint this app already calls,
  exactly like `qwen3.7-plus`. It is now curated as `tools: ['web_search']`
  in `providers/qwen.ts`, alongside 10 other models the same research pass
  confirmed on the same table — see "Web search across the direct
  providers" below for the full list and citations.
- **DeepSeek** — the API changelog now extends through 2026-07-31
  (DeepSeek-V4-Flash public beta) and still announces no search, grounding,
  or `enable_search` capability of any kind. Nothing changed since round 3;
  `providers/deepseek.ts` correctly keeps `tools: []`.

  **Correction (2026-09-16), scoped narrowly.** The "no first-party
  mechanism" conclusion for DeepSeek's OpenAI-compatible endpoint (the one
  this app actually calls) still stands. But a separate research pass
  found the earlier claim about DeepSeek's *Anthropic-compatible* endpoint
  was wrong — it genuinely accepts Anthropic's `web_search_20250305`
  server-tool type as documented functionality, not incidental schema
  tolerance. See "DeepSeek — no first-party mechanism on the endpoint this
  app uses" below for the corrected record and why this isn't wired yet.

This record predates that 2026-09-16 correction; it is kept as-is above so
the reversal itself stays legible, rather than silently rewritten.

**Qwen — implemented.** DashScope's built-in web search is a plain
`enable_search: true` body flag on the same chat-completions endpoint this
app already calls, with an optional `search_options` sibling object — not an
OpenAI-style tool declaration. `useQwen()` therefore wires it through
`providerOptions.qwen` exactly like `enable_thinking`, and its `getTools()`
still returns `{}` (there is no AI SDK tool object and must be no
`toolChoice`). Scoping decisions, all sourced from
`https://www.alibabacloud.com/help/en/model-studio/web-search` (and its
region-tabbed `help.aliyun.com` twin):

- **Allowlist rule (corrected 2026-09-16, superseding the round-4 record
  above).** DashScope's Singapore-region "Supported models" table for
  `enable_search` is the single source of truth for which Qwen ids are
  curated with `tools: ['web_search']`. It covers `qwen3.7-max/plus`, the
  `qwen3.6-*` family (`qwen3.6-flash`, `qwen3.6-max-preview`,
  `qwen3.6-plus`, `qwen3.6-27b`, `qwen3.6-35b-a3b`), the `qwen3.5-*` family
  (`qwen3.5-plus`, `qwen3.5-397b-a17b`, `qwen3.5-122b-a10b`,
  `qwen3.5-27b`, `qwen3.5-35b-a3b`) and bare `qwen3-max` — 13 models in
  total, matching `providers/qwen.ts` exactly. It does **not** cover:
  Qwen3.8 (`qwen3.8-max`, `qwen3.8-flash` — see the dedicated note below);
  the Beijing-only rolling-alias ids (`qwen-max`, `qwen-plus`,
  `qwen-flash`, `qwen-turbo`, `qwq-plus` — this app calls the Singapore
  endpoint, not Beijing); any `qwen3-vl-*`/`qwen-vl-*` vision model; any
  `qwen3-coder-*` model; `qwen3-next-*`; the legacy `qwen2-5-*` models; or
  the `qwen-mt-*` translation models. None of these appear in DashScope's
  web-search-supported-model table at all, so they all stay `tools: []`
  until a documented entry says otherwise.
- **Qwen3.8 is deliberately excluded from web search.** Alibaba's Chat
  Completions API for `qwen3.8-max`/`qwen3.8-flash` does not support
  `search_strategy: 'agent'` — the only search strategy priced and
  available on the Singapore endpoint this app calls (`turbo`/`max` are
  Beijing-only). This is a documented incompatibility, not an oversight or
  a pending verification item.
  See https://www.alibabacloud.com/help/en/model-studio/web-search.
- `search_options.search_strategy` is pinned to `'agent'`. The
  international-facing docs state only `agent` is supported outside
  China-mainland (`turbo`/`max` are Beijing-only, down to having no
  Singapore price listed). Under the agent strategy the docs mark
  `forced_search` as inert ("only return search sources is supported;
  other web search features are unavailable"), so Besidka's web-search
  toggle means "let the model search," not "force a search" — unlike
  OpenAI, where this app forces `toolChoice` onto the search tool.
- `enable_search` and `enable_thinking` coexist — Alibaba publishes a
  combined example — so a thinking-enabled search request sends both flags
  in one body.
- Search billing is separate from tokens and sharply regional: the agent
  strategy is priced around CNY 73.4 per 1,000 calls (~$10/1k) in
  Singapore vs CNY 4/1k in Beijing — a ~17x premium on this app's exact
  endpoint, paid by the BYOK key owner. Search results are also injected
  into the prompt and billed as ordinary input tokens. The toggle ships
  with no in-UI cost hint — a logged default decision (2026-08-09, taken
  without a separate owner ask), not an oversight.
- Two disclosed cosmetic gaps: DashScope's chat-completions response carries
  no source annotations that `@ai-sdk/openai-compatible` would map to AI SDK
  source parts, so a Qwen search turn renders no source chips, and the
  context menu's "Web search" chip (inferred from `source-url` parts on
  assistant rows) stays hidden — the persisted user-message `tools` array
  still records the request. The response also has no explicit "a search
  happened" indicator at all; Alibaba's own suggested detection is comparing
  input-token counts with and without the flag.
- Never live-verified (no DashScope key available in this environment) —
  see the dedicated item under "Known gaps requiring live verification".

**DeepSeek — no first-party mechanism on the endpoint this app uses
(corrected 2026-09-16).** DeepSeek's OpenAI-compatible developer API — the
transport this app actually calls via `@ai-sdk/deepseek` — has no built-in
web search as of 2026-08. Checked: the Chat Completions reference
(`https://api-docs.deepseek.com/api/create-chat-completion/`) documents no
`enable_search`/`web_search`/`search_options` parameter, and its `tools`
parameter states verbatim "Currently, only functions are supported as a
tool"; the full API change log (`https://api-docs.deepseek.com/updates/`,
2024-05-17 through 2026-07-31, covering every model line through
V4/V4-Flash) never announces a search or grounding feature; and the
chat.deepseek.com consumer app's "Search" toggle is a product feature, not
an API capability — an API request does not browse. That part of the
2026-08-09 record still holds.

**Correction: the Anthropic-compatible endpoint is a genuine second
mechanism, not schema tolerance.** The 2026-08-09 record above
misread the Anthropic-compatible endpoint
(`https://api.deepseek.com/anthropic/v1/messages`, documented at
`https://api-docs.deepseek.com/guides/anthropic_api`) as merely tolerating
`server_tool_use`/`web_search_tool_result` content blocks for conversation
history, with no way to actually request a server-side search. A separate,
later research pass found this wrong: that endpoint genuinely accepts
Anthropic's `web_search_20250305` server-tool type as documented DeepSeek
functionality — a real first-party web search mechanism, just on a
different transport (`@ai-sdk/anthropic` pointed at DeepSeek's Anthropic
base URL) than the one this app currently uses for DeepSeek
(`@ai-sdk/deepseek` against the OpenAI-compatible endpoint). Wiring it is
deliberately **not** done in this round — see "Owner action items" below
for the five live-key details that need verification first — so
`providers/deepseek.ts` keeps every DeepSeek model at `tools: []` for now.
This is a candidate follow-up, not the same "not now, skip" product
decision recorded on 2026-08-09 against Besidka building its own
non-BYOK search backend (that decision is unaffected and still stands).

**Moonshot AI — implemented via the Formula API (Wave C-1, verified against
current docs on 2026-08-10).** Round 3/4 documented two web-search surfaces
and declined both — the legacy `$web_search` builtin function (inherently a
two-round-trip flow: the model emits a `$web_search` tool call whose
arguments the client must echo back verbatim as a `role: "tool"` message and
Moonshot runs the search server-side during the follow-up call; and
unwireable anyway, since `@ai-sdk/moonshotai@3.0.30` delegates tool
serialization to `@ai-sdk/openai-compatible`'s `prepareTools`, which
hard-codes `type: "function"` and silently drops provider-defined tools) and
the Formula API official tool `moonshot/web-search:latest` (wireable in
principle, but blocked on the app having no multi-step tool loop). LW1 (the
tool loop, `server/utils/ai/tool-loop.ts`) shipped in Wave B; this section
records the Formula-API implementation that consumes it — its first real
caller. Note: `platform.moonshot.ai` redirects (301) to `platform.kimi.ai`,
the canonical docs host used below.

- **Mechanics, re-verified against the live doc pages, not just a planning
  snapshot**
  (`https://platform.kimi.ai/docs/guide/use-official-tools`,
  `https://platform.kimi.ai/docs/guide/use-web-search`, both fetched
  2026-08-10): fetch the declaration with
  `GET {MOONSHOT_BASE_URL}/formulas/{FORMULA_URI}/tools`, send it as an
  ordinary `type: "function"` tool on `POST /v1/chat/completions`, and when
  the model calls it, execute with
  `POST {MOONSHOT_BASE_URL}/formulas/{FORMULA_URI}/fibers` using body
  `{"name": <function name>, "arguments": <JSON-string args, unmodified
  from the model's own output>}`. `MOONSHOT_BASE_URL` is
  `https://api.moonshot.ai/v1` (matches `@ai-sdk/moonshotai`'s own default
  base URL) and `FORMULA_URI` is `moonshot/web-search:latest`. Auth on both
  calls is `Authorization: Bearer <the user's own Moonshot API key>` — there
  is no separate "app" credential; BYOK holds here exactly as everywhere
  else.
  - **On the URI form:** an earlier planning draft wrote the declaration
    fetch as `GET /v1/formulas/moonshot%2Fweb-search:latest/tools`
    (URI-encoding the formula's own `/`). Moonshot's own official code
    samples (Python `f"/formulas/{FORMULA_URI}/tools"` and a bash
    `curl ${MOONSHOT_BASE_URL}/formulas/${FORMULA_URI}/tools` with
    `FORMULA_URI="moonshot/web-search:latest"` set literally, unencoded)
    both interpolate the raw string with no `encodeURIComponent`/`%2F`
    anywhere on the page. `server/utils/providers/moonshotai-web-search.ts`
    follows the doc's own literal form: plain string concatenation, no
    encoding.
- **Model support (research question: is this k3-only?).** The
  official-tools page frames Formula-API tools as "Moonshot's recommended
  path" specifically for kimi-k3, but its own worked example says verbatim:
  "The examples on this page use the latest model `kimi-k3` by default. …
  To use another model such as `kimi-k2.6` or `kimi-k2.5`, just replace the
  `model` field — parameter configurations differ across models." Both of
  this app's curated models are named as drop-in replacements in Moonshot's
  own official-tools flow, so both are flipped to `tools: ['web_search']` in
  `providers/moonshotai.ts`. "Parameter configurations differ" refers to
  each model's own reasoning-effort field shape (already handled by this
  provider's existing `getProviderOptions()`), not to Formula-API tool
  eligibility — the tool declaration itself is a standard `type: "function"`
  tool, and nothing in either doc page scopes it to one model.
- **The Anthropic-compatible endpoint is not a backdoor (checked, closed;
  correction 2026-09-16 on the DeepSeek comparison only).** Moonshot does
  expose `POST https://api.moonshot.ai/anthropic/v1/messages` (documented
  for Claude Code integration; see MoonshotAI/Kimi-K2 GitHub issue #129 for
  the community-reconstructed reference). Nothing in Moonshot's own docs
  claims Anthropic-style **server-side** tool types (`web_search_20250305`)
  are accepted there — that conclusion, specific to Moonshot's endpoint,
  is unchanged. The comparison this bullet originally drew to DeepSeek's
  analogous endpoint is corrected: DeepSeek's Anthropic-compatible endpoint
  does **not** support "only custom function tools" — a later research
  pass found it genuinely accepts Anthropic's `web_search_20250305`
  server-tool type as documented DeepSeek functionality (see "DeepSeek —
  no first-party mechanism on the endpoint this app uses" above). That
  correction doesn't change Moonshot's own conclusion, since Moonshot's
  docs still make no equivalent claim for its own endpoint, so this
  remains schema compatibility for Claude Code's client tools here, not a
  server-search backdoor. Rewiring Moonshot onto `@ai-sdk/anthropic`
  against that endpoint on an unverifiable hope would be a regression risk
  with no documented payoff. **Not a path** — recorded so it isn't
  re-investigated.
- **No forced `toolChoice`.** Unlike this app's OpenAI/xAI wiring (which
  forces `toolChoice` onto their provider-executed search tools, safe
  because those never loop), the Moonshot tool is client-executed and
  marked with `withFollowUpTurn()` — forcing `toolChoice` here would re-select
  the same tool on every loop step and the model would never produce text.
  See `server/utils/ai/tool-loop.ts`'s doc comment.
- **The encrypted-output blob — flagged for explicit product-owner
  sign-off, not silently shipped.** Web search is documented as a
  "protected" formula: a successful fiber run reports its result inside
  `context.encrypted_output` (`----MOONSHOT ENCRYPTED BEGIN----…----MOONSHOT
  ENCRYPTED END----`), and the official-tools doc states this "content can
  be passed directly into the tool call" — i.e. it is designed to flow
  through as opaque tool-result content that only Moonshot's own backend
  can interpret; the app is not expected to decrypt or inspect it, and this
  implementation doesn't. `getMoonshotWebSearchTools()`'s `execute()`
  returns the string verbatim, and the multi-step loop's existing part
  persistence (`normalizeAssistantMessagePartsForPersistence` passes
  through every part type other than `tool-generate_image`) stores it in
  `messages.parts` unchanged, same as any other tool result. Moonshot's own
  docs only describe the *immediate* next `/chat/completions` call reusing
  this blob — they say nothing about an app like this one that keeps full
  multi-turn chat history and resends it on every subsequent turn of the
  *same* chat, potentially for as long as the chat exists. **The shared-chat
  path is confirmed clean, not a risk**: `server/api/v1/shared/[slug]/
  index.get.ts`'s `filterPublicParts()` strips every `isToolUIPart` part
  (matching this tool's `tool-web_search` result) from the public JSON
  response before it is ever built, and `stripToolPartsFromBranchedMessage`
  (`server/utils/chats/branch.ts`) does the same when a shared chat is
  branched into another user's own chat — both filter on part *type*, so
  this holds regardless of what the ciphertext actually contains. The real,
  narrower open question is retention within the *owner's own* chat: because
  Moonshot's actual encryption scheme (algorithm, key custody,
  ciphertext-reuse safety) is undocumented and unverifiable from outside,
  indefinite storage and repeated resend of this blob to Moonshot on every
  future turn has **not** been independently confirmed safe as a
  data-minimization matter — it is passed through exactly as documented,
  but the product owner should explicitly sign off on this retention/re-send
  behavior rather than it being an implicit consequence of following the
  docs. Nothing is decrypted, transformed, or given any bespoke DB handling
  here; it lives in the exact same `messages.parts` JSON column every other
  tool result already uses.
- **Cross-provider resend on a mid-chat model switch — functional gap, not
  a security issue.** This app resolves the model fresh from each request
  and resends the full persisted history regardless of which provider
  handled earlier turns. If a chat has a `tool-web_search` part from a
  Moonshot turn and the user then switches the same chat to a different
  provider, that opaque part is resent verbatim to a backend that never
  declared the tool and cannot interpret it — at best inert (a third party
  never learns anything from ciphertext it has no key for), at worst a
  provider that validates tool-call/result pairing strictly could reject the
  request. Not verified live (no provider-switch-after-search scenario has
  been exercised with real keys); tracked here rather than guessed at.
- **Billing — still self-contradictory as of 2026-08-10, not resolved
  here.** Two Moonshot doc pages disagree, same as round 3/4 found:
  - `use-official-tools`: "official tools are currently free for a limited
    time; when the tool load reaches capacity limits, temporary rate
    limiting measures may be applied."
  - `use-web-search` + `/docs/pricing/tools`: "In addition to token
    consumption, we also charge a call fee for each web search" —
    specifically "$0.005 for the `$web_search` call" when
    `finish_reason = tool_calls` (no charge if the model never triggers a
    search), plus ordinary token billing for
    `prompt_tokens + search_tokens + completions_tokens`. Prices exclude
    tax.
  - Whether the $0.005/call figure (stated for the legacy `$web_search`
    builtin) also applies to a Formula-API `web_search` fiber call is
    itself ambiguous — the official-tools page's own "free for a limited
    time" sentence is the only pricing language on the page that actually
    describes what this app calls, and it cross-references the same "Web
    Search Price" page as if the fee applies there too. Per this round's
    instructions, this contradiction is recorded, not resolved — verify the
    real Moonshot console/invoice on the first live search send (see "Known
    gaps" below).

### Vision vs image generation in the picker

The two capabilities are deliberately never conflated and never share a
color: a violet `image-plus`/"Image generation" chip comes from
`hasImageGenerationCapability()`, while an `eye`/"Vision" chip —
`text-secondary`/`badge-secondary` — comes from `hasVisionCapability()`
(`app/utils/models-picker.ts`, reading the `model.modalities.input`
data the models.dev merge already populates). Accepted trade-off, a
deliberate product-owner decision (2026-08-09) rather than scope creep: most
modern curated models are vision-capable, so the eye chip appears on nearly
every row.

### models.dev catalog key: `alibaba`, not `qwen`

`scripts/fetch-models-metadata.mjs` looks up each curated provider's
models.dev entry via `catalog[provider.id]?.models` for every other
provider, but models.dev lists Qwen's models under the top-level key
`alibaba` (confirmed via `curl -s https://models.dev/api.json | jq
'keys'`), not `qwen` — this app's own `provider.id` is `qwen` for good
reason (it's also the DB `keys.provider` value, the `keyProviderId`, and the
`ProviderIcon`/`provider-meta` lookup key, all of which have real blast
radius if renamed). `providers/merge.ts`'s `CuratedProvider` interface
gained an optional `modelsDevKey?: string` field for exactly this
divergence; `providers/qwen.ts` sets `modelsDevKey: 'alibaba'`, and the fetch
script now resolves `provider.modelsDevKey ?? provider.id` at both of its
two `catalog[...]` lookup sites instead of assuming `provider.id` always
matches. No other curated provider needs this override today — xAI,
DeepSeek, Moonshot AI, OpenAI, Anthropic and Google all use identical ids on
both sides.

### Missing brand icon (closed)

`app/components/ProviderIcon.vue` originally had no Qwen/Alibaba brand icon
and fell back to the generic two-letter badge (`Qw`). This was closed by a
later round's icon-system rewrite, which replaced every provider's bespoke
SVG component with real Iconify marks resolved at runtime through
`icon.serverBundle.remote` — Qwen now renders `simple-icons:qwen`, alongside
every other provider.

`providers/index.ts`'s default-model resolution had a latent bug fixed while
adding these three: a later provider's `default: true` model would silently
overwrite the global default because the `break` only exited the inner loop.
Fixed with a labeled `break outer`. **No new model in any provider file
should ever set `default: true`** unless the intent is genuinely to change
Besidka's single global default (currently `gemini-2.5-flash-lite`) — "pick a
sensible default per provider" means "list it first in that provider's
array," which is a display-order convention with no functional effect, not
the `default` flag.

## Multi-step tool loop

`streamText()` defaults to `stopWhen: isStepCount(1)`, so historically every
send ran exactly one step. `server/utils/ai/tool-loop.ts` adds an opt-in
multi-step loop for the one case that genuinely needs it: a tool whose result
the *model* must read before it can answer in natural language.

**The trigger is a marker on the tool, never a heuristic.**
`withFollowUpTurn(tool)` stamps `requiresFollowUpTurn: true` onto a tool
definition; `resolveToolLoopOptions()` returns loop options only when at least
one tool in the send carries it, and `undefined` otherwise. `undefined` spreads
to nothing at the `streamText()` call site, so every other send passes byte-
identical arguments to what it passed before the loop existed.

**"Has an `execute()`" is explicitly NOT the trigger, and using it would be a
regression.** `createImageGenerationTool()` is a client-executed tool with a
real `execute()`, and the AI SDK's own continuation condition (client tool
calls that produced results, in `streamText`'s step flush) would happily
continue past it if a blanket `stopWhen` were set — spending a second billed
generation to narrate an image the user can already see. Image generation is
single-step precisely because its tool result IS the deliverable.
Provider-executed tools are doubly safe: the SDK's continuation condition
skips tool calls flagged `providerExecuted: true`.

Moonshot's Formula-API `web_search` tool
(`server/utils/providers/moonshotai-web-search.ts`) is the first real caller
of the marker — see "Moonshot AI — implemented via the Formula API" above.
The loop mechanics themselves remain proven generically by a test-only
fixture tool (`tests/fixtures/follow-up-turn-tool.ts`) driven through the
real send pipeline with a real `streamText` and a `MockLanguageModelV4`;
that fixture must never be wired into a provider builder.

**Bounds.** `TOOL_LOOP_MAX_STEPS` is 3 (request the tool, answer from the
result, one spare refinement round). `timeout: { totalMs: 540_000, toolMs:
60_000 }` is set on the loop path only: the KV generation-in-progress guard
this route writes expires after 600s, so the loop's total budget must stay
under that — otherwise a client retry arriving after the guard expired would
start a second concurrent generation for the same turn. A tool `execute()`
that throws produces a `tool-error` output, which the model sees and answers
from, so a failing tool terminates the loop rather than retrying it.

**`toolMs` is cooperative, not enforced.** The AI SDK only passes it to
`execute()` as `options.abortSignal` — it never wraps the call in its own
race/cancellation. A tool that hangs without checking that signal (e.g. a
`fetch()` that omits `signal: options.abortSignal`) is never interrupted by
`toolMs`, and can hang past `totalMs` too, since nothing else force-resolves
a pending step. `totalMs` does correctly abort a hang in the *model's own*
HTTP call: `persistAssistantMessageFromStream()` sees the resulting `abort`
chunk, returns `false`, writes no assistant row, and the KV guard is still
released in the handler's `finally`. **Any real tool wired via
`withFollowUpTurn()` must thread `options.abortSignal` into its own network
I/O**, or `toolMs` does nothing for it. There is no test for a true hang —
nothing in this framework can force one to resolve — only a tool `throw` is
exercised (`tests/integration/api/chats-tool-loop.spec.ts`).

**Persistence and rendering.** Intermediate tool-call/tool-result parts land
in `messages.parts` unchanged: `normalizeAssistantMessagePartsForPersistence`
passes through every part type other than `tool-generate_image`. On the
client, the `v-if` chain in `app/pages/chats/[slug].vue` and
`app/pages/shared/[slug].vue` matches only `tool-generate_image`, error text
and `text`, so an unrecognized tool part renders nothing and throws nothing.
One cosmetic consequence worth knowing: `shouldFitMessageBubble()` returns
`false` for any part type outside `text`/`reasoning`/`step-start`/`file`, so
a message carrying a tool part loses fit-content bubble styling. Deciding how
search steps should *look* (chips, collapsed steps, or nothing) is still
deliberately open.

## No-key UX gating

`useUserKeys()` (`app/composables/user-keys.ts`) fetches
`GET /api/v1/profiles/keys` once into shared state and fails **open** while
loading/erroring — a slow network must never flash every model as disabled.
Every provider is gated generically by iterating `providerMeta`, so a new
provider is gated for free with zero picker-side code changes. Server-side,
the original 401-at-send-time remains the real enforcement backstop; the
picker gating is UI guidance only.

## Known gaps requiring live verification

None of these were verified against a real account/credential in the
development environment (no live API keys were available). Each was flagged
by its own PR's review and confirmed still open by the final cross-PR review:

1. **Real streamed chat completions** through all 11 direct-provider models
   (8 xAI/DeepSeek/Moonshot AI + 3 Qwen) — `pnpm run preview` (workerd) with
   real keys. Qwen carries the same unverified-`enable_thinking` risk
   category as the other three providers' reasoning wiring.
2. **Qwen `enable_search` on the international endpoint** — the wiring
   follows the Singapore-region docs (agent strategy, the region tab's
   supported-model table), but no live DashScope call was made, and
   Alibaba's docs internally conflict on exactly the two originally curated
   models: the Singapore tab's supported-models table lists
   `qwen3.7-plus`/`qwen3.6-flash` under the agent strategy, while the
   agent strategy's own applicability list names only 3.5-generation
   models plus bare `qwen3-max`, and no worked example anywhere in the doc
   uses a 3.7/3.6 id with `enable_search`. The curated flags deliberately
   follow the supported-models table; this live probe is what resolves
   that conflict, not a formality. The response carries no explicit search
   indicator, so Alibaba's own suggested probe is comparing input-token
   counts for the same prompt with and without the flag (a fired search
   inflates the prompt by hundreds-to-thousands of tokens). Verify on
   `qwen3.7-plus` and `qwen3.6-flash`, and confirm a flagged request is
   not rejected when the model chooses not to search. The same EN/ZH
   `agent`-strategy-applicability disagreement applies to the 11 models
   flipped on 2026-09-16, so extend this probe to at least one
   newly-flipped 3.5-generation model (e.g. `qwen3.5-plus`) and one
   3.6/3.7-generation model (e.g. `qwen3.6-plus` or `qwen3.7-max`) before
   treating the wider allowlist as fully live-confirmed.
3. **Moonshot's Formula-API `web_search` tool, end to end** (Wave C-1,
   2026-08-10) — no live Moonshot key exists in this environment, so
   nothing here was exercised against the real API. Everything in
   `server/utils/providers/moonshotai-web-search.ts` is built and tested
   against realistic mocks shaped from Moonshot's own current doc pages
   (cited inline in the source and in the "Moonshot AI — implemented via
   the Formula API" section above), not a live response. Needs, on the
   first real key: (a) a genuine declaration fetch against
   `GET /v1/formulas/moonshot/web-search:latest/tools` to confirm the
   unencoded-URI form this app sends is accepted and the response shape
   matches; (b) one real search send per curated model (`kimi-k2.6` and
   `kimi-k3`) confirming the model actually receives and uses the
   `encrypted_output` blob to produce a grounded follow-up answer, not
   just that the fiber call itself succeeds; (c) checking the real
   Moonshot console/invoice to resolve which side of the billing
   contradiction above actually applies to a Formula-API call, not the
   legacy `$web_search` builtin; (d) confirming `withFollowUpTurn()` +
   no forced `toolChoice` actually lets `kimi-k3` (always-on reasoning)
   produce a natural-language answer after the tool result rather than
   re-calling the tool — the fixture-based loop test proves the mechanism
   generically with a mock model, not with this specific model's real
   tool-calling behavior; and (e) the `kimi-k2.6` + thinking-disabled +
   web-search combination specifically — Moonshot's own web-search doc
   phrases `kimi-k2.6` support as "can perform web search with thinking
   enabled," which hints the thinking-off case may behave differently
   (weaker tool selection, a different result shape, or no search at all)
   rather than being a mechanical no-op; this app's reasoning toggle and
   web-search toggle are fully independent controls, so a user can select
   that exact combination today; and (f) that the tool declaration is
   genuinely account/tier-independent as assumed by the global (non-key-
   scoped) cache — if a real account ever returns a different declaration
   shape than another, the failure mode is a stale-but-wrong cached schema
   served to an unrelated account, not a data leak (fiber *execution*
   always uses the requesting user's own key regardless of which
   declaration was cached), but it would still need the cache key scoped
   per-account.

**Recommended pre-production gate**: item 1 is one real key per provider,
one message per model, confirming a streamed completion and an Axiom event
with the expected `providerId`/`modelId`. Item 2 needs one extra pair of Qwen
sends — the same prompt with the web-search toggle on and off — comparing the
two input-token counts in the context menu. Item 3 is its own pass, described
inline above.

## Known limitation (disclosed, not fixed)

An image attached earlier in a conversation under a vision-capable model can
still reach the provider raw on a *later* turn if the user regenerates that
same message after switching to a non-vision model mid-session —
`sanitizeMessagesForModelContext()` in
`server/utils/files/assistant-files.ts` only replaces file parts with an
"omitted" text placeholder for non-latest user messages; the latest user
message's file parts are always kept as-is regardless of the currently
selected model's vision support, since there's no new attach action for the
client-side gate to intercept. Closing this fully requires threading the
selected model's modality data into `sanitizeMessagesForModelContext()`
before it runs, which means resolving it earlier in `index.post.ts`'s request
flow, before `messagesForAI` is built. Left as a disclosed gap: the friendly
error normalization in `server/utils/chats/errors.ts`
(`looksLikeImageInputRejection`) is the safety net for that case and for any
other model whose vision support this app doesn't yet know.

## Owner action items

Nothing is required to deploy. Specifically:

- No new secrets or environment variables — this remains 100% BYOK.
- No destructive migrations — every schema change across all 8 PRs (Qwen
  included) was a purely additive `ALTER TABLE ADD COLUMN` or a TS-only enum
  widening with no SQL-level change; Qwen's `keys.provider` addition
  generated no migration file at all (`pnpm run db:generate` reported "No
  schema changes, nothing to migrate").
- The live-verification gate above is a strong recommendation, not a hard
  deploy blocker — BYOK means a failure only affects the specific user
  testing a specific provider, not the app as a whole.

**Unverifiable without a live key (model catalog expansion, 2026-09-16).**
Each of these was a recorded decision point
(`docs/model-catalog-expansion-plan.md` § 8) resolved with a documented,
best-evidence recommendation rather than a live call, because no live key
for the provider is available in this
environment:

- **Removing `deepseek-chat`/`deepseek-reasoner` outright** rather than
  keeping them as deprecated safety-net entries. Both ids are gone from
  models.dev, so keeping them would need `EXEMPT_IDS` plus full hand
  curation of models that hard-fail on every real send. A user with either
  id persisted already falls back safely to the default model
  (`app/composables/model.ts`'s `useUserModel()` guard) — confirm this
  fallback in practice on the first live DeepSeek smoke test.
- **Moonshot's 13 discontinued models** are assumed to hard-404 (Moonshot's
  own docs call them "no longer maintained or supported," reading as a
  harder cutoff than xAI/DeepSeek's silent-redirect-and-rebill pattern), but
  this has not been confirmed against a real request. Check with a live key
  before ever reconsidering curating any of them as legacy entries.
- **`kimi-k2.7-code` and `kimi-k2.7-code-highspeed` really don't accept a
  reasoning toggle.** Curated as `reasoningAlwaysOn: true` on the strength of
  models.dev reporting `reasoning_options: []` for both — confirm with a
  live key that sending `providerOptions.moonshotai.thinking` to either
  model is in fact rejected (or simply ignored) rather than silently
  accepted, which would mean they could be curated as toggle-mode instead.
- **xAI's image output format and quality tier.** `grok-imagine-image-2.0`
  is assumed to return PNG, JPEG, or WebP bytes (base64, per the
  `response_format: "b64_json"` request the SDK hardcodes) — confirm with a
  live key that `validateGeneratedImage()`'s signature check actually
  accepts what comes back, and confirm which quality tier the flat $0.04
  price in `flatImageGenerationCostUsdByModelId` corresponds to (this app
  sends no explicit `quality`, so xAI's own `'auto'` default applies — see
  "xAI image generation" above).
- **Qwen web search on the remaining 33 unflagged new models (updated
  2026-09-16).** A DashScope-docs research pass confirmed 13 of the 46
  curated Qwen models against the Singapore-region `enable_search`
  supported-model table and flipped them to `tools: ['web_search']` — see
  "Web search across the direct providers" above for the full list. The
  other 33 (all from this expansion's "43 new" set) still ship
  `tools: []` because they genuinely do not appear in that table, not
  because verification is pending — a DashScope per-model pass already
  ran over the full 46. Only a live-key probe (item 2 under "Known gaps
  requiring live verification" above) remains open, not a documentation
  gap.
- **DeepSeek's Anthropic-compatible web search endpoint — candidate
  follow-up, not wired this round.** DeepSeek genuinely supports
  Anthropic's `web_search_20250305` server-tool type on its
  Anthropic-compatible endpoint (`https://api.deepseek.com/anthropic/v1/
  messages`), a real first-party mechanism this app does not currently use
  — see "DeepSeek — no first-party mechanism on the endpoint this app
  uses" above. Wiring it would mean adding `@ai-sdk/anthropic` pointed at
  that base URL as a second DeepSeek transport, alongside the existing
  `@ai-sdk/deepseek`-against-OpenAI-compatible wiring. Left unwired this
  round pending live-key verification of:
  1. whether the endpoint is accepted from typical BYOK client user-agents
     outside Anthropic's own SDK/Claude Code, or whether it rejects or
     rate-limits unrecognized callers;
  2. reasoning-parameter shape differences on the Anthropic-compatible
     endpoint versus the OpenAI-compatible endpoint this app already
     handles in `server/utils/providers/deepseek.ts`;
  3. `top_p` semantics differences between the two endpoints, which could
     silently change generation behavior for non-search turns too if this
     transport were ever used as a general replacement;
  4. whether hidden search-result-summarization tokens the endpoint may
     bill are captured by this app's existing cost-map, or would need a
     new entry;
  5. general endpoint behavior parity with the OpenAI-compatible
     endpoint (error shapes, streaming semantics, model id acceptance)
     before trusting it for anything beyond search.
