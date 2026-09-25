# Moonshot AI

Part of the direct-providers documentation set — see
[`general.md`](./general.md) for the cross-cutting architecture and shared
patterns this file builds on.

## Curated models

Moonshot AI (4 models): `kimi-k2.6` (default/first-listed), `kimi-k3`,
`kimi-k2.7-code`, `kimi-k2.7-code-highspeed`. The `moonshot-v1-*` classic
line is deliberately not curated — Moonshot is sunsetting it. `kimi-k2.5`
(originally the product owner's explicit pick) was removed after real users
hit "Not found the model kimi-k2.5 or Permission denied" in the live app —
Moonshot has an active sunset notice for it on their platform. **Three of
the four models — `kimi-k3`, `kimi-k2.7-code`, and
`kimi-k2.7-code-highspeed` — are curated with `reasoningAlwaysOn: true`,
not a toggle**: models.dev reports an empty `reasoning_options: []` for all
three, meaning reasoning is always on with zero adjustable options, no
disable switch included. Sending `providerOptions.moonshotai.thinking =
{ type: 'disabled' }` to a model with no `thinking` parameter at all would
be a live-key failure mode nothing in CI can catch. `kimi-k2.6` is the
*only* Moonshot model models.dev reports a real `[{"type":"toggle"}]` for,
so it's the only one curated with `reasoning: { mode: 'toggle' }`. Both new
code-focused models are ordinary singleton families
(`kimi-k{v}-code`, `kimi-k{v}-code-highspeed`) and don't interact with the
ordering question below. All four declare `tools: ['web_search']` — see
"Web search" below.

- **Ordering: `kimi-k2.6` deliberately stays first, ahead of the
  newer-by-version `kimi-k3`.** Main's generic `parseModelFamily` groups
  `kimi-k2.6` and `kimi-k3` into the same family `kimi-k{v}` and would rank
  `kimi-k3` (version `3`) ahead of `kimi-k2.6` (version `2.6`) under a
  strict newest-first rule. This app's actual convention is "first-listed
  is the provider default," a *product* decision, not the *ergonomic*
  newest-first convention the generic family parser encodes — and here
  they collide: `kimi-k2.6` ($0.95/$4.00, reasoning toggleable off) is the
  intended cheaper default, while `kimi-k3` ($3.00/$15.00, reasoning
  mandatory) is the newer release. Reordering to satisfy the generic parser
  would silently triple the cost of Moonshot's default. `kimi-k2.6` stays
  first, and `tests/unit/providers/ordering.spec.ts`'s newest-first
  invariant is scoped to `anthropic`, `google`, `openai` and `xai` only —
  `moonshotai`, `deepseek` and `qwen` are deliberately excluded. The
  clinching counter-example for why the generic parser can't be trusted
  outside those four providers: run it over Qwen's ids and it produces
  `qwen{v}b :: qwen3-32b(3-32) > qwen3-14b(3-14) > ... > qwen3.6-27b(3.6-27)
  > qwen3.5-27b(3.5-27)` — ranking `qwen3-32b` as *newer* than
  `qwen3.6-27b`, which is simply wrong. A spec built on that parser for
  Qwen would enforce a meaningless order.

Server-side wiring lives in `server/utils/providers/moonshotai.ts`, matching
the existing `use<Provider>()` contract described in
[`general.md`](./general.md#server-side-wiring). **Moonshot needs one
non-obvious guard**: its API rejects a request that sends both a `thinking`
param and an auto-derived `reasoning_effort` — this app avoids the conflict
by never setting the top-level `reasoning` streamText option for Moonshot
models, only `providerOptions.moonshotai.thinking` directly.

## Package version note

`@ai-sdk/moonshotai@3.x` ships on a lower major than this app's `ai@7`/
`@ai-sdk/provider@4` line — see
[`general.md`](./general.md#package-versions) for the cross-provider version
note this is part of. Bumping it changes nothing for reasoning behavior:
this app never sends a Moonshot reasoning effort at all —
`server/utils/providers/moonshotai.ts` returns `reasoning: undefined`
unconditionally.

## Web search — implemented via the Formula API

**Implemented via the Formula API (Wave C-1, verified against current docs
on 2026-08-10).** Round 3/4 documented two web-search surfaces and declined
both — the legacy `$web_search` builtin function (inherently a two-round-trip
flow: the model emits a `$web_search` tool call whose arguments the client
must echo back verbatim as a `role: "tool"` message and Moonshot runs the
search server-side during the follow-up call; and unwireable anyway, since
`@ai-sdk/moonshotai@3.0.30` delegates tool serialization to
`@ai-sdk/openai-compatible`'s `prepareTools`, which hard-codes
`type: "function"` and silently drops provider-defined tools) and the
Formula API official tool `moonshot/web-search:latest` (wireable in
principle, but blocked on the app having no multi-step tool loop). LW1 (the
tool loop, `server/utils/ai/tool-loop.ts`, documented in
[`general.md`](./general.md#multi-step-tool-loop)) shipped in Wave B; this
section records the Formula-API implementation that consumes it — its first
real caller. Note: `platform.moonshot.ai` redirects (301) to
`platform.kimi.ai`, the canonical docs host used below.

- **Mechanics, re-verified against the live doc pages, not just a planning
  snapshot**
  (`https://platform.kimi.ai/docs/guide/use-official-tools`,
  `https://platform.kimi.ai/docs/guide/use-web-search`, both fetched
  2026-08-10): fetch the declaration with
  `GET {MOONSHOT_BASE_URL}/formulas/{FORMULA_URI}/tools`, send it as an
  ordinary `type: "function"` tool on `POST /v1/chat/completions`, and when
  the model calls it, execute with
  `POST {MOONSHOT_BASE_URL}/formulas/{FORMULA_URI}/fibers` using body
  `{"name": <function name>, "arguments": <JSON-string args, unmodified
  from the model's own output>}`. `MOONSHOT_BASE_URL` is
  `https://api.moonshot.ai/v1` (matches `@ai-sdk/moonshotai`'s own default
  base URL) and `FORMULA_URI` is `moonshot/web-search:latest`. Auth on both
  calls is `Authorization: Bearer <the user's own Moonshot API key>` — there
  is no separate "app" credential; BYOK holds here exactly as everywhere
  else.
  - **On the URI form:** an earlier planning draft wrote the declaration
    fetch as `GET /v1/formulas/moonshot%2Fweb-search:latest/tools`
    (URI-encoding the formula's own `/`). Moonshot's own official code
    samples (Python `f"/formulas/{FORMULA_URI}/tools"` and a bash
    `curl ${MOONSHOT_BASE_URL}/formulas/${FORMULA_URI}/tools` with
    `FORMULA_URI="moonshot/web-search:latest"` set literally, unencoded)
    both interpolate the raw string with no `encodeURIComponent`/`%2F`
    anywhere on the page. `server/utils/providers/moonshotai-web-search.ts`
    follows the doc's own literal form: plain string concatenation, no
    encoding.
- **Model support (research question: is this k3-only?).** The
  official-tools page frames Formula-API tools as "Moonshot's recommended
  path" specifically for kimi-k3, but its own worked example says verbatim:
  "The examples on this page use the latest model `kimi-k3` by default. …
  To use another model such as `kimi-k2.6` or `kimi-k2.5`, just replace the
  `model` field — parameter configurations differ across models." Both of
  this app's curated models are named as drop-in replacements in Moonshot's
  own official-tools flow, so both are flipped to `tools: ['web_search']` in
  `providers/moonshotai.ts`. "Parameter configurations differ" refers to
  each model's own reasoning-effort field shape (already handled by this
  provider's existing `getProviderOptions()`), not to Formula-API tool
  eligibility — the tool declaration itself is a standard `type: "function"`
  tool, and nothing in either doc page scopes it to one model.
- **The Anthropic-compatible endpoint is not a backdoor (checked, closed;
  correction 2026-09-16 on the DeepSeek comparison only).** Moonshot does
  expose `POST https://api.moonshot.ai/anthropic/v1/messages` (documented
  for Claude Code integration; see MoonshotAI/Kimi-K2 GitHub issue #129 for
  the community-reconstructed reference). Nothing in Moonshot's own docs
  claims Anthropic-style **server-side** tool types (`web_search_20250305`)
  are accepted there — that conclusion, specific to Moonshot's endpoint, is
  unchanged. The comparison this bullet originally drew to DeepSeek's
  analogous endpoint is corrected: DeepSeek's Anthropic-compatible endpoint
  does **not** support "only custom function tools" — a later research pass
  found it genuinely accepts Anthropic's `web_search_20250305` server-tool
  type as documented DeepSeek functionality (see
  [`deepseek.md`](./deepseek.md#web-search)). That correction doesn't
  change Moonshot's own conclusion, since Moonshot's docs still make no
  equivalent claim for its own endpoint, so this remains schema
  compatibility for Claude Code's client tools here, not a server-search
  backdoor. Rewiring Moonshot onto `@ai-sdk/anthropic` against that endpoint
  on an unverifiable hope would be a regression risk with no documented
  payoff. **Not a path** — recorded so it isn't re-investigated.
- **No forced `toolChoice`.** Unlike this app's OpenAI/xAI wiring (which
  forces `toolChoice` onto their provider-executed search tools, safe
  because those never loop), the Moonshot tool is client-executed and
  marked with `withFollowUpTurn()` — forcing `toolChoice` here would
  re-select the same tool on every loop step and the model would never
  produce text. See `server/utils/ai/tool-loop.ts`'s doc comment.
- **The encrypted-output blob — flagged for explicit product-owner
  sign-off, not silently shipped.** Web search is documented as a
  "protected" formula: a successful fiber run reports its result inside
  `context.encrypted_output` (`----MOONSHOT ENCRYPTED BEGIN----…----MOONSHOT
  ENCRYPTED END----`), and the official-tools doc states this "content can
  be passed directly into the tool call" — i.e. it is designed to flow
  through as opaque tool-result content that only Moonshot's own backend
  can interpret; the app is not expected to decrypt or inspect it, and this
  implementation doesn't. `getMoonshotWebSearchTools()`'s `execute()`
  returns the string verbatim, and the multi-step loop's existing part
  persistence (`normalizeAssistantMessagePartsForPersistence` passes
  through every part type other than `tool-generate_image`) stores it in
  `messages.parts` unchanged, same as any other tool result. Moonshot's own
  docs only describe the *immediate* next `/chat/completions` call reusing
  this blob — they say nothing about an app like this one that keeps full
  multi-turn chat history and resends it on every subsequent turn of the
  *same* chat, potentially for as long as the chat exists. **The shared-chat
  path is confirmed clean, not a risk**: `server/api/v1/shared/[slug]/
  index.get.ts`'s `filterPublicParts()` strips every `isToolUIPart` part
  (matching this tool's `tool-web_search` result) from the public JSON
  response before it is ever built, and `stripToolPartsFromBranchedMessage`
  (`server/utils/chats/branch.ts`) does the same when a shared chat is
  branched into another user's own chat — both filter on part *type*, so
  this holds regardless of what the ciphertext actually contains. The real,
  narrower open question is retention within the *owner's own* chat: because
  Moonshot's actual encryption scheme (algorithm, key custody,
  ciphertext-reuse safety) is undocumented and unverifiable from outside,
  indefinite storage and repeated resend of this blob to Moonshot on every
  future turn has **not** been independently confirmed safe as a
  data-minimization matter — it is passed through exactly as documented,
  but the product owner should explicitly sign off on this retention/re-send
  behavior rather than it being an implicit consequence of following the
  docs. Nothing is decrypted, transformed, or given any bespoke DB handling
  here; it lives in the exact same `messages.parts` JSON column every other
  tool result already uses.
- **Cross-provider resend on a mid-chat model switch — functional gap, not
  a security issue.** This app resolves the model fresh from each request
  and resends the full persisted history regardless of which provider
  handled earlier turns. If a chat has a `tool-web_search` part from a
  Moonshot turn and the user then switches the same chat to a different
  provider, that opaque part is resent verbatim to a backend that never
  declared the tool and cannot interpret it — at best inert (a third party
  never learns anything from ciphertext it has no key for), at worst a
  provider that validates tool-call/result pairing strictly could reject the
  request. Not verified live (no provider-switch-after-search scenario has
  been exercised with real keys); tracked here rather than guessed at.
- **Billing — still self-contradictory as of 2026-08-10, not resolved
  here.** Two Moonshot doc pages disagree, same as round 3/4 found:
  - `use-official-tools`: "official tools are currently free for a limited
    time; when the tool load reaches capacity limits, temporary rate
    limiting measures may be applied."
  - `use-web-search` + `/docs/pricing/tools`: "In addition to token
    consumption, we also charge a call fee for each web search" —
    specifically "$0.005 for the `$web_search` call" when
    `finish_reason = tool_calls` (no charge if the model never triggers a
    search), plus ordinary token billing for
    `prompt_tokens + search_tokens + completions_tokens`. Prices exclude
    tax.
  - Whether the $0.005/call figure (stated for the legacy `$web_search`
    builtin) also applies to a Formula-API `web_search` fiber call is
    itself ambiguous — the official-tools page's own "free for a limited
    time" sentence is the only pricing language on the page that actually
    describes what this app calls, and it cross-references the same "Web
    Search Price" page as if the fee applies there too. Per this round's
    instructions, this contradiction is recorded, not resolved — verify the
    real Moonshot console/invoice on the first live search send (see "Known
    gaps requiring live verification" below).

## Known gaps requiring live verification

No live Moonshot key exists in this environment, so nothing in
`server/utils/providers/moonshotai-web-search.ts` was exercised against the
real API. Everything is built and tested against realistic mocks shaped
from Moonshot's own current doc pages (cited inline in the source and in
"Web search" above), not a live response. Needs, on the first real key:

1. a genuine declaration fetch against
   `GET /v1/formulas/moonshot/web-search:latest/tools` to confirm the
   unencoded-URI form this app sends is accepted and the response shape
   matches;
2. one real search send per curated model (`kimi-k2.6` and `kimi-k3`)
   confirming the model actually receives and uses the `encrypted_output`
   blob to produce a grounded follow-up answer, not just that the fiber
   call itself succeeds;
3. checking the real Moonshot console/invoice to resolve which side of the
   billing contradiction above actually applies to a Formula-API call, not
   the legacy `$web_search` builtin;
4. confirming `withFollowUpTurn()` + no forced `toolChoice` actually lets
   `kimi-k3` (always-on reasoning) produce a natural-language answer after
   the tool result rather than re-calling the tool — the fixture-based loop
   test proves the mechanism generically with a mock model, not with this
   specific model's real tool-calling behavior; and
5. the `kimi-k2.6` + thinking-disabled + web-search combination
   specifically — Moonshot's own web-search doc phrases `kimi-k2.6` support
   as "can perform web search with thinking enabled," which hints the
   thinking-off case may behave differently (weaker tool selection, a
   different result shape, or no search at all) rather than being a
   mechanical no-op; this app's reasoning toggle and web-search toggle are
   fully independent controls, so a user can select that exact combination
   today; and
6. that the tool declaration is genuinely account/tier-independent as
   assumed by the global (non-key-scoped) cache — if a real account ever
   returns a different declaration shape than another, the failure mode is
   a stale-but-wrong cached schema served to an unrelated account, not a
   data leak (fiber *execution* always uses the requesting user's own key
   regardless of which declaration was cached), but it would still need the
   cache key scoped per-account.

This pass is its own item, separate from the cross-provider
streamed-completion gate described in
[`general.md`](./general.md#known-gaps-requiring-live-verification).

## Owner action items

**Unverifiable without a live key (model catalog expansion, 2026-09-16).**
Each of these was a recorded decision point
(`docs/model-catalog-expansion-plan.md` § 8) resolved with a documented,
best-evidence recommendation rather than a live call, because no live
Moonshot key is available in this environment:

- **Moonshot's 13 discontinued models** are assumed to hard-404 (Moonshot's
  own docs call them "no longer maintained or supported," reading as a
  harder cutoff than xAI/DeepSeek's silent-redirect-and-rebill pattern), but
  this has not been confirmed against a real request. Check with a live key
  before ever reconsidering curating any of them as legacy entries.
- **`kimi-k2.7-code` and `kimi-k2.7-code-highspeed` really don't accept a
  reasoning toggle.** Curated as `reasoningAlwaysOn: true` on the strength of
  models.dev reporting `reasoning_options: []` for both — confirm with a
  live key that sending `providerOptions.moonshotai.thinking` to either
  model is in fact rejected (or simply ignored) rather than silently
  accepted, which would mean they could be curated as toggle-mode instead.
