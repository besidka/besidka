# Providers and gateways: xAI/DeepSeek/Moonshot AI/Qwen + Vercel/Cloudflare/OpenRouter

Besidka's BYOK model catalog has two independent halves that must never be
merged into one data structure: **direct providers** (curated, build-time,
models.dev-backed) and **gateways** (uncurated, runtime-fetched, per-user).
This doc is the permanent record of that architecture and the decisions
behind it — it replaces a temporary planning document
(`docs/_wip-plan-providers-gateways.md`) used during development and deleted
once the last PR in the stack landed.

## Direct providers: xAI, DeepSeek, Moonshot AI, Qwen

Added alongside the pre-existing Anthropic/Google/OpenAI providers, following
the exact same pattern documented in `docs/models-data-fetching.md`:
`providers/{xai,deepseek,moonshotai,qwen}.ts` hold curated capabilities,
merged at import time against `providers/data/models-dev-snapshot.json`.

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
  image_generation — re-verified against DeepSeek's official API docs, see
  "Web search across the direct providers" below.
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
- **Qwen**: `qwen3.7-plus` (default/first-listed), `qwen3.7-max`,
  `qwen3.6-flash`. All three get a toggle-only `reasoning` capability
  (`enable_thinking`, see below); `qwen3.7-plus` and `qwen3.6-flash` also
  declare `web_search` while `qwen3.7-max` deliberately does not — see
  "Web search across the direct providers" below for the doc-sourced
  scoping. Deliberately **not** curated
  with the bare `qwen-max`/`qwen-plus`/`qwen-flash`/`qwen-turbo` ids Alibaba's
  own docs lead with: Alibaba's own release notices confirm those unversioned
  names are rolling aliases that get silently repointed to a newer dated
  snapshot over time (e.g. `qwen-plus` → `qwen-plus-2025-07-28`), the same
  "moving target" problem `docs/models-data-fetching.md` already rejected
  OpenAI's `-latest` aliases for. The numbered `qwen3.x` releases are fixed
  point releases instead. The very latest `qwen3.8-max` (released days before
  this was written) was deliberately left out too — its reasoning is a
  three-way `toggle`/`effort` (`low`/`medium`/`xhigh`)/`budget_tokens` choice,
  and mapping this app's `low`/`medium`/`high` levels onto DashScope's
  `xhigh` would need a dedicated translation this app's `ReasoningLevel` type
  doesn't have prior art for. models.dev's own catalog shows all three
  curated models also expose a `budget_tokens` option alongside the toggle —
  this app deliberately wires only `enable_thinking` and leaves
  `budget_tokens` unused, rather than the models having no other option.

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
action items" below.

### Qwen: openai-compatible mechanism, not a dedicated SDK

