# Round 4: web search / tools mapping — findings and implementation plan

Planning-only deliverable for the top-priority bucket in
`docs/round4-feedback.md`. No code has been changed. Every vendor claim
below was re-verified on **2026-08-09** against the vendor's current
documentation, the live public catalog APIs, or the exact package versions
installed in this repo — never from model training data. Items that could
not be verified without live account credentials are explicitly flagged
(this environment has no real API keys; BYOK keys live per-user in D1).

## TL;DR

| Vendor / gateway | Globe badge today | Reality (verified 2026-08-09) | Verdict |
| --- | --- | --- | --- |
| Qwen `qwen3.7-plus`/`qwen3.6-flash` | shown | Correct — chat-completions `enable_search` supported | Correct as-is |
| Qwen `qwen3.7-max` | hidden | Max tier is **Responses-API-only** for search; this app calls chat completions | Real gap, correctly modeled |
| Moonshot `kimi-k2.6`/`kimi-k3` | hidden | Search exists but both mechanisms need a **multi-step tool loop** (or a fragile raw-body hack) | Real gap; fixable only via larger work |
| DeepSeek (both) | hidden | Still **zero** first-party search API surface (changelog through 2026-07-31) | Real gap; only an app-owned tool could close it |
| OpenRouter | 16/400 models | **Mapping bug.** Universal `web` plugin works on *any* model; current signal only catches native search | Biggest concrete bug — fix |
| Vercel AI Gateway | 70/209 models | Field read correctly, but Vercel now ships **universal search tools** for all models (docs updated 2026-07-28) | Fix same way as OpenRouter |
| Cloudflare AI Gateway | never shown | No search for `@cf/` Workers AI models; "AI Gateway does not provide a provider-agnostic web search abstraction" | Correctly-modeled gap |
| Image gen vs vision badge (gateways) | conflated | `modalities.output` never read; generation models labeled "Image input" | App-side bug — fix |

The user's core suspicion — "it's still an issue of tools mapping from
providers (all) to my app's architecture" — is **half right**. For the two
public gateways it is exactly a mapping bug (wrong signal read from the
catalog, plus a blanket server-side tool ban). For Qwen max, Moonshot,
DeepSeek and Cloudflare, the missing badges reflect genuine vendor-side
gaps that were verified again today; two of them (Moonshot, DeepSeek) are
closable only with a multi-step tool loop this app doesn't have yet.

---

## 1. Findings per vendor / gateway

### 1.1 Qwen (direct provider) — curation is correct; no change

**Current behavior.** `providers/qwen.ts` curates `tools: ['web_search']`
on `qwen3.7-plus` and `qwen3.6-flash`, and `tools: []` on `qwen3.7-max`.
`server/utils/providers/qwen.ts` forwards `enable_search: true` +
`search_options.search_strategy: 'agent'` via `providerOptions.qwen`
(a raw body flag on the chat-completions endpoint, not an AI-SDK tool).

