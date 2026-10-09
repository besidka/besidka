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
  entry written by earlier steps.
- **The UTC date line.** The current-date instruction changes when UTC
  midnight passes, invalidating every chat's cache once per day.
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