Alibaba's community `qwen-ai-provider` npm package pins `zod@^3.25.49`
(confirmed via `npm view qwen-ai-provider peerDependencies` at the time this
was added), which conflicts with this app's `zod@^4` line — the same
incompatibility a prior round of this initiative already found and rejected.
DashScope (Alibaba's Model Studio API) has a genuine OpenAI-compatible mode,
so Qwen is wired through the generic `@ai-sdk/openai-compatible` package
instead — the exact same SDK mechanism `server/utils/gateways/cloudflare.ts`
already uses for the Cloudflare AI Gateway, but with `useXai`/`useDeepSeek`'s
direct-provider function contract (its own `keys` table lookup scoped to
`provider: 'qwen'`, returning `{ instance, generateChatTitle, tools,
providerOptions, reasoning }`) rather than the gateway builders' `useVercelGateway`
/`useCloudflareGateway`-style `GatewayChatResult` shape.

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

**Round 4 re-verification (2026-08-09, QW4).** The user raised the same
suspicion again for Qwen's `qwen3.7-max` exclusion, prompting a fresh,
independent re-check against current vendor docs rather than trusting the
round-3 record — see `docs/round4-web-search-tools-plan.md` sections 1.1
(Qwen), 1.3 (DeepSeek) and 1.6 (Cloudflare) for the full evidence trail. All
three conclusions below held with no code change required:

- **Qwen `qwen3.7-max`** — Alibaba's current docs still state
  `qwen3.7-max` supports web search "only" through the Responses API, a
  different surface from the `/compatible-mode/v1/chat/completions`
  endpoint this app calls via `@ai-sdk/openai-compatible` (which has no
  Responses API support at all). The exclusion is a real, verified
  per-tier capability difference, not a mapping bug — closing it for real
  would mean a bespoke second DashScope Responses wiring for one model's
  badge, out of scope.
- **DeepSeek** — the API changelog now extends through 2026-07-31
  (DeepSeek-V4-Flash public beta) and still announces no search, grounding,
  or `enable_search` capability of any kind. Nothing changed since round 3;
  `providers/deepseek.ts` correctly keeps `tools: []`.
- **Cloudflare AI Gateway** — Cloudflare's own web-search documentation
  (fetched 2026-08-09) confirms search now exists through AI Gateway, but
  **only for proxied third-party providers** (Anthropic, OpenAI/xAI via
  Responses API only, Alibaba/Qwen) — explicitly stating "AI Gateway does
  not provide a provider-agnostic web search abstraction." Nothing exists
  for `@cf/` Workers AI models, which are the entire catalog this app's
  Cloudflare integration surfaces (`/ai/models/search`) and sends through.
  The never-badge, always-`undefined` `supportsWebSearch` behavior remains
  the correct, honest representation of a real vendor gap.

None of these three needed a code change; this record exists so round 5
doesn't re-litigate the same question a third time.

**Qwen — implemented.** DashScope's built-in web search is a plain
`enable_search: true` body flag on the same chat-completions endpoint this
app already calls, with an optional `search_options` sibling object — not an
OpenAI-style tool declaration. `useQwen()` therefore wires it through
`providerOptions.qwen` exactly like `enable_thinking`, and its `getTools()`
still returns `{}` (there is no AI SDK tool object and must be no
`toolChoice`). Scoping decisions, all sourced from
`https://www.alibabacloud.com/help/en/model-studio/web-search` (and its
region-tabbed `help.aliyun.com` twin):

- `qwen3.7-plus` and `qwen3.6-flash` appear in the Singapore-region
  "Supported models" table, so they are curated with
  `tools: ['web_search']`. `qwen3.7-max` is **not** flagged: the same doc
  states "Models such as qwen3.7-max support only the web search feature of
  the Responses API" — a different API surface from the
  `/compatible-mode/v1/chat/completions` endpoint this app uses.
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
  into the prompt and billed as ordinary input tokens.
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

**DeepSeek — no first-party mechanism (verified non-fix).** DeepSeek's
developer API has no built-in web search as of 2026-08. Checked: the Chat
Completions reference
(`https://api-docs.deepseek.com/api/create-chat-completion/`) documents no
`enable_search`/`web_search`/`search_options` parameter, and its `tools`
parameter states verbatim "Currently, only functions are supported as a
tool"; the full API change log (`https://api-docs.deepseek.com/updates/`,
2024-05-17 through 2026-07-31, covering every model line through
V4/V4-Flash) never announces a search or grounding feature; and the
chat.deepseek.com consumer app's "Search" toggle is a product feature, not
an API capability — an API request does not browse. One near-miss recorded
so it isn't re-litigated: the Anthropic-compatible endpoint
(`https://api-docs.deepseek.com/guides/anthropic_api`) lists
`server_tool_use`/`web_search_tool_result` content blocks as "Supported" in
its Message Fields table, but its Tools table documents only the
custom-tool schema with no server-tool `type` (nothing like Anthropic's
`web_search_20250305`), so those rows are schema tolerance for conversation
history, not a way to request a server-side search. The only route DeepSeek
offers is generic function calling against a caller-built search backend —
that would be a Besidka-side search integration (with Besidka owning the
search-API bill), not a provider capability. `providers/deepseek.ts`
therefore keeps `tools: []`; don't revisit without new docs evidence.

**Moonshot AI — two documented mechanisms, neither cleanly wireable
(verified non-fix).** Moonshot documents two web-search surfaces (note:
`platform.moonshot.ai` now redirects to `platform.kimi.ai`):

1. The legacy `$web_search` builtin function
   (`https://platform.kimi.ai/docs/guide/use-web-search`): declared as
   `{"type": "builtin_function", "function": {"name": "$web_search"}}`,
   executed on Moonshot's own servers ($0.005 per triggered search), with
   the client required to echo the tool call's arguments back verbatim as a
   `role: "tool"` message carrying both `tool_call_id` and `name`. Both
   curated models (kimi-k2.6, kimi-k3) support it. `@ai-sdk/moonshotai`
   (3.0.30) cannot carry it: the package delegates tool serialization to
   `@ai-sdk/openai-compatible`'s `prepareTools`, which hard-codes
   `type: "function"` for every regular tool and silently **drops**
   provider-defined tools with an "unsupported" warning (verified in the
   installed package source; a GitHub code search of vercel/ai for
   `builtin_function` returns zero results, and the open PR #18449 that
   moves Moonshot onto its own chat implementation is about video input,
   not search). A regular AI SDK tool named `$web_search` would serialize
   as `type: "function"` with a name Moonshot's docs disallow for ordinary
   functions (`$` is builtin-only), and the SDK's outgoing tool-result
   messages omit the `name` field Moonshot requires. The only injection
   point left is rewriting raw request bodies through a custom `fetch` —
   the kind of fragile, live-unverifiable hack this round declined to ship.
