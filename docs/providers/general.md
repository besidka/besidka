# Direct providers: architecture and shared patterns

Besidka's BYOK model catalog is a single curated, build-time,
models.dev-backed data structure — `docs/models-data-fetching.md` documents
the catalog machinery itself. This directory is the permanent record of the
four providers added alongside the pre-existing Anthropic/Google/OpenAI
ones, of the mechanisms they needed (openai-compatible wiring, per-provider
web search, the multi-step tool loop) and of the decisions behind them.

**This file** covers the cross-cutting architecture and the patterns shared
across every direct provider. Per-provider capability decisions, wiring
details, web search implementations and owner action items live in their
own files:

| File | Covers |
| --- | --- |
| [`xai.md`](./xai.md) | Grok models, image generation (`grok-imagine-image-2.0`), xAI-specific web search/reasoning wiring |
| [`deepseek.md`](./deepseek.md) | `deepseek-flash`/`deepseek-v4-pro`, reasoning wiring, the unwired Anthropic-compatible web-search endpoint |
| [`moonshotai.md`](./moonshotai.md) | Kimi models, Formula-API web search, reasoning notes |
| [`alibaba.md`](./alibaba.md) | Qwen/Alibaba models, DashScope web search, the `qwen`-vs-`alibaba` catalog-key divergence |

## Model catalog architecture

Added alongside the pre-existing Anthropic/Google/OpenAI providers,
following the exact same pattern documented in
`docs/models-data-fetching.md`: `providers/{xai,deepseek,moonshotai,qwen}.ts`
hold curated capabilities, merged at import time against
`providers/data/models-dev-snapshot.json`. See that doc for the full
curated-vs-fetched split, the per-field merge policy, and the `EXEMPT_IDS`
mechanism; it is not repeated here.

## Server-side wiring

