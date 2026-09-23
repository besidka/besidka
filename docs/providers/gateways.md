# Gateways: Vercel AI Gateway, Cloudflare AI Gateway, OpenRouter

Besidka's BYOK model catalog has two independent halves that are never
merged into one data structure: **direct providers**
([`general.md`](./general.md), curated, build-time, models.dev-backed) and
**gateways** — this file — uncurated, runtime-fetched, per-user. A gateway
routes a chat send through a third-party proxy (Vercel AI Gateway, Cloudflare
AI Gateway, or OpenRouter) using the user's own account with that gateway,
rather than a direct per-provider key. `docs/providers/general.md`'s
cross-cutting architecture (the multi-step tool loop, no-key UX gating) is
shared with gateways and linked from here rather than repeated.

This is a from-scratch rewrite of a doc that existed before gateway support
was removed and later restored (`docs/gateway-removal-plan.md` has that
history). Every fact below was verified against the code currently on this
branch; nothing here is transcribed from the old doc without a fresh check
against the installed packages or the current source.

## Naming — the three-id-space trap

Three different id spaces exist for the same three gateways, and conflating
them produces a silent "key never found" failure rather than a crash:

| Concept | Values | Single source of truth |
| --- | --- | --- |
| `GatewayId` | `'vercel'`, `'cloudflare'`, `'openrouter'` | `shared/utils/gateways.ts`'s `gatewayIds` const; the type itself is `typeof gatewayIds[number]` in `shared/types/gateways.d.ts` |
| `keys.provider` DB enum | `'vercel-gateway'`, `'cloudflare-gateway'`, `'openrouter'` — note OpenRouter needs **no suffix** | `shared/utils/provider-meta.ts`'s `providerMeta[gatewayId].keyProviderId` |
| The mapped value used for telemetry/DB lookups | same three strings as the row above | `keyProviderIdForGateway(gatewayId)` in `server/utils/gateways/index.ts` |

`keyProviderIdForGateway()` is the **only** place this mapping is written.
Every gateway builder
(`server/utils/gateways/{vercel,openrouter,cloudflare}.ts`) resolves its DB
key lookup through it — never a hardcoded literal — and the mapped value is
also what every gateway send sets as `telemetryProviderId`
and `originProvider` on generated files, never the bare `GatewayId`.

`gatewayIds` and `GatewayId` are deliberately split across a `.ts` and a
`.d.ts`: Nuxt's auto-import scanner dedupes by symbol name across
`shared/utils/*.ts` and `shared/types/*.d.ts`, and declaring both the const
and a re-exported type in one file triggered a "Duplicated imports" warning
during this restoration. Before that fix, this const was independently
duplicated in four separate places — mentioned here only as historical
context for why the split file structure looks unusual, not because the old
duplication still exists.

**`gatewayIds` now also drives every zod validator that needs a `GatewayId`
enum** — `server/api/v1/chats/[slug]/index.post.ts`, `title.patch.ts`, and
`server/api/v1/gateways/[gateway]/models.get.ts` all build their `gateway`
field with `z.enum(gatewayIds)`, and `shared/utils/model-selection.ts`'s
`isGatewayId()` guard imports the same const. Adding a fourth gateway
therefore only needs a **manual** addition in two places beyond `gatewayIds`
itself: `shared/utils/provider-meta.ts`'s `enabledGateways` array (the
gateway-listing UI order, a deliberate product decision, not alphabetical)
and a new `providerMeta` entry for it. Reserve the `GatewayId`/`keys.provider`
values first, then wire the feature, then add the id to `enabledGateways`
last — that ordering is what lets a future gateway land without a flag day.

## Catalog fetching

Vercel (`https://ai-gateway.vercel.sh/v1/models`) and OpenRouter
(`https://openrouter.ai/api/v1/models`) are public, unauthenticated, and
richly self-describing (pricing, context length, modalities, tool support).
Both are cached globally in KV for one hour, with a stale-on-upstream-error
fallback.

Cloudflare's catalog is per-account and requires the user's own credentials,
so it's cached per-account with a 15-minute TTL instead — long enough to
avoid an uncached passthrough on every picker open, short enough that adding
a model to a Workers AI account doesn't stay invisible for long.

The cache entry is versioned (`GATEWAY_CATALOG_SCHEMA_VERSION` in
`server/utils/gateways/catalog.ts`, currently `'v3'`) and bumped whenever
`GatewayModel`'s shape changes in a way an old cached entry wouldn't carry —
this restoration's own round added the required `toolCall` field, which
older cached entries never wrote at all, so the version was bumped to avoid
serving stale-shaped data for up to the TTL after deploy.