2. The newer "Formula API" official tool `moonshot/web-search:latest`
   (`https://platform.kimi.ai/docs/guide/use-official-tools`), which
   Moonshot itself now recommends over `$web_search` for kimi-k3: a
   standard `type: "function"` tool whose declaration is fetched from
   `GET /v1/formulas/{uri}/tools` and whose execution the client triggers
   with a second authenticated call to `POST /v1/formulas/{uri}/fibers`,
   feeding back a possibly encrypted output blob
   (`----MOONSHOT ENCRYPTED BEGIN----…`) as the tool result. This is
   implementable through the AI SDK's ordinary tool path in principle, but
   not in this app today: the chat pipeline's `streamText` call runs a
   single step with no `stopWhen`/continuation (image generation works
   single-step because the tool result IS the deliverable), so the model
   would never get to produce its post-search answer. It would also persist
   opaque encrypted blobs into message parts, and the billing docs
   currently self-contradict ("official tools are currently free for a
   limited time" vs. fiber execution "produces the tool_call billing").
   Enabling a multi-step tool loop is a shared-pipeline change affecting
   every provider — out of scope for this round, and the documented path if
   this is revisited.

**Cloudflare AI Gateway** — see "Tool calling through gateways: web search
wired for OpenRouter and Vercel" in the gateway half of this doc, and the
round-4 re-verification above.

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
every other direct provider and gateway.

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

#### Cloudflare's two-format join

Cloudflare serves the same `/ai/models/search` endpoint in two shapes, and
`fetchCloudflareGatewayCatalog()` fetches **both and joins them**, because
neither is sufficient alone:

- `?format=openrouter` — the marketplace projection the picker's
  `GatewayModel` shape is built around. Carries ids, names and descriptions,
  but **no pricing, tool-calling or reasoning data**.
- the default format (no `format` param) — Cloudflare's own model objects,
  whose `properties[]` array is the **only** place pricing,
  `function_calling` and `reasoning` are exposed.

**The identity relationship between the two is inverted, which is the whole
trap.** In the marketplace shape, `id` is the real `@cf/vendor/model` string.
In the default shape, `id` is an internal UUID and that same
`@cf/vendor/model` string lives in `name`. The join key is therefore
`marketplace.id === default.name` — joining on `id === id` silently matches
nothing, and matching a UUID against a model id must never appear to succeed.

Both fetches live inside the **one** cached unit: the enrichment fetch is not
separately cached and has no TTL of its own, so a picker open costs at most
two upstream calls, once per 15-minute window, against the Worker's
6-simultaneous-connection budget. They are issued in parallel.

Only the marketplace fetch is load-bearing. Its failure propagates so the
stale-cache fallback still applies. The enrichment fetch is best-effort and
degrades to an unenriched catalog on **any** problem — non-2xx, network
throw, unexpected envelope, a model absent from the join, or a malformed
property value. A model always renders with at least its id and name.
Coverage is logged as `gatewayCatalogEnrichment` (`models`/`matched`/
`priced`), with failures under `attributes.gatewayCatalogEnrichment.error`,
since this join cannot be reproduced locally without real account
credentials.

**Property parsing is defensive by necessity.** Cloudflare declares every
`properties[].value` as a string, but only some are: `context_window`,
`function_calling` and `reasoning` arrive as `"128000"`/`"true"`, while
`price` arrives as a real JSON array. Every reader coerces rather than
trusts, and yields `undefined` on anything it does not positively recognise.
Enrichment **backfills only** — a value the marketplace response already
provided is never overwritten.

Price entries look like
`{"unit": "per M input tokens", "price": 0.35, "currency": "USD"}`, i.e. **USD
per million tokens**, while `GatewayModel.pricing` is per-token — hence a
divide by 1e6. An unrecognised unit spelling yields no price rather than a
guess, so an unfamiliar unit costs a missing badge instead of a figure wrong
by six orders of magnitude. Prices are only reported when **both** input and
output resolve.

### Price tier and capability signals

`GatewayModel.pricing` (per-token USD strings) resolves to the same
`$`/`$$`/`$$$`/`$$$+` tier enum direct-provider models use, via
`resolveGatewayPriceTier()` in `shared/utils/gateway-pricing.ts`. It reuses
`providers/merge.ts`'s exported `tierCeilingsPerMillionTokens` as the single
source of truth — never re-declare those ceiling numbers elsewhere.
`isGatewayModelFree()` in the same file is a separate, stricter signal (both
input and output must parse to exactly `0`, and missing pricing is never
treated as free), deliberately not folded into the tier enum: zero dollars
resolves to `$` through the shared ceilings, so a free model would otherwise
carry the cheapest paid tier's badge.

A gateway row shows the tier badge and nothing else about price — the
spelled-out per-million figures live only in the badge's tooltip and in
`GatewayModelDetail.vue`'s spec rows, both via `formatGatewayPriceDetail()`.
A free model shows a green `banknote-x` badge **instead of** the tier badge,
never both.

**Round 4 (2026-08-09) rewrote `supportsWebSearch` from a plain boolean into
a `WebSearchResolution` (`'native' | 'universal' | undefined`)**, because the
round-3 boolean was reading the wrong signal on OpenRouter and Vercel — see
`docs/round4-web-search-tools-plan.md` sections 1.4/1.5/3 for the full
investigation and evidence trail. The policy lives in one shared module,
`shared/utils/gateway-capabilities.ts`, consumed identically by the picker
badge, the chat-input toggle, and the server-side send gate below, so the
three can never drift apart again:

- `'native'` means the gateway's own raw catalog signals that the *routed*
  provider itself supports search — Vercel's `tags` array (`'web-search'`)
  or OpenRouter's `supported_parameters` array (`'web_search_options'`).
  `web_search_options` was previously (mis)read as "can this model search at
  all"; it is documented as a native-search context-size parameter, i.e.
  "this model's provider offers server-side search" — a `'native'` signal,
  nothing more.
- `'universal'` means the *gateway itself* can search on behalf of any
  routed model via its own plugin/tool, billed separately per search:
  OpenRouter's `web` plugin (`plugins: [{ id: 'web' }]`, works on literally
  any model) and Vercel's gateway-executed search tools
  (`client.tools.perplexitySearch()` and friends). Absent a native signal,
  every OpenRouter/Vercel model resolves to `'universal'` unless it is a
  confirmed image-generation model (see below) — a globe on an image model
  would recreate the exact "Image input badge on a generation model"
  mislabeling this same round fixed for the input side.
