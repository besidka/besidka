# Providers and gateways: xAI/DeepSeek/Moonshot AI + Vercel/Cloudflare/OpenRouter

Besidka's BYOK model catalog has two independent halves that must never be
merged into one data structure: **direct providers** (curated, build-time,
models.dev-backed) and **gateways** (uncurated, runtime-fetched, per-user).
This doc is the permanent record of that architecture and the decisions
behind it — it replaces a temporary planning document
(`docs/_wip-plan-providers-gateways.md`) used during development and deleted
once the last PR in the stack landed.

## Direct providers: xAI, DeepSeek, Moonshot AI

Added alongside the pre-existing Anthropic/Google/OpenAI providers, following
the exact same pattern documented in `docs/models-data-fetching.md`:
`providers/{xai,deepseek,moonshotai}.ts` hold curated capabilities, merged at
import time against `providers/data/models-dev-snapshot.json`.

- **xAI**: `grok-4.20-0309-non-reasoning` (default/first-listed),
  `grok-4.20-0309-reasoning`, `grok-4.5`. Note the dated model ids — the
  undated `grok-4.20-non-reasoning`/`grok-4.20-reasoning` forms do not exist
  on models.dev or in xAI's own docs. `tools: ['web_search']` via
  `xai.tools.webSearch({})`. No image-generation capability: xAI's image
  generation is a separate model class (`xai.image(...)`), not a chat tool.
  `grok-4.20-0309-reasoning` doesn't accept xAI's `reasoning_effort` param at
  all (fixed behavior, confirmed via xAI's own docs) — it's curated with
  `reasoningAlwaysOn: true` instead of a `reasoning` toggle/levels
  capability, so the picker shows the brain icon without offering a control
  the model can't actually honor.
- **DeepSeek**: `deepseek-chat` (default/first-listed, on/off `thinking`
  toggle), `deepseek-reasoner` (always-on reasoning). No native web_search or
  image_generation.
- **Moonshot AI**: `kimi-k2.6` (default/first-listed), `kimi-k3`. The
  `moonshot-v1-*` classic line is deliberately not curated — Moonshot is
  sunsetting it. `kimi-k2.5` (originally the product owner's explicit pick)
  was removed after real users hit "Not found the model kimi-k2.5 or
  Permission denied" in the live app — Moonshot has an active sunset notice
  for it on their platform. `kimi-k3` reasons unconditionally (Moonshot's own
  docs confirm `reasoning_effort` only adjusts intensity — `low`/`high`/`max`
  — with no way to disable reasoning), so it's curated with
  `reasoningAlwaysOn: true` rather than a `reasoning` toggle; see the xAI
  entry above for the parallel case and `providers/merge.ts`'s
  `curatedCapabilities()` for how the flag is threaded.

Server-side wiring lives in `server/utils/providers/{xai,deepseek,moonshotai}.ts`,
matching the existing `use<Provider>()` contract. **Moonshot needs one
non-obvious guard**: its API rejects a request that sends both a `thinking`
param and an auto-derived `reasoning_effort` — this app avoids the conflict by
never setting the top-level `reasoning` streamText option for Moonshot
models, only `providerOptions.moonshotai.thinking` directly.

**Package version note**: `@ai-sdk/deepseek@3.x` and `@ai-sdk/moonshotai@3.x`
ship on a lower major than this app's `ai@7`/`@ai-sdk/provider@4` line
(`@ai-sdk/xai@4.x` matches). Verified compatible via typecheck/build/full test
suite, but this was never proven with a real live API call — see "Owner
action items" below.

`providers/index.ts`'s default-model resolution had a latent bug fixed while
adding these three: a later provider's `default: true` model would silently
overwrite the global default because the `break` only exited the inner loop.
Fixed with a labeled `break outer`. **No new model in any provider file
should ever set `default: true`** unless the intent is genuinely to change
Besidka's single global default (currently `gemini-2.5-flash-lite`) — "pick a
sensible default per provider" means "list it first in that provider's
array," which is a display-order convention with no functional effect, not
the `default` flag.

## Gateways: Vercel AI Gateway, OpenRouter, Cloudflare AI Gateway

**The core architectural rule**: gateway models are a parallel runtime data
path, never merged into the static `providers` array. The existing
picker/selection/favorites/routing stack assumes one build-time-known,
globally-unique model id space. Gateways violate every part of that
assumption — their catalogs are per-user, hundreds of models deep, fetched at
runtime, and uncurated by design.

### Id naming — read this before touching any gateway code

Three different id spaces exist for the same three gateways, and conflating
them produces silent bugs:

| Concept | Values | Where it's used |
| --- | --- | --- |
| `GatewayId` (`shared/types/gateways.d.ts`) | `'vercel'`, `'cloudflare'`, `'openrouter'` | UI, `provider-meta.ts` ids, `ModelSelection.gatewayId`, `enabledGateways` |
| `keys.provider` DB enum | `'vercel-gateway'`, `'cloudflare-gateway'`, `'openrouter'` | The `keys` table — note OpenRouter has **no suffix** while the other two do |
| `keyProviderId` (`shared/utils/provider-meta.ts`) | maps the two above | **The only place this mapping should ever be written** |

Every gateway builder (`server/utils/gateways/{vercel,openrouter,cloudflare}.ts`)
resolves its DB key lookup via `keyProviderIdForGateway(gatewayId)` — never a
hardcoded literal. A hardcoded `'vercel'` where `'vercel-gateway'` was needed
produces a silent "key never found" failure, not a crash, so it's easy to
miss without a naming-drift-specific test (several exist, e.g. in
`tests/unit/composables/user-keys.spec.ts` and the gateway builder specs).

**Adding a fourth gateway later**: the id needs to be added in at least these
six places — `shared/types/gateways.d.ts`'s `GatewayId` union,
`shared/utils/model-selection.ts`'s gateway-id list, `shared/utils/provider-meta.ts`'s
`enabledGateways` + a new `providerMeta` entry, and the `z.enum([...])`
literals in `server/api/v1/chats/[slug]/index.post.ts`, `title.patch.ts`, and
`server/api/v1/gateways/[gateway]/models.get.ts`. There is no single source
of truth for this list today — a follow-up to derive the zod enums from one
exported const (the `model-selection.ts` array is the natural candidate)
would close this gap; until then, grep for `'openrouter'` across `server/` to
find every site that needs a new gateway's id added.

### Selection encoding

```ts
type ModelSelection =
  | { source: 'provider'; modelId: string }
  | { source: 'gateway'; gatewayId: GatewayId; modelId: string }
```

Persisted via `usePreferenceStorage()`'s existing `'model'` key. A bare
string (no leading `{`) parses as a provider selection — zero migration for
every existing stored value. A gateway selection is `JSON.stringify`d (never
colon-delimited: OpenRouter ids legitimately contain both `:` and `/`, e.g.
`anthropic/claude-opus-5:free`). Malformed JSON falls back to treating the
raw string as a provider model id rather than throwing.

### Catalog fetching

Vercel (`https://ai-gateway.vercel.sh/v1/models`) and OpenRouter
(`https://openrouter.ai/api/v1/models`) are public, unauthenticated, and
richly self-describing (pricing, context length, modalities, tool support) —
cached globally in KV, 1 hour TTL, stale-on-upstream-error fallback.

Cloudflare's catalog (`GET /accounts/{account_id}/ai/models/search?format=openrouter`)
is per-account and requires the user's own credentials, so it's cached
per-account with a much shorter TTL (15 minutes), keyed by a hash of the
user's API key (not the raw key, and not accountId alone — a guessed account
ID paired with an unrelated key must never produce a cache hit against
another user's real catalog).

### Price tier and capability signals

`GatewayModel.pricing` (per-token USD strings) resolves to the same
`$`/`$$`/`$$$`/`$$$+` tier enum direct-provider models use, via
`resolveGatewayPriceTier()` in `shared/utils/gateway-pricing.ts`. It reuses
`providers/merge.ts`'s exported `tierCeilingsPerMillionTokens` as the single
source of truth — never re-declare those ceiling numbers elsewhere.
`isGatewayModelFree()` in the same file is a separate, stricter signal (both
input and output must parse to exactly `0`, and missing pricing is never
treated as free) intended for a future "free" filter/badge, not folded into
the tier enum.

`GatewayModel.supportsReasoning`/`supportsWebSearch` are advisory,
best-effort flags populated per gateway from whatever real signal each raw
catalog exposes: Vercel's `tags` array (`'reasoning'`/`'web-search'` —
also the only field surfacing web-search at all, since Vercel's
`supported_parameters` never does) and OpenRouter's `supported_parameters`
array (`'reasoning'`/`'web_search_options'`). **Cloudflare's
marketplace-format catalog has no confirmed field for either** — unlike
`supportsTools`, whose `tools` key the OpenRouter marketplace OpenAPI schema
documents landing in a text output modality's `supported_parameters` map,
nothing in that schema names a reasoning or web-search parameter key. Both
fields are left `undefined` for Cloudflare rather than guessed; `undefined`
always means "unknown," never "no," across all three gateways.

`getGatewayModelProviderPrefix()` in `shared/utils/gateway-model-id.ts`
splits a gateway model id on its first `/` (e.g. `anthropic/claude-opus-5` →
`anthropic`) so a future picker UI can group/filter by the underlying
proxied provider. It is a pure split with no vendor-slug normalization —
Cloudflare's own ids are prefixed `@cf/...`, so it returns `@cf` for those,
not the underlying provider; provider-grouping for Cloudflare needs a
second-segment rule this WP does not add. `app/components/ProviderIcon.vue`
separately normalizes a handful of known vendor-slug variants (OpenRouter's
`x-ai` and its six `~`-prefixed "latest" aliases) to this app's existing icon
keys, falling back to the two-letter badge for every other prefix
(`mistralai`, `qwen`, `meta-llama`, …) since no matching brand icon exists in
this codebase.

### Cost capture

- **OpenRouter**: read synchronously from `providerMetadata.openrouter.usage.cost`.
  Requires `compatibility: 'strict'` **and** `usage: { include: true }` on the
  client — without both, OpenRouter never returns cost data at all. This is
  genuinely instant now on both paths: the persisted DB row (via
  `persistAssistantMessageFromStream`, which awaits `result.finalStep`) **and**
  the live streamed message the client renders immediately, with no reload
  needed. The live path can't `await` anything — `toUIMessageStream`'s
  `messageMetadata` callback is synchronous and its return value is never
  awaited by the AI SDK, so a naive `onEnd`-closure capture doesn't work: an
  empirical check (constructing a real `streamText()` call against a mock
  model and logging call order) showed `messageMetadata`'s `finish` branch
  fires *before* `onEnd`, not after. The actual fix reads `providerMetadata`
  off the per-step `finish-step` chunk instead, which is part of the same
  `result.stream` `messageMetadata` already consumes and is guaranteed to
  arrive before the terminal `finish` chunk (every send in this app is
  single-step today, direct-provider or gateway, since nothing anywhere sets
  `stopWhen` and `streamText()` defaults to `stopWhen: isStepCount(1)`). See
  `resolveLiveGatewayCost()` in `server/api/v1/chats/[slug]/index.post.ts`.
  **This ordering is observed behavior of `ai@7.0.56`, not a documented
  contract** — the SDK's own public type for `messageMetadata` claims it only
  fires on `start`/`finish`, which the `finish-step` firing already
  contradicts. A future `ai` version bump (the dependency is pinned with a
  caret range) could silently change this; re-run the empirical check above
  after any `ai` upgrade before trusting live gateway cost display again.
- **Vercel**: `providerMetadata.gateway.generationId` → `client.getGenerationInfo({id})`,
  scheduled via the existing `waitUntil` background-completion mechanism
  (same pattern as push notifications / Axiom shipping). Cost lands on the
  message after the response has already streamed back — this is a real,
  disclosed limitation, not a bug: there is no cost value obtainable
  synchronously at stream-finish time for Vercel, live or persisted, so
  `resolveLiveGatewayCost()` deliberately excludes it and it keeps behaving
  exactly as before.
- **Cloudflare**: no per-request cost API exists, but as of this fix
  `totalCost` is no longer always unset — `estimateGatewayMessageCost()` in
  `shared/utils/gateway-pricing.ts` multiplies the turn's real
  input/output token counts by the model's own catalog `pricing.input`/
  `pricing.output` (per-token USD strings) to produce a token-based
  **estimate**, on both the persisted row and the live streamed metadata.
  `MessageUsage.costEstimated` is set alongside it, which
  `ContextMenu.client.vue`'s `hasEstimatedCost` computed already renders as
  "Cost (estimated)" rather than "Cost". When the model isn't in the catalog
  or has no `pricing` (a catalog miss, an unpriced model, an upstream
  outage), the estimate — and `totalCost` — stays unset exactly as before;
  no fallback number is ever guessed.

`MessageUsage.totalCost` is a new optional field read by
`shared/utils/message-metadata.ts`'s cost-display logic in preference to the
input/output split used for direct-provider models (a gateway reports one
blended total, not a token-priced breakdown).

### Max output tokens capping

`streamText()`'s top-level `maxOutputTokens` option was never set for any
send, direct-provider or gateway, letting the AI SDK/provider default apply.
OpenRouter self-caps/negotiates a safe value server-side and tolerates this;
Vercel AI Gateway and (presumably, untested live) Cloudflare AI Gateway do
not, and the underlying model rejects a request for more output tokens than
it actually supports (confirmed live: `qwen3-14b` through Vercel AI Gateway
hit `max_tokens=65536 cannot be greater than max_model_len=40960`, while the
same model worked through OpenRouter on the same account).

The fix caps `maxOutputTokens` for **Vercel and Cloudflare only**, sourced
from the selected model's own `GatewayModel.maxOutputTokens` catalog entry
(`findGatewayCatalogModel()` in `server/utils/gateways/catalog.ts`, called
once per builder invocation and reused for `pricing` too — a cache hit in
the common case, since a user only ever sends to a model they already saw
in the picker). `GatewayChatResult.maxOutputTokens` carries the resolved
value (or stays `undefined` on a catalog miss or a model with no known
`maxOutputTokens` — never a guessed fallback) from `useVercelGateway`/
`useCloudflareGateway` into `index.post.ts`, which passes it straight
through as `streamText({ maxOutputTokens })`. The same cap is applied to
title generation (`useChatTitle`'s new optional third parameter) for
consistency, though that codepath's tiny output size makes it unlikely to
ever hit this limit in practice.

**OpenRouter is deliberately left uncapped.** It already handles this
correctly today, and OpenRouter's own advertised
`top_provider.max_completion_tokens` can be *lower* than a model's real
output capacity for a specific routed upstream (observed: `8192` vs a
documented 131k context for the same model on some upstreams) —
introducing an explicit cap there risks newly truncating outputs that work
fine today. This is a reasoned, permanent exclusion, not an oversight; see
the comment at the `maxOutputTokens: gatewayMaxOutputTokens` cap site in
`index.post.ts`'s `streamText()` call before "fixing" it.

No live Vercel/Cloudflare key was available in this development environment
(BYOK keys are stored per-user in D1, entered through the app UI — nothing
in `.dev.vars`), so the actual capped request no longer 400s was verified by
unit test (`tests/unit/utils/gateways/{vercel,cloudflare}.spec.ts`,
`tests/integration/api/chats-gateway.spec.ts`) and code inspection only, not
against a real account. This is a documented gap in "Known gaps requiring
live verification" below, same category as the pre-existing gateway gaps.

### Telemetry

`providerId`/`modelId` stay flat top-level fields on the existing Axiom wide
events (routing new provider/gateway ids through them costs zero new schema
fields — field *names* count against Axiom's 256-field cap, not field
*values*). Gateway-specific detail (`gateway`, `gatewayProvider` — the
underlying proxied provider, derived as `modelId.split('/')[0]` —, and
`gatewayModel`) is nested under the already-declared `attributes.chat.*` map
field per `docs/axiom-map-fields.md`'s convention. No new top-level flat
field was introduced; `scripts/axiom-declare-map-field.mjs` does not need to
run again.

### No-key UX gating

`useUserKeys()` (`app/composables/user-keys.ts`) fetches
`GET /api/v1/profiles/keys` once into shared state and fails **open** while
loading/erroring — a slow network must never flash every model as disabled.
Every provider/gateway is gated generically by iterating `enabledGateways`/
`providerMeta`, so Cloudflare (and any future gateway) is gated for free with
zero picker-side code changes. Server-side, the original 401-at-send-time
remains the real enforcement backstop; the picker gating is UI guidance only.

## Known gaps requiring live verification

None of these were verified against a real account/credential in the
development environment (no live API keys were available). Each was flagged
by its own PR's review and confirmed still open by the final cross-PR review:

1. **Real streamed chat completions** through all 8 new direct-provider
   models and all 3 gateways — `pnpm run preview` (workerd) with real keys.
2. **Cloudflare's catalog response shape** — the normalizer is built against
   OpenRouter's own published OpenAPI schema for the "marketplace" format
   Cloudflare's docs say `format=openrouter` returns, but this was never hit
   against a live Cloudflare account. Whether the endpoint paginates
   (`page`/`per_page` params are documented) is also unconfirmed.
3. **Cloudflare model id compatibility** — whether ids returned by the
   catalog endpoint match what the `/ai/v1/chat/completions` endpoint expects
   for `client.chatModel(modelId)` is unverified.
4. **Vercel's `providerMetadata.gateway.generationId`** — `@ai-sdk/gateway`
   is a transparent proxy; this field is injected by Vercel's backend, not
   observable from installed package source.
5. **Cloudflare token scope** — Cloudflare's own docs are inconsistent on
   whether a "Workers AI Read"-only token suffices or Read+Edit is required.
6. **The `maxOutputTokens` cap actually clearing the Vercel/Cloudflare 400**
   — verified by unit test and code inspection only (see "Max output tokens
   capping" above); never sent against a real Vercel or Cloudflare account.
7. **OpenRouter's live (pre-reload) `usage.totalCost`** — the fix relies on
   an empirically-confirmed AI SDK v7 chunk-ordering guarantee (`finish-step`
   before `finish` on `result.stream`) and a mocked-integration test that
   exercises the real `messageMetadata` implementation, but was never
   confirmed against a real OpenRouter response in a browser.

**Recommended pre-production gate**: one manual smoke test — one real key per
gateway, open its catalog in the picker, send one message, confirm an Axiom
event with the expected `attributes.chat.gateway*` fields — closes all seven
items at once (send through Vercel/Cloudflare with a model whose catalog
`max_tokens` is below its account-level default to also exercise item 6, and
watch the OpenRouter message's context menu before reloading to exercise
item 7).

## Known limitation (disclosed, not fixed)

Regenerating the first message of a conversation after switching from a
direct-provider model (sent with tools requested) to a gateway model can hit
the tool-rejection 400, because the server reads `selectedTools` from the
*persisted first message* when the conversation has exactly one message —
even though the client-side capability watcher already cleared the tools
toggle for gateway mode. Narrow (only the very first message of a
conversation, only when switching models mid-session) and graceful (a clear
error, not a crash or silent failure), left as a known edge case rather than
fixed, since closing it fully requires stripping first-turn tools
server-side specifically for a gateway-model regenerate — a small feature in
its own right.

An image attached earlier in a conversation under a vision-capable model can
still reach the provider raw on a *later* turn if the user regenerates that
same message after switching to a non-vision model mid-session —
`sanitizeMessagesForModelContext()` in
`server/utils/files/assistant-files.ts` only replaces file parts with an
"omitted" text placeholder for non-latest user messages; the latest user
message's file parts are always kept as-is regardless of the currently
selected model's vision support, since there's no new attach action for the
client-side gate to intercept. Closing this fully requires threading the
selected model's (or, for gateways, its catalog entry's) modality data into
`sanitizeMessagesForModelContext()` before it runs — for gateways this also
means resolving the catalog entry earlier in `index.post.ts`'s request flow,
before `messagesForAI` is built, not just inside `useGateway()`'s builders as
this fix does for `maxOutputTokens`/`pricing`. Left as a disclosed gap
rather than folded into this fix: Cloudflare's catalog exposes no modality
data at all regardless (see "Price tier and capability signals" above), so
this wouldn't close the gap for Cloudflare specifically — the friendly
error normalization in `server/utils/chats/errors.ts`
(`looksLikeImageInputRejection`) is the safety net for that case and for any
other model whose vision support this app doesn't yet know.

## Owner action items

Nothing is required to deploy. Specifically:

- No new secrets or environment variables — this remains 100% BYOK.
- No destructive migrations — every schema change across all 7 PRs was a
  purely additive `ALTER TABLE ADD COLUMN` or a TS-only enum widening with no
  SQL-level change.
- The live-verification gate above is a strong recommendation, not a hard
  deploy blocker — BYOK means a failure only affects the specific user
  testing a specific gateway, not the app as a whole.