### Cloudflare's two-format join

Cloudflare serves its `GET /accounts/{account_id}/ai/models/search` endpoint
in two shapes, and `fetchCloudflareGatewayCatalog()`
(`server/utils/gateways/catalog.ts`) fetches **both and joins them**, because
neither is sufficient alone:

- `?format=openrouter` — the marketplace projection `GatewayModel` is built
  around. Carries ids, names and descriptions, but no pricing, tool-calling
  or reasoning data.
- the default format (no `format` param) — Cloudflare's own model objects,
  whose `properties[]` array is the only place pricing, `function_calling`
  and `reasoning` are exposed.

**The identity relationship between the two is inverted — the join key
trap.** In the marketplace shape, `id` is the real `@cf/vendor/model`
string. In the default shape, `id` is an internal UUID, and that same
`@cf/vendor/model` string lives in `name` instead. The join key is therefore
`marketplace.id === default.name` — joining on `id === id` silently matches
nothing, and a naive reading of Cloudflare's own docs will get this
backwards.

Only the marketplace fetch is load-bearing: its failure propagates so the
KV stale-cache fallback still applies. The enrichment fetch is best-effort
and degrades to an unenriched catalog on any problem — a non-2xx response, a
network throw, an unexpected envelope, a model absent from the join, or a
malformed property value — never blocking a model from rendering with at
least its id and name. Coverage is logged as `gatewayCatalogEnrichment`
(`models`/`matched`/`priced` counts, with failures under
`gatewayCatalogEnrichment.error`), since this join cannot be reproduced
locally without real account credentials.

Cloudflare declares every `properties[].value` as a string, but only some
actually are: `context_window`/`function_calling`/`reasoning` arrive as
`"128000"`/`"true"`, while `price` arrives as a real JSON array. Every reader
coerces rather than trusts, and yields `undefined` on anything it doesn't
positively recognize; enrichment only ever backfills a value the marketplace
response didn't already provide.

This fetch hits the Workers AI account API
(`api.cloudflare.com/client/v4/accounts/{id}/ai/models/search`), **not** the
AI Gateway reverse-proxy endpoint — see "Cloudflare's two-product
distinction" below for why that distinction matters and is easy to get
backwards from Cloudflare's own docs.

## Cost capture

Each of the three gateways reports cost through a different mechanism, and
`resolveLiveGatewayCost()` (`server/api/v1/chats/[slug]/index.post.ts`) is
the single dispatcher both the live-streamed message metadata and the
persisted DB row call, so the two can never disagree.

- **OpenRouter**: cost is reported synchronously in
  `providerMetadata.openrouter.usage.cost` — a plain number — read by
  `readOpenRouterCost()` (`server/utils/gateways/index.ts`).
  `compatibility: 'strict'` and `usage: { include: true }` are set on every
  OpenRouter send, but a 4-way matrix test against the installed
  `@openrouter/ai-sdk-provider@3.1.0` confirmed neither option is actually
  *required* to get cost back — all four combinations of the two returned a
  cost. That requirement applied to the older `3.0.0` this app used to run;
  both options are kept anyway since they cost nothing and guarantee other
  extended response fields. If a future OpenRouter send is missing cost, do
  not assume one of these options was dropped — that isn't the failure mode
  anymore.
- **Vercel**: cost is *also* reported synchronously, as of this restoration
  — read from `providerMetadata.gateway.cost`, a **decimal string** (unlike
  OpenRouter's number), by `readVercelGatewayCost()`. This corrects the
  original design, which relied solely on an async
  `client.getGenerationInfo()` follow-up call
  (`persistVercelGenerationCost()` in `server/utils/gateways/vercel.ts`).
  That call is now only a **fallback** for a response that omits the
  synchronous field: measured real-world latency for `getGenerationInfo()`
  to succeed was around 12 seconds (failed attempts at +0.3s/+2.5s/+5.0s/
  +7.4s/+9.7s, succeeded at +12.0s), but the original fallback only retried
  once after 1.5s — meaning every real Vercel send would have silently lost
  its cost. The fallback's retry window is now widened to roughly 15s (8
  attempts, 2s apart), inside the 30-second `waitUntil` budget it runs
  under, and it re-reads the message row first and stops if a `totalCost`
  is already there — so it costs nothing on the normal (synchronous-cost-
  present) path.

  `providerMetadata.gateway` carries `cost`, `marketCost`, `surchargeCost`,
  `gatewayCost`, and `inferenceCost`. Confirmed via a live send bundling
  `client.tools.perplexitySearch()` (which forces the fields to diverge):
  `cost`/`marketCost`/`gatewayCost` all read `0.00522065`, while
  `inferenceCost` read `0.00022065`. `cost` matched
  `getGenerationInfo().totalCost` exactly. **`inferenceCost` is the
  token-only subset and silently drops a bundled search fee — never read it
  for total cost.** `marketCost`/`gatewayCost` only agree with `cost` while
  `surchargeCost` is zero, so neither is a safe substitute; `cost` is the
  only field to use, and it's the one `readVercelGatewayCost()` reads.

  Decimal-string parsing is deliberately defensive: a missing,
  non-string/non-number, or unparseable value resolves to `undefined` —
  **never `0`** — including the specific empty-string trap where
  `Number('')` evaluates to `0` and passes `Number.isFinite`. That was a
  real bug caught in review; the fix guards on `cost.trim() === ''` before
  coercion.
