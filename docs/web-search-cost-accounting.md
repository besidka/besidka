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

As shipped, this app accounts for separately-billed web search on Google,
Anthropic, and OpenAI (the three providers that existed when this pattern
was built; Brave and Exa are covered separately by
`external-search-cost.ts`, see "Sketch: external search backends") through a
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
  rate invoice-verified (paid-one SKU); free allowance not modelled.
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
hand: the top-level (preview) `vars` block and `env.production.vars`. Six
keys today, all under the `NUXT_PUBLIC_` prefix:

```
NUXT_PUBLIC_GOOGLE_SEARCH_COST_PER_THOUSAND_QUERIES_USD=14
NUXT_PUBLIC_GOOGLE_SEARCH_COST_PER_THOUSAND_GROUNDED_PROMPTS_USD=35
NUXT_PUBLIC_ANTHROPIC_WEB_SEARCH_COST_PER_THOUSAND_SEARCHES_USD=10
NUXT_PUBLIC_OPENAI_WEB_SEARCH_COST_PER_THOUSAND_CALLS_USD=10
NUXT_PUBLIC_BRAVE_SEARCH_COST_PER_THOUSAND_REQUESTS_USD=5
NUXT_PUBLIC_EXA_SEARCH_COST_PER_THOUSAND_REQUESTS_USD=7
```

Public provider list pricing is a deliberate exception to "config values are
secrets, keep them out of git": it isn't a credential, it's published on a
web page, and having it in git with a dated source comment is strictly
better for review than having it invisible in a Cloudflare dashboard. Only
the Gemini 3.x rate is invoice-verified (paid-one SKU; its free allowance
is not modelled); the other five are documentation-only, and the comment
above each block says so.

These six keys live in `runtimeConfig.public` (not private
`runtimeConfig`) — they are the single source of truth for search pricing.
`server/api/v1/chats/[slug]/index.post.ts` reads them via
`resolveSearchRates(useRuntimeConfig(event).public)` for cost accounting,
and `app/components/Profile/Keys/SearchProvidersInfo.vue` reads the same
`useRuntimeConfig().public` values to render the pricing table shown to
users — no hardcoded display constants in the component, and no
wrangler-parsing assertions in its test (`wrangler-search-rates.spec.ts`
still parses `wrangler.jsonc` directly, to guarantee the preview and
production `vars` blocks agree).

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
  PR #385 for dashboard continuity. **Superseded:** a `webSearchProvider`
  key was added later, once Brave/Exa made "which provider ran the search"
  different from `providerId` — see "Dashboard queries" below.

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

## Dashboard queries

### The problem

The owner's existing Axiom widgets group by `providerId` — the model's own
direct provider (google/anthropic/openai/xai). That conflates the model's
provider with which search tool actually ran: a Brave or Exa search fired
on a Google model still gets bucketed under `google`, so an external BYOK
search never shows up as its own series. The field that actually
distinguishes them, `attributes.ai.webSearchProvider` (set at
`server/api/v1/chats/[slug]/index.post.ts:1134`, typed as `SearchProvider`
in `shared/types/message-usage.d.ts:8-9` — `'google' | 'anthropic' |
'openai' | 'xai' | 'brave' | 'exa'`), already carries this distinction. The
widgets just don't group by it yet.

### The fix

Both widgets change their `by` clause from `provider = ['providerId']` to
`searchProvider = tostring(attributes['ai']['webSearchProvider'])`.

**Web search queries per provider:**

```
['besidka-prod']
| where operation == 'ai-stream'
| where isnotnull(attributes['ai']['webSearchUnits'])
| summarize searchUnits = sum(toint(attributes['ai']['webSearchUnits']))
  by bin(_time, 30d),
     searchProvider = tostring(attributes['ai']['webSearchProvider'])
```

**Web search cost per provider:**

```
['besidka-prod']
| where operation == 'ai-stream'
| where isnotnull(attributes['ai']['webSearchCost'])
| summarize searchCostUsd = sum(todouble(attributes['ai']['webSearchCost']))
  by bin(_time, 30d),
     searchProvider = tostring(attributes['ai']['webSearchProvider'])
```

The cost widget sums with `todouble`, not `toint` — `webSearchCost` is a
dollar figure and routinely well under 1.

**Optional: native vs. gateway split.** Not required — the owner called
this "nice to have," not needed. Add an `extend` before the `summarize`
and a second `by` dimension:

```
| extend route = iff(isnotnull(attributes['chat']['gateway']),
    strcat('via ', tostring(attributes['chat']['gateway'])), 'native')
| summarize searchUnits = sum(toint(attributes['ai']['webSearchUnits']))
  by bin(_time, 30d),
     searchProvider = tostring(attributes['ai']['webSearchProvider']),
     route
```

`attributes.chat.gateway` (`server/api/v1/chats/[slug]/index.post.ts:549-559`)
is set to `'vercel' | 'openrouter' | 'cloudflare'` only when the send is
gateway-routed; it's absent entirely for a direct-provider send, which is
exactly what `isnotnull` is testing for.

### Caveats

- **Unverified live.** Nobody has confirmed `webSearchProvider` is actually
  populated for a real Brave or Exa row in `besidka-prod` (or the preview
  dataset) yet. Run a one-off, read-only check before trusting either
  widget:
  ```
  ['besidka-prod']
  | where attributes['ai']['webSearchProvider'] in ('brave', 'exa')
  | take 5
  ```
  The field was added on `feat/add-more-providers`
  (`da88f71 feat(chat): wire Brave/Exa tools into the send path, cost,
  telemetry`), which is not yet on `main`. Until that branch deploys,
  `besidka-prod` has zero rows carrying this field, so the check above
  returning nothing is expected pre-deploy, not evidence of a bug.
- **No map-field re-declaration needed.** Per `docs/axiom-map-fields.md`,
  the declaration lives on `attributes` itself, at any depth: "anything
  nested under it, at any depth, is exempt from the field-count check, no
  matter how many different sub-keys different call sites add over time."
  `webSearchProvider` is a new key under the already-declared `attributes`
  map, not a new top-level field, so `scripts/axiom-declare-map-field.mjs`
  does not need to run again for it.
- **Rows predating this field.** A message persisted before
  `webSearchProvider` existed has no value for it —
  `tostring(attributes['ai']['webSearchProvider'])` on a missing key
  resolves to an empty string, so historical rows appear as an unlabeled
  `""` series rather than disappearing. If continuity with old data
  matters more than a clean split, replace the bare `tostring(...)` with
  `coalesce(tostring(attributes['ai']['webSearchProvider']),
  tostring(['providerId']))` in both widgets.
- **This lives in Axiom, not this repo.** The dashboard is a separate,
  ungitted Axiom project (its own widget-editor UI) — this section is the
  reference the owner pastes the APL from, not something this codebase
  deploys.
- **Gateway-native search stays invisible here, by design.** OpenRouter's
  `web` plugin and Vercel's bundled search tools (`perplexitySearch()` and
  similar) never populate `webSearchUnits`/`webSearchProvider` at all:
  `resolveUnbundledSearchUsage`
  (`server/api/v1/chats/[slug]/index.post.ts:1552-1571`) returns
  `undefined` whenever a gateway is in play without a BYOK external-search
  provider, because that search's cost already lives inside the gateway's
  blended `totalCost` — see "Double counting, once an external backend
  exists" below. That's correct for cost (nothing is double-billed), but
  it means a `webSearchUnits`-based widget will never show
  OpenRouter- or Vercel-native search volume, even after this fix.
- **`xai` is a defined `SearchProvider` value that never populates today.**
  xAI wires a native `web_search` tool
  (`server/utils/providers/xai.ts:87-103`), but `resolveSearchUsage`'s
  fallback branch only tags `provider` for `anthropic`/`openai`
  (`server/utils/ai/search-usage.ts:139-142`), and `getWebSearchUsage`
  itself gates on those same two providers
  (`server/utils/ai/web-search-cost.ts:49`) — so an xAI search-enabled
  turn returns `undefined` from `resolveSearchUsage` before
  `webSearchProvider` is ever set. An `xai` series appearing in either
  widget would mean that gate changed, not that xAI search is being
  counted today. Pre-existing gap in the counting code, unrelated to this
  query fix.

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