Server-side wiring for each direct provider lives in
`server/utils/providers/{xai,deepseek,moonshotai,qwen}.ts`, matching the
existing `use<Provider>()` contract used by every other provider in this
app. Provider-specific wiring quirks (Moonshot's `thinking`/
`reasoning_effort` conflict guard, Qwen's `enable_thinking`/`enable_search`
body flags, xAI's image-model controller) are documented in each provider's
own file.

## Package versions

`@ai-sdk/deepseek@3.x` and `@ai-sdk/moonshotai@3.x` ship on a lower major
than this app's `ai@7`/`@ai-sdk/provider@4` line (`@ai-sdk/xai@4.x`
matches). Verified compatible via typecheck/build/full test suite, but this
was never proven with a real live API call — see each provider's own Owner
action items section. Provider-specific detail on what each package's bump
would (and wouldn't) change is recorded in
[`deepseek.md`](./deepseek.md#package-version-note) and
[`moonshotai.md`](./moonshotai.md#package-version-note).

## Web search, reasoning, and image generation across providers

Each of the three axes this catalog varies per model is handled the same
way across every direct provider: derive the capability mechanically from
the vendor's own documentation or models.dev metadata, never hand-guess it,
and never enable a control the model can't actually honor (a mismatch here
is a live-key error, not a picker cosmetic).

- **Reasoning shape** is derived mechanically from each model's models.dev
  `reasoning_options` (or, for xAI, its effort-axis metadata): a toggle
  becomes `reasoning: { mode: 'toggle' }`, an always-on model with no
  disable switch becomes `reasoningAlwaysOn: true`, and a multi-level effort
  axis becomes `reasoning: { mode: 'levels' }` truncated to this app's
  `'low' | 'medium' | 'high'` vocabulary. See each provider's "Curated
  models" section for the specific derivation.
- **Web search** is enabled per model only after independently verifying
  against the provider's own official documentation that the specific model
  supports it on the specific endpoint this app actually calls — a round-3
  review challenged the empty `tools` declarations on Qwen, DeepSeek and
  Moonshot AI ("I don't believe it doesn't support web_search. their docs
  mentioned they do"), and each was verified against the provider's official
  docs on 2026-08-09, with the outcomes deliberately differing per provider:
  xAI gets `tools: ['web_search']` via `xai.tools.webSearch({})` on every
  text model except `grok-4.20-multi-agent-0309` (see [`xai.md`](./xai.md));
  Qwen gets a documented
  DashScope allowlist of specific model ids (see
  [`alibaba.md`](./alibaba.md#web-search)); Moonshot gets a Formula-API tool
  requiring the multi-step tool loop below (see
  [`moonshotai.md`](./moonshotai.md#web-search--implemented-via-the-formula-api));
  and DeepSeek gets none on the endpoint this app calls, with a documented,
  unwired alternative transport (see
  [`deepseek.md`](./deepseek.md#web-search)). Superseded conclusions are
  kept in place with a **Reversed**/**Correction** annotation rather than
  being silently rewritten, so each correction itself stays legible in the
  record.
- **Image generation** is wired through the same dedicated-image-model
  pattern for every provider that offers it: a hand-curated
  `imageGeneration: { controllerModel }` entry invoked once, outside the
  chat loop, never a chat tool the model calls mid-turn. OpenAI
  (`gpt-image-2`), Google, and xAI (`grok-imagine-image-2.0`, see
  [`xai.md`](./xai.md#image-generation)) all follow this shape. Qwen has no
  image-generation capability on either its OpenAI-compatible endpoint or
  the evaluated `@ai-sdk/alibaba` package (see
  [`alibaba.md`](./alibaba.md#curated-models)), so it doesn't participate in
  this pattern yet; DeepSeek and Moonshot AI don't offer image generation at
  all.

## Vision vs image generation in the picker

The two capabilities are deliberately never conflated and never share a
color: a violet `image-plus`/"Image generation" chip comes from
`hasImageGenerationCapability()`, while an `eye`/"Vision" chip —
`text-secondary`/`badge-secondary` — comes from `hasVisionCapability()`
(`app/utils/models-picker.ts`, reading the `model.modalities.input` data the
models.dev merge already populates). Accepted trade-off, a deliberate
product-owner decision (2026-08-09) rather than scope creep: most modern
curated models are vision-capable, so the eye chip appears on nearly every
row.

## Default-model resolution fix

`providers/index.ts`'s default-model resolution had a latent bug fixed
while adding the xAI/DeepSeek/Moonshot AI providers: a later provider's
`default: true` model would silently overwrite the global default because
the `break` only exited the inner loop. Fixed with a labeled `break outer`.
**No new model in any provider file should ever set `default: true`**
unless the intent is genuinely to change Besidka's single global default
(currently `gemini-2.5-flash-lite`) — "pick a sensible default per
provider" means "list it first in that provider's array," which is a
display-order convention with no functional effect, not the `default`
flag.

## Multi-step tool loop

`streamText()` defaults to `stopWhen: isStepCount(1)`, so historically every
send ran exactly one step. `server/utils/ai/tool-loop.ts` adds an opt-in
multi-step loop for the one case that genuinely needs it: a tool whose
result the *model* must read before it can answer in natural language.

**The trigger is a marker on the tool, never a heuristic.**
`withFollowUpTurn(tool)` stamps `requiresFollowUpTurn: true` onto a tool
definition; `resolveToolLoopOptions()` returns loop options only when at
least one tool in the send carries it, and `undefined` otherwise.
`undefined` spreads to nothing at the `streamText()` call site, so every
other send passes byte-identical arguments to what it passed before the
loop existed.

**"Has an `execute()`" is explicitly NOT the trigger, and using it would be
a regression.** `createImageGenerationTool()` is a client-executed tool
with a real `execute()`, and the AI SDK's own continuation condition
(client tool calls that produced results, in `streamText`'s step flush)
would happily continue past it if a blanket `stopWhen` were set — spending
a second billed generation to narrate an image the user can already see.
Image generation is single-step precisely because its tool result IS the
deliverable. Provider-executed tools are doubly safe: the SDK's
continuation condition skips tool calls flagged `providerExecuted: true`.

Moonshot's Formula-API `web_search` tool
(`server/utils/providers/moonshotai-web-search.ts`) was the first real
caller of the marker — see
[`moonshotai.md`](./moonshotai.md#web-search--implemented-via-the-formula-api).
Brave and Exa's BYOK search tools (`server/utils/search/brave.ts`,
`server/utils/search/exa.ts`) now also mark their tool with
`withFollowUpTurn()`, for the same reason: the model must read the search
results before it can answer in natural language. The loop mechanics
themselves remain proven generically by a test-only
fixture tool (`tests/fixtures/follow-up-turn-tool.ts`) driven through the
real send pipeline with a real `streamText` and a `MockLanguageModelV4`;
that fixture must never be wired into a provider builder.

**Bounds.** `TOOL_LOOP_MAX_TOOL_STEPS` is 3 search rounds, plus one
guaranteed final step (`TOOL_LOOP_MAX_STEPS = TOOL_LOOP_MAX_TOOL_STEPS + 1`)
that forces an answer instead of another tool call.
`stepCountIs(TOOL_LOOP_MAX_STEPS)` stops the loop the instant a step
completes, with no regard for whether that step was itself a tool call, so
without the forced final step the model could spend its whole budget on tool
calls and the send would persist zero text — three real production rows hit
exactly this before the fix. `prepareStep()` enforces the final step by
setting `toolChoice: 'none'` and appending an "answer now" instruction; for
Anthropic models it only adds the instruction; `@ai-sdk/anthropic@4.0.34`
maps `toolChoice: 'none'` to `tools: undefined` while still sending the
prior turns' `tool_use`/`tool_result` history, an unverified combination
against Anthropic's API, so Anthropic's final step is a best-effort nudge,
not a guarantee. `timeout: { totalMs: 540_000, toolMs: 60_000 }` is set on
the loop path only: the KV generation-in-progress guard this route writes
expires after 600s, so the loop's total budget must stay under that —
otherwise a client retry arriving after the guard expired would start a
second concurrent generation for the same turn. A tool `execute()` that
throws produces a `tool-error` output, which the model sees and answers
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

None of the direct-provider gaps recorded across this directory were
verified against a real account/credential in the development environment
(no live API keys were available). Each was flagged by its own PR's review
and confirmed still open by the final cross-PR review. The cross-cutting
gap lives here; provider-specific gaps live in each provider's own file
(linked below).

**Real streamed chat completions** through all 11 direct-provider models (8
xAI/DeepSeek/Moonshot AI + 3 Qwen) — `pnpm run preview` (workerd) with real
keys. Qwen carries the same unverified-`enable_thinking` risk category as
the other three providers' reasoning wiring.

**Recommended pre-production gate**: one real key per provider, one message
per model, confirming a streamed completion and an Axiom event with the
expected `providerId`/`modelId`. Provider-specific live-verification gaps
and their own recommended gates are recorded in
[`alibaba.md`](./alibaba.md#known-gaps-requiring-live-verification) (Qwen
`enable_search`) and
[`moonshotai.md`](./moonshotai.md#known-gaps-requiring-live-verification)
(the Formula-API web-search tool, end to end).

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

**Unverifiable without a live key (model catalog expansion, 2026-09-16).**
Several decision points from that expansion
(`docs/model-catalog-expansion-plan.md` § 8) were each resolved with a
documented, best-evidence recommendation rather than a live call, because no
live key for the relevant provider is available in this environment. The
specific items are recorded in each provider's own Owner action items
section: [`xai.md`](./xai.md#owner-action-items),
[`deepseek.md`](./deepseek.md#owner-action-items),
[`moonshotai.md`](./moonshotai.md#owner-action-items), and
[`alibaba.md`](./alibaba.md#owner-action-items).
