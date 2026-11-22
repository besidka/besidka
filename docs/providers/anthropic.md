# Anthropic

Part of the direct-providers documentation set — see
[`general.md`](./general.md) for the cross-cutting architecture and shared
patterns this file builds on.

## Prompt caching

Every direct Anthropic send enables Anthropic's **automatic prompt caching**.
`getProviderOptions()` in `server/utils/providers/anthropic.ts` returns
`{ cacheControl: { type: 'ephemeral' } }`, which `@ai-sdk/anthropic` sends as
a single top-level `cache_control` request field. Anthropic then places the
cache breakpoint on the last cacheable block itself and moves it forward as
the conversation grows, so each turn reads the prefix the previous turn wrote.

Source:
<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>.

### Why automatic, not explicit breakpoints

- It is one line of provider options. Explicit breakpoints would need
  per-block `providerOptions` on system, tools and messages, plus bookkeeping
  to move the marker every turn.
- It follows the conversation by construction, with no code that can drift
  out of sync with how messages are assembled.

### Why the default 5 minute TTL

The marker carries no `ttl`, so the 5 minute lifetime applies. A 1 hour
lifetime (`ttl: '1h'`) doubles the cache write price. Users bring their own
keys and pay the bill, so the cheaper default wins; chats that continue within
5 minutes (the common case) keep refreshing the entry for free.

### The 4-breakpoint cap

The API allows at most 4 cache breakpoints per request. The automatic marker
occupies one of those slots. The AI SDK does **not** count it and does **not**
warn before sending, so adding 4 explicit breakpoints on top returns an HTTP
400 from Anthropic. If explicit breakpoints are ever added, at most **3** may
exist per request.

### Minimum cacheable length

Prompts shorter than the model's minimum are processed normally and silently
skip caching, with no error and no cache fields in usage.

| Models | Minimum tokens |
|---|---|
| Opus 5.5, Opus 5, Sonnet 5.5, Fable 5.x, Haiku 5.5 | 512 |
| Sonnet 5, Sonnet 4.x, Opus 4.8, Opus 4.1, Opus 4 | 1024 |
| Opus 4.7 | 2048 |
| Opus 4.6, Opus 4.5, Haiku 4.5 | 4096 |

### Known cache invalidators in this app

A cache entry is only read when everything before the breakpoint is
byte-identical, in the order tools, system, messages. These changes break it:

- **Tool set changes.** Anthropic's table says modifying tool definitions
  invalidates the entire cache (tools, system and messages). Toggling web
  search is listed separately: the tools cache stays valid, but the system
  and messages caches are invalidated ("Enabling/disabling web search
  modifies the system prompt").
- **The tool-loop final-step instruction.** `prepareStep` edits the
  instructions on the last allowed step, so that step does not reuse the
  entry written by earlier steps. On models with preserved thinking it also
  fails the prefix check; see "Thinking blocks and the prefix check".
- **The date line.** The current-date line is the last line of the system
  text and changes when the user's local midnight passes, so it invalidates
  that chat's cached messages once per day and nothing before it. See
  [`general.md`](./general.md#the-current-date-line).
- **Project memory and instruction edits.** They live in the system prompt.
- **Search and image mode toggles.** They change the tools and the system
  prompt.
- **Thinking or effort changes.** Changing the reasoning level always
  invalidates cached messages. Whether the tools and system caches survive is
  model-specific: they are also invalidated on models that render the
  thinking configuration ahead of them, so do not assume the prefix stays
  valid.

### The search-answer continuation is excluded

The search-answer continuation `streamText` in
`server/api/v1/chats/[slug]/index.post.ts` runs with **no tools**, while the
main call and the next turn run with tools. Because dropping or adding web
search invalidates at least the system and messages caches, a cache write made
by the continuation can never be read: it would be a pure 1.25x write
premium. The continuation therefore
passes its provider options through `omitPromptCacheControl()`
(`server/utils/ai/search-answer-continuation.ts`), which drops
`anthropic.cacheControl` (and the gateway equivalents, see
[`general.md`](./general.md#prompt-caching)) and leaves every other option
untouched. The shared options object is never mutated.

### Not covered

- **Gateways.** Direct Anthropic is the only path through
  `getProviderOptions()`. Vercel AI Gateway and OpenRouter (`anthropic/`
  models) have their own switches and Cloudflare AI Gateway gets none. See
  [`gateways.md`](./gateways.md#gateway-prompt-caching).
- **Title and project-memory `generateText` calls.** They are small,
  one-shot prompts: usually below the minimum length and never repeated, so a
  cache write would only cost more.

## Reasoning

Anthropic documents that Opus 5.5's adaptive thinking "is always on and
can't be turned off"
([effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)).
`claude-opus-5-5` is therefore curated with `cannotDisable: true` and
`defaultLevel: 'medium'`: the menu has no `Off`, and `off` is sent and
persisted as `medium`. Every other Claude model still offers `Off`. See
[`docs/chat-reasoning.md`](../chat-reasoning.md#models-that-cannot-disable-reasoning).

## Thinking blocks and the prefix check

Claude Fable 5.1 and 5.2, Mythos 5.1 and 5.2, Opus 5.5, Sonnet 5.5 and
Haiku 5.5 bind every thinking block to what came before it. Anthropic's
[preserved thinking docs](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)
say a block is tied to "`system`, `tools`, and every earlier message. If any
of them changes, the block fails the prefix check, and the request can get a
400 error." The error reads "The block is bound to a different
conversation". `tool_choice`, `effort`, `max_tokens` and other parameters are
not part of the check
([prefix checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks)).

Across sends this never matters: the history sanitizer drops reasoning and
its signature from earlier assistant turns
([`model-switch-context.md`](../chats/model-switch-context.md)). Inside one
send it does, because the tool loop replays each step's thinking to the next
step, and Besidka changes the prefix between steps on purpose:

- **The tool index (C-15).** `tool_index__load` and `use_connector` add the
  loaded tools to `activeTools` from the next step on, so `tools` grows. This
  is what failed on PR #923 with Claude Haiku 5.5.
- **The forced final step.** For a direct Anthropic model, `prepareStep`
  adds the final-step addendum to the instructions, so `system` changes.
- **Approval resumes.** A resumed send replays the paused send's thinking
  blocks with their signatures, under the tool set rebuilt for the resume.

`withAnthropicThinkingBinding()` (`server/utils/ai/anthropic-thinking-binding.ts`)
wraps the send's `prepareStep` for a direct Anthropic model with preserved
thinking. It compares each step's tools, tool order and instructions with
the earlier steps'. From the first step that differs, and on every step
after it, it sends `thinking.blockBinding: { prefixMismatchBehavior:
'drop_block' }`. The provider then adds the
`thinking-binding-controls-2026-08-01` beta, and the API drops the blocks
that no longer match instead of failing: "The API drops the invalid blocks,
and the request succeeds. You aren't billed for those blocks". A step that
replays no signed thinking block never gets it. A resumed send gets it from
the first step when reasoning is on, or when the resume reloaded tools or
reopened a connector. Steps before any change, and sends that never change,
are sent exactly as before.

`getAnthropicThinkingBinding()` (`server/utils/providers/anthropic.ts`)
builds the option. An explicit `thinking` replaces the one the provider
derives from `reasoning`, so with reasoning on it spells out the derived
`{ type: 'adaptive', display: 'summarized' }` in full (without `display` the
reasoning text can come back empty). With reasoning off the provider sends no
`thinking` and these models default to adaptive thinking ("Leaving `thinking`
out gives adaptive thinking on these models too"), so the binding goes with a
bare `{ type: 'adaptive' }` and no `display`, which keeps the API's default.
The API requires `type` next to `block_binding`: a `thinking` object with only
the binding fails with "thinking.type: Field required" (Claude Haiku 5.5 on
PR #923, after #946 sent that shape), and sending the binding with
`disabled` or `between_tools` is a 400 on every model. The AI SDK schema
accepts the typeless shape, so the unit test captures every request body and
fails if a `thinking` object ever lacks a valid `type`, and if the provider's
derived object drifts from the one spelled out here.

Cost: a dropped block is not billed, and the step that changed the tools or
instructions already misses the prompt cache. The API drops the first
mismatched block and every thinking block after it in that request, so from
the change on the model can answer without the thinking of the earlier
steps. Each send that drops blocks logs
`attributes.anthropicThinking` (prefix changes and the `thinking_dropped`
count from `input_transformations`).

Not done, and the better long-term fix: declare the deferred tools with
`providerOptions.anthropic.deferLoading: true` from the first step and surface
a loaded one with a `toolChanges` `tool_addition` in a system message appended
after its tool result (the `mid-conversation-tool-changes-2026-07-01` beta),
and move the final-step addendum into an appended system message. That keeps
every thinking block and the prompt cache, but the wire shape was not checked
against the live API yet. Also not covered: gateway routes (Vercel AI
Gateway, OpenRouter) to these models, and the search-answer continuation of a
resumed send, which replays the resumed thinking with no tools.

## Cost accounting

Anthropic bills three input buckets at different rates. Multipliers are
relative to the base input price:

| Bucket | Multiplier |
|---|---|
| Cache write, 5 minute TTL | 1.25x |
| Cache write, 1 hour TTL | 2x |
| Cache read | 0.1x |
| Cache read, Opus 5.5 and Sonnet 5.5 | 0.05x |
| Cache read, Fable 5.1 | 0.025x |

In AI SDK 7, `usage.inputTokens` is the total prompt size
(`noCacheTokens + cacheReadTokens + cacheWriteTokens`), with the buckets in
`usage.inputTokenDetails`. `buildMessageUsage()` in
`server/utils/ai/message-usage.ts` prices each bucket on its own:

```
inputCost = noCache * input
          + cacheRead * (cacheReadPrice ?? input)
          + cacheWrite * (cacheWritePrice ?? input)
```

with everything divided by 1,000,000. `noCacheTokens` falls back to
`max(0, inputTokens - cacheRead - cacheWrite)` when the SDK leaves it
undefined. `MessageUsage.inputTokens` stays the total, and the new optional
`cacheWriteTokens` sits next to `cachedInputTokens`.

Cache prices come from models.dev (`cost.cache_read`, `cost.cache_write`),
are stored in the snapshot as `cost.cacheRead` / `cost.cacheWrite`, and reach
`getModelCostMap()` as numeric fields (see
[`../models-data-fetching.md`](../models-data-fetching.md)). A model without a
published cache rate bills that bucket at the plain input price, which is the
old behavior.

This fixes cost display beyond Anthropic: OpenAI, Google, xAI and DeepSeek
cache automatically and report `cacheReadTokens`, which used to be billed at
the full input price. They now use their published `cache_read` rate.

## Skills in containers

Skills the user marked "Allow scripts" run in Anthropic's own code execution
container, on the user's own key, never through a gateway and never with a
Besidka key. Besidka uploads the skill to the user's Anthropic workspace
(`uploadSkill` with `anthropic.skills()`), pins the returned version, and sends
`providerOptions.anthropic.container.skills = [{ type: 'custom',
providerReference: { anthropic: <id> }, version }]` next to the D-7 code
execution tool. The SDK adds the `skills-2025-10-02`, `code-execution-2025-08-25`
and `files-api-2025-04-14` betas itself. The full design, the disclosure, the
reserved-word rule (`anthropic` and `claude` are replaced inside a name),
the per-chat consent and the delete rules are in
[`../skills.md`](../skills.md) section 7.

- **Billing.** Container time is billed by Anthropic to the user's
  organization after its free allowance (1,550 container-hours a month, then
  $0.05 an hour with a 5-minute minimum). The response carries no billable
  usage, so Besidka records how many skills were attached
  (`attributes.codeExecution.skills`) and never a cost.
- **Data.** Skills are workspace-scoped (visible to everything in the
  workspace), not covered by zero data retention, kept until deleted and then
  under Anthropic's retention policy. Container data is kept up to 30 days and
  cannot be deleted. Besidka deletes the skill (every version, then the skill:
  `DELETE /v1/skills/{id}/versions/{version}`, then `DELETE /v1/skills/{id}`)
  when scripts are turned off, the skill is deleted or the account is purged,
  and warns before the Anthropic key is removed while copies exist.
- **Caching.** Attaching skills changes the request, so the first send after
  an upload misses the prompt cache once. A new `current_version` replaces the
  copy lazily, never on every save.
- **Not verified live.** Everything is tested against mocks; the first run
  with a real key is a manual check (see section 7 of `skills.md`).

## Message threads

Not used. Evaluated on 2026-11-03 together with OpenAI's
`previous_response_id`, see
[`conversation-state.md`](./conversation-state.md).