OpenAI and Google wire a forced tool choice
(`toolChoice: { type: 'tool', toolName: 'web_search_preview' }`) when the
user enables the tool. Anthropic never does: it rejects a forced tool choice
alongside extended thinking, and the Claude 5.5 generation rejects it
outright (see the JSDoc in `server/utils/providers/anthropic.ts`), so
Anthropic runs on `auto` and the model decides whether to search. For OpenAI
the forced search is documented behaviour; what Google does with a forced
choice on `googleSearch` (which isn't a function declaration) is unverified.

The consequence for any future native-vs-external routing design: **on
OpenAI and Google each search-enabled turn carries a cost floor of one unit,
not zero** — the toggle is the spend decision, not the model. Anthropic
turns have a floor of zero.

### The free quota exists; PR #385 verified the rate, not its absence

An independent investigation (2026-09-25) corrected the earlier claim
here — that the free grounding quota "did not apply" because the
billing account was paid. Google's Gemini API pricing documents a free
allowance that exists only on the paid tier: 5,000 search queries/month
for Gemini 3.x (shared across the 3.x family), and 1,500 grounded
prompts/day for Gemini 2.5 on the paid tier (Flash/Flash-Lite also get
500/day on the free tier). Archived pricing pages from Dec 2025 through
Sep 2026 show it was never removed — only the counting-unit wording
changed, from "prompts" to "search requests/queries".

The Gemini API SKU catalog (service `AEFD-7695-64FA`) has a free/paid
pair per family: `Generate content search query gemini 3 free`
(`7166-DCCD-7D46`, $0) vs. `... gemini 3 paid one` (`E662-8171-51CB`,
flat $14/1,000); for 2.5, `FAF4-1886-D9DB` (free) vs. `1590-B4E9-A799`
(paid one, $35). The PR #385 invoice line was the **paid-one** SKU — it
verified the $14 rate, not the absence of a free pool. 521 charged
queries is compatible with an exhausted allowance: Gemini 3.x models
fan out several queries per prompt, and the pool may be shared with
other projects on the same billing account. Google staff have also
confirmed an April 2026 grounding billing misconfiguration that
over-billed searches (since refunded) — another reason one invoice
can't stand in for documented pricing.

Only the billing export settles a given month: group Gemini API usage
by SKU; any free-SKU rows before the first paid-one row mean the pool
wasn't yet exhausted that month.

**Policy is unchanged** by this correction: cost estimates are list
price × units, computed before any free allowance, because the app has
no way to see a user's remaining pool. Unit counts are always recorded
regardless, so a human can reconcile against their own invoice.

**Known gap:** query dedup (`getGoogleSearchGrounding`) spans all steps
of a multi-step turn, while Google counts unique queries per
`generateContent` call — i.e. per step. A query repeated in a later
step is billed by Google but counted once here. Not fixed in this
pass — follow-up.

**2026-09-29 update.** The owner's Aug–Sep invoices showed paid-SKU
billing at 178 and 850 monthly units, with 0 free units on the prepay
account. Google Cloud Support attributed this to an undocumented daily
allocation (~161–166/day) and to prepay routing usage straight to paid
SKUs. Neither appears in any published Google doc (pricing, billing,
grounding, Gemini API terms, Cloud ToS, prepay/in-product billing
setup, which instead states "products with a Free Tier continue to
offer free usage up to their specified limits"). The owner's data
(Aug 22: 26 free of 58; Sep 20 prepay: 0 free of 24) also contradicts
the daily claim. The UI now tells users the documented allowance may
not be applied, and estimates stay list price from the first query.

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
the divergence failure entirely. The consistency test is implemented
(`tests/unit/config/wrangler-search-rates.spec.ts`); the dated review
reminder is not.

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

**Status, 2026-10-03: besidka now routes through AI Gateways, but only
when the user explicitly selects one.** Direct providers stay the default
routing path — the `server/utils/providers/*.ts` builders still construct
each direct provider from the user's own key with no `baseURL`. Vercel AI
Gateway, Cloudflare AI Gateway and OpenRouter are an optional,
user-selected layer built in `server/utils/gateways/` (see
`docs/providers/gateways.md`), and a direct-provider key is never routed
through one. The question below was written when this was hypothetical; it
is kept as the pre-written case for that restoration, and its passthrough
question is only partly answered (see "Partially resolved" below).

The paragraphs from here through the "Partially resolved" note record what
was known on 2026-09-22, before gateways were restored.

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

**Still open after the restoration (post-merge):** the Cloudflare half of
the passthrough question, and a BYOK-header re-check on Vercel and
OpenRouter. OpenRouter is not a passthrough at all — its native-tool
object is rejected with HTTP 400, and the shipped path uses its own
`plugins: [{ id: 'web' }]` request flag instead, whose cost arrives
blended into `usage.cost` (the double-count guard in
`docs/providers/gateways.md` keeps it from also emitting a search line).

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
(`web_search_brave`/`web_search_exa`), and capability-first routing. The
one deliberate departure is key storage, which went the other way — see
"Key storage" below. What follows is kept for its reasoning trail, not as a
live proposal — see the plan doc for what actually shipped.

Shipped request shapes are fixed module constants, not model-configurable
apart from an optional `freshness` input
(`server/utils/search/{brave,exa,freshness}.ts`); see "Richer page content,
same unit" below for the current shapes. Exa's pricing page lists a
$1/1,000-per-extracted-page charge that would make a 10-result content
request $17/1,000 ($7 base plus 10 pages), but live calls on 2026-09-22
(`contents.highlights: true`) and 2026-10-04 (`contents.text.maxCharacters:
1500`) all reported `costDollars.total: 0.007`. The live path therefore
prefers the vendor-reported `costDollars` and falls back to the committed
$7/1,000 rate only when the response omits it; revisit the $17 figure with
more samples before raising that fallback.

### Richer page content, same unit

The search tools used to hand the model only short snippets (Brave's Web
Search `description`, Exa's `highlights`). They now return real page
content, with no change to the billing unit (still one request per tool
call) or to either rate:

| | Request | Snippet |
|---|---|---|
| Brave | `GET /res/v1/llm/context` with `q`, `count=8`, `maximum_number_of_tokens=3072`, `maximum_number_of_tokens_per_url=1024`, `enable_source_metadata=true` (was `/res/v1/web/search`, `count=10`, `result_filter=web`) | `grounding.generic[].snippets` joined with `\n`; title falls back to `sources[url].title`, then hostname; `publishedDate` is `sources[url].age[3]` (full ISO timestamp), falling back to `age[1]`, and only when the value matches an ISO date/datetime pattern |
| Exa | `POST /search` with `type: 'auto'`, `numResults: 10`, `contents.text.maxCharacters: 1500` (was `contents.highlights: true`) | `results[].text`, falling back to joined `highlights`, else empty |

Why the rate is unchanged:

- **Exa** — the 2026-10-04 live call with exactly this body returned
  `costDollars {"total":0.007,"search":{"neural":0.007}}`: text content up
  to 1,500 characters is bundled into the $7/1,000 search price, same as
  the highlights shape. The rate constant stays derived from this exact
  request shape, which is why `exa.ts` documents it as an invariant.
- **Brave** — the LLM Context endpoint is part of the same Search plan at
  $5/1,000 requests as Web Search, so one call is still one billed request.
  The `braveWebSearch.resultCount` log attribute is unchanged.

Both tools also accept an optional `freshness: 'day' | 'week' | 'month' |
'year'`. Brave maps it to `freshness=pd|pw|pm|py`; Exa maps it to
`startPublishedDate` (now minus 1/7/31/365 days, ISO string). The model is
told to set it for news and recent-events queries; omitted means no filter.
A filter does not change the request count or price.

The trade-off is LLM input tokens, not search cost. Page content is
roughly an order of magnitude longer than a snippet, and the tool result is
resent to the model on every later step of the tool loop. The size is
therefore capped by constants, not by the user: Brave by the token budgets
above, Exa by `maxCharacters`, and the guaranteed-answer continuation
(`server/utils/ai/search-answer-continuation.ts`) by
`SEARCH_ANSWER_RESULT_SNIPPET_MAX_CHARS = 1500` per result (tool input
and error text use the separate `SEARCH_ANSWER_AUXILIARY_TEXT_MAX_CHARS =
600`) and `SEARCH_ANSWER_CONTEXT_MAX_CHARS = 32_000` in total (24 results
max). That extra input is priced by the ordinary model-token path
(`computeModelCost`), not by the search-cost dispatcher.

Earlier turns do not re-pay for it: `sanitizeMessagesForModelContext` drops
every tool and `source-url` part from previous messages before the prompt is
built, so search output costs input tokens only on the turn that gathered
it.

### Per-turn call cap and untrusted content

Richer content raises both the cost and the injection surface of each
search call, so three guards sit next to it:

- **Per-turn call cap.** A per-request `ExternalSearchBudget`
  (`server/utils/search/search-budget.ts`) is shared by the Brave and Exa
  tool `execute`s. Past `EXTERNAL_SEARCH_MAX_CALLS_PER_TURN = 8` the call
  throws before any provider request, which the AI SDK turns into a
  `tool-error` part. `getExternalSearchUsage` counts `tool-result` parts
  only, so the rejected call adds neither a fetch nor a billed unit; a
  turn that hits the cap records exactly 8 search units. The cap is needed
  because one step can fan out parallel calls and Anthropic keeps tools
  declared on the forced final step.
- **Tag neutralisation.** The continuation wraps results in
  `<untrusted_web_search_results>` and replaces every `<` and `>` in the
  wrapped text with `‹`/`›`. Stripping the tag name instead is bypassable
  by nesting it inside itself.
- **Source URL scheme allowlist.** Only `http:`/`https:` result URLs are
  emitted as `source-url` parts and opened from `UrlSources.vue`
  (`shared/utils/http-url.ts`), so a `javascript:` or `data:` URL in a
  search result never becomes a clickable source.

A 400/422 from either provider maps to a non-transient "rejected the search
request as invalid" error instead of "temporarily unavailable".

### Candidates

| | Brave Search API | Exa.ai |
|---|---|---|
| Price | $5 / 1,000 requests (Search plan) | $7 / 1,000 standard Search |
| Free | no always-free tier since Feb 2026; $5/mo recurring credit (~1,000 queries), card required, no default overage cap | $20 new-account credit (~2,800 searches) + $10/mo recurring credit, no subscription |
| Returns | structured JSON — URLs, titles, snippets, up to 5/query, plus news/image results (shipped tool uses the LLM Context endpoint instead, see above) | full page content, highlights and citations for the first 10 results; +$1/1,000 beyond 10 |
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

> **Reversed.** The separate-surface recommendation below was not followed.
> The `keys.provider` enum in `server/db/schemas/keys.ts` was widened to
> include `brave`, `exa` and the three gateway ids, and the `keys` table
> holds every one of them. The feared `SupportedProviderId` leak does not
> exist: the chat handler's `toSupportedProviderId()` narrows an arbitrary
> string to the LLM-provider union, and gateway ids travel as a separate
> `GatewayId` type. The text is kept below, unedited, as the reasoning
> trail.

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

(Both of the above were later done — see the "Implemented" notes in this
document and `docs/providers/gateways.md`. This list records the scope of
the original investigation.)
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

Ordered decisions, each blocking the next, before any code. Each is marked
with how it resolved:

1. **Verify the two counting unknowns empirically** — does Anthropic's
   `server_tool_use.web_search_requests` counter include errored searches,
   and does one OpenAI `web_search_call` map to exactly one emitted part at
   every integration point. One live call each. Don't trust a count nobody
   has watched. *Still unverified live for Anthropic's counter; the
   structural `tool-result` fallback provably excludes errored searches, and
   unit counts are always recorded so a human can reconcile.*
2. **Decide whether besidka adopts an AI Gateway at all.** *Resolved:
   gateways are an optional, user-selected layer; direct providers remain
   the default (`docs/providers/gateways.md`). The passthrough test ran for
   Vercel (pass) and OpenRouter (incompatible, uses its own plugin);
   Cloudflare is still open.*
3. **Decide the routing rule.** *Resolved: capability-first, and at most
   one of `web_search` / `web_search_brave` / `web_search_exa` is active per
   turn (`docs/gateway-restoration-and-search-providers-plan.md`).*
4. **Decide build-your-own vs. bundled.** *Resolved: build-your-own, Brave
   first and Exa second, behind a swappable client interface, with tool keys
   `web_search_brave`/`web_search_exa` distinct from `web_search_preview`.*
5. **Decide the key-storage surface.** *Resolved the opposite way from this
   document's recommendation: the `keys` enum was widened (see "Key
   storage" above).*
6. **Update `docs/legal.md` / `content/legal/`** for the new processor, and
   bump `updatedAt`. *Done: `content/legal/` now covers search vendors and
   gateways; see `docs/legal.md`.*
7. **Add the `wrangler.jsonc` two-block consistency check.** *Implemented:
   `tests/unit/config/wrangler-search-rates.spec.ts` asserts the preview and
   production `vars` blocks agree.*
