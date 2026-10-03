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
`reasoning: { mode: 'toggle' }`, not levels — DeepSeek's own effort axis
(`deepseek-flash`: `low,high,max`; `deepseek-v4-pro`: `high,max`, no `low`
at all) has no `medium` and no shared shape between the two models, so
there's no lossless mapping onto this app's `low`/`medium`/`high` levels;
the on/off toggle both models share is the only exact fit. DeepSeek also
bills a 2x peak/off-peak pricing multiplier that
`server/utils/ai/cost-map.ts`'s single flat per-model rate does not model —
a known, disclosed limitation, not something this PR attempts to fix. Still
no native web_search or image_generation — re-verified against DeepSeek's
official API docs, see "Web search" below.

Server-side wiring lives in `server/utils/providers/deepseek.ts`, matching
the existing `use<Provider>()` contract described in
[`general.md`](./general.md#server-side-wiring).

## Package version note

`@ai-sdk/deepseek@3.x` ships on a lower major than this app's `ai@7`/
`@ai-sdk/provider@4` line — see
[`general.md`](./general.md#package-versions) for the cross-provider version
note this is part of. **Correction**: an earlier draft of this plan assumed
`@ai-sdk/deepseek` needed a bump to `3.0.45` before it could support
`reasoningEffort`. That's wrong — the installed `3.0.26` already ships the
full `reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"])`
schema and the `thinking.type` field, read directly from
`node_modules/@ai-sdk/deepseek/dist/index.js`. Bumping the package stays
optional hygiene, not a blocker for anything in this catalog expansion: the
bump only affects the unreachable `mode: 'levels'` branch (see
`server/utils/providers/deepseek.ts`'s doc comment).

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
`providers/deepseek.ts` keeps every DeepSeek model at `tools: []` for now.
This is a candidate follow-up, not the same "not now, skip" product
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