- `undefined` means neither mechanism exists — always true for Cloudflare,
  whose AI Gateway documents no provider-agnostic web-search abstraction and
  nothing for `@cf/` Workers AI models specifically (re-verified 2026-08-09,
  `docs/round4-web-search-tools-plan.md` section 1.6).

`GatewayModel.supportsReasoning` is unaffected by this round — still a plain
best-effort boolean from Vercel's `tags` (`'reasoning'`), OpenRouter's
`supported_parameters` (`'reasoning'`), or Cloudflare's default-format
`reasoning` property (see "Cloudflare's two-format join" above). A property
that is simply absent for a model also leaves the flag `undefined` —
`undefined` always means "unknown," never "no," across every advisory signal
in this section.

**Badge policy (product decision, 2026-08-09).** Every model that resolves
to either `'native'` or `'universal'` earns the globe chip — the picker no
longer separates "confirmed native search" from "gateway can search this
too" by hiding the badge, since that read as a mapping bug to users
(`docs/round4-feedback.md`). Instead the two are differentiated by
label/tooltip, via `WEB_SEARCH_TOOLTIP` in `gateway-capabilities.ts`:
`GatewayModelItem.vue`'s compact row chip keeps the short "Web search" label
and puts the differentiated string in its `data-tip`; `GatewayModelDetail.vue`
uses the full string as the badge's own visible label, since that panel has
the room and no existing tooltip mechanism. **There is deliberately no
separate cost-hint UI element** — the "via gateway, billed per search"
wording IS the cost hint, matching the existing Qwen search toggle, which
also ships without one.

The chat-input toggle reads the same signal off the cached catalog
(`isWebSearchSupported` in `app/composables/chat-input.ts`), not a fresh
fetch — it is deliberately fail-closed, unlike the vision check, which fails
open. This means a persisted gateway selection (page reload, or resuming a
chat) shows no web-search toggle at all until the picker has fetched that
gateway's catalog at least once in the session; opening the model picker
once is enough, since the fetched catalog is cached across the session.

`GatewayModel.supportsImageGeneration` is a new advisory boolean, derived
from each gateway's own OUTPUT modalities containing `'image'` (Vercel
`modalities.output`, OpenRouter `architecture.output_modalities`, Cloudflare
`output_modalities[].type`) — a genuine image-*generation* model, never
conflated with `modalities.input` (vision, i.e. the model can *receive*
image/video/PDF input). Both lists now separate the two: a violet
`image-plus`/"Image generation" chip for `supportsImageGeneration` (gateway
list) or `hasImageGenerationCapability()` (curated list, unchanged), and an
`eye`/"Vision" chip — deliberately `text-secondary`/`badge-secondary`, not
violet, so the two capabilities never share a color again — for image input,
in **both** the gateway lists (`modalities.input.includes('image')`) and the
curated list (`hasVisionCapability()` in `app/utils/models-picker.ts`, same
underlying `model.modalities.input` data the models.dev merge already
populates). Accepted trade-off: most modern curated models are vision-capable,
so the eye chip now appears on nearly every curated row — a deliberate
product decision (`docs/round4-web-search-tools-plan.md` OQ3), not scope
creep.

Only an explicit `true` (or a resolved web-search value) ever earns a picker
badge. A gateway row renders a `brain`/`text-warning` chip for
`supportsReasoning`, a `globe`/`text-info` chip for `supportsWebSearch`, a
violet `image-plus` chip for `supportsImageGeneration`, and a `secondary`
`eye` chip for vision, matching the direct-provider `ModelItem.vue` palette
for the first two — the picker never claims a capability is absent, only
that one is confirmed present.

