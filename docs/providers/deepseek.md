# DeepSeek

Part of the direct-providers documentation set — see
[`general.md`](./general.md) for the cross-cutting architecture and shared
patterns this file builds on.

## Curated models

`deepseek-flash` (default/first-listed) and `deepseek-v4-pro` — a full
replacement of the previously curated `deepseek-chat` and
`deepseek-reasoner`, which were retired upstream on 2026-07-24 and no longer
exist in models.dev's `deepseek` catalog at all. The retirement wasn't
cosmetic: it broke `pnpm run models:fetch` outright ("models.dev no longer
lists 2 curated model(s)"), blocking every other catalog change in this PR
until it was fixed first. Both replacements are curated with
`reasoning: { mode: 'levels', levels: ['low', 'high'] }` and can still be
switched off (updated 2026-10-15; they were first curated as plain toggles).
DeepSeek's docs for both models give `reasoning_effort` as `none`/`low`/
`high`/`max` with thinking on by default and the default effort `high`;
`minimal` maps to `low`, and `medium` and `xhigh` map to `high`. Besidka's
scale is `off|low|medium|high` by owner decision (`max` targets coding and
agentic workloads, not chat, so High is the cap), so the menu shows Off, Low
and High, and a requested Medium rounds up to High (see
[`chat-reasoning.md`](../chat-reasoning.md#reasoning-scale-and-the-round-up-rule)).
Earlier revisions of this document called the two effort axes incompatible
and curated a toggle; a lossless mapping onto `low`/`high` does exist, and
`medium` is covered by the round-up rule instead of a synthesized level.
DeepSeek also
bills a 2x peak/off-peak pricing multiplier that
`server/utils/ai/cost-map.ts`'s single flat per-model rate does not model —
a known, disclosed limitation, not something this PR attempts to fix. Still
no native web_search or image_generation — re-verified against DeepSeek's
official API docs, see "Web search" below. **Superseded for web search
(2026-10-17):** both models now carry `tools: ['web_search']` through
DeepSeek's standalone Search API — see "Correction (2026-10-17)" at the end
of this document.

Server-side wiring lives in `server/utils/providers/deepseek.ts`, matching
the existing `use<Provider>()` contract described in
[`general.md`](./general.md#server-side-wiring).

## Package version note

`@ai-sdk/deepseek@3.x` ships on a lower major than this app's `ai@7`/
`@ai-sdk/provider@4` line — see
[`general.md`](./general.md#package-versions) for the cross-provider version
note this is part of. **Correction**: an earlier draft of this plan assumed
`@ai-sdk/deepseek` needed a bump to `3.0.45` before it could support
`reasoningEffort`. That's wrong — the installed `3.0.26` already shipped the
full `reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"])`
schema and the `thinking.type` field, read directly from
`node_modules/@ai-sdk/deepseek/dist/index.js`.

**Reasoning wiring (updated 2026-10-15, `@ai-sdk/deepseek@3.0.63`).**
`useDeepSeek()` always sends `providerOptions.deepseek.thinking` as
`enabled` or `disabled` for a reasoning model, plus the top-level
`reasoning` option for the effort. The explicit `thinking` is required
because the installed provider treats V4 models as thinking-enabled whenever
no `thinking` is sent, so an `off` request that sent nothing would stay on.
The provider maps `medium` to `high` and omits `reasoning_effort` when
thinking is disabled, so `off` sends only `thinking: disabled`.

## Web search

A round-3 review of DeepSeek's empty `tools` declaration was verified
against DeepSeek's official docs on 2026-08-09 — see
[`general.md`](./general.md#web-search-reasoning-and-image-generation-across-providers)
for the shared verification practice this and the other providers' web
search findings follow.

**Round 4 re-verification (2026-08-09).** The API changelog now extends
through 2026-07-31 (DeepSeek-V4-Flash public beta) and still announces no
search, grounding, or `enable_search` capability of any kind. Nothing
changed since round 3; `providers/deepseek.ts` correctly keeps `tools: []`.
(Superseded 2026-10-17 — DeepSeek has since shipped a standalone Search API;
see "Correction (2026-10-17)" at the end of this document.)

**Correction (2026-09-16), scoped narrowly.** The "no first-party mechanism"
conclusion for DeepSeek's OpenAI-compatible endpoint (the one this app
actually calls) still stands. But a separate research pass found the
earlier claim about DeepSeek's *Anthropic-compatible* endpoint was wrong —
it genuinely accepts Anthropic's `web_search_20250305` server-tool type as
documented functionality, not incidental schema tolerance. See "No
first-party mechanism on the endpoint this app uses" below for the
corrected record and why this isn't wired yet.

This record predates that 2026-09-16 correction; it is kept as-is above so
the reversal itself stays legible, rather than silently rewritten.

**No first-party mechanism on the endpoint this app uses (corrected
2026-09-16).** DeepSeek's OpenAI-compatible developer API — the transport
this app actually calls via `@ai-sdk/deepseek` — has no built-in web search
as of 2026-08. Checked: the Chat Completions reference
(`https://api-docs.deepseek.com/api/create-chat-completion/`) documents no
`enable_search`/`web_search`/`search_options` parameter, and its `tools`
parameter states verbatim "Currently, only functions are supported as a
tool"; the full API change log (`https://api-docs.deepseek.com/updates/`,
2024-05-17 through 2026-07-31, covering every model line through
V4/V4-Flash) never announces a search or grounding feature; and the
chat.deepseek.com consumer app's "Search" toggle is a product feature, not
an API capability — an API request does not browse. That part of the
2026-08-09 record still holds.

**Correction: the Anthropic-compatible endpoint is a genuine second
mechanism, not schema tolerance.** The 2026-08-09 record above misread the
Anthropic-compatible endpoint
(`https://api.deepseek.com/anthropic/v1/messages`, documented at
`https://api-docs.deepseek.com/guides/anthropic_api`) as merely tolerating
`server_tool_use`/`web_search_tool_result` content blocks for conversation
history, with no way to actually request a server-side search. A separate,
later research pass found this wrong: that endpoint genuinely accepts
Anthropic's `web_search_20250305` server-tool type as documented DeepSeek
functionality — a real first-party web search mechanism, just on a
different transport (`@ai-sdk/anthropic` pointed at DeepSeek's Anthropic
base URL) than the one this app currently uses for DeepSeek
(`@ai-sdk/deepseek` against the OpenAI-compatible endpoint). Wiring it is
deliberately **not** done in this round — see "Owner action items" below
for the five live-key details that need verification first — so
`providers/deepseek.ts` keeps every DeepSeek model at `tools: []` for now
(superseded 2026-10-17 by the standalone Search API — see "Correction
(2026-10-17)" at the end of this document, which wires search without the
Anthropic-compatible transport). This is a candidate follow-up, not the same "not now, skip" product
decision recorded on 2026-08-09 against Besidka building its own non-BYOK
search backend (that decision is unaffected and still stands).

Moonshot AI's analogous Anthropic-compatible endpoint does **not** share
this capability — see
[`moonshotai.md`](./moonshotai.md#web-search--implemented-via-the-formula-api)
("The Anthropic-compatible endpoint is not a backdoor") for that comparison.

## Owner action items

Nothing is required to deploy for DeepSeek specifically — see
[`general.md`](./general.md#owner-action-items) for the cross-cutting
deploy-readiness framing.

**Unverifiable without a live key (model catalog expansion, 2026-09-16).**
Each of these was a recorded decision point
(`docs/model-catalog-expansion-plan.md` § 8) resolved with a documented,
best-evidence recommendation rather than a live call, because no live
DeepSeek key is available in this environment:

- **Removing `deepseek-chat`/`deepseek-reasoner` outright** rather than
  keeping them as deprecated safety-net entries. Both ids are gone from
  models.dev, so keeping them would need `EXEMPT_IDS` plus full hand
  curation of models that hard-fail on every real send. A user with either
  id persisted already falls back safely to the default model
  (`app/composables/model.ts`'s `useUserModel()` guard) — confirm this
  fallback in practice on the first live DeepSeek smoke test.
- **DeepSeek's Anthropic-compatible web search endpoint — candidate
  follow-up, not wired this round.** DeepSeek genuinely supports
  Anthropic's `web_search_20250305` server-tool type on its
  Anthropic-compatible endpoint (`https://api.deepseek.com/anthropic/v1/
  messages`), a real first-party mechanism this app does not currently use
  — see "No first-party mechanism on the endpoint this app uses" above.
  Wiring it would mean adding `@ai-sdk/anthropic` pointed at that base URL
  as a second DeepSeek transport, alongside the existing
  `@ai-sdk/deepseek`-against-OpenAI-compatible wiring. Left unwired this
  round pending live-key verification of:
  1. whether the endpoint is accepted from typical BYOK client user-agents
     outside Anthropic's own SDK/Claude Code, or whether it rejects or
     rate-limits unrecognized callers;
  2. reasoning-parameter shape differences on the Anthropic-compatible
     endpoint versus the OpenAI-compatible endpoint this app already
     handles in `server/utils/providers/deepseek.ts`;
  3. `top_p` semantics differences between the two endpoints, which could
     silently change generation behavior for non-search turns too if this
     transport were ever used as a general replacement;
  4. whether hidden search-result-summarization tokens the endpoint may
     bill are captured by this app's existing cost-map, or would need a
     new entry;
  5. general endpoint behavior parity with the OpenAI-compatible endpoint
     (error shapes, streaming semantics, model id acceptance) before
     trusting it for anything beyond search.

## Correction (2026-10-17)

Two things in the sections above are out of date as of 2026-10-17. The
earlier text is kept in place, annotated, rather than rewritten.

**The "new model" is the existing `deepseek-flash` id.** DeepSeek announced
V4.1-Flash-1017, but it is served under the existing `deepseek-flash` model
id with unchanged pricing. There is no catalog id change, no new entry in
`providers/deepseek.ts`, and `scripts/fetch-models-metadata.mjs` was
deliberately not re-run for it.

**DeepSeek now has a first-party web search mechanism on the
OpenAI-compatible endpoint: the standalone Search API.** "No first-party
mechanism on the endpoint this app uses" is no longer true for web search.
Both `deepseek-flash` and `deepseek-v4-pro` now carry
`tools: ['web_search']`.

- **Endpoint.** `POST https://api.deepseek.com/v1/tools/search` with the
  user's own DeepSeek key as `Authorization: Bearer`. Body: `query` (1 to 128
  characters, supports the operators `site:`, `-site:`, `"exact phrase"`,
  `lang:`, `after:`, `before:`), plus optional `count` (1 to 50, default 10),
  `need_content` (default false), `ori_question` and `localization`.
  Response: `results[]` with `rerank_score`, `title`, `url`, `snippet`
  (short, for UI), `summary` (longer, for models), `content`, `site_name`,
  `site_icon`, `date` and `authority`; `site_name`, `site_icon` and `date`
  can be null. Errors are OpenAI-style `{ error: ... }`: 402 insufficient
  balance, 429 over the QPS limit, 504 timeout.
- **Why a client function tool.** It is a standalone endpoint, not a
  chat-completions parameter, and `@ai-sdk/deepseek` (3.0.63, installed) has
  no search support. The one thing the SDK does send is client `function`
  tools, which is exactly what this wiring uses
  (`server/utils/providers/deepseek-web-search.ts`), the same shape as the
  Brave/Exa and Moonshot tools: `tool()` with a zod `{ query }` schema,
  `withFollowUpTurn()` so the model answers after the results, no forced
  `toolChoice`, no KV caching. The SDK already replays `reasoning_content`
  for `deepseek-flash`/`deepseek-v4-pro`, so the multi-step tool loop is safe
  with thinking enabled. No package was bumped.
- **Request shape.** `count: 8` (a named constant) and `need_content: false`;
  the model reads each result's `summary`, not full page content that would
  be resent on every later loop step. The tool output is
  `{ provider: 'deepseek', query, billable, results: [{ title, url, snippet,
  summary, siteName?, date? }] }` — no dollar amount, since rates come only
  from config. `rerank_score`, `authority`, `site_icon` and `content` are
  dropped. The per-turn call cap (`createExternalSearchBudget`, 8 calls) is
  shared with Brave/Exa's pattern and also keeps parallel calls inside the
  5 QPS account limit; a non-2xx response or network failure throws, which
  becomes a `tool-error` part.
- **Billing rule and rate.** $0.75 per 1,000 *successful* requests, where
  successful means HTTP 200 with a non-empty `results` array. Empty-result
  and failed requests are not billed, and `count` does not change the price.
  The rate is `NUXT_PUBLIC_DEEPSEEK_SEARCH_COST_PER_THOUSAND_REQUESTS_USD`
  (`0.75`) in all three `wrangler.jsonc` vars blocks, source
  https://api-docs.deepseek.com/quick_start/pricing (accessed 2026-10-17),
  documentation-only and not invoice-verified. The tool sets
  `billable: results.length > 0`, and `getWebSearchUsage` counts only
  `tool-result` parts for `web_search` whose output has `billable === true`;
  a `tool-error` or an empty result never counts. See
  [`web-search-cost-accounting.md`](../web-search-cost-accounting.md).
- **Cost is a floor, and the API is docs-verified only.** A timeout or a
  200 response with a malformed body is not counted, though DeepSeek may
  still bill it, so the recorded search cost can underestimate the invoice
  but never overestimate from those cases. The request/response shapes, the
  billing rule and the rate come from DeepSeek's published documentation;
  no live DeepSeek key has called the endpoint yet, so verify the first real
  searches against the DeepSeek usage page.
- **Untrusted results.** Each result is bounded and sanitized before it
  reaches the model or the UI: at most 8 results, every field coerced to a
  length-capped string, results without a plain http(s) URL dropped, `date`
  kept only when it is an ISO date or datetime, and non-OK response bodies
  cancelled, with redirects not followed (`redirect: 'manual'`, the only
  non-follow value Cloudflare's workerd fetch accepts, so a 3xx surfaces as a
  status error). The system instruction tells the model results are
  information, never instructions.
- **Direct sends only.** A gateway send of a DeepSeek model never counts this
  usage (`resolveUnbundledSearchUsage` returns nothing for a gateway send
  without a Brave/Exa key), and the tool is only registered on the direct
  DeepSeek path. Chat title generation calls `useDeepSeek` with no tools and
  stays tool-less.
- **Source chips.** `emitSourcesForExternalSearchResults` accepts
  `provider: 'deepseek'`, so the cited URLs render as source chips.
- **5 QPS limit.** The account-level 5 QPS cap is not enforced client-side
  beyond the per-turn call budget; a 429 surfaces as the shared "rate limited
  or out of quota" tool error.
- **Fetch API intentionally not wired.** DeepSeek also offers a page-fetch
  endpoint; it is not exposed. `need_content` stays false and the model
  answers from summaries.
- **Responses-API and Anthropic server-side `web_search` intentionally not
  used.** The Anthropic-compatible `web_search_20250305` route described
  above remains unwired and its five open verification items are moot for
  search: the standalone Search API needs no second transport, no
  `@ai-sdk/anthropic`, and no reasoning/`top_p` parity work.
