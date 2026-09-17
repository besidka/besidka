# Alibaba (Qwen)

Part of the direct-providers documentation set — see
[`general.md`](./general.md) for the cross-cutting architecture and shared
patterns this file builds on. This app's internal provider id is `qwen`
(the DB `keys.provider` value, the `keyProviderId`, and the
`ProviderIcon`/`provider-meta` lookup key), but the actual provider company
is Alibaba (Alibaba Cloud's Model Studio / DashScope), matching this file's
name and models.dev's catalog key — see "models.dev catalog key" below.

## Curated models

Qwen (48 models — 3 previously curated plus 43 new plus 2 hand-curated
`EXEMPT_IDS` additions): the full list is in `providers/qwen.ts`, ordered by
the same "first-listed is the default" convention as every other provider.
Each new model's reasoning shape is derived mechanically from its
models.dev `reasoning_options`, not hand-guessed per model:

- contains `{"type":"toggle"}` → `reasoning: { mode: 'toggle' }` (19 of the
  43 — this app only ever wires the `enable_thinking` boolean, which is
  exactly that toggle);
- reports reasoning but **no** toggle (either `[]` or `budget_tokens` only)
  → `reasoningAlwaysOn: true` (5 of the 43) — sending
  `enable_thinking: false` to one of these would be a live-key error, the
  same failure class as the Moonshot case documented in
  [`moonshotai.md`](./moonshotai.md);
- no reasoning at all → no `reasoning` field, no `reasoningAlwaysOn` (19 of
  the 43).

**Web search (updated 2026-09-16).** A dedicated DashScope-docs research
pass (both the English and Chinese doc pages) found the Singapore-region
`enable_search` supported-model table covers 13 of the 46 curated models,
not the 2 this document originally shipped with — `qwen3.7-max` was wrongly
excluded on a stale reading, and 10 of the "43 new" ids from this expansion
are on the table too. All 13 are curated with `tools: ['web_search']`; every
other model, including the remaining 33 of the 43 newly added ids, still
ships `tools: []` because it genuinely does not appear in DashScope's
web-search allowlist. See "Web search" below for the full list, the
Qwen3.8 exclusion rationale, and citations.

**Hand-curated additions (updated 2026-09-17): `qwen3.7-flash` and
`qwen3.5-flash`.** models.dev does not yet track these two ids under its
international `alibaba` catalog key — only under the mainland-China
`alibaba-cn` key this app never queries. That is a models.dev
metadata-tracking gap, not a region restriction: Alibaba Cloud's own
dedicated docs pages for both models
(`https://www.alibabacloud.com/help/en/model-studio/qwen3-7-flash` and
`https://www.alibabacloud.com/help/en/model-studio/qwen3-5-flash`) state
`Scope: International` explicitly, confirming both genuinely run on the
Singapore/international DashScope endpoint this app calls. Both are
curated in `providers/qwen.ts` as fully hand-curated entries — the same
pattern as `grok-imagine-image-2.0` in `providers/xai.ts` (see
[`xai.md`](./xai.md#image-generation)) — and added to `EXEMPT_IDS` in
`scripts/fetch-models-metadata.mjs` so `pnpm run models:fetch` never
attempts a models.dev lookup for them and they never appear in
`providers/data/models-dev-snapshot.json`. Both are curated with
`tools: ['web_search']` and `reasoning: { mode: 'toggle' }`, matching their
same-generation `flash`/`plus` siblings. This brings the totals to 48
curated Qwen models and 15 with web search enabled.

**Standing rule: never curate an Alibaba-hosted third-party model id.**
`deepseek-v4-flash-0731` and `glm-5.2` both appear in the live `alibaba`
models.dev catalog (Alibaba resells other vendors' models on DashScope) and
are deliberately excluded, permanently, not just for this PR. This app's
model catalog is keyed by a **flat id with no provider namespace**
(`getModel(id)` scans every provider and the last match wins), so curating
an Alibaba-hosted copy of a model this app already curates under its native
provider (DeepSeek, in this case) would be a latent id collision: the
moment two curated entries share an id, `getModel()` silently resolves to
whichever the provider loop hits last, and a request could route to the
wrong provider with the wrong key. This rule applies to every provider going
forward, not only DeepSeek/GLM (Zhipu) today.

- **First-party `@ai-sdk/alibaba@2.0.46` was evaluated and declined.** It
  exists, its peer `zod: "^3.25.76 || ^4.1.8"` is compatible with this app's
  `zod@^4`, and its default `baseURL` matches the endpoint this app already
  targets — but its `providerOptions.alibaba` is a *closed*
  `z.object({...})` (`enableThinking`, `thinkingBudget`, `parallelToolCalls`,
  `cacheControl`, no `.passthrough()`). This app's Qwen web search depends
  entirely on `enable_search` and `search_options.search_strategy: 'agent'`
  being forwarded verbatim, which works today only because
  `@ai-sdk/openai-compatible` passes through unrecognized `providerOptions`
  keys. Migrating to `@ai-sdk/alibaba` would silently strip both flags — Zod
  drops unknown keys with no error and no warning — breaking Qwen web search
  with nothing in CI able to catch it. `@ai-sdk/alibaba` also exposes no
  image-generation capability at all, so migration buys nothing there
  either. Qwen stays on `@ai-sdk/openai-compatible`; see "openai-compatible
  mechanism, not a dedicated SDK" below for the rest of that wiring. (This
  package's shape also matters for the separate Qwen3.8 web-search gap — see
  "Owner action items" below.)
- **Reversal — `qwen3.8-max`'s `xhigh` exclusion.** This document previously
  excluded `qwen3.8-max` because its reasoning is a three-way
  `toggle`/`effort` (`low`/`medium`/`xhigh`)/`budget_tokens` choice and
  mapping DashScope's `xhigh` onto this app's `low`/`medium`/`high` levels
  had no prior art. **Reversed**, because that concern never actually
  applies to Qwen: this app only ever wires the `enable_thinking` boolean
  for every Qwen model — the effort axis (including `xhigh`) is never sent
  regardless of which model is selected. `qwen3.8-max` is curated as plain
  `reasoning: { mode: 'toggle' }`, identical in shape to every other Group A
  Qwen model, and the `xhigh` incompatibility that blocks xAI's
  `grok-4.6`/`grok-4.20-multi-agent-0309` (see
  [`xai.md`](./xai.md#curated-models)) simply doesn't arise here.
- **Reversal — the rolling-alias exclusion.** This document previously
  excluded the bare `qwen-max`/`qwen-plus`/`qwen-flash`/`qwen-turbo` ids
  because Alibaba's release notices describe them as rolling aliases that
  get silently repointed to a newer dated snapshot over time (e.g.
  `qwen-plus` → `qwen-plus-2025-07-28`), the same "moving target" problem
  this document rejected OpenAI's `-latest` aliases for. **Reversed**:
  models.dev's live `alibaba` catalog carries **no dated Alibaba snapshots
  at all** — the rolling aliases are the only reachable form of these
  models through the endpoint this app calls. Excluding them would mean
  excluding the models entirely, not picking a more stable id for the same
  model. All four are now curated as ordinary Group C (no reasoning field)
  entries.

Server-side wiring lives in `server/utils/providers/qwen.ts`, matching the
existing `use<Provider>()` contract described in
[`general.md`](./general.md#server-side-wiring).

## openai-compatible mechanism, not a dedicated SDK

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

## Web search

A round-3 review of Qwen's empty `tools` declaration was verified against
Alibaba's official docs on 2026-08-09 — see
[`general.md`](./general.md#web-search-reasoning-and-image-generation-across-providers)
for the shared verification practice this and the other providers' web
search findings follow.

**Round 4 re-verification (2026-08-09).** The user raised the same
suspicion again for Qwen's `qwen3.7-max` exclusion, prompting a fresh,
independent re-check against Alibaba's current documentation rather than
trusting the round-3 record. That conclusion held with no code change
required.

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
  is curated, but under Moonshot's own native Moonshot API, never under
  Qwen/DashScope — see [`moonshotai.md`](./moonshotai.md)), not to
  `qwen3.7-max`. There is no per-tier capability gap: `qwen3.7-max`
  supports `enable_search` on the same
  `/compatible-mode/v1/chat/completions` endpoint this app already calls,
  exactly like `qwen3.7-plus`. It is now curated as `tools: ['web_search']`
  in `providers/qwen.ts`, alongside 10 other models the same research pass
  confirmed on the same table — see below for the full list and citations.
  (This round-4 record is kept as-is above, superseded but not rewritten,
  matching the convention described in
  [`general.md`](./general.md#web-search-reasoning-and-image-generation-across-providers).)

**Implemented.** DashScope's built-in web search is a plain
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
- **Extended (2026-09-17) to `qwen3.7-flash` and `qwen3.5-flash`.** Both are
  hand-curated `EXEMPT_IDS` additions (see the "Hand-curated additions"
  note above); Alibaba's own docs for their same-generation `flash`/`plus`
  siblings already on this allowlist, plus each model's dedicated docs
  page, support the same `enable_search` availability, so both are curated
  with `tools: ['web_search']`. This brings the allowlist total to 15
  models, matching `providers/qwen.ts` exactly.
- **Qwen3.8 is deliberately excluded from web search.** Alibaba's Chat
  Completions API for `qwen3.8-max`/`qwen3.8-flash` does not support
  `search_strategy: 'agent'` — the only search strategy priced and
  available on the Singapore endpoint this app calls (`turbo`/`max` are
  Beijing-only). This is a documented incompatibility, not an oversight or
  a pending verification item. See
  https://www.alibabacloud.com/help/en/model-studio/web-search. It's a real
  capability blocked on a second, unimplemented transport, not a mapping
  mistake — see "Owner action items" below for the full detail, including
  Alibaba's documented alternative and an open, unverified question about
  reaching it through this app's existing AI SDK packages.
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
  see "Known gaps requiring live verification" below.

## models.dev catalog key: `alibaba`, not `qwen`

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

## Brand icon (closed)

`app/components/ProviderIcon.vue` originally had no Qwen/Alibaba brand icon
and fell back to the generic two-letter badge (`Qw`). This was closed by a
later round's icon-system rewrite, which replaced every provider's bespoke
SVG component with real Iconify marks resolved at runtime through
`icon.serverBundle.remote` — Qwen now renders `simple-icons:qwen`, alongside
every other provider.

## Known gaps requiring live verification

**Qwen `enable_search` on the international endpoint** — the wiring follows
the Singapore-region docs (agent strategy, the region tab's supported-model
table), but no live DashScope call was made, and Alibaba's docs internally
conflict on exactly the two originally curated models: the Singapore tab's
supported-models table lists `qwen3.7-plus`/`qwen3.6-flash` under the agent
strategy, while the agent strategy's own applicability list names only
3.5-generation models plus bare `qwen3-max`, and no worked example anywhere
in the doc uses a 3.7/3.6 id with `enable_search`. The curated flags
deliberately follow the supported-models table; this live probe is what
resolves that conflict, not a formality. The response carries no explicit
search indicator, so Alibaba's own suggested probe is comparing
input-token counts for the same prompt with and without the flag (a fired
search inflates the prompt by hundreds-to-thousands of tokens). Verify on
`qwen3.7-plus` and `qwen3.6-flash`, and confirm a flagged request is not
rejected when the model chooses not to search. The same EN/ZH
`agent`-strategy-applicability disagreement applies to the 11 models
flipped on 2026-09-16, so extend this probe to at least one newly-flipped
3.5-generation model (e.g. `qwen3.5-plus`) and one 3.6/3.7-generation model
(e.g. `qwen3.6-plus` or `qwen3.7-max`) before treating the wider allowlist
as fully live-confirmed.

**Recommended gate**: one extra pair of Qwen sends — the same prompt with
the web-search toggle on and off — comparing the two input-token counts in
the context menu. This is in addition to the cross-provider
streamed-completion gate described in
[`general.md`](./general.md#known-gaps-requiring-live-verification).

## Owner action items

**Unverifiable without a live key (model catalog expansion, 2026-09-16).**
Each of these was a recorded decision point
(`docs/model-catalog-expansion-plan.md` § 8) resolved with a documented,
best-evidence recommendation rather than a live call, because no live
DashScope key is available in this environment:

- **Qwen web search on the remaining 33 unflagged new models (updated
  2026-09-16).** A DashScope-docs research pass confirmed 13 of the 46
  curated Qwen models against the Singapore-region `enable_search`
  supported-model table and flipped them to `tools: ['web_search']` — see
  "Web search" above for the full list. The other 33 (all from this
  expansion's "43 new" set) still ship `tools: []` because they genuinely do
  not appear in that table, not because verification is pending — a
  DashScope per-model pass already ran over the full 46. Only a live-key
  probe (see "Known gaps requiring live verification" above) remains open,
  not a documentation gap.
- **Qwen3.8's blocked-on-a-second-transport web search gap — real
  capability, unimplemented transport, not a bug.** `qwen3.8-max` and
  `qwen3.8-flash` are excluded from web search not because they lack the
  capability, but because Alibaba's own docs state they don't support
  `search_strategy: 'agent'` on the Chat-Completions/DashScope-compatible
  API (the only strategy priced on the Singapore endpoint this app uses) —
  see "Qwen3.8 is deliberately excluded from web search" above. The
  documented alternative is Alibaba's own separate "Responses API"
  (analogous to, but distinct from, OpenAI's Responses API), where agentic
  web search is a proper tool the model calls itself. Confirmed via
  `ai-sdk.dev`'s Alibaba provider page that `@ai-sdk/alibaba` (the AI SDK
  package this app doesn't currently use for Qwen, staying on
  `@ai-sdk/openai-compatible` instead — see "First-party `@ai-sdk/alibaba`
  was evaluated and declined" above) implements ONLY the OpenAI-compatible
  chat-completions shape; it has zero support for any Responses API,
  agentic tool-calling, or web search. Closing this gap for real would mean
  a second, dedicated Alibaba Responses-API transport — a candidate
  follow-up PR, not a quick flag flip, following the same shape as
  DeepSeek's unwired Anthropic-compatible endpoint (see
  [`deepseek.md`](./deepseek.md#owner-action-items)).

  **Open, unverified question — needs its own dedicated research pass
  before anyone treats it as viable**: whether Alibaba's Responses API
  happens to speak the same JSON shape as OpenAI's Responses API, such that
  `@ai-sdk/openai`'s `.responses()` factory could be pointed at Alibaba's
  base URL — the way DeepSeek's Anthropic-compatible endpoint is reachable
  via `@ai-sdk/anthropic` pointed at a different base URL. This is **not
  confirmed** one way or the other; nothing in this pass's research
  established whether the two Responses API shapes are actually compatible,
  only that `@ai-sdk/alibaba` itself doesn't implement either one.