- **Cloudflare**: has no per-request cost field of either kind. Priced by
  estimate instead, via `estimateGatewayMessageCost()`
  (`shared/utils/gateway-pricing.ts`), which multiplies the turn's real
  input/output token counts by the model's own catalog
  `pricing.input`/`pricing.output` (per-token USD strings). The result is
  flagged `costEstimated: true` on the persisted `MessageUsage`, which
  `ContextMenu.client.vue`'s `hasEstimatedCost` computed renders as "Cost
  (estimated)" rather than "Cost". A catalog miss (unpriced model, cold
  cache, upstream outage) leaves the cost unset — no fallback number is ever
  guessed.

`sumGatewayReportedStepCosts()` sums the per-step cost across every AI SDK
step of one send, rather than taking the last step's figure. Each step is
its own `doStream()` call — a separate gateway request with its own
generation id and its own billed cost — so a multi-step send (see the
multi-step tool loop in [`general.md`](./general.md#multi-step-tool-loop))
reports N independent costs that must be added. For a single-step send
(everything reachable today without a `withFollowUpTurn()` tool routed
through a gateway), the sum of one element is exactly what a single read
would have produced.

None of the three mechanisms above adds a separate line item for gateway
image output — see "Gateway image generation" below for why that's
deliberate.

### The double-count guard

`resolveUnbundledSearchUsage()` (`index.post.ts`) exists because a gateway's
*own* web-search mechanism — OpenRouter's `plugins: [{ id: 'web' }]`,
Vercel's `client.tools.perplexitySearch()` — bills its fee straight into the
blended cost described above. If the app also recorded a separate
`searchCost` for the same fee, `sumMessageCosts()` would add
`getPerMessageCost()` (which already prefers `totalCost`) and
`getPerMessageSearchCost()` as independent terms, double-charging on screen.
The guard returns `undefined` for `searchCost` outright whenever `gatewayId`
is set and no external search provider (Brave/Exa) was used — exactly the
case where the gateway's own native `web_search` mechanism ran instead of
a BYOK search tool.

Structurally, a gateway's bundled `web_search` is the only case this guard
needs to cover: gateway image generation is native multimodal output, never
a `tool-generate_image` part, so `getGeneratedImageCostFromParts()` can never
match it; Brave and Exa are always billed on the user's own vendor key,
entirely outside any gateway, so they must always stay a separate line
regardless of routing. The guard is proven non-vacuous by a mutation test:
removing it fails a real assertion in
`tests/integration/api/chats-gateway.spec.ts`, which mocks
`resolveSearchUsage()` to always report a billable search specifically so a
naive, gateway-agnostic version of the guard can't pass with the real one
deleted.

## Gateway reasoning

Every gateway send resolves a `ReasoningLevel` and threads it into
`GatewayChatResult.reasoning`, but the wire-level mechanism is genuinely
different per gateway — deliberately verified against the currently pinned
package versions, not assumed from a prior investigation:

- **OpenRouter needs a settings-level chat field, not the standardized
  top-level `streamText({ reasoning })` option** every direct provider uses.
  Verified directly in the installed `@openrouter/ai-sdk-provider@3.1.0`'s
  `dist/index.js`: `OpenRouterChatLanguageModel.getArgs()` destructures only
  `{ prompt, maxOutputTokens, temperature, topP, frequencyPenalty,
  presencePenalty, seed, stopSequences, responseFormat, topK, tools,
  toolChoice }` from the standardized call options — `reasoning` is not
  among them, so the SDK's standardized reasoning option is silently dropped
  for OpenRouter. Instead, the same `getArgs()` sets the outgoing
  `reasoning` request field from `this.settings.reasoning` — a **chat
  setting**, the same mechanism `plugins` already uses for web search.
  `useOpenRouterGateway()` builds `reasoning: { effort }` on the
  `openrouter.chat(model, settings)` instance accordingly.
  `toReasoningEffort()` (`server/utils/providers/reasoning.ts`, the exact
  function every direct-provider builder already calls) maps this app's
  `ReasoningLevel` down to the effort string. Title generation deliberately
  builds a separate instance with no `reasoning` setting, the same reason it
  excludes `plugins` — a title generation must never carry the cost of a
  chat-level reasoning request.
- **Vercel needs no per-provider mapping at all.** `@ai-sdk/gateway`'s
  `GatewayLanguageModel` is a transparent proxy: its `doStream()`/
  `doGenerate()` forward the *entire* standardized call-options object,
  `reasoning` included, straight through to Vercel's backend as the request
  body. Vercel's own backend then translates that single effort level into
  each routed provider's native reasoning shape. `useVercelGateway()`
  therefore makes no changes to `getInstance()` — it only returns
  `reasoning: toReasoningEffort(...)` for the call site to pass through the
  same top-level `streamText()` option every direct-provider builder already
  sets.
- **Cloudflare gets no functional reasoning mechanism at all.**
  `useCloudflareGateway()`'s signature doesn't even accept a reasoning
  parameter, and `GatewayChatResult.reasoning` stays `undefined` for every
  Cloudflare send. `isGatewayReasoningSupported()`
  (`shared/utils/gateway-capabilities.ts`) is the single policy both the
  chat-input reasoning toggle and the server-side `reasoningLevel`
  resolution consume — `true` for OpenRouter and Vercel, `false` for
  Cloudflare — so the toggle and the send-path gate can never drift apart.
  This is a deliberate policy choice, not a gap: Cloudflare's `@cf/` catalog
  exposes a `reasoning` capability flag for badge purposes only, with no
  working control behind it.

## Web search resolution

`GatewayModel.supportsWebSearch: 'native' | 'universal' | undefined`
(`shared/types/gateways.d.ts`) is resolved by
`resolveGatewayWebSearchSupport()` (`shared/utils/gateway-capabilities.ts`):

- `'native'` means the *routed* provider itself supports search, per the
  gateway's own raw catalog signal — Vercel's `tags` array containing
  `'web-search'`, or OpenRouter's `supported_parameters` array containing
  `'web_search_options'`.
- `'universal'` means the *gateway itself* searches on the model's behalf
  via its own plugin/tool, billed separately per search — OpenRouter's
  `plugins: [{ id: 'web' }]` (works on any routed model) or Vercel's
  gateway-executed search tools (`client.tools.perplexitySearch()`).
- `undefined` for Cloudflare always, and for any model the resolution logic
  can't positively classify. Never treat `undefined` as "confirmed no" —
  only as "the catalog didn't say" or "not applicable to this gateway."

Both resolutions are gated through `isGatewayToolAllowed()` first (see
"`GatewayModel.toolCall`" below for the distinct Brave/Exa gate) — a gateway
whose policy denies `web_search` can never earn a badge the send-path gate
would then reject, even if its raw catalog happens to report a native
signal.

**Title generation never carries a gateway's own web-search mechanism.**
`title.patch.ts` calls `useGateway(gatewayId, userId, model, [], 'off')` with
an *empty* `requestedTools` array, and OpenRouter's title-generation instance
is built with only `{ usage: { include: true } }` — it never reads whether
web search was requested at all, so a title generation can never carry
`plugins` (or, on Vercel, the search tool) regardless of what the original
chat requested. A title generated for a gateway chat never incurs a second,
silent search fee.

## `GatewayModel.toolCall` — the Brave/Exa gate

`GatewayModel.toolCall: boolean` (always defined, unlike the advisory,
optional `supportsTools?: boolean`) is the gateway counterpart of
direct-provider `Model.toolCall`. It gates whether Brave or Exa may be
offered or accepted on a gateway-routed model — without it, a model that
can't call tools would still run (and bill, on the user's own Brave/Exa key)
a search the model could never see the result of.

Resolution differs per gateway. Vercel and Cloudflare get `toolCall` "for
free" from the same catalog lookup they already perform for
`maxOutputTokens`/`pricing`. OpenRouter deliberately caps and prices
nothing, so its catalog lookup for `toolCall` is **conditional** — only
performed when `requestedTools` actually includes an external search tool
(`isExternalWebSearchTool()`) — so an ordinary OpenRouter send never pays a
cache read (or, on a cold cache, a full catalog fetch) it doesn't need.

The gate is enforced in two places that must agree:

- **Server-side**, `index.post.ts` rejects with a 400
  (`gatewayToolCall !== true`) when a gateway send requested Brave or Exa.
  This check is placed *after* the provider-selection `try`/`catch` block —
  placing it inside would let `normalizeChatError`'s fallback silently
  replace the structured `why`/`fix` with generic defaults, a real bug
  caught and fixed during development.
- **Client-side**, `chat-input.ts`'s `isToolCallingSupported` reads
  `gatewayModel.value?.toolCall === true`, fail-**closed** before the
  catalog has loaded, so the option never appears offerable ahead of a send
  the server would then reject.

**Brave/Exa are not gated by the same allowlist as `web_search`/
`image_generation`.** `GATEWAY_TOOL_POLICY`
(`shared/utils/gateway-capabilities.ts`) still exists and still allowlists
exactly those two tools per gateway (`isGatewayToolAllowed()`) — it was
never removed or replaced. Brave and Exa bypass that allowlist entirely:
`isProviderResolvedTool()` (`index.post.ts`) filters them out of every
`isGatewayToolAllowed()` check, because they're resolved by this app itself
from the user's own key, never a capability a gateway's own catalog can
allow or deny. Applying `GATEWAY_TOOL_POLICY` naively to Brave/Exa would
reject every such request on every gateway, since the policy only lists
`web_search`/`image_generation`. The `toolCall`/400 mechanism above is their
actual gate.

## Gateway image generation

`image_generation` is a real, working capability for OpenRouter and Vercel,
but it is **not** an AI SDK tool call — it's each gateway's own native
multimodal-output mechanism, single-step by construction (no tool, no
`stopWhen`):

- **OpenRouter** needs the chat-completions request parameter `modalities:
  ['image', 'text']`. This is not a typed field on the installed
  `@openrouter/ai-sdk-provider@3.1.0`'s `OpenRouterChatSettings` (confirmed
  absent from the package's `dist/index.d.ts`), so `useOpenRouterGateway()`
  sends it through `extraBody`, which `getArgs()` spreads onto the outgoing
  request body verbatim — the same escape hatch a typed SDK needs for any
  raw body field it doesn't model. A returned image arrives as
  `choice.message.images[]`, which the installed provider maps to ordinary
  AI SDK `file` content parts — the same generic UI file-part rendering path
  this app already uses for attachments and direct-provider generated
  images, so no client rendering changes were needed for this path.
- **Vercel** takes no request parameter at all — the model id itself
  (`google/gemini-*-image`) is the only configuration. Images surface in
  `result.files`, and at the streaming-chunk level as the same `file`-type
  chunks the OpenRouter path produces.

`buildChatInstructions()` in `index.post.ts` branches on whether the send is
a gateway send: direct providers still get the "call `generate_image`
exactly once" wording, which would actively mislead a gateway send (there's
no tool to call), so gateway sends get prose describing native image output
instead.

