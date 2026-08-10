# Direct providers: xAI, DeepSeek, Moonshot AI, Qwen

Besidka's BYOK model catalog is a single curated, build-time,
models.dev-backed data structure — `docs/models-data-fetching.md` documents
the catalog machinery itself. This doc is the permanent record of the four
providers added alongside the pre-existing Anthropic/Google/OpenAI ones, of
the mechanisms they needed (openai-compatible wiring, per-provider web
search, the multi-step tool loop) and of the decisions behind them.

## Curated capabilities and server wiring

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
  `curatedCapabilities()` for how the flag is threaded. Both models now
  declare `tools: ['web_search']` — see "Moonshot AI — implemented via the
  Formula API" below.
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

### Web search across the direct providers (round-3 investigation, 2026-08)

A round-3 review challenged the empty `tools` declarations on Qwen, DeepSeek
and Moonshot AI ("I don't believe it doesn't support web_search. their docs
mentioned they do"). Each was verified against the provider's official docs
on 2026-08-09; the outcomes deliberately differ per provider.

**Round 4 re-verification (2026-08-09).** The user raised the same suspicion
again for Qwen's `qwen3.7-max` exclusion, prompting a fresh, independent
re-check against each vendor's current documentation rather than trusting the
round-3 record. Both conclusions below held with no code change required:

- **Qwen `qwen3.7-max`** — Alibaba's current docs still state
  `qwen3.7-max` supports web search "only" through the Responses API, a
  different surface from the `/compatible-mode/v1/chat/completions`
  endpoint this app calls via `@ai-sdk/openai-compatible` (which has no
  Responses API support at all). The exclusion is a real, verified
  per-tier capability difference, not a mapping bug — closing it for real
  would mean a bespoke second DashScope Responses wiring for one model's
  badge. The product owner explicitly signed off (2026-08-09) on accepting
  the gap rather than funding that wiring.
- **DeepSeek** — the API changelog now extends through 2026-07-31
  (DeepSeek-V4-Flash public beta) and still announces no search, grounding,
  or `enable_search` capability of any kind. Nothing changed since round 3;
  `providers/deepseek.ts` correctly keeps `tools: []`.

Neither needed a code change; this record exists so round 5 doesn't
re-litigate the same question a third time.

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
search-API bill), not a provider capability. **The product owner explicitly
declined that route (2026-08-09, "not now, skip")**: no app-owned,
non-BYOK search component is to be built, and DeepSeek stays `tools: []`.
Revisit only on a separate, future ask with new docs evidence.

**Moonshot AI — implemented via the Formula API (Wave C-1, verified against
current docs on 2026-08-10).** Round 3/4 documented two web-search surfaces
and declined both — the legacy `$web_search` builtin function (inherently a
two-round-trip flow: the model emits a `$web_search` tool call whose
arguments the client must echo back verbatim as a `role: "tool"` message and
Moonshot runs the search server-side during the follow-up call; and
unwireable anyway, since `@ai-sdk/moonshotai@3.0.30` delegates tool
serialization to `@ai-sdk/openai-compatible`'s `prepareTools`, which
hard-codes `type: "function"` and silently drops provider-defined tools) and
the Formula API official tool `moonshot/web-search:latest` (wireable in
principle, but blocked on the app having no multi-step tool loop). LW1 (the
tool loop, `server/utils/ai/tool-loop.ts`) shipped in Wave B; this section
records the Formula-API implementation that consumes it — its first real
caller. Note: `platform.moonshot.ai` redirects (301) to `platform.kimi.ai`,
the canonical docs host used below.

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
- **The Anthropic-compatible endpoint is not a backdoor (checked, closed).**
  Moonshot does expose `POST https://api.moonshot.ai/anthropic/v1/messages`
  (documented for Claude Code integration; see MoonshotAI/Kimi-K2 GitHub
  issue #129 for the community-reconstructed reference). Nothing in
  Moonshot's docs claims Anthropic-style **server-side** tool types
  (`web_search_20250305`) are accepted there, and DeepSeek's analogous
  endpoint explicitly supports only custom function tools — so this is
  schema compatibility for Claude Code's client tools, not a server-search
  backdoor. Rewiring Moonshot onto `@ai-sdk/anthropic` against that endpoint
  on an unverifiable hope would be a regression risk with no documented
  payoff. **Not a path** — recorded so it isn't re-investigated.
- **No forced `toolChoice`.** Unlike this app's OpenAI/xAI wiring (which
  forces `toolChoice` onto their provider-executed search tools, safe
  because those never loop), the Moonshot tool is client-executed and
  marked with `withFollowUpTurn()` — forcing `toolChoice` here would re-select
  the same tool on every loop step and the model would never produce text.
  See `server/utils/ai/tool-loop.ts`'s doc comment.
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
    gaps" below).