**`supportsTools` is deliberately not a row badge.** Measured live, 333 of
OpenRouter's 400 models and 197 of Vercel's 209 report it, so a wrench on
four rows in five separates nothing; it also collided with web search on
`text-info`. It survives in `GatewayModelDetail.vue`, where a full
capability roster is the point, on the deprioritized `badge-neutral`.
Re-adding a row-level wrench re-creates the exact "everything looks the
same" complaint this replaced.

### Tool calling through gateways: web search wired for OpenRouter and Vercel

**As of round 4 (2026-08-09), the blanket gate is gone.** `index.post.ts`
now checks a per-gateway, per-tool policy — `isGatewayToolAllowed()` in
`shared/utils/gateway-capabilities.ts` — instead of rejecting any tool
request routed through a gateway outright: `web_search` is allowed for
OpenRouter and Vercel, `image_generation` stays rejected for every gateway
(actual image generation through a gateway is separate, not-yet-built
functionality — see `docs/round4-web-search-tools-plan.md` LW5), and
Cloudflare rejects everything, matching its `supportsWebSearch: undefined`
badge. The two allowed paths use different mechanics, both single-step-safe
(no `stopWhen`, no tool-execution loop):

- **OpenRouter** passes a *model setting*, not an AI SDK tool:
  `useOpenRouterGateway()` builds the chat instance with
  `plugins: [{ id: 'web' }]` when `web_search` is requested, and the
  returned `GatewayChatResult.tools` stays `{}` — no `toolChoice`. No
  explicit `engine` override is set, so the plugin uses its own
  native-or-Exa default (product decision, 2026-08-09). Title generation
  deliberately builds a *separate* instance with no `plugins` — carrying the
  plugin into title generation would silently charge a second, unwanted
  per-search fee and inject search results into a prompt that never needs
  them.
- **Vercel** returns a *provider-executed tool* in
  `GatewayChatResult.tools`: `useVercelGateway()` attaches
  `client.tools.perplexitySearch()` under the `web_search` key when
  requested, with no `toolChoice` — letting the model decide whether to
  search, the same policy Qwen's `enable_search` toggle already uses. This
  is genuinely single-step: `perplexitySearch()`'s underlying
  `ProviderExecutedTool` is built with no `supportsDeferredResults` flag, so
  it defaults `false` and returns its result in the same generation step
  rather than requiring a follow-up turn — confirmed by reading the
  installed `@ai-sdk/gateway` package source, not assumed. Perplexity is the
  default engine per the product decision recorded above (Vercel's own lead
  option).

The catalog's `supportsTools` flag remains a display-only enrichment
consumed exclusively by `GatewayModelDetail.vue`'s capability roster;
nothing downstream reads it to enable tool calling, and Cloudflare's
`@cf/` catalog still exposes no web-search mechanism of any kind to gate
on — the round-3 observation that "Cloudflare has still no supported tools"
remains accurate for Cloudflare specifically, while OpenRouter and Vercel
have moved on from it.

### Picker: grouping by underlying provider

`getGatewayModelProviderPrefix()` in `shared/utils/gateway-model-id.ts`
splits a gateway model id on its first `/` (e.g. `anthropic/claude-opus-5` →
`anthropic`). `app/utils/models-picker.ts` builds on it with
`getGatewayProviderGroups()` (counts per prefix, most-stocked first, ties
alphabetical) and `sortGatewayModelsByProvider()` (clusters the list in that
same order, then by model name), and
`ChatInput/ModelsTrigger/GatewayProviderRail.vue` renders one icon button per
group down the panel's left edge.

**The rail is vertical, matching `ProviderRail.vue`, by explicit user
request** — it replaced a horizontal `GatewayProviderStrip.vue` that put the
same chips across the top. The strip's original rationale was scale: the
curated catalog has six providers, while OpenRouter reports **58 distinct
prefixes across 400 models** and Vercel 28 across 209, and this codebase has
brand icons for nine vendors only, so most entries are unlabelled two-letter
monograms. That reasoning was overruled in favour of one consistent
provider-separation pattern across direct providers and all three gateways;
the trade-offs it named are real and are handled rather than avoided:

- **Length** — the rail is `overflow-y-auto min-h-0 no-scrollbar`, so 58
  vendors scroll inside the rail instead of stretching the panel past its
  `max-h-[60dvh]`.
- **Tooltips** — the rail deliberately does **not** use daisyUI's
  `tooltip tooltip-right`, which `ProviderRail.vue` still does. A scroll
  container force-computes `overflow-x` to `auto` (see
  `feedback_css_overflow_axis_coercion` and the ContextMenu clipping
  post-mortem), which clips the tooltip's `::before` bubble as it reaches
  past the rail's right edge, with no `overflow-x: visible` escape hatch.
  The rail uses a native `title` instead — browser chrome escapes any
  container. Do not "restore consistency" by adding the tooltip classes
  back; that silently breaks the tooltip rather than erroring.

