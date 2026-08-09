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
  client — without both, OpenRouter never returns cost data at all.
- **Vercel**: `providerMetadata.gateway.generationId` → `client.getGenerationInfo({id})`,
  scheduled via the existing `waitUntil` background-completion mechanism
  (same pattern as push notifications / Axiom shipping). Cost lands on the
  message after the response has already streamed back.
- **Cloudflare**: no per-request cost API exists. `totalCost` stays unset for
  Cloudflare sends — token counts are still captured, cost display is not.

`MessageUsage.totalCost` is a new optional field read by
`shared/utils/message-metadata.ts`'s cost-display logic in preference to the
input/output split used for direct-provider models (a gateway reports one
blended total, not a token-priced breakdown).

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

**Recommended pre-production gate**: one manual smoke test — one real key per
gateway, open its catalog in the picker, send one message, confirm an Axiom
event with the expected `attributes.chat.gateway*` fields — closes all five
items at once.

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

## Owner action items

Nothing is required to deploy. Specifically:

- No new secrets or environment variables — this remains 100% BYOK.
- No destructive migrations — every schema change across all 7 PRs was a
  purely additive `ALTER TABLE ADD COLUMN` or a TS-only enum widening with no
  SQL-level change.
- The live-verification gate above is a strong recommendation, not a hard
  deploy blocker — BYOK means a failure only affects the specific user
  testing a specific gateway, not the app as a whole.