**Evidence (re-fetched 2026-08-09,
https://www.alibabacloud.com/help/en/model-studio/web-search).** The
current doc lists chat-completions web-search support for Qwen3.7-Plus,
Qwen3.6-Plus, Qwen3.5-Plus, Qwen3.6-Flash, Qwen3.5-Flash and the
`*-character` models. Max-tier models are marked "Supported only by the
Responses API", and the doc states "The Responses API only supports the
Qwen3.7 Max series, Qwen3.6, Qwen3.5, qwen3-max, and qwen3-max-2026-01-23
models" for its own search surface. Only the `agent` strategy exists
outside China mainland ($10.00 per 1,000 calls international).

**Verdict.** The `qwen3.7-max` exclusion is a deliberate, evidence-backed
scoping decision that is still correct today — a real per-tier capability
difference on the exact endpoint this app calls, not an incomplete
implementation. Widening the array would produce requests Alibaba
documents as unsupported. Closing it for real would mean driving
DashScope's OpenAI-compatible **Responses API** for max-tier models only —
`@ai-sdk/openai-compatible` (how Qwen is wired) has no Responses support,
so that is a bespoke second wiring for one model's badge. Recommended:
accept and document (see OQ4).

**Standing caveat.** The `enable_search` wiring itself has never been
live-verified (no DashScope key here) — `docs/gateways.md` "Known gaps"
item 8 already tracks the exact probe, including the internal conflict in
Alibaba's own doc about 3.7/3.6 applicability under the agent strategy.

### 1.2 Moonshot AI / Kimi (direct provider) — real gap; larger work

**Current behavior.** Both `kimi-k2.6` and `kimi-k3` have `tools: []`.

**Evidence (re-fetched 2026-08-09,
https://platform.kimi.ai/docs/guide/use-web-search and
`docs/gateways.md`'s round-3 record).** Both documented mechanisms were
re-confirmed, and both remain unwireable in the current single-step
pipeline:

1. **`$web_search` builtin function** — supported by both curated models.
   The model emits a `$web_search` tool call whose arguments the client
   must echo back verbatim as a `role: "tool"` message; Moonshot executes
   the search server-side *during the follow-up call*. This is inherently
   a two-round-trip flow → requires a tool-execution loop. Additionally
   `@ai-sdk/moonshotai@3.0.30` (installed; delegates to
   `@ai-sdk/openai-compatible`) still hard-codes `type: "function"` and
   drops provider-defined tools — re-verified in the installed dist
   (`prepareTools` warns `provider-defined tool ${tool.id}` unsupported).
   Only a raw request-body rewrite via custom `fetch` could inject
   `type: "builtin_function"`; round 3 declined that hack and this round
   concurs.
2. **Formula API official tool `moonshot/web-search:latest`** — Moonshot's
   recommended path for kimi-k3. A standard `type: "function"` tool
   (declaration fetched from `GET /v1/formulas/{uri}/tools`, execution via
   `POST /v1/formulas/{uri}/fibers`). Cleanly expressible as an AI SDK
   tool with an `execute()` — but the model must produce its answer
   *after* the tool result, which the app's single-step `streamText` never
   allows (image generation only works single-step because the tool result
   *is* the deliverable).

**Anthropic-compatible endpoint angle (new this round).** Moonshot does
expose `POST https://api.moonshot.ai/anthropic/v1/messages` (documented
for Claude Code integration; see MoonshotAI/Kimi-K2 GitHub issue #129 for
the community-reconstructed reference). Nothing in Moonshot's docs claims
Anthropic-style **server-side** tool types (`web_search_20250305`) are
accepted there, and DeepSeek's analogous endpoint explicitly supports only
custom function tools — so this is schema compatibility for Claude Code's
client tools, not a server-search backdoor. Rewiring Moonshot onto
`@ai-sdk/anthropic` against that endpoint on an unverifiable hope would be
a regression risk with no documented payoff. **Not a path.**

**Verdict.** Real capability gap given this app's architecture. The only
honest fix is the multi-step tool loop + Formula API path — sketched
concretely as LW1+LW2 below. No quick win exists.

### 1.3 DeepSeek (direct provider) — still zero API surface

**Evidence (re-fetched 2026-08-09,
https://api-docs.deepseek.com/updates).** The changelog now extends
through **2026-07-31** (DeepSeek-V4-Flash public beta; V4-Pro/V4-Flash on
both OpenAI and Anthropic interfaces since 2026-04-24) and still announces
no web search, grounding, or `enable_search` anything. The chat-completion
reference still documents `tools` as functions-only. The consumer app's
Search toggle remains a product feature, not an API capability.

**Verdict.** Round 3's conclusion holds with newer evidence: there is
nothing to map. The only route is generic function calling against a
search backend this app supplies (LW3) — which is an app feature with real
cost/ownership questions (OQ5), not a provider capability. Keep
`tools: []` until the owner decides on LW3.

### 1.4 OpenRouter — the mapping bug is confirmed; universal plugin works

**Current behavior.** `server/utils/gateways/catalog.ts` derives
`supportsWebSearch: model.supported_parameters?.includes('web_search_options')`,
and `index.post.ts` 400s any tool request routed through a gateway, so
even badge-carrying models can't actually search.

**Evidence.**

- Live catalog probe (2026-08-09, `GET openrouter.ai/api/v1/models`):
  exactly **16 of 400** models carry `web_search_options` — the GPT-4o
  family, Perplexity Sonar models, and `openrouter/auto`. Every GPT-5.x
  entry reports `false`. This reproduces the user's screenshot exactly
  (globe on GPT-4o family, none on GPT-5+).
- Current docs (https://openrouter.ai/docs/features/web-search, fetched
  2026-08-09): "You can incorporate relevant web search results for *any*
  model on OpenRouter by activating and customizing the `web` plugin."
  The `:online` model-suffix is "exactly equivalent" to
  `plugins: [{ id: 'web' }]`. Engine selection: native provider search
  when available (Anthropic/Google/OpenAI/Perplexity/xAI), otherwise Exa;
  Firecrawl/Parallel/Perplexity explicitly selectable. Exa pricing:
  $0.007/request (10 results included). Native search "passed through
  directly from the provider". "Using web search will incur extra costs,
  even with free models." Results come back as standardized
  `url_citation` annotations.
- `web_search_options` itself is documented as the **native-search
  context-size parameter** (`low`/`medium`/`high`) — i.e. the current
  derivation was only ever a "has native provider-side search" signal.
  Reading it as "can this model search at all" is the bug.
- Installed `@openrouter/ai-sdk-provider@3.0.0` supports
  `plugins: [{ id: 'web', max_results?, search_prompt?, engine? }]` as a
  typed per-model setting (verified in `dist/index.d.ts`), and per the
  installed `dist/index.js` its stream mapper both parses `url_citation`
  annotation schemas and emits AI SDK `type: 'source', sourceType: 'url'`
  parts — so this app's existing source chips and the context menu's
  "Web search" indicator are expected to work with zero UI code, *better*
  than the Qwen integration (which gets no annotations at all). The
  causal annotation→source-part link is asserted from the dist code, not
  a live stream; QW1's pass criteria cover it.

**Why this fits the single-step pipeline.** The plugin is a request body
parameter, not an AI SDK tool: OpenRouter runs the search server-side and
injects results before/while the model generates. `tools` stays `{}`, no
`toolChoice`, no loop — the same conceptual shape as Qwen's
`enable_search`. The blanket gateway-tools 400 must simply learn to admit
`web_search` for OpenRouter and translate it into the plugin setting
instead of a tool.

**Verdict.** App-side mapping bug, and the single biggest concrete fix in
this plan (QW1).

### 1.5 Vercel AI Gateway — the landscape changed; universal tools exist now

**Current behavior.** `supportsWebSearch: model.tags?.includes('web-search')`.
The round-3 comment "tags is the only field that surfaces web-search at
all" was accurate *for the catalog*; it is no longer the whole story for
the capability.

**Evidence.**

- Live catalog probe (2026-08-09): the `tags` field is read correctly —
  **70 of 209** language models carry `web-search`, and notably the whole
  GPT-5 family carries it on Vercel (so any GPT-5 globe gap the user saw
  there is not a tag-read bug; the remaining 139 models genuinely lack a
  *native* search tag: most non-Anthropic/OpenAI/Google/xAI vendors). If
  the preview showed GPT-5 rows without globes, the likely explanation is
  a stale KV-cached catalog (1h TTL), not the derivation — and the
  universal fix below moots the distinction anyway.
- Current docs
  (https://vercel.com/docs/ai-gateway/models-and-providers/web-search,
  `last_updated: 2026-07-28`): AI Gateway now ships **universal search
  tools** — `gateway.tools.perplexitySearch()`, `gateway.tools.exaSearch()`,
  `gateway.tools.parallelSearch()` — each usable "with any model
  regardless of the model provider or creator", executed by the gateway
  (it "routes the request to [the search provider's] API"). Pricing:
  Perplexity $5/1k requests, Parallel $5/1k (10 results incl.), Exa $7/1k.
  Provider-native tools (`anthropic.tools.webSearch_20250305()`,
  `openai.tools.webSearch({})`, `google.tools.googleSearch({})`,
  `xai.tools.webSearch({})`) also pass through the gateway for their own
  model families.
- Installed `@ai-sdk/gateway@4.0.46`: the universal tools exist as
  `ProviderExecutedToolFactory` entries and `tools` hangs off the
  `GatewayProvider` **instance** interface — so the BYOK
  `createGateway({ apiKey })` client in `server/utils/gateways/vercel.ts`
  can call `client.tools.perplexitySearch()` today, no upgrade needed.

**Why this fits the single-step pipeline.** Provider-executed tools run on
the gateway side mid-generation — the SDK sees one step, exactly like the
already-working direct-provider `openai.tools.webSearch()` path. The docs'
own examples are plain `streamText` calls with no `stopWhen`.
Medium-high confidence; needs the live smoke test below since no Vercel
key exists in this environment.

**Verdict.** Not a tag-read bug, but the same *class* of fix as
OpenRouter: web search is now available for every Vercel model via a
gateway-executed tool, so both the badge derivation and the send path
should reflect that (QW2). One presentational unknown to check live:
whether the universal tools also emit source parts or only
tool-call/tool-result parts (affects which chips render; not blocking).

### 1.6 Cloudflare AI Gateway — correctly-modeled gap, stated plainly

**Current behavior.** `supportsWebSearch` is never set (always
`undefined`) — by design, per the catalog.ts comment.

**Evidence (fetched 2026-08-09,
https://developers.cloudflare.com/ai-gateway/usage/web-search/).**
Cloudflare now documents web search through AI Gateway — but **only for
proxied third-party providers**: Anthropic (`POST /ai/v1/messages`,
`web_search_20250305`), OpenAI and xAI (**Responses API only** — "The
`/ai/v1/chat/completions` endpoint does not accept the
`web_search_preview` tool"), and Alibaba/Qwen (`enable_search` flag on
chat completions, `qwen3-max`/`qwen3.5-397b-a17b`). Explicitly: "AI
Gateway does not provide a provider-agnostic web search abstraction."
Nothing exists for `@cf/` Workers AI models — which are what this app's
Cloudflare catalog (`/ai/models/search`) lists and what its
chat-completions builder can drive.

**Verdict.** For the catalog this app actually surfaces, zero models can
web-search, and the picker's never-badge behavior is honest. This is a
real, correctly-modeled vendor gap — no fix invented. Two forward-looking
notes: (a) Cloudflare's 2026-08-07 changelog ("Workers AI and AI Gateway
unify model access and billing") suggests third-party models may start
appearing through the same binding/REST path — if a future live-account
catalog fetch shows e.g. Alibaba models in `/ai/models/search`, the
Qwen-style `enable_search` flag becomes wireable for exactly those rows
(chat-completions compatible); (b) Anthropic-through-Cloudflare would
additionally require a Messages-API client, and OpenAI/xAI a Responses
client — different SDK surfaces than the one `@ai-sdk/openai-compatible`
builder this app uses. Both are unverifiable without a real account
(catalog shape is already "Known gaps" item 2 in `docs/gateways.md`).

### 1.7 Secondary finding: gateway reasoning is badge-only today

The user's acceptance line includes reasoning. Current state: badges come
from real signals (OpenRouter `supported_parameters: 'reasoning'` — 268 of
400 live; Vercel `tags: 'reasoning'`; Cloudflare default-format `reasoning`
property), but **functionally every gateway send forces reasoning off** —
`index.post.ts` line 97-99 hard-codes `reasoningLevel = 'off'` when
`body.data.gateway` is set, and `GatewayChatResult` carries no reasoning
field. The client never offers the toggle either (`useChatInput`'s
`selectedModel` resolves only curated models). So gateway reasoning has
the same "advertised but inert" shape web search had. The installed
`@openrouter/ai-sdk-provider` supports a unified
`reasoning: { effort, max_tokens, exclude }` setting, making OpenRouter
the cheap first target; Vercel needs per-underlying-provider
`providerOptions` threading. Scoped as LW4 — flagged so it isn't silently
dropped from the user's expectation, but web search + badges are the
priority per the feedback.

---

## 2. The image-generation vs. vision semantic bug

**Root cause.** `GatewayModel` (`shared/types/gateways.d.ts`) has no
image-generation concept. `GatewayModelItem.vue` renders exactly one
image-related chip: `supportsImageInput` =
`modalities?.input.includes('image')`, iconed `lucide:image`, tooltip
"Image input", in the same violet the curated list uses for *generation*.
`modalities.output` is **never read by any component**.
`GatewayModelDetail.vue` repeats the same input-only "Image input" row
(~line 128). Meanwhile the curated `ModelItem.vue` shows a violet
`lucide:image-plus` "Image generation" chip via
`hasImageGenerationCapability()` (a different field entirely:
`model.tools`/`model.imageGeneration`) and has **no vision badge at all**.
Result: OpenRouter's `openai/gpt-5-image` / `openai/gpt-5-image-mini`
(live-verified today: `output_modalities: ['image', 'text']`) render as
"Image input" — a generation model labeled as merely accepting images,
styled identically to the real generation badge one list over. Two
components, three semantics, one color.

**Live data confirming derivability (2026-08-09).** OpenRouter: 11
image-output models (GPT-5 Image/Mini, GPT-5.4 Image 2, the Nano Banana
family, `openrouter/auto`). Vercel: 5 language-type image-output models
(all Gemini `*-image` variants; the pure `bfl/`/`bytedance/` image models
are already dropped by the `type === 'language'` filter). Cloudflare's
marketplace format models `output_modalities[].type` explicitly.

**Proposed fix (badge semantics; generation *functionality* through
gateways stays gated — see LW5).**

1. Add `supportsImageGeneration?: boolean` to `GatewayModel`, derived in
   all three normalizers from output modalities containing `image`
   (Vercel `modalities.output`, OpenRouter `architecture.output_modalities`,
   Cloudflare `output_modalities[].type`). Same "explicit true only"
   contract as the other advisory flags.
2. In `GatewayModelItem.vue` + `GatewayModelDetail.vue`: violet
   `lucide:image-plus` / "Image generation" chip for the new flag —
   matching the curated list — and change the input-side chip to
   `lucide:eye` / "Vision" (covers image/video/PDF input semantics), per
   the user's option 2 in `docs/round4-feedback.md`.
3. Same separation in the curated list: add the `lucide:eye` "Vision"
   chip to `ModelItem.vue`/`ModelDetail.vue` from
   `model.modalities.input.includes('image')` (data already present via
   the models.dev merge). This closes the pre-existing inconsistency where
   direct providers show generation but never vision. Caveat for the
   owner: most modern curated models are vision-capable, so this adds a
   chip to almost every row — see OQ3.

---

## 3. Proposed unified capability architecture

One conceptual rule everywhere: **a capability chip/toggle means "this
send path can actually do it", derived from the strongest evidence the
source offers, and `undefined` still means unknown, never no.**

- **Web search** becomes a per-model *resolution* rather than a raw
  boolean: `'native' | 'universal' | undefined`.
  - Curated providers: `'native'` iff `tools` includes `web_search`
    (unchanged data; Qwen's flag mechanism and OpenAI/Google/xAI/
    Anthropic's forced server tools are both "native" here).
  - OpenRouter: `'native'` when `supported_parameters` has
    `web_search_options`; else `'universal'` (the `web` plugin, which
    itself auto-upgrades to the provider's native engine when one exists).
  - Vercel: `'native'` when `tags` has `web-search`; else `'universal'`
    (gateway search tools).
  - Cloudflare: `undefined` (nothing exists for `@cf/` models).
  - Exclusion: models whose output modalities include `image`
    (generation models) never get the universal resolution — a globe on
    "GPT-5 Image" would recreate the exact class of mislabeling this
    round is fixing.
  - This policy lives in **one shared module** (proposed:
    `shared/utils/gateway-capabilities.ts`) consumed by all three
    consumers — the picker badge, the chat-input toggle gating, and the
    server-side send gate — so the three can never drift apart again.
    That drift (badge from catalog, toggle from curated-only lookup, gate
    from a blanket 400) is the architectural root of "badges lie".
- **The server gate** (`index.post.ts`): replace the blanket
  "gateway + tools → 400" with a per-gateway, per-tool policy from that
  same shared module. `web_search` → allowed for OpenRouter and Vercel;
  `image_generation` → still rejected for all gateways; everything →
  still rejected for Cloudflare. Crucially the two allowed paths use
  **different mechanics** and the gate must dispatch accordingly:
  OpenRouter passes a *model setting* (`plugins`) and keeps `tools: {}`;
  Vercel returns a *provider-executed tool* in `GatewayChatResult.tools`.
  Both are single-step-safe; neither touches `stopWhen`.
- **Reasoning**: keep current per-catalog signals for badges; functional
  controls are LW4.
- **Image generation vs vision**: output modalities vs input modalities,
  identically in both lists (section 2).
- **App-owned provider-agnostic search tool** (function-calling based,
  backed by a search API): deliberately **not** proposed as part of this
  round. The OpenRouter + Vercel fixes cover the two surfaces where the
  user reported breakage, with vendor-native mechanics and zero pipeline
  changes. An app-owned tool requires the multi-step loop (LW1), a search
  backend whose bill someone must own (a genuine BYOK-principle conflict —
  the app has no keys of its own), and would still leave Cloudflare's
  `@cf` models constrained by their own function-calling quality. It stays
  on the menu as LW3 strictly for DeepSeek (and optionally Moonshot,
  where it would be simpler than Formula API) if the owner wants those
  gaps closed at all costs.

---

## 4. Prioritized concrete change list

### Quick wins (no pipeline redesign; ordered by impact)

**QW1 — OpenRouter: correct the signal and make the toggle real.**
- Files: `server/utils/gateways/catalog.ts` (derivation),
  `shared/types/gateways.d.ts` (capability shape),
  new `shared/utils/gateway-capabilities.ts` (policy),
  `server/utils/gateways/index.ts` + `openrouter.ts` (thread the
  requested tools into the builder; set
  `openrouter.chat(model, { usage: { include: true }, plugins: [{ id: 'web' }] })`
  when web search is requested),
  `server/api/v1/chats/[slug]/index.post.ts` (per-gateway gate),
  `app/composables/chat-input.ts` (gateway branch for
  `isWebSearchSupported`, resolving the selected gateway model from the
  catalog composable instead of returning null),
  `app/components/ChatInput/ModelsTrigger/GatewayModelItem.vue` +
  `GatewayModelDetail.vue` (badge per OQ1 outcome),
  tests (`tests/unit/utils/gateways/*`, `gateway-catalog-normalize.spec`,
  `chats-gateway` integration, `GatewayModelItem.spec`) +
  `scripts/test-affected-check.mjs` registration, `docs/gateways.md`.
- Plain English: stop reading `web_search_options` as "can search";
  admit the `web_search` tool through the gate for OpenRouter and
  translate it into the `plugins` body parameter (a Qwen-style flag, not
  an AI SDK tool). Persisted user-message `tools` arrays already record
  the request; the provider already maps `url_citation` → source parts,
  so source chips and the context-menu "Web search" indicator light up
  for free.
- Verification: real OpenRouter key; pick a model with **no**
  `web_search_options` (any GPT-5.x); toggle web search; ask a
  current-events question. Pass = answer cites current facts, source
  chips render, OpenRouter dashboard shows the web-plugin charge, and
  `usage.cost` capture still works (cost should now include the search
  fee). Also verify a non-search send on the same model is byte-identical
  to today (no `plugins` key sent).
- Side effect to note: the disclosed "first-message regenerate after
  switching direct→gateway model" 400 edge case in `docs/gateways.md`
  partially dissolves for web_search on OpenRouter/Vercel (the tool is now
  accepted); the doc paragraph needs updating either way.

**QW2 — Vercel AI Gateway: universal search tool.**
- Files: `server/utils/gateways/vercel.ts` (return
  `tools: { web_search: client.tools.<engine>Search() }` when requested —
  provider-executed, no `toolChoice`, no loop), plus the same shared
  policy/gate/toggle/badge/test/docs touchpoints as QW1.
- Plain English: when the user toggles web search on any Vercel model,
  attach the chosen gateway-executed search tool (engine per OQ2;
  recommend Perplexity as default — Vercel's own lead option, $5/1k).
- Verification: real Vercel key; one search send on a model **without**
  the `web-search` tag (e.g. a Meta or DeepSeek model) and one **with**
  it (GPT-5). Pass = current-events answer + tool-call/tool-result parts
  stream without erroring + the send stays single-step (no hang after
  tool result — this is the one medium-confidence assumption; if the
  model stalls after the tool result, the tool is not provider-executed
  live and QW2 must move to the LW1 bucket). Check whether source parts
  render or only tool parts, and confirm the existing Vercel
  `generationId` cost hop includes the search fee.

**QW3 — Image generation vs vision badges (both lists).**
- Files: `server/utils/gateways/catalog.ts` (+`supportsImageGeneration`
  in all three normalizers), `shared/types/gateways.d.ts`,
  `GatewayModelItem.vue`, `GatewayModelDetail.vue` (both the badge and
  the ~line-128 "Image input" capability row), `ModelItem.vue`,
  `ModelDetail.vue` (add Vision chip), matching specs, `docs/gateways.md`.
- Plain English: section 2's three-step fix. Badge-only — selecting an
  image-output gateway model still cannot generate (LW5); the picker just
  stops lying about what the model *is*.
- Verification: with dummy keys (catalogs are public), open OpenRouter in
  the picker — `GPT-5 Image` shows image-plus/"Image generation" and no
  eye; `gpt-4o` shows eye/"Vision"; curated list shows eye on
  vision-capable rows and unchanged generation badges. Unit specs assert
  the derivation on all three raw-catalog fixtures.

**QW4 — Qwen + Cloudflare + DeepSeek: document the verified non-fixes.**
- Files: `docs/gateways.md` (update the round-3 sections with today's
  re-verification dates and the new Cloudflare web-search doc link),
  optionally a one-line "why no search" note in the model-detail views.
- Plain English: no code change is correct for these three; the plan's
  evidence (sections 1.1, 1.3, 1.6) becomes the permanent record so
  round 5 doesn't re-litigate it.
- Verification: none needed (documentation).

### Larger architecture work (each needs a real design decision)

**LW1 — Multi-step tool-execution loop in the chat pipeline.**
Prerequisite for LW2/LW3. What it actually requires:
- `index.post.ts`: set `stopWhen` (e.g. `stepCountIs(3-4)`) **only** for
  sends carrying client-executed tools, so every existing single-step
  path keeps its current behavior and its `stopWhen: isStepCount(1)`
  default.
  > **Corrected during implementation (Wave B).** "Sends carrying
  > client-executed tools" is the wrong trigger and would have been a
  > regression: `createImageGenerationTool()` is a client-executed tool
  > with a real `execute()`, and the AI SDK's continuation condition
  > counts exactly those, so a client-executed-tool trigger would have
  > looped image generation into a second billed model turn narrating an
  > image the user can already see. The shipped trigger is an explicit
  > opt-in marker on the tool definition (`withFollowUpTurn()` →
  > `requiresFollowUpTurn: true`), which nothing in the codebase sets
  > today. See `docs/gateways.md`'s "Multi-step tool loop" section.
- **Cost-capture rework — the hidden blast radius.** The live OpenRouter
  cost fix documented in `docs/gateways.md` reads `providerMetadata` off
  the per-step `finish-step` chunk and its correctness note says
  verbatim that every send is single-step today. A tool loop produces
  *multiple* `finish-step` chunks — the capture in
  `resolveLiveGatewayCost()` / `messageMetadata` must switch to
  last-chunk-wins or summing, and usage/token aggregation across steps
  needs the same review (`persistAssistantMessageFromStream`,
  `estimateGatewayMessageCost`).
  > **Resolved during implementation (Wave B): summing.** Each step is a
  > separate OpenRouter request with its own billed cost, so the three
  > capture sites (`messageMetadata`, `persistAssistantMessageFromStream`,
  > and `onEnd`'s telemetry — the plan missed the third) now fold with
  > `sumOpenRouterStepCosts()`. Token aggregation needed no change at all:
  > `finish.totalUsage`, `result.usage` and `onEnd`'s `usage` are already
  > summed across steps by the SDK, so `estimateGatewayMessageCost()`
  > receives correct totals unchanged.
- Persistence & UI: intermediate tool-call/tool-result parts land in
  `messages.parts` — verify the renderer tolerates unknown tool parts
  (today only `generate_image` tool parts exist) and decide whether
  search steps render as chips, collapsed steps, or nothing.
- Timeouts/limits: a loop on Workers has a request budget; cap steps and
  tool payload sizes.
- Rough scope: `index.post.ts`, `server/utils/chats/*` (persistence,
  errors), message part rendering components, cost tests, new loop tests.

**LW2 — Moonshot web search via Formula API (depends on LW1).**
`server/utils/providers/moonshotai.ts`: fetch the tool declaration from
`GET /v1/formulas/moonshot%2Fweb-search:latest/tools` (cacheable), expose
it as an AI SDK tool whose `execute()` posts to
`POST /v1/formulas/{uri}/fibers` with the user's own Moonshot key and
returns the (possibly `----MOONSHOT ENCRYPTED BEGIN----`) blob verbatim;
flip `providers/moonshotai.ts` to `tools: ['web_search']`. Open issues
recorded in round 3 still stand: encrypted blobs persisted into message
parts, and Moonshot's self-contradictory billing note ("currently free
for a limited time" vs fiber `tool_call` billing). Verification: real
Moonshot key, one search send per model, confirm the post-search answer
arrives and the fiber charge appears on the Moonshot console.

**LW3 — App-owned search tool for DeepSeek (depends on LW1 + OQ5).**
Generic function tool (`search_web`) whose `execute()` calls a search API
(Exa/Tavily/Brave-class), offered only to models with function calling
and no other search resolution. Requires deciding whose key/bill backs
the search API — the app's only non-BYOK component ever, or a new
optional user-supplied "search provider" key in `/profile/keys`. Also
benefits Cloudflare `@cf` function-calling models if ever wanted.

**LW4 — Functional reasoning controls for gateway models.**
OpenRouter first (`reasoning: { effort }` setting exists in the installed
provider; gate on `supported_parameters` including `reasoning`); Vercel
needs per-underlying-provider `providerOptions` mapping — messier, decide
scope separately. Client side: reasoning toggle/levels UI for gateway
selections + persisted `reasoning` on the message row (schema already
stores it). Un-force the `'off'` at `index.post.ts:97-99` behind the same
per-gateway policy module.

> **Corrected during implementation (Wave C-2).** This entry's difficulty
> assessment was backwards. Vercel needed **zero** custom code: direct
> inspection of the installed `@ai-sdk/gateway@4.0.46` source shows
> `GatewayLanguageModel.getArgs()` forwards the whole call-options object,
> including the standardized top-level `reasoning` option, verbatim to the
> backend for server-side translation — a transparent proxy, not a mapping
> problem. OpenRouter was the actually-bespoke one: its provider silently
> **ignores** the top-level `reasoning` option entirely (confirmed in
> compiled `dist/index.js`) and requires the settings-level
> `reasoning: { effort }` field this entry already anticipated. See
> `docs/gateways.md`'s "Gateway reasoning" section for the full mechanism
> writeup and citations.

**LW5 — Actual image generation through gateways (optional, furthest
out).** OpenRouter supports image output on chat completions via the
`modalities` request param for its 11 image models; Vercel's 5 Gemini
image models similarly. Needs an image-part persistence path equivalent
to `createImageGenerationTool`'s R2 upload, plus pricing/estimation
handling. Recommend deferring until the badges (QW3) have been right for
a while and demand is proven.

> **Shipped (Wave C-2).** Both gateways now emit real images: OpenRouter
> via `extraBody: { modalities: ['image', 'text'] }` (untyped in the
> installed provider, sent as a raw body field), Vercel with no request
> change at all — its Gemini `*-image` models return files from a plain
> `generateText`/`streamText` call. The image-part persistence path is
> `persistGatewayGeneratedImageParts()`
> (`server/utils/files/assistant-files.ts`), reusing
> `validateGeneratedImage()`/`persistFile()` rather than duplicating them.
> Pricing/estimation needed no new code: OpenRouter's `usage.cost` and
> Vercel's `getGenerationInfo()` are already generation-scoped, so an
> image-output surcharge is already folded into the existing total —
> adding a separate line item would double-count. One real bug was caught
> and fixed while building the read-path half of this:
> `reconstructGeneratedImageParts()`'s origin-metadata guard would have
> reconstructed a gateway-origin file into a `tool-generate_image` part
> that the client
> only renders for `openai`/`google` origins, silently vanishing the image
> on reload; it now allowlists those two origins explicitly. No
> aspect-ratio control exists for gateway image generation (no tool, no
> input schema to carry it) — a disclosed gap, not an oversight. Full
> writeup in `docs/gateways.md`'s "Gateway image generation" section.

---

## 5. Open questions requiring the product owner's sign-off

**OQ1 — Badge policy for universal search.** With QW1/QW2, *every*
OpenRouter/Vercel model can search. Options: (a) globe on every row —
truthful, matches your "GPT-5 must have it 100%" expectation, but
`docs/gateways.md` itself argued 16/400 was "the signal worth the pixels"
and a badge on everything separates nothing; (b) globe everywhere but
visually/tooltip-differentiated — "Web search (native)" vs "Web search
(via gateway, billed per search)"; (c) globe only for native, toggle
available everywhere. **Recommendation: (b)** — one extra tooltip string,
keeps the pixels honest. Your call before implementation.

**OQ2 — Who pays, and which engine.** Universal search costs real money
on the user's own gateway account per request — OpenRouter: "Using web
search will incur extra costs, even with free models" (Exa $0.007/req);
Vercel: Perplexity/Parallel $5/1k, Exa $7/1k. Decisions needed: default
engine per gateway (recommend OpenRouter plugin default = native-or-Exa;
Vercel = Perplexity), and whether the toggle needs a cost hint in the UI
(the Qwen agent-strategy search at ~$10/1k already ships without one —
consistency argues either both get a hint or neither).

**OQ3 — Vision badge rollout.** Your feedback left two options open;
this plan proposes option 2 (eye = Vision for input, image-plus =
generation) applied to *both* lists. Consequence: nearly every modern
curated model gains an eye chip — acceptable noise, or should the
curated list keep vision implicit and only gateways gain the eye?

**OQ4 — Qwen max.** Accept the verified Responses-API-only exclusion
(recommended, zero cost), or fund a bespoke DashScope Responses wiring
for one model's search?

**OQ5 — DeepSeek.** Accept "no native search exists" as final for this
round, or approve LW1+LW3 — and if LW3, who owns the search-API bill
(first-ever non-BYOK component vs a new optional user key type)?

**OQ6 — Moonshot.** Approve the LW1+LW2 investment now, or ship
QW1-QW4 first and revisit? (LW1 is the shared prerequisite for OQ5/OQ6 —
approving either implies approving LW1.)

**OQ7 — Cloudflare unified catalog.** When a live Cloudflare account is
next available, re-run the catalog fetch and check whether third-party
(e.g. Alibaba) models now appear per the 2026-08-07 unified-billing
changelog; if yes, the Qwen `enable_search` flag path becomes wireable
for those rows. Until then Cloudflare keeps zero search — confirmed
correct, not a bug.

---

## 6. Resolved decisions (product owner, 2026-08-09)

- **Scope: full cycle approved.** All of QW1–QW4 and LW1/LW2/LW4/LW5 are
  in scope for this implementation round. **LW3 (DeepSeek app-owned search
  tool) is explicitly declined** — "not now, skip" — DeepSeek stays
  `tools: []` with no search this round; do not build a non-BYOK search
  component. Revisit only on a separate, future ask.
- **OQ1 (badge policy) → (b).** Show the globe for every model that can
  search once QW1/QW2 land (native or via gateway plugin), but
  differentiate via tooltip/label: "Web search (native)" vs "Web search
  (via gateway, billed per search)".
- **OQ2 (engine + cost hint) → plan defaults, taken without a separate
  ask; log here for review.** OpenRouter: use the plugin's own
  native-or-Exa default engine (no explicit `engine` override). Vercel:
  default to `perplexitySearch()`. Cost hint: the OQ1(b) tooltip wording
  itself is the cost hint — no separate UI element, consistent with the
  existing Qwen search toggle also shipping without one.
- **OQ3 (vision badge rollout) → both lists.** Add the eye/"Vision" chip
  to gateway AND curated direct-provider model lists. Accepted trade-off:
  most modern curated models will show this chip since most now support
  image input.
- **OQ4 (Qwen max) → accept the gap**, per the plan's own recommendation
  (zero cost, matches verified Responses-API-only reality). No dissent
  registered on this one.
- **OQ5 (DeepSeek $ owner) → not now, skip.** See scope note above.
- **OQ6 (Moonshot loop investment) → approved.** LW1 (multi-step tool
  loop) and LW2 (Moonshot Formula-API search) are both in scope now, not
  deferred.
- **OQ7 (Cloudflare unified catalog re-check)** → fold into this round's
  live verification pass opportunistically if a real Cloudflare account is
  available; not a blocker for anything else.

### Execution ordering (file-collision-driven, not conceptual)

QW1/QW2/QW3 all touch `server/utils/gateways/catalog.ts`,
`shared/types/gateways.d.ts`, the server gate, and both
`GatewayModel*.vue` files — these run as **one work package**, not
parallel worktrees. `server/api/v1/chats/[slug]/index.post.ts` is touched
by QW1, LW1, and LW4 — strict serial order on that file. LW2 strictly
follows LW1. LW5 does not depend on LW1 (image-output is a request
param / response part, single-step) but needs QW3's
`supportsImageGeneration` derivation and may brush LW1's persistence
utils, so it runs last.

**Wave A** — QW1 + QW2 + QW3 + QW4 (one work package).
**Wave B** — LW1 alone, gated on regression proof that every existing
non-tool send is byte-identical to pre-change behavior (the cost-capture
rework is the actual blast radius, not the loop mechanics themselves).
**Wave C** — LW2 ∥ LW4 ∥ LW5, dispatched in parallel once Wave B lands.

The QW2 pivot condition must be smoke-tested on the live preview with a
real Vercel key as soon as Wave A deploys, before Wave B's scope is
finalized: if Vercel's universal search tool is not actually
provider-executed in a single step (model stalls waiting for a second
turn), QW2's implementation moves into Wave B instead of staying in
Wave A.

---

## What was NOT verifiable in this environment

- Any live send through any gateway or new direct provider (no real keys
  here — unchanged from `docs/gateways.md` "Known gaps" items 1-8).
- Vercel universal-tool behavior under this app's exact
  single-step `streamText` (docs + installed types say provider-executed;
  needs the QW2 smoke test).
- Whether Vercel universal search emits source parts or only tool parts.
- OpenRouter plugin cost landing in `usage.cost` (assumed; verify in QW1).
- Cloudflare catalog shape/live contents (pre-existing gap, OQ7).
- Qwen `enable_search` live behavior (pre-existing gap, item 8).

Everything else above cites a document fetched, a live public catalog
probed, or an installed package inspected on 2026-08-09.