**Persistence is the real work**, because gateway image output has no tool
wrapper. It arrives as a plain `file` UI part carrying an inline
`data:<mediaType>;base64,<...>` URL straight from the AI SDK's own
file-chunk mapping. Left alone, that base64 blob would land verbatim in the
persisted `messages.parts` JSON column — unbounded row growth, no R2
offload, no `files` table record. `persistGatewayGeneratedImageParts()`
(`server/utils/files/assistant-files.ts`) closes this: it runs
**unconditionally** for every gateway send's response — never gated on
`requestedTools` including `image_generation`, since an inline image `file`
part on an assistant message can only ever be genuine model output — decodes
the `data:` URL, and reuses the same `validateGeneratedImage()`/
`persistFile()` pipeline direct-provider image generation already uses. It
runs *before* `normalizeAssistantMessagePartsForPersistence()`, which stays
untouched: by the time that function looks for parts whose URL isn't already
`/files/`-prefixed, this step has already rewritten every gateway-generated
image part. It's bounded by `maxGatewayGeneratedImagePartsPerMessage = 4`
and a per-image size cap derived from the existing shared
`maxGeneratedImageBytes`, guarding against a hostile or misbehaving upstream
forcing unbounded decode/R2-write work.

**The read-path guard.** `hasOriginMetadata()`
(`server/utils/files/reconstruct-generated-image-parts.ts`) only allowlists
`originProvider === 'openai' | 'google'` for reconstruction back into a
richer `tool-generate_image` card on chat-history load. A persisted
gateway-origin file must never be reconstructed that way — the client's
`getGenerateImageOutput()` only recognizes those two direct providers and
would silently return `null` for anything else, making the image disappear
on reload. This guard survived the original removal intact and needed no
code changes to be correct again; a gateway-origin file simply keeps
rendering through the plain `file`-part path, which this app's message-part
rendering already treats as first-class image content independent of
whether it came from a tool or a gateway.