### Vision vs image generation in the picker

The two capabilities are deliberately never conflated and never share a
color: a violet `image-plus`/"Image generation" chip comes from
`hasImageGenerationCapability()`, while an `eye`/"Vision" chip —
`text-secondary`/`badge-secondary` — comes from `hasVisionCapability()`
(`app/utils/models-picker.ts`, reading the `model.modalities.input`
data the models.dev merge already populates). Accepted trade-off, a
deliberate product-owner decision (2026-08-09) rather than scope creep: most
modern curated models are vision-capable, so the eye chip appears on nearly
every row.

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
every other provider.

`providers/index.ts`'s default-model resolution had a latent bug fixed while
adding these three: a later provider's `default: true` model would silently
overwrite the global default because the `break` only exited the inner loop.
Fixed with a labeled `break outer`. **No new model in any provider file
should ever set `default: true`** unless the intent is genuinely to change
Besidka's single global default (currently `gemini-2.5-flash-lite`) — "pick a
sensible default per provider" means "list it first in that provider's
array," which is a display-order convention with no functional effect, not
the `default` flag.

## Multi-step tool loop

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
single-step precisely because its tool result IS the deliverable.
Provider-executed tools are doubly safe: the SDK's continuation condition
skips tool calls flagged `providerExecuted: true`.

Moonshot's Formula-API `web_search` tool
(`server/utils/providers/moonshotai-web-search.ts`) is the first real caller
of the marker — see "Moonshot AI — implemented via the Formula API" above.
The loop mechanics themselves remain proven generically by a test-only
fixture tool (`tests/fixtures/follow-up-turn-tool.ts`) driven through the
real send pipeline with a real `streamText` and a `MockLanguageModelV4`;
that fixture must never be wired into a provider builder.

**Bounds.** `TOOL_LOOP_MAX_STEPS` is 3 (request the tool, answer from the
result, one spare refinement round). `timeout: { totalMs: 540_000, toolMs:
60_000 }` is set on the loop path only: the KV generation-in-progress guard
this route writes expires after 600s, so the loop's total budget must stay
under that — otherwise a client retry arriving after the guard expired would
start a second concurrent generation for the same turn. A tool `execute()`
that throws produces a `tool-error` output, which the model sees and answers
from, so a failing tool terminates the loop rather than retrying it.

**`toolMs` is cooperative, not enforced.** The AI SDK only passes it to
`execute()` as `options.abortSignal` — it never wraps the call in its own
race/cancellation. A tool that hangs without checking that signal (e.g. a
`fetch()` that omits `signal: options.abortSignal`) is never interrupted by
`toolMs`, and can hang past `totalMs` too, since nothing else force-resolves
a pending step. `totalMs` does correctly abort a hang in the *model's own*
HTTP call: `persistAssistantMessageFromStream()` sees the resulting `abort`
chunk, returns `false`, writes no assistant row, and the KV guard is still
released in the handler's `finally`. **Any real tool wired via
`withFollowUpTurn()` must thread `options.abortSignal` into its own network
I/O**, or `toolMs` does nothing for it. There is no test for a true hang —
nothing in this framework can force one to resolve — only a tool `throw` is
exercised (`tests/integration/api/chats-tool-loop.spec.ts`).

**Persistence and rendering.** Intermediate tool-call/tool-result parts land
in `messages.parts` unchanged: `normalizeAssistantMessagePartsForPersistence`
passes through every part type other than `tool-generate_image`. On the
client, the `v-if` chain in `app/pages/chats/[slug].vue` and
`app/pages/shared/[slug].vue` matches only `tool-generate_image`, error text
and `text`, so an unrecognized tool part renders nothing and throws nothing.
One cosmetic consequence worth knowing: `shouldFitMessageBubble()` returns
`false` for any part type outside `text`/`reasoning`/`step-start`/`file`, so
a message carrying a tool part loses fit-content bubble styling. Deciding how
search steps should *look* (chips, collapsed steps, or nothing) is still
deliberately open.

