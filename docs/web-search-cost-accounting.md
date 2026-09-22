# Web search cost accounting

> **The number this app shows for web search is an estimate and can never be
> anything else.** In a BYO-key app the provider bills the *user's* account,
> not ours — we never see their tier, their free quota, their negotiated rate
> or their invoice. Everything below is public list pricing multiplied by a
> unit count we derive from the SDK's response. The unit count is the
> durable, reconcilable part; the dollar figure is decoration on top of it.
> Design changes must preserve that ordering.

## The general problem, not just the Google bug

Provider-native tool use is billed on a completely separate axis from tokens.
A generation that used Grounding with Google Search produces a normal
`LanguageModelUsage` (input/output/reasoning tokens) and a *second*,
invisible charge that never appears in any token field. `getModelCostMap()`
(`server/utils/ai/cost-map.ts`) prices tokens from the models.dev snapshot
and is structurally incapable of seeing the rest.

That gap is what produced the original incident: the Axiom AI-cost dashboard
reported $3.56 against a real Google Cloud Billing export of ~$10.34 for the
same period, of which 521 search queries × $0.014 = $7.29 — roughly 70% of
the bill — was search grounding this app never logged (PR #385).

Web search is the instance we hit first, not the category. The category is
"provider-executed server-side tools with their own SKU," and it already has
more members: image generation (handled separately, see
`addImageGenerationCostToUsage`), code execution, computer use, file search,
and whatever ships next. Four properties make this category structurally
hard, and all four get worse as providers are added:

1. **No standardised billing unit.** Google bills two different units
   depending on model generation. Anthropic and OpenAI each bill one flat
   unit, but a provider's SDK can expose more than one tool variant with
   different tiering for the same nominal capability (see "Billing-unit
   heterogeneity" below) — the unit isn't even fixed *within* a provider
   without checking which tool the code actually calls. Nothing forces the
   next provider to reuse any of these shapes.
2. **No machine-readable pricing source.** models.dev tracks per-token
   prices and nothing else. `scripts/fetch-models-metadata.mjs`
   (`docs/models-data-fetching.md`) cannot ever learn a search rate. Every
   rate in this repo was read off a pricing page by a human.
3. **No invoice visibility.** BYO-key means the provider's bill goes to the
   user. The app has no API, no scope, and no legitimate reason to read it.
4. **The SDK does not normalise any of it.** Each provider's count, if it is
   exposed at all, lives in a different corner of `providerMetadata` or in
   tool-call content, under a different name.

## Current architecture

As shipped, this app accounts for separately-billed web search on **all
three** providers it supports — Google, Anthropic, and OpenAI — through a
provider-dispatcher pattern:

- `server/utils/ai/google-search-cost.ts` — Google-only, untouched since PR
  #385 (invoice-verified, deliberately not refactored when the other two
  providers were added).
- `server/utils/ai/web-search-cost.ts` — Anthropic and OpenAI together,
  since both share the same structural signal (a provider-executed
  `web_search` tool-result part) and the same billing shape (flat per
  search/call), differing only in which rate applies.
- `server/utils/ai/search-usage.ts` — a thin dispatcher over both of the
  above, so `server/api/v1/chats/[slug]/index.post.ts`'s three integration
  points call one function (`resolveSearchUsage`) instead of each growing a
  three-way provider branch.

Google was kept in its own file rather than generalised into one
abstraction with the other two, on the judgment that the part which
genuinely varies between providers — *how to extract a unit count from SDK
output* — is irreducibly imperative, and forcing it through a shared
interface would have meant either churning just-merged, invoice-verified
code or building an abstraction around three data shapes that don't share
much beyond "it's a number of something." See "Gray zones" below for the
fuller version of that argument, because it also answers "does this scale
to provider four."

### Counting: three different signals for three providers

**Google** (`getGoogleSearchGrounding`, unchanged from PR #385): walks every
step's `providerMetadata.google.groundingMetadata` and produces two
independent counts — `queries` (a `Set` of trimmed, non-empty
`webSearchQueries` strings, deduplicated because Google bills the
deduplicated query and the same query can repeat across steps) and
`groundedSteps` (how many steps carried any `groundingMetadata`, including a
step with zero queries). Returns `undefined` when `groundedSteps === 0`.
`imageSearchQueries` and `retrievalQueries` are ignored — neither is part of
the invoiced Google Search SKU.

**Anthropic** (`getWebSearchUsage` in `web-search-cost.ts`): tries a
metadata path first, falls back to a structural count. The metadata path
reads `providerMetadata.anthropic.usage.server_tool_use.web_search_requests`
— Anthropic's own billing-side counter, present because `@ai-sdk/anthropic`
parses Anthropic's `usage` object with a *loose* zod schema
(`z3.looseObject`) that preserves unknown keys rather than stripping them,
and passes the full parsed object through into `providerMetadata` verbatim.
This was verified against the installed `node_modules/@ai-sdk/anthropic`
source, not assumed from types — the metadata path is live code, not dead
code, if Anthropic's response includes `server_tool_use`. Whether that
counter itself includes errored searches (which Anthropic doesn't bill) is
not independently verifiable without a live API call; if the counter is
absent, the structural fallback counts `tool-result` parts (never
`tool-error` parts) matching a web-search tool name, which provably excludes
errors — `ai`'s core SDK converts any provider tool result with
`isError: true` into a `tool-error` part type, never `tool-result`.

**OpenAI**: no counter exists anywhere in provider metadata. The only signal
is structural — `web_search_call` output items surface as provider-executed
`tool-call`/`tool-result` content parts, counted the same way as Anthropic's
fallback path.

Both Anthropic and OpenAI register their tool locally under the key
`web_search_preview` — the **same key Google's tool is also registered
under** (`server/utils/providers/{google,anthropic,openai}.ts`). This is why
`getWebSearchUsage` is hard-gated to `providerId === 'anthropic' ||
providerId === 'openai'` and returns `undefined` for anything else: an
ungated structural count would double-report a Google turn, since Google's
tool-result parts carry the same local tool name.

### The billing unit, and its shape per provider

`SearchBillingUnit` (`shared/types/message-usage.d.ts`) is `'query' |
'grounded-prompt' | 'search'`:

- **Google, Gemini 3.x** → `'query'`, $14/1,000 deduplicated queries,
  invoice-verified.
- **Google, Gemini ≤2.5** → `'grounded-prompt'`, $35/1,000 grounded
  requests, documentation-only. The generation split is a string match on
  `/^gemini-(\d+)/` against the model id — the AI SDK exposes no generation
  field, so this is a dated heuristic that would misclassify a
  differently-billed future generation, and the function's own comment says
  so.
- **Anthropic, all generations** → `'search'`, flat $10/1,000 searches,
  same rate across Opus/Sonnet/Haiku, documentation-only.
- **OpenAI, all models** → `'search'`, flat $10/1,000 calls, uniformly
  across every model including `gpt-4o-mini`/`gpt-4.1-mini`,
  documentation-only.

**A tiered OpenAI model (reasoning $10/1k vs. non-reasoning $25/1k, with
`gpt-4o-mini`/`gpt-4.1-mini` exempted entirely) shipped briefly during
review and was wrong.** This app calls `openai.tools.webSearch({})`
(`server/utils/providers/openai.ts`), which sends the OpenAI Responses API
the **non-preview** `web_search` tool type — confirmed by reading the
installed `@ai-sdk/openai` source, which maps `openai.web_search` to
`type: "web_search"` on the wire. The reasoning/non-reasoning split
belongs to the *separate*, *legacy* `web_search_preview` tool, which this
app does not use. The non-preview tool bills **$10.00 per 1,000 calls for
every model, no tiering**, per developers.openai.com/api/docs/pricing (as
of 2026-09-22, quoted verbatim): *"Web search (all models) | $10.00 / 1k
calls + Search content tokens billed at model rates."* `gpt-4o-mini` and
`gpt-4.1-mini` additionally get "search content tokens... billed as a
fixed block of 8,000 input tokens per call" — **in addition to**, not
instead of, the $10/1k fee. That 8,000-token block is ordinary input-token
spend the existing `computeModelCost`/`getModelCostMap()` path already
prices whenever the provider reports it as input tokens; it needed no
special handling in `web-search-cost.ts` at all, and the original
`'token-billed'` exemption that omitted a cost for those two models was a
straightforward pricing error, not a real product distinction. The lesson,
worth stating plainly: **verify which tool variant a provider's SDK
factory actually sends on the wire before pricing it** — a provider's
pricing page can (and here did) have two adjacently-named tools with
substantially different rates, and reading the wrong section produces a
plausible-looking, fully-tested, confidently-wrong number.

### Rates: real values are committed, never a code literal

Every `resolve*Rates` function reads from Cloudflare runtime config and
divides a "per 1,000" figure into a per-unit rate, returning `undefined` for
anything empty, non-finite, or `<= 0`. **No dollar literal exists anywhere
in source or test logic** — a deliberate, explicit constraint, carried over
from a rejected first attempt that hardcoded an unsourced `$0.014` and
applied it uniformly to every Google model regardless of generation.

The real values live in `wrangler.jsonc`, in two places kept in sync by
hand: the top-level (preview) `vars` block and `env.production.vars`. Four
keys today:

```
NUXT_GOOGLE_SEARCH_COST_PER_THOUSAND_QUERIES_USD=14
NUXT_GOOGLE_SEARCH_COST_PER_THOUSAND_GROUNDED_PROMPTS_USD=35
NUXT_ANTHROPIC_WEB_SEARCH_COST_PER_THOUSAND_SEARCHES_USD=10
NUXT_OPENAI_WEB_SEARCH_COST_PER_THOUSAND_CALLS_USD=10
```

Public provider list pricing is a deliberate exception to "config values are
secrets, keep them out of git": it isn't a credential, it's published on a
web page, and having it in git with a dated source comment is strictly
better for review than having it invisible in a Cloudflare dashboard. Only
the Gemini 3.x rate is invoice-verified; the other three are
documentation-only, and the comment above each block says so.

Every cost function mirrors `buildMessageUsage()`'s existing contract: an
unknown cost is `undefined`, never `0`.

### The three integration points

All three live in `server/api/v1/chats/[slug]/index.post.ts`, and all three
now call `resolveSearchUsage({ providerId, modelId, steps, rates })` — the
`search-usage.ts` dispatcher — rather than branching per provider inline.

| Point | Input it reads | What it feeds |
|---|---|---|
| `streamText`'s `onEnd` | `steps` (full) | Axiom wide event |
| `toUIMessageStream`'s `messageMetadata` | buffered per-step content, flushed on `finish-step` | live streamed message metadata |
| `persistAssistantMessageFromStream` | `await result.steps` | the DB row |

No one point reads another's output — each computes independently from the
step data available to it. `messageMetadata` buffers `tool-call`/
`tool-result`/`tool-error` stream parts as they arrive and attaches them to
the step on `finish-step`, because every `finish-step` part is guaranteed by
the stream itself to precede the single `finish` part — an ordering the AI
SDK provides, unlike `onEnd`'s ordering relative to the same transform,
which isn't guaranteed.

`onEnd` writes two distinct things to the same wide event:

- `ai.cost` = `textCost + imageCost + searchCost`, the roll-up the Axiom
  dashboard already sums. Including search cost here **is** the fix — the
  original undercount was precisely this number missing a term.
- `attributes.ai.*` — provider-neutral `webSearchUnits` / `webSearchCost` /
  `webSearchBillingUnit` for all three providers, plus the four
  Google-specific keys (`googleSearchQueries`, `googleSearchGroundedSteps`,
  `googleSearchBillingUnit`, `googleSearchCost`) kept byte-identical to
  PR #385 for dashboard continuity. No `webSearchProvider` key was added —
  the same wide event already carries a flat `providerId`/`modelId`, so
  filtering the generic keys by provider needs no new field.

The `attributes` nesting isn't stylistic. Per `docs/axiom-map-fields.md`,
`besidka-prod` is at Axiom's 256-field-per-dataset cap, and any new flat
nested key becomes a permanent schema field. `attributes` is a declared
Axiom map field, exempt from the field count at any depth. **Every field a
future provider's telemetry adds must go under `attributes`**, or it
re-breaks ingestion.

### The `MessageUsage` extension, and where the number surfaces

```ts
searchUnits?: number
searchBillingUnit?: SearchBillingUnit // 'query' | 'grounded-prompt' | 'search'
searchCost?: number
```

`addSearchUsage()` (`server/utils/ai/message-usage.ts`, generalised from the
Google-only `addGoogleSearchUsage`) sets `searchUnits` **unconditionally**
whenever any provider's search tool was used, `searchBillingUnit` when the
unit is known, and `searchCost` only when a rate resolved.

That asymmetry is the most durable part of the whole design. With no rate
configured, the app still records "this message ran 7 searches" — a human
can multiply that by whatever their invoice says and reconcile. A dollar
figure computed from a stale rate is worse than no dollar figure; a unit
count is never stale.

Contrast with image generation: `addImageGenerationCostToUsage()` *folds*
the image cost into `outputCost`, because to a user a generated image is
part of what the turn produced. Search is deliberately not folded — the
whole reason the original bill was surprising is that a separate SKU was
hiding inside a number labelled "cost."

Precisely:

- **Not folded into `outputCost`.** `searchCost` is its own field.
- **Excluded from the "Current message" line.** `getPerMessageCost()`
  (`shared/utils/message-metadata.ts`) reads `outputCost` only.
- **Included in "Up to this message" and "Chat total."**
  `sumMessageCosts()` adds `getPerMessageCost` and `getPerMessageSearchCost`
  as separate terms.
- **Included in Axiom's `ai.cost`.**
- **Rendered as its own "Web search" row** in
  `app/components/Chat/ContextMenu.client.vue`, labelled through
  `formatSearchGroundingUnits()` (`shared/utils/message-format.ts`) as
  `3 queries`, `1 grounded request`, or `2 searches` depending on
  `billingUnit`, with `~$` prefixed once a cost is known. A missing
  `billingUnit` still defaults to query-wording, preserved on purpose so a
  Google turn with an unrecognised model id degrades gracefully rather than
  rendering nothing.

`getPerMessageSearchCost()` hardcodes `isEstimated: true` — the "~" is
unconditional, for the reason in the callout at the top of this document. It
is also deliberately independent of `hasUnknownTokenSplit()`: a search cost
stays trustworthy even when the token split is not, which is why a
message's own `cost` can render unflagged while the cumulative totals flip
to estimated.

### Model coverage

Native `web_search` is wired for Google, Anthropic, and OpenAI in
`server/utils/providers/*.ts`. In the curated catalogs, every Gemini chat
model and every Claude model carries `tools: ['web_search']`; most OpenAI
chat models do too, with a handful of exceptions (`gpt-5-nano`,
`gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`). As of this fix, **all three
providers' search spend is accounted for** — before it, only Google's third
of the picker was.

## Gray zones

### Billing-unit heterogeneity, and whether bespoke logic scales

Today: Google 2 units across its own generations, Anthropic 1 flat unit,
OpenAI 1 flat unit — but only once the correct tool variant is priced (see
above; the first pass here priced the wrong OpenAI tool and shipped a
3-tier model that was simply wrong, caught in code review before merge, not
a real product distinction). A fourth provider could bill per result, per
"search depth," or per region, or could — like OpenAI — expose multiple
tool variants with different rates for what looks like the same capability
from the outside. Nothing here generalises any of that; it has to be
checked per provider, against the specific SDK call this app actually
makes, every time.

**Opinion, stated rather than hedged: don't build a declarative billing-rule
schema.** The part that varies between providers is *how to extract a unit
count from SDK output*, and that's irreducibly imperative — three providers
already need three unrelated readers. The part a rules engine would
formalise, the rate table, is already config. A schema would add a layer
over the easy half while the hard half stays bespoke.

The right shape is what's shipped: a thin dispatcher returning a normalised
`{ units, billingUnit, cost? }` record, with per-provider counters behind
it. Revisit only if a provider introduces a unit that depends on *request
parameters* (result count, depth) rather than a model-id tier, because
that's the point where the count stops being derivable from the response
alone.

### Forced tool choice means the floor is one unit, not zero

All three providers wire a forced tool choice
(`toolChoice: { type: 'tool', toolName: 'web_search_preview' }`) when the
user enables the tool — Anthropic only when reasoning is off, since it
rejects a forced tool choice alongside extended thinking (see the comment in
`server/utils/providers/anthropic.ts`). So the product behaviour today is
not "the model searches if it decides to"; it's "the user toggles search
on, and at least one billable search is forced." For OpenAI this is
documented behaviour; what Google does with a forced choice on
`googleSearch` (which isn't a function declaration) is unverified.

The consequence for any future native-vs-external routing design: **each
search-enabled turn carries a cost floor of one unit, not zero** — the
toggle is the spend decision, not the model.

### Free quota is not knowable from documentation

Google publishes a free grounding quota. The invoice that triggered PR #385
shows it did not apply, apparently because the project has a paid billing
account attached. That was discovered empirically, from a real bill, and
nothing on the pricing page said so.

Generalising: **a provider's documented rate can't be trusted until it's
been reconciled against one real invoice for this app's actual usage
pattern.** That doesn't scale cleanly — it needs a paid account per
provider, real traffic, and a billing-export read, per provider, per rate
change. The practical policy already in the repo is to mark in the config
comment which rates are invoice-verified and which are documentation-only
(only Gemini 3.x is verified; the other four rates shipped in this
extension are not). Extend that comment discipline to every new rate.

### Pricing drift

The rates are literal strings in two `wrangler.jsonc` blocks with an "as of"
date, kept in sync by hand. There's no staleness check, and **updating one
block and forgetting the other is a concrete failure mode**, not a
hypothetical one — production and non-production would silently diverge,
and the non-production block is the one a local `wrangler dev` reads.

Three options, none chosen here:

1. **Leave it manual.** Defensible: the figures are estimates already, and a
   rate change of a few dollars per thousand moves a number the UI renders
   with a "~".
2. **A dated review reminder** — a line in the release checklist, or a
   scheduled issue, asking a human to re-read the pricing pages. Cheap,
   catches drift within a quarter, no new machinery.
3. **An automated check against the pricing pages.** Tempting and probably a
   trap: pricing pages are unstructured marketing HTML with no stable
   selectors, and a scraper that silently starts matching the wrong number
   is worse than a stale constant.

Preference, weakly held: option 2, plus a lint/test that asserts the two
`wrangler.jsonc` blocks agree with each other, which is cheap and eliminates
the divergence failure entirely. Not implemented yet.

### Double counting, once an external backend exists

If a model has native `web_search` *and* the app could also fire a
Brave/Exa call for the same turn, that's redundant capability and redundant
spend, and the accounting would show two search lines for one user intent.
This must be a **mutually exclusive choice per turn**, resolved before the
request is built, not an additive one.

The available inputs for that decision:

- **Model capability** — already curated per model in `providers/*.ts`
  (`tools: ['web_search']`). A model without it is the unambiguous case for
  an external path.
- **User preference** — a settings toggle, or per-chat. Honest, but pushes a
  decision onto the user that they have no real basis to make.
- **Cost** — an external backend at $5/1,000 (Brave) is cheaper than every
  native option ($10, $14, $25, $35 per 1,000). Cost-based routing would
  therefore always prefer external, which makes it not really a routing
  rule but a default.
- **Quality** — native grounding returns provider-integrated citations
  (`source-url` parts, already rendered by this app); an external tool
  returns raw JSON the model then has to read and cite itself. These
  aren't equivalent outputs, and cost-based routing would quietly degrade
  citation quality.

The defensible rule is *capability-first with an explicit override*: use
native when the model has it, external when it doesn't, and let a user
setting force external if they care about the price difference. Anything
cleverer needs a quality comparison nobody has run.

One concrete naming constraint falls out of this: all three providers
already register their native tool under the local key `web_search_preview`.
**A generic external tool must not reuse that key** — persisted parts
(`tool-web_search_preview`) and any tools-based telemetry would become
unable to distinguish native from external, which is the attribution
problem this whole section is about.

## The AI Gateway question

**besidka does not route through any AI Gateway today.**
`server/utils/providers/{openai,anthropic,google}.ts` each call
`createOpenAI` / `createAnthropic` / `createGoogleGenerativeAI` with nothing
but a decrypted `apiKey` — no `baseURL`, no gateway abstraction anywhere in
the resolution path. Whatever is true about Gateways is currently
hypothetical for this app.

On the stated concern — that a Gateway strips web search from models that
support it directly — the research says it probably isn't real:

- **Vercel AI Gateway** does not strip provider-native tools.
  `anthropic.tools.webSearch_20250305()`, `openai.tools.webSearch({})`, and
  `google.tools.googleSearch({})` all pass through unmodified and bill at
  the underlying provider's normal rate
  (vercel.com/docs/ai-gateway/models-and-providers/web-search, as of
  2026-09-22).
- **Cloudflare AI Gateway** is proxy-based rather than translation-based, in
  both its per-provider passthrough endpoints and its Universal Endpoint.
  The Universal Endpoint's `query` field is documented as "the payload as
  the provider expects it in their official API," which implies native tool
  configs survive intact (developers.cloudflare.com/ai-gateway/usage/universal/,
  .../configuration/bring-your-own-keys/, as of 2026-09-22).

**Neither statement is an explicit end-to-end guarantee for tool calling.**
Both are inferences from architecture descriptions. Before this is treated
as settled it needs one live call through whichever Gateway is actually
relevant, asserting the response still carries `groundingMetadata` /
`server_tool_use` / `web_search_call` — docs-reading isn't verification
here.

**Partially resolved since the above was written, for an unrelated reason:**
a real empirical spike run ahead of the gateway-restoration work (not this
Brave/Exa effort) made exactly that live call — see
`docs/gateway-restoration-and-search-providers-plan.md` § R12 for the full
evidence trail. **Vercel AI Gateway: confirmed PASS.**
`openai.tools.webSearch({})` and `google.tools.googleSearch({})` routed
through `gateway(...)` both genuinely invoked the search tool (real
`tool-call`/`tool-result` steps, real source URLs, live results) and were
billed a separate `billableWebSearchCalls`/`cost` line distinct from
inference cost — proof the tool executed, not an inference from
architecture. **Cloudflare AI Gateway: still inconclusive, blocked on the
owner's account state, not a demonstrated stripping bug.** The request
reached the correct gateway endpoint with `tools:[{type:'web_search'}]`
intact, but every gateway on the tested account rejected it before a 200
(no funded wholesale credits, or no BYOK OpenAI key configured on the
gateway) — an owner action item, not an engineering finding. Treat
Cloudflare as unresolved until an owner funds credits or adds a key and the
saved `test2-cloudflare-gateway-openai-search.mjs` script is re-run to a
real 200.

Separately, and more interesting than the passthrough question: Vercel AI
Gateway ships its **own** model-agnostic search tools usable with any model
regardless of native support — Perplexity $5/1,000, Exa $7/1,000, Tako
$7-12/1,000, Parallel $5/1,000 (same source). That's a genuine alternative
to building a Brave/Exa integration from scratch.

| | Build our own BYOK search tool | Adopt a Gateway's bundled tools |
|---|---|---|
| Prerequisite | none | adopt an AI Gateway across all providers — a much larger architectural decision than this document's scope |
| Key management | one more key type to store, encrypt, expose in settings | none |
| Billing | one direct vendor bill (Brave/Exa) | one Gateway bill, possibly mixed with LLM spend |
| Cost accounting | we count calls ourselves; same problem, new provider | Gateway may report usage, but we'd still be *estimating* per-call cost |
| BYO-key model | preserved — the user's key, the user's bill | breaks it unless the Gateway itself is BYOK |
| Lock-in | swappable backend behind our own interface | search availability tied to staying on that Gateway |
| Provider choice | whatever we integrate | fixed menu |

The BYO-key row is the decisive one. besidka's premise is that the user's
spend lands on the user's own accounts; a Gateway-bundled search tool billed
to *our* Gateway account inverts that. It's only attractive if besidka
adopts a Gateway for other reasons first.

## Sketch: external search backends

**Implemented.** Epic 0 and Epic 1 of
`docs/gateway-restoration-and-search-providers-plan.md` built Brave and Exa
web search substantially as sketched below: BYOK function tools, Brave
first, tool keys distinct from `web_search_preview`
(`web_search_brave`/`web_search_exa`), a separate key-storage surface rather
than a widened `keys` enum, and capability-first routing. What follows is
kept for its reasoning trail, not as a live proposal — see the plan doc for
what actually shipped.

### Candidates

| | Brave Search API | Exa.ai |
|---|---|---|
| Price | $5 / 1,000 requests (Search plan) | $7 / 1,000 standard Search |
| Free | no always-free tier since Feb 2026; $5/mo recurring credit (~1,000 queries), card required, no default overage cap | $20 new-account credit (~2,800 searches) + $10/mo recurring credit, no subscription |
| Returns | structured JSON — URLs, titles, snippets, up to 5/query, plus news/image results | full page content, highlights and citations for the first 10 results; +$1/1,000 beyond 10 |
| Other endpoints | — | Answer $5/1,000; Deep Search $12-15/1,000 |
| Model | keyword search | neural/semantic, auto/fast/instant modes |

(brave.com/search/api/ and exa.ai/pricing, both as of 2026-09-22.)

**Brave is the better default** for a generic "give every model a common
search tool" function: cheaper, simpler output, and everyday chat grounding
doesn't need semantic search. Exa is better positioned as a premium or
secondary backend. Its natural fit is a *self-built* research loop — deep
research in this app is provider-native today (`deep-research-max-preview-04-2026`,
`o3-deep-research`, see `docs/deep-research.md`), so Exa wouldn't plug into
it; it would be the backend for a loop that doesn't currently exist.

### Shape

A server-side AI-SDK **function** tool (not a provider-native one), exposed
to any model, backed by a swappable search-client interface with Brave as
the first implementation. Distinct tool key from `web_search_preview`, per
the constraint above. Routing between it and native search decided per
turn, per the capability-first rule.

### Key storage — checked, and it doesn't generalise for free

What exists today: `server/db/schemas/keys.ts` has `provider: text({ enum:
['openai', 'anthropic', 'google'] })` plus a `uq_key_user_provider` unique
index; encryption goes through `crypto-shield`
(`server/utils/encryption.ts`), keyed on `runtimeConfig.encryptionKey`; REST
routes and Vue components are hand-cloned per provider (`server/api/v1/profiles/keys/{google,anthropic,openai}/`,
`app/components/Profile/Keys/{Google,Anthropic,OpenAi}.vue`).

The **encryption** layer generalises for free — it's just text in, text
out. Nothing else does: the enum needs widening plus a Drizzle migration,
and the routes/components are per-provider files, not a generic form.

More importantly, the enum leaks. The chat handler carries a
`supportedProviderId: 'openai' | 'google' | 'anthropic' | undefined` type
that every provider switch in the chat path reads. Adding `brave` to the
`keys` enum puts a non-LLM value into a type every one of those switches
would then need an unreachable branch for. That's a real argument for a
**separate storage surface for search-provider keys**, not merely a UI
preference — it keeps "which LLM provider" and "which vendor do we hold a
key for" as genuinely different types.

### Accounting implication — genuinely simpler

An external backend has **one** bill from **one** vendor with **one** unit
(a request), regardless of which LLM provider the user is chatting with.
Compare the current model, where each LLM provider adds its own unit, its
own rate, its own extraction path, and its own invoice to reconcile.

That's an argument for external search independent of whether it saves
money, and maybe the stronger one: it collapses an O(providers) accounting
problem into O(1). It doesn't eliminate the estimation problem — we'd still
be counting calls ourselves and multiplying by a list price — but there's
exactly one count and one price to keep correct.

One concrete side effect to handle: `getMessageUsedTools()`
(`shared/utils/message-metadata.ts`) infers that `web_search` was used from
the presence of `source-url`/`source-document` parts. A generic function
tool produces `tool-<name>` parts and, unless results are explicitly
converted to sources, no source parts at all — so external searches
wouldn't light up the existing "Web search" tool badge without an added
detection branch.

### Privacy — a blocker, not a footnote

Sending a user's search query to Brave or Exa is a **new third-party data
flow** to a recipient this app doesn't currently talk to. The query is
user-authored content and can contain anything.

`docs/legal.md` documents that the Privacy Policy carries a "Who else
receives your data" recipients table, and that adding a processor is a
substantive change (the Turnstile precedent there is explicit — Cloudflare's
own terms make the Privacy Addendum link a condition of use). **Any
external-search work requires that analysis to be revisited and the
recipients table updated before shipping, and `updatedAt` bumped.** That
analysis isn't attempted here and shouldn't be attempted by whoever writes
the code either — it's separate work against `docs/legal.md` and
`content/legal/`.

## Non-goals

This document doesn't propose building anything. Specifically out of scope:

- Adopting an AI Gateway, or changing how providers are constructed.
- Integrating Brave, Exa, or any external search vendor.
- A declarative billing-rule engine (argued against above).
- Automated pricing scraping.
- Changing how image generation cost is folded into `outputCost`.
- The privacy analysis for a new processor.
- Retroactively correcting historical Axiom data. Like the map-field fix,
  any accounting change is prospective only — messages persisted before it
  landed have no `searchUnits` and can't gain one.

## If we build this next

**Superseded — this happened.** The ordered list below records the
decisions actually made during Epic 0/1 of
`docs/gateway-restoration-and-search-providers-plan.md`, not a
forward-looking plan; see that document for the execution detail.

Ordered decisions, each blocking the next, before any code:

1. **Verify the two counting unknowns empirically** — does Anthropic's
   `server_tool_use.web_search_requests` counter include errored searches,
   and does one OpenAI `web_search_call` map to exactly one emitted part at
   every integration point. One live call each. Don't trust a count nobody
   has watched.
2. **Decide whether besidka adopts an AI Gateway at all.** A larger
   architectural decision than this document's scope, and it gates
   everything below — if yes, a Gateway's bundled search tools may make
   step 4 unnecessary; if no, step 4 is the only path. If the Gateway
   question is live for other reasons, run the passthrough test call
   ("The AI Gateway question," above) at the same time.
3. **Decide the routing rule** — capability-first with user override, or
   something else — and whether a search-enabled turn may ever produce
   zero billable units given the current forced `toolChoice`.
4. **Decide build-your-own vs. bundled**, informed by (2). If
   build-your-own: Brave first, behind a swappable client interface, with a
   tool key distinct from `web_search_preview`.
5. **Decide the key-storage surface** — widen the `keys` enum and accept
   the `supportedProviderId` leak, or add a separate search-keys table and
   settings surface. Recommendation above is the latter.
6. **Update `docs/legal.md` / `content/legal/`** for the new processor, and
   bump `updatedAt`. This gates shipping, not building.
7. **Add the `wrangler.jsonc` two-block consistency check** regardless of
   everything above — it's a few lines and removes a live failure mode.