**Cost needs no new computation.** Unlike direct-provider image generation,
which needs a static per-model price table because OpenAI/Google's SDKs
report no per-request USD figure for image generation, gateway image cost
requires zero new code: OpenRouter's `usage.cost` and Vercel's `gateway.cost`
are both whole-generation figures that already include any image-output
surcharge. `resolveLiveGatewayCost()`'s result is already the complete total
for a gateway send regardless of modality mix, so no separate image-cost
add-on is ever applied on top of it — doing so would double-count.

**Two deliberately accepted gaps, inherited rather than introduced:**

1. **No aspect-ratio control.** Direct-provider image generation exposes
   `aspectRatio` through the `generate_image` tool's own input schema.
   Gateway image generation has no tool and therefore no input schema to
   carry that parameter — the model picks its own output dimensions from
   the prompt alone.
2. **No per-user concurrency lease/cooldown**, unlike direct-provider
   generation's `acquireImageGenerationLease()`. By the time
   `persistGatewayGeneratedImageParts()` runs, the image has *already* been
   generated and billed on the user's own gateway key — rejecting the save
   at that point would discard something the user already paid for, a
   materially different trade-off than the direct-provider case (where the
   lease blocks *before* any spend happens). A per-image size bound and a
   per-message image-count cap (both described above) still bound the
   decode/R2-write cost of a single request.