## No-key UX gating

`useUserKeys()` (`app/composables/user-keys.ts`) fetches
`GET /api/v1/profiles/keys` once into shared state and fails **open** while
loading/erroring — a slow network must never flash every model as disabled.
Every provider is gated generically by iterating `providerMeta`, so a new
provider is gated for free with zero picker-side code changes. Server-side,
the original 401-at-send-time remains the real enforcement backstop; the
picker gating is UI guidance only.

## Known gaps requiring live verification

None of these were verified against a real account/credential in the
development environment (no live API keys were available). Each was flagged
by its own PR's review and confirmed still open by the final cross-PR review:

1. **Real streamed chat completions** through all 11 direct-provider models
   (8 xAI/DeepSeek/Moonshot AI + 3 Qwen) — `pnpm run preview` (workerd) with
   real keys. Qwen carries the same unverified-`enable_thinking` risk
   category as the other three providers' reasoning wiring.
2. **Qwen `enable_search` on the international endpoint** — the wiring
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
3. **Moonshot's Formula-API `web_search` tool, end to end** (Wave C-1,
   2026-08-10) — no live Moonshot key exists in this environment, so
   nothing here was exercised against the real API. Everything in
   `server/utils/providers/moonshotai-web-search.ts` is built and tested
   against realistic mocks shaped from Moonshot's own current doc pages
   (cited inline in the source and in the "Moonshot AI — implemented via
   the Formula API" section above), not a live response. Needs, on the
   first real key: (a) a genuine declaration fetch against
   `GET /v1/formulas/moonshot/web-search:latest/tools` to confirm the
   unencoded-URI form this app sends is accepted and the response shape
   matches; (b) one real search send per curated model (`kimi-k2.6` and
   `kimi-k3`) confirming the model actually receives and uses the
   `encrypted_output` blob to produce a grounded follow-up answer, not
   just that the fiber call itself succeeds; (c) checking the real
   Moonshot console/invoice to resolve which side of the billing
   contradiction above actually applies to a Formula-API call, not the
   legacy `$web_search` builtin; (d) confirming `withFollowUpTurn()` +
   no forced `toolChoice` actually lets `kimi-k3` (always-on reasoning)
   produce a natural-language answer after the tool result rather than
   re-calling the tool — the fixture-based loop test proves the mechanism
   generically with a mock model, not with this specific model's real
   tool-calling behavior; and (e) the `kimi-k2.6` + thinking-disabled +
   web-search combination specifically — Moonshot's own web-search doc
   phrases `kimi-k2.6` support as "can perform web search with thinking
   enabled," which hints the thinking-off case may behave differently
   (weaker tool selection, a different result shape, or no search at all)
   rather than being a mechanical no-op; this app's reasoning toggle and
   web-search toggle are fully independent controls, so a user can select
   that exact combination today; and (f) that the tool declaration is
   genuinely account/tier-independent as assumed by the global (non-key-
   scoped) cache — if a real account ever returns a different declaration
   shape than another, the failure mode is a stale-but-wrong cached schema
   served to an unrelated account, not a data leak (fiber *execution*
   always uses the requesting user's own key regardless of which
   declaration was cached), but it would still need the cache key scoped
   per-account.

**Recommended pre-production gate**: item 1 is one real key per provider,
one message per model, confirming a streamed completion and an Axiom event
with the expected `providerId`/`modelId`. Item 2 needs one extra pair of Qwen
sends — the same prompt with the web-search toggle on and off — comparing the
two input-token counts in the context menu. Item 3 is its own pass, described
inline above.

## Known limitation (disclosed, not fixed)

An image attached earlier in a conversation under a vision-capable model can
still reach the provider raw on a *later* turn if the user regenerates that
same message after switching to a non-vision model mid-session —
`sanitizeMessagesForModelContext()` in
`server/utils/files/assistant-files.ts` only replaces file parts with an
"omitted" text placeholder for non-latest user messages; the latest user
message's file parts are always kept as-is regardless of the currently
selected model's vision support, since there's no new attach action for the
client-side gate to intercept. Closing this fully requires threading the
selected model's modality data into `sanitizeMessagesForModelContext()`
before it runs, which means resolving it earlier in `index.post.ts`'s request
flow, before `messagesForAI` is built. Left as a disclosed gap: the friendly
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
  testing a specific provider, not the app as a whole.