Both rails carry a count badge per icon: a `badge badge-xs` hung off the
icon's `indicator` wrapper as an `indicator-item indicator-end
indicator-bottom`, capped at `99+` by `formatRailCount()` so it never
outgrows the one-icon-wide rail. In `ProviderRail.vue` a provider with no
API key shows a plain accent dot in that slot instead of a number — there is
nothing to count without a key, and `0` would read as "this provider is
empty" rather than "not connected yet". The gateway rail has no such state:
it renders only once its gateway has a key.

Three rules keep the rail honest:

- It renders only when the catalog has **more than one** distinct prefix, or
  when a favorite exists (the rail also owns the favorites filter in gateway
  mode, so exactly one rail ever occupies the left edge). Cloudflare's ids
  are all `@cf/vendor/model-slug` — `getGatewayModelProviderPrefix()` detects
  that shape and returns the real vendor segment (`meta`, `google`,
  `mistralai`, …) instead of the shared `@cf` namespace, so Cloudflare's rail
  now renders multiple buttons like every other gateway. The single-prefix
  guard still exists for the degenerate case (a two-segment `@cf/vendor` id
  with no model slug, or any gateway whose catalog genuinely only has one
  vendor) — it hides the useless control instead of faking one.
- It hides while a search is narrowing the list (parity with
  `ProviderRail.vue`), and a hidden rail governs nothing: the search
  **suspends** the provider filter rather than compounding with it, exactly
  as `isRailFilterApplied` bypasses the rail in provider mode. The choice
  survives and applies again the moment the field is cleared. A filter no
  visible control can explain is worse than a wider result set.
- `ModelsTrigger.vue` drops an active prefix as soon as the catalog stops
  offering it — the free filter can empty a provider out from under the
  button that selected it. **`getGatewayProviderGroups()` must therefore be
  fed a search-independent list** (`groupableModels`, favorites + free only):
  a provider with no hit for the current search term would otherwise
  disappear from the groups, and that reset would silently discard a filter
  the user set before they started typing. This is also why a rail count
  holds still as the user types, but does still track the favorites and free
  filters.

`app/components/ProviderIcon.vue` normalizes a handful of known vendor-slug
variants (OpenRouter's `x-ai` and its six `~`-prefixed "latest" aliases, plus
Cloudflare's `cloudflareVendorIconOverrides` table — `mistralai`, `qwen`,
`meta-llama`, `deepseek-ai`, `ibm-granite`, `zai-org` and others) to this
app's existing icon keys. A later round's icon-system rewrite gave every
direct provider and gateway a real Iconify logo, so the two-letter-monogram
fallback is now reachable only for a genuinely unrecognized vendor slug
(`nousresearch`, `thebloke`, `defog`, …) with no verified brand icon at all.
That fallback is styled as a fixed-size tinted square rather than bare text
**because gateway rows are its only caller** — an unsized monogram used to
overlap the model name it sat next to.

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
  arrive before the terminal `finish` chunk. See `resolveLiveGatewayCost()`
  in `server/api/v1/chats/[slug]/index.post.ts`.

  **Per-step costs are summed, not last-wins** (superseding this section's
  earlier "every send is single-step" assumption, which the multi-step tool
  loop below invalidated). Each AI SDK step is its own `doStream()` call —
  a separate OpenRouter request with its own generation id and its own billed
  `usage.cost` — so a loop of N steps reports N independent costs that must
  be added. `sumOpenRouterStepCosts()` does that on both paths: live by
  accumulating across `finish-step` chunks, persisted by folding over
  `result.steps`. For a single-step send the sum of one element is exactly
  the value the previous `finalStep`-only read produced, which is what the
  single-step characterization suite pins. Token counts needed no change:
  `finish.totalUsage`, `result.usage` and `onEnd`'s `usage` are all already
  summed across steps by the SDK (`addLanguageModelUsage`).
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

### Multi-step tool loop

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
single-step precisely because its tool result IS the deliverable. Provider-
executed tools (Vercel's `perplexitySearch()`) are doubly safe: the SDK's
continuation condition skips tool calls flagged `providerExecuted: true`.

Nothing in the app sets the marker today — the first user will be Moonshot's
Formula-API search (LW2). The loop is therefore proven by a test-only fixture
tool (`tests/fixtures/follow-up-turn-tool.ts`) driven through the real send
pipeline with a real `streamText` and a `MockLanguageModelV4`; that fixture
must never be wired into a provider or gateway builder.

**Bounds.** `TOOL_LOOP_MAX_STEPS` is 3 (request the tool, answer from the
result, one spare refinement round). `timeout: { totalMs: 540_000, toolMs:
60_000 }` is set on the loop path only: the KV generation-in-progress guard
this route writes expires after 600s, so the loop's total budget must stay
under that — otherwise a client retry arriving after the guard expired would
start a second concurrent generation for the same turn. A tool `execute()`
that throws produces a `tool-error` output, which the model sees and answers
from, so a failing tool terminates the loop rather than retrying it. If a tool
instead *hangs* past `toolMs`, or the whole loop passes `totalMs`, the SDK
aborts the stream: `persistAssistantMessageFromStream()` sees the `abort`
chunk, returns `false` and writes no assistant row, and the KV guard is still
released in the handler's `finally` — so a timed-out loop loses the reply
rather than leaving a half-written one, and the user can resend immediately.

**Persistence and rendering.** Intermediate tool-call/tool-result parts land
in `messages.parts` unchanged: `normalizeAssistantMessagePartsForPersistence`
passes through every part type other than `tool-generate_image`. On the
client, the `v-if` chain in `app/pages/chats/[slug].vue` and
`app/pages/shared/[slug].vue` matches only `tool-generate_image`, error text
and `text`, so an unrecognized tool part renders nothing and throws nothing.
One cosmetic consequence worth knowing before Wave C ships a real tool:
`shouldFitMessageBubble()` returns `false` for any part type outside
`text`/`reasoning`/`step-start`/`file`, so a message carrying a tool part
loses fit-content bubble styling. Deciding how search steps should *look*
(chips, collapsed steps, or nothing) is deliberately left to the work package
that introduces the first real multi-step tool.

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

While the **active gateway** has no key, the picker drops the entire search
and filter row (`models-picker-search-row`) along with the provider strip,
leaving only the key prompt — there is no catalog behind them to search,
filter or group, and an inert search box reads as a broken control rather
than a gated one. Provider mode is unaffected: the curated catalog is always
searchable even on a zero-key account, where the rows carry their own "Key
required" badges instead.

## Known gaps requiring live verification

None of these were verified against a real account/credential in the
development environment (no live API keys were available). Each was flagged
by its own PR's review and confirmed still open by the final cross-PR review:

1. **Real streamed chat completions** through all 11 new direct-provider
   models (8 xAI/DeepSeek/Moonshot AI + 3 Qwen) and all 3 gateways —
   `pnpm run preview` (workerd) with real keys. Qwen carries the same
   unverified-`enable_thinking` risk category as the other three providers'
   reasoning wiring below.
2. **Cloudflare's catalog response shape** — the normalizer is built against
   OpenRouter's own published OpenAPI schema for the "marketplace" format
   Cloudflare's docs say `format=openrouter` returns, but this was never hit
   against a live Cloudflare account. The default-format enrichment half
   (see "Cloudflare's two-format join") is built against Cloudflare's own
   published per-model catalog JSON, also never hit live. Specifically worth
   probing on the first real-account run, via the
   `gatewayCatalogEnrichment` log fields:
   - **`matched` far below `models`** — the two formats would not be
     listing the same set, or `name` is not the join key live.
   - **`priced` far below `matched`** — a price `unit` spelling the
     per-million matcher does not recognise, or one-sided pricing.
   - **Envelope** — the enrichment parser accepts both `{result: [...]}`
     (Cloudflare's usual client/v4 envelope) and `{data: [...]}`; which one
     the endpoint actually returns is unconfirmed.
   - **Pagination** — the enrichment fetch requests `per_page=1000` in a
     single call. Whether the endpoint honours, caps or ignores that
     parameter is unconfirmed; a silent cap would truncate enrichment and
     show up as a low `matched`.
   - **`value` runtime types** — declared as string, but `price` is a real
     array. Other properties could diverge the same way.
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

8. **Qwen `enable_search` on the international endpoint** — the wiring
   follows the Singapore-region docs (agent strategy, the region tab's
   supported-model table), but no live DashScope call was made, and
   Alibaba's docs internally conflict on exactly the two curated models:
   the Singapore tab's supported-models table lists
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
   not rejected when the model chooses not to search.
9. **OpenRouter's `web` plugin cost landing in `usage.cost`** (round 4,
   2026-08-09) — `readOpenRouterCost()` reads
   `providerMetadata.openrouter.usage.cost` the same way it already does for
   token costs, and OpenRouter's docs say the plugin charge is billed on the
   same generation, but this was never sent against a real OpenRouter
   account. Verify the search-toggled send's context-menu cost is visibly
   higher than the same prompt without the toggle.
10. **Vercel's universal search tools actually executing in a single step
    live** — the installed `@ai-sdk/gateway` package's
    `perplexitySearch()`/`exaSearch()`/`parallelSearch()` factories are built
    with no `supportsDeferredResults` flag (defaults `false`, meaning
    same-turn results per the type's own doc comment), which is strong
    static evidence this is genuinely provider-executed and single-step —
    but it was never exercised against a live Vercel account. If a real send
    stalls waiting for a second turn after the tool result, this pivots into
    Wave B's multi-step-loop scope instead of staying a Wave A quick win —
    see `docs/round4-web-search-tools-plan.md` section 6's "QW2 pivot
    condition."
11. **Whether Vercel's universal search tool emits source parts or only
    tool-call/tool-result parts** — OpenRouter's provider maps `url_citation`
    annotations to AI SDK `source` parts (confirmed in the installed
    package's dist source), so its context-menu "Web search" indicator and
    source chips are expected to render for free; Vercel's gateway tools have
    no equivalent confirmed mapping. Not blocking (the send itself still
    works either way), but affects which chips a Vercel search turn shows.
12. **OpenRouter's per-step cost reporting under a real multi-step send**
    (Wave B, 2026-08-09) — the summing in `sumOpenRouterStepCosts()` follows
    from static inspection of the installed `ai@7.0.56` and
    `@openrouter/ai-sdk-provider@3.0.0`: `streamText`'s step flush calls
    `streamStep()` again, which issues a fresh `streamLanguageModelCall()`,
    and the provider builds `providerMetadata.openrouter.usage.cost` purely
    from that one HTTP response's `usage` object — there is no cross-request
    accumulation anywhere in either package, so each step's cost is that
    step's own. Confidence is high and the alternative (a cumulative figure)
    would require OpenRouter to know about a prior, separate, stateless
    chat-completions request. Still unconfirmed live, because no tool sets
    the follow-up marker yet and no multi-step send has ever been made.
    **Confirm on the first real multi-step send** (Wave C's Moonshot search,
    if it is ever routed through OpenRouter): compare the summed
    context-menu cost against the OpenRouter dashboard's total for that
    turn. If it reads roughly double, the per-step figures were cumulative
    and the fold must become last-wins.
13. **Vercel generation-id capture is last-step-only under a multi-step
    gateway send** — `readVercelGenerationId()` still reads
    `finalStep.providerMetadata`, so the background
    `persistVercelGenerationCost()` hop would price only the final step of a
    loop. This is unconstructible today: nothing gateway-side sets the
    follow-up marker, Vercel's search tool is provider-executed (single-step
    by construction), and OpenRouter reports its cost synchronously instead.
    Documented rather than speculatively fixed; revisit only if a Vercel
    gateway send is ever given a marked tool.

**Recommended pre-production gate**: one manual smoke test — one real key per
gateway, open its catalog in the picker, send one message, confirm an Axiom
event with the expected `attributes.chat.gateway*` fields — closes items 1-7
at once (send through Vercel/Cloudflare with a model whose catalog
`max_tokens` is below its account-level default to also exercise item 6, and
watch the OpenRouter message's context menu before reloading to exercise
item 7). Item 8 needs one extra pair of Qwen sends — the same prompt with
the web-search toggle on and off — comparing the two input-token counts in
the context menu. Items 9-11 need one more pair of sends per gateway with the
web-search toggle on: an OpenRouter model with no native `web_search_options`
(any GPT-5.x) and a Vercel model without the `web-search` tag, each asked a
current-events question — pass criteria are a current-facts answer, a
visibly higher cost than the same prompt without the toggle, and (per item
10) no hang waiting for a second turn.

**Partially closed since**: the Vercel and OpenRouter *catalog* halves were
driven end-to-end against the live upstream APIs (both are public and
unauthenticated, so a dummy stored key is enough to pass the picker's
presence gate — the route never validates it). Both rendered their real
catalogs through the picker: OpenRouter 400 models / 58 prefixes / 268
reasoning / 16 web-search / 17 free, Vercel 209 / 28 / 154 / 70 / 2 (the
web-search count reflects the pre-round-4 boolean derivation; round 4
rewrote `supportsWebSearch` into `'native' | 'universal' | undefined`
afterward, so this probe no longer measures what the badge shows today —
the new derivation is fixture-verified only, not re-run live). That
closes catalog fetching, normalization, price tiering and capability
signalling for those two gateways. It closes **nothing** for Cloudflare
(items 2, 3 and 5 need real account credentials) and nothing about sending a
chat (item 1) or Vercel's generation-id cost hop (item 4).

## Known limitation (disclosed, not fixed)

Regenerating the first message of a conversation after switching from a
direct-provider model (sent with tools requested) to a gateway model can hit
the tool-rejection 400, because the server reads `selectedTools` from the
*persisted first message* when the conversation has exactly one message —
even though the client-side capability watcher already cleared the tools
toggle for gateway mode. **Round 4 partially dissolved this**: `web_search`
is now accepted for OpenRouter and Vercel, so this edge case only remains
reachable for `image_generation` (still rejected on every gateway) or for a
regenerate landing on Cloudflare (which rejects everything). Narrow (only
the very first message of a conversation, only when switching models
mid-session, only for a still-rejected tool) and graceful (a clear error,
not a crash or silent failure), left as a known edge case rather than fixed,
since closing it fully requires stripping first-turn tools server-side
specifically for a gateway-model regenerate — a small feature in its own
right.

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
- No destructive migrations — every schema change across all 8 PRs (Qwen
  included) was a purely additive `ALTER TABLE ADD COLUMN` or a TS-only enum
  widening with no SQL-level change; Qwen's `keys.provider` addition
  generated no migration file at all (`pnpm run db:generate` reported "No
  schema changes, nothing to migrate").
- The live-verification gate above is a strong recommendation, not a hard
  deploy blocker — BYOK means a failure only affects the specific user
  testing a specific gateway, not the app as a whole.