**New in this restoration, not previously documented anywhere:** the live
stream still carries the inline `data:` blob until the message is reloaded
— persistence rewrites the *persisted* copy, not the live client-stream tee,
which is split off before the persistence branch runs. A gateway-generated
image therefore renders from a raw base64 blob immediately after
generating, and from a `/files/...` URL only after a reload. This is the
current, working design, not a defect, but it's a visible behavior
difference from direct-provider generation worth knowing about before
debugging a report that a gateway image "looks different" right after it's
generated.

## Max output tokens capping

`streamText()`'s top-level `maxOutputTokens` option was historically never
set for any send, direct-provider or gateway, letting the AI SDK/provider
default apply. OpenRouter self-caps/negotiates a safe value server-side and
tolerates this fine; Vercel AI Gateway and Cloudflare AI Gateway do not —
the underlying model rejects a request for more output tokens than it
actually supports (observed live: a model routed through Vercel AI Gateway
hit a `max_tokens` value greater than the routed model's real
`max_model_len`, while the same model worked fine through OpenRouter on the
same account).

The fix caps `maxOutputTokens` for **Vercel and Cloudflare only**, sourced
from the selected model's own `GatewayModel.maxOutputTokens` catalog entry
via `findGatewayCatalogModel()` (`server/utils/gateways/catalog.ts`), called
once per builder invocation and reused for `pricing` too — a cache hit in
the common case, since a user only ever sends to a model they already saw
in the picker, which just fetched the same catalog.
`GatewayChatResult.maxOutputTokens` carries the resolved value (or stays
`undefined` on a catalog miss or a model with no known `maxOutputTokens` —
never a guessed fallback) into `index.post.ts`, which passes it straight
through as `streamText({ maxOutputTokens })`. The same cap is applied to
title generation for consistency, though that codepath's tiny output size
makes it unlikely to ever hit the limit in practice.

**OpenRouter is deliberately left uncapped.** It already handles this
correctly today, and OpenRouter's own advertised
`top_provider.max_completion_tokens` can be *lower* than a model's real
output capacity for a specific routed upstream — introducing an explicit
cap there risks newly truncating outputs that work fine today. This is a
permanent exclusion, not an oversight.

## Cloudflare's two-product distinction (troubleshooting reference)

This is a genuinely confusing area of Cloudflare's own product surface, and
future debugging will hit it again:

- `gateway.ai.cloudflare.com/v1/<account>/<slug>/<provider>` is the AI
  Gateway **reverse proxy**. It adds logging/caching/observability in front
  of any upstream provider you already have a key for (OpenAI, Anthropic,
  etc.).
- `api.cloudflare.com/client/v4/accounts/{id}/ai/v1` is Cloudflare's own
  **Workers AI** product: a catalog of open-weight models (`@cf/meta/...`,
  `@cf/mistral/...`) that Cloudflare itself hosts and bills for. The
  `cf-aig-gateway-id` header just attaches optional AI Gateway observability
  on top of this second product — it does not change which product is being
  called.

