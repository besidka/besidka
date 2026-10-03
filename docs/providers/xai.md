# xAI

Part of the direct-providers documentation set — see
[`general.md`](./general.md) for the cross-cutting architecture and shared
patterns this file builds on.

## Curated models

xAI (8 models — 7 text + 1 image): `grok-4.20-0309-non-reasoning`
(default/first-listed), `grok-4.20-0309-reasoning`,
`grok-4.20-multi-agent-0309`, `grok-4.6`, `grok-4.5`, `grok-4.3`,
`grok-build-0.1`, and the image model `grok-imagine-image-2.0` (see "Image
generation" below). Note the dated model ids on the `-0309` pair — the
undated `grok-4.20-non-reasoning`/`grok-4.20-reasoning` forms do not exist on
models.dev or in xAI's own docs. `tools: ['web_search']` via
`xai.tools.webSearch({})` on every text model except
`grok-4.20-multi-agent-0309`, which is curated with `tools: []` because
models.dev reports `tool_call: false` for it upstream — sending a tool
declaration to a model that can't call tools would be a live-key error, not
a picker cosmetic. `grok-4.20-0309-reasoning` and `grok-build-0.1` don't
accept xAI's `reasoning_effort` param at all (fixed behavior, confirmed via
xAI's own docs) — both are curated with `reasoningAlwaysOn: true` instead of
a `reasoning` toggle/levels capability, so the picker shows the brain icon
without offering a control the model can't actually honor.

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
- **`grok-4.3`'s `none` level and the app's `'off'` state are not quite the
  same thing.** models.dev reports `grok-4.3`'s effort axis as
  `none,low,medium,high`; it's curated the same as every other levels-mode
  xAI model, `levels: ['low', 'medium', 'high']`. The app's `'off'`
  reasoning state sends no `reasoning_effort` param at all, which lets xAI
  apply its own per-model default (e.g. `grok-4.5` defaults to `'high'` when
  nothing is sent) rather than explicitly disabling reasoning the way `none`
  would. This is pre-existing behavior, identical for the already-curated
  `grok-4.5` — not a regression introduced by this PR — and is left as-is
  rather than plumbing an explicit `none` value through.

Server-side wiring lives in `server/utils/providers/xai.ts`, matching the
existing `use<Provider>()` contract described in
[`general.md`](./general.md#server-side-wiring).

## Image generation

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

## Owner action items

**Unverifiable without a live key (model catalog expansion, 2026-09-16).**
This was a recorded decision point
(`docs/model-catalog-expansion-plan.md` § 8) resolved with a documented,
best-evidence recommendation rather than a live call, because no live xAI
key is available in this environment:

- **xAI's image output format and quality tier.** `grok-imagine-image-2.0`
  is assumed to return PNG, JPEG, or WebP bytes (base64, per the
  `response_format: "b64_json"` request the SDK hardcodes) — confirm with a
  live key that `validateGeneratedImage()`'s signature check actually
  accepts what comes back, and confirm which quality tier the flat $0.04
  price in `flatImageGenerationCostUsdByModelId` corresponds to (this app
  sends no explicit `quality`, so xAI's own `'auto'` default applies — see
  "Image generation" above).

See [`general.md`](./general.md#known-gaps-requiring-live-verification) for
the cross-provider live-streamed-completion verification item that also
covers xAI's models.
