# xAI

Part of the direct-providers documentation set — see
[`general.md`](./general.md) for the cross-cutting architecture and shared
patterns this file builds on.

## Curated models

xAI (9 models — 7 text + 2 image): `grok-4.20-0309-non-reasoning`
(default/first-listed), `grok-4.20-0309-reasoning`,
`grok-4.20-multi-agent-0309`, `grok-4.6`, `grok-4.5`, `grok-4.3`,
`grok-build-0.1`, and the image models `grok-imagine-image-2.0` and
`grok-imagine-image` (see "Image generation" below). Note the dated model
ids on the `-0309` pair — the undated
`grok-4.20-non-reasoning`/`grok-4.20-reasoning` forms do not exist on
models.dev or in xAI's own docs. `tools: ['web_search']` via
`xai.tools.webSearch({})` on every text model except
`grok-4.20-multi-agent-0309`, which is curated with `tools: []` because
models.dev reports `tool_call: false` for it upstream — sending a tool
declaration to a model that can't call tools would be a live-key error, not
a picker cosmetic. `grok-4.20-0309-reasoning` and `grok-build-0.1` don't
accept xAI's `reasoning_effort` param at all (fixed behavior, confirmed via
xAI's own docs) — both are curated with `reasoningAlwaysOn: true` instead of
a `reasoning` toggle/levels capability. The picker labels them "Always
reasons" and the chat input shows its reasoning button forced on and
disabled, since no effort can be sent (see
[`docs/chat-reasoning.md`](../chat-reasoning.md#reasoning-control-states)).

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
  apply its own default (`low` for `grok-4.3`, per its model page) rather
  than explicitly disabling reasoning the way `none` would. This is
  pre-existing behavior and is left as-is rather than plumbing an explicit
  `none` value through. `grok-4.5`/`4.6`/`4.7` have no `none` at all and
  no longer offer `off` (see below).

Server-side wiring lives in `server/utils/providers/xai.ts`, matching the
existing `use<Provider>()` contract described in
[`general.md`](./general.md#server-side-wiring).

## Reasoning output

Verified against primary sources on 2026-10-13. Short version: xAI
documents readable reasoning text only for `grok-4.7`. For every other
curated Grok model the API reports `reasoning_tokens` in usage and, at most,
an encrypted reasoning blob. No request parameter turns that into readable
text. The app therefore shows a compact "Reasoned · N tokens" indicator on
those messages instead of a reasoning block (see
[`docs/chat-reasoning.md`](../chat-reasoning.md#hidden-reasoning-indicator)).

What the docs say:

- **Summaries are `grok-4.7`-only.** The reasoning guide's "Summarized
  Reasoning Content" section says "For `grok-4.7`, we expose summarizations
  of the model's internal reasoning", and names no other model
  ([docs.x.ai reasoning guide](https://docs.x.ai/developers/model-capabilities/text/reasoning)).
  The model pages for `grok-4.20-0309-reasoning`, `grok-build-0.1`,
  `grok-4.3`, `grok-4.5` and `grok-4.6` only say "Reasoning: Yes"
  ([model pages](https://docs.x.ai/developers/models)). The docs are silent
  for those models rather than explicitly negative.
- **Otherwise the trace is encrypted.** The guide's key features list says
  usage exposes `reasoning_tokens` and "Some models can also return
  encrypted reasoning" via `include: ["reasoning.encrypted_content"]`. That
  blob exists to be sent back for multi-turn context, which is xAI's API
  design; it is not readable. This app neither requests it (no `include`,
  no `store: false`) nor would it replay it, because reasoning parts are
  dropped from earlier turns before a send (see
  [`general.md`](./general.md#multi-step-tool-loop)).
  The docs' own encrypted example item carries `"summary": []` next to
  `encrypted_content`
  ([generate-text guide](https://docs.x.ai/developers/model-capabilities/text/generate-text)).
- **`reasoning.summary` does nothing.** The Responses API reference
  describes it as "Only included for compatibility"
  ([Responses API reference](https://docs.x.ai/developers/rest-api-reference/inference/responses)).
- **Reasoning cannot be disabled** on `grok-4.5`, `grok-4.6` and
  `grok-4.7`. The guide says `reasoning_effort` "defaults to `"high"`" and
  "Reasoning cannot be disabled". These models are curated with
  `cannotDisable: true` and `defaultLevel: 'high'`, so their menu has no
  `Off` and a saved `off` is sent and persisted as `high` (see
  [`docs/chat-reasoning.md`](../chat-reasoning.md#models-that-cannot-disable-reasoning)).
  The hidden-reasoning indicator makes that visible on the message.

What `@ai-sdk/xai@5.0.20` does (`dist/index.js`):

- The Responses parser emits a `reasoning` part from `summary` text, or
  from `content` text when `summary` is empty. When neither has text but
  `encrypted_content` is present, it emits a reasoning part with empty
  text. Empty-text reasoning parts never render as a block in this app.
- `reasoningSummary` is deprecated and no longer sent
  ([vercel/ai#21410](https://github.com/vercel/ai/pull/21410)), because
  xAI documents the field as compatibility-only. `useXai()` still passes
  it, which is a no-op.
- `include: ['reasoning.encrypted_content']` is only added automatically
  when `store: false` is set. This app sets neither.
- For `grok-4.20(-dddd)-(non-)reasoning` ids the SDK drops any effort with
  an unsupported-setting warning, because those models reject
  `reasoning_effort`.

Live evidence (2026-10-13). Production (`@ai-sdk/xai@4.0.33`, still sending
`reasoning.summary`) and a PR preview (`5.0.20`, plus a temporary body shim
that sent `reasoning: { summary: 'detailed' }`) gave the same result:
`grok-4.20-0309-reasoning` returned 855–1217 reasoning tokens and
`grok-4.5` at `low` returned 264, with message parts `step-start` and
`text` only. So the missing trace is not caused by the SDK upgrade or by a
parameter this app fails to send.

One app-side bug did hide reasoning on always-on models, and it is now
fixed. The chat route forwarded reasoning text only when the requested
level was not `off`, and an always-on model's level is always `off`. Any
reasoning text such a model returned was stripped before it reached the
client or the database. For `grok-4.20-0309-reasoning` this made no
visible difference, because xAI returns no text. It did matter for the
Moonshot and Qwen always-on models. The rule now lives in
`shouldSendReasoning()` (`shared/utils/reasoning.ts`).

Not live-verified: that `grok-4.7` at `low`/`medium`/`high` streams its
summary into a full reasoning block through the
`response.reasoning_summary_text.delta` path. It is on the PR's preview
checklist.

## Image generation

`grok-imagine-image-2.0` is xAI's first image model in this catalog, wired
through the same dedicated-image-model pattern as OpenAI (`gpt-image-2`) and
Google — a hand-curated `imageGeneration: { controllerModel }` entry, never
a chat tool the model invokes mid-turn.

`grok-imagine-image` (the original 1.0 model, still active) is curated
second, after 2.0, so image models stay at the tail of the array. It uses the
same shape as 2.0 (`tools: []`, controlled by
`grok-4.20-0309-non-reasoning`) with `price.display: '$0.02 / image'` and a
flat `0.02` entry in `flatImageGenerationCostUsdByModelId` (billed the same
at 1K and 2K). models.dev lists it with a null `cost`, so it is in
`EXEMPT_IDS` and fully hand-curated, exactly like 2.0. It takes no `quality`
parameter, and none is sent: the xAI path sends only `aspectRatio`.
`grok-imagine-image-quality` is deliberately not curated; it retires
2026-11-02.

- **`xai.image(modelId)`, not `xai.tools.imageGeneration()`.** The installed
  `@ai-sdk/xai@5.0.20` exposes both `xai.image`/`xai.imageModel` (confirmed
  via `require()` — no SDK bump needed) and a conversational
  `xai.tools.imageGeneration()` tool the chat model can call mid-turn. Only
  the former fits this app's controller-model pattern: a dedicated image
  model invoked once, outside the chat loop, the same shape
  `server/utils/providers/xai.ts`'s `getImageModel()` already uses for
  OpenAI/Google.
- **`grok-imagine-image-2.0` (and `grok-imagine-image`) are in
  `EXEMPT_IDS`.** models.dev lists the id,
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