**This app's `useCloudflareGateway()` correctly targets the second one** —
Workers AI's own catalog, with gateway observability layered on. This is the
intended design, not a bug. A token scoped for AI Gateway management does
**not** automatically carry Workers AI inference permission — they are
separate grants on the same Cloudflare account.

**Owner action items:**

1. **Closed (2026-09-23).** The token was updated with **`Account > Workers
   AI > Read`** — the only permission needed; there is no separate "Run"
   permission for Workers AI, and Read covers both the catalog fetch and
   inference. (An earlier version of this doc said "Read + Run"; that was
   wrong.) Verified live with the updated token: `tokens/verify` 200, the
   marketplace fetch 200 with 27 `@cf/*` models, the enrichment fetch 200
   with 65 entries. A 401/403 from a Read-less token (Cloudflare error code
   10000) maps to its own HTTP 403 with a `why` naming the error code and a
   `fix` pointing at the missing permission, instead of the generic "could
   not load" 502 it used to collapse into — see
   `createCloudflareCatalogError` in `server/utils/gateways/catalog.ts`.
2. **Closed.** The available gateway was out of wholesale credits (402);
   credits have since landed — a proxy call through the `besidka` gateway
   returned 200 (~$7.5e-7 billed).
3. **Closed.** `@cf/meta/llama-3.3-70b-instruct` returning "no such model"
   was never a catalog bug: that model id doesn't exist. Only
   `@cf/meta/llama-3.3-70b-instruct-fp8-fast` does — the old id was
   hand-typed, not sourced from a real catalog response.

**Billing rule.** The Gateway ID on this app's Cloudflare key also decides
who pays: a gateway funded with credits (`besidka`, for this account) pays
for Workers AI models from those credits. Left blank, requests go through
the account's `default` gateway and bill as regular postpaid Workers AI
usage instead.

**Considered, not built: AI Gateway proxy mode / `compat/models`.** The AI
Gateway reverse-proxy product also exposes its own gateway-scoped listing
and inference path
(`gateway.ai.cloudflare.com/v1/<account>/<slug>/compat/models` and
`.../chat/completions`), authenticated with an AI Gateway token rather than
a Workers AI token — sidestepping the permission in item 1. Not built: it's
a different auth shape than `useCloudflareGateway()` targets, and
`compat/models` is comparatively thin, publishing only an id and a price
with none of the context-length/tool-calling/reasoning fields the
marketplace+default-format join above extracts. Trading one straightforward
permission grant for a thinner catalog format wasn't judged worth it.

**Known gap: the chat send path's own 401/403 mapping.** The error mapping
in item 1 covers only the catalog fetch (`ai/models/search`). The chat send
path (`ai/v1/chat/completions`, driven by `useCloudflareGateway()`'s
builder) hits the same permission wall and returns the same Cloudflare
401/403 for a Read-less token, but its response isn't run through the same
mapping — a rejected send still falls back to whatever `normalizeChatError`
in `index.post.ts` does with an unrecognized upstream error, which is where
a structured `why`/`fix` from a gateway builder gets flattened to a generic
message today. Not closed; the catalog path was fixed first since it's the
fetch the model picker depends on to list a model to send to.

## Live-verification status

State honestly: most of the following was verified by reading installed
package source, unit/integration tests against realistic mocks, or (where
noted) one real API call this session — not a full end-to-end browser
verification across all three gateways.

**Confirmed by a real, live API call this session:**

- Vercel's `providerMetadata.gateway` cost fields (`cost`, `marketCost`,
  `surchargeCost`, `gatewayCost`, `inferenceCost`) are genuinely present on
  a real response and diverge exactly as described in "Cost capture" above,
  observed on a send bundling `client.tools.perplexitySearch()`.
- OpenRouter returns `providerMetadata.openrouter.usage.cost` without
  requiring `compatibility: 'strict'`/`usage: { include: true }`, verified
  by a 4-way matrix test against the live API on
  `@openrouter/ai-sdk-provider@3.1.0`.
- **OpenRouter image generation**, verified by a direct API call with the
  app's exact request shape against `google/gemini-2.5-flash-image`: one PNG
  returned, with real usage/cost recorded. Not yet verified through the
  app's UI end to end.
- **OpenRouter's web plugin**, confirmed live: it runs and its cost is
  blended into the response the same way as other usage, not itemized
  separately (see "The double-count guard"). Citation behavior is
  model-dependent, not a mapping gap — on one send the model ignored the
  injected search results and OpenRouter returned no citations; on another,
  the raw stream carried 10 `url_citation` annotations, all correctly mapped
  to `source` parts.
- **Cloudflare's marketplace + default-format two-format join**, confirmed
  2026-09-23 against a real account with a correctly-scoped token: the
  marketplace fetch returned 27 `@cf/*` models, the enrichment fetch
  returned 65 entries, and this app's own
  `GET /api/v1/gateways/cloudflare/models` returned all 27 with `pricing`
  populated (e.g. `@cf/openai/gpt-oss-120b` input `3.5e-7` / output
  `7.5e-7`) and a strict `toolCall` (`true` for `gpt-oss-120b`/
  `kimi-k2.7-code`/`glm-5.3`, `false` for `llama-3.2-3b-instruct`/
  `llama-guard-3-8b`).

**Still genuinely open, not settled by this restoration:**

- **Vercel image generation is unverified.** The owner's Vercel account is
  on the free tier, which returns HTTP 403 `RestrictedModelsError` ("Free
  tier users do not have access to this model. Upgrade to paid credits…")
  for Gemini image models such as `google/gemini-3.1-flash-image`. This is
  an account-tier restriction, not a code defect — see "Owner action items"
  below.
- **R12 — "does a BYOK gateway strip provider-native web search?" remains
  OPEN.** Nothing in this restoration's testing inspected a gateway
  response for `groundingMetadata`/`server_tool_use`/`web_search_call` on a
  real native-search-through-gateway send. This is the highest-value open
  question flagged by the restoration plan, and it is still unanswered.
- **Cloudflare's live chat send path.** The catalog is now verified (see
  above), but a real chat send through Cloudflare
  (`ai/v1/chat/completions`) has not been. The chat builder is built
  against Cloudflare's own published API shapes and exercised by unit
  tests, but never sent against a live account.
- **OpenRouter's and Vercel's reasoning request shapes**, live. Both are
  verified against the installed packages' type definitions and compiled
  source, and against each provider's current public docs for the
  wire-level request shape, but a reasoning-toggled send was never made
  against a real account in this environment.
- **Whether an xAI model routed through Vercel degrades gracefully when a
  reasoning level is requested** — Vercel's docs say an unsupported provider
  "ignores the option and emits an `unsupported` warning" rather than
  erroring, and xAI is absent from Vercel's own documented reasoning-provider
  table, but this was never independently confirmed live.
- **The `maxOutputTokens` cap actually clearing the Vercel/Cloudflare 400**
  live — verified by unit test and code inspection only (see
  `tests/unit/utils/gateways/{vercel,cloudflare}.spec.ts`,
  `tests/integration/api/chats-gateway.spec.ts`), never sent against a real
  Vercel or Cloudflare account.
- **A multi-step gateway send's per-step cost summing**
  (`sumGatewayReportedStepCosts()`) under a real multi-step send — no tool
  routed through a gateway currently sets the `withFollowUpTurn()` marker
  (Moonshot's Formula-API search and Brave/Exa are direct-provider-only), so
  this path has never actually executed with more than one step live.
- **Whether Vercel's universal search tools emit `source` parts** the same
  way OpenRouter's `url_citation` annotations do — OpenRouter's mapping is
  confirmed in the installed package's source; Vercel's gateway tools have
  no equivalent confirmed mapping.

None of these gaps block a deploy — BYOK means a failure only affects the
specific user testing a specific gateway, not the app as a whole — but they
should be closed with real accounts before treating any of the above as
settled.

## Owner action items

Nothing is required to deploy. Specifically:

- No new secrets or environment variables — this remains 100% BYOK.
- No destructive migrations — see `docs/gateway-removal-plan.md` § 2 for the
  database history and `pnpm run db:generate`'s verification requirement in
  `CLAUDE.md`'s D1 safety section.
- The live-verification gaps above are strong recommendations, not hard
  deploy blockers.
- **Vercel's free-tier restriction (confirmed for Gemini image models) is an
  account issue, not a code issue.** Tier depends on whether the team has
  ever purchased AI Gateway credits, not the remaining balance — the
  monthly free credit still counts as free tier even when nearly full
  (https://vercel.com/docs/ai-gateway/pricing). The free tier includes only
  a subset of models (https://vercel.com/docs/ai-gateway/faq), and BYOK
  does not bypass this — it also requires the paid tier
  (https://vercel.com/docs/ai-gateway/authentication-and-byok/byok).
  `/v1/models` exposes no free-tier/restricted flag across any of its 386
  models, so the picker can't hide these ahead of a send; the app now
  surfaces the 403 as "Your gateway account can't use this model." instead
  of blaming the saved key.
