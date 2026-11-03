# Server-side conversation state (evaluated 2026-11-03, not adopted)

Two providers let a request send only the new message and point at the
earlier conversation stored on their side:

- **OpenAI**: `previous_response_id` and the Conversations API, in the
  Responses API. OpenAI shipped this first.
- **Anthropic**: message threads, a public beta announced on 2026-11-02.

Besidka uses neither. Every send rebuilds the history from D1 and sends all
of it. This doc records why, so the question doesn't have to be researched
again. It is not about prompt caching: `promptCacheKey` and `x-grok-conv-id`
only route requests to a warm cache and store nothing (see
[`general.md`](./general.md#prompt-caching)).

## Summary

| | OpenAI `previous_response_id` | Anthropic message threads |
|---|---|---|
| What you send | New input + `previous_response_id` | New messages + `thread: { type: 'continue', previous_message_id }` |
| Stored for | 30 days (`store: true`); Conversations API items have no 30-day TTL | 5 min idle, deleted at most 1 h after last use, in memory only |
| System prompt | `instructions` are sent per request and not carried over | `system` and `tools` frozen at create; sending them on continue is a 400 |
| Fixed per chain | Not documented | `model`, `tool_choice`, `thinking`, beta set and more (`thread_fingerprint_mismatch`) |
| Branching | Likely from any stored response (not verified) | Append-only, each response id continues once |
| Price | All earlier input tokens billed as input | Unchanged |
| Gain | Smaller request; reasoning items stay with the chain | Lower time to first token (Anthropic: ~35% median at 500k to 1M tokens) |
| AI SDK | `providerOptions.openai.previousResponseId` and `conversation` exist; the step loop does not chain on its own (vercel/ai#16356) | Not released; vercel/ai#24397 approved, not merged |
| ZDR | Works on stored responses, so likely not for ZDR orgs (not verified) | Not ZDR eligible |

Neither one lowers cost. Both need the app to keep its own full history and
a replay path, and both clash with the same parts of Besidka.

## Why it doesn't fit Besidka

These apply to both providers:

- **D1 is the source of truth, and users can change it.** Users can delete a
  message (in the UI and with the MCP `delete_chat_message` tool), edit,
  regenerate and branch chats. A provider-side chain still holds the deleted
  or replaced content and keeps feeding it to the model. On OpenAI it is
  stored for 30 days, so after a deletion the chain has to be dropped and the
  history replayed.
- **The model would see a different context than the replay.** The whitelist
  sanitizer keeps only text from past assistant turns. It drops reasoning,
  tool calls, sources and OpenAI `itemId`s (see
  [`../chats/model-switch-context.md`](../chats/model-switch-context.md)). A
  stored chain keeps all of these. The same chat would then behave
  differently depending on whether the chain is still alive, and file
  carry-over and omitted-file notes would no longer apply.
- **Model switches are common.** Each switch to another provider needs a full
  replay, and so does each switch back.
- **New state per message.** The last response id has to be stored per
  assistant message (a new D1 column, which is additive, or message metadata)
  and kept consistent with every edit path.

Specific to Anthropic threads:

- A thread expires 5 minutes after its last request. Human turns are often
  further apart, so most sends would replay anyway.
- `buildChatInstructions()` rebuilds the system prompt on every send (memory,
  project prompt, knowledge block, tool toggles, the current date), and the
  tool set follows the per-send toggles. Any change needs a new thread.
- A change of model or reasoning level, or a refusal, needs a new thread.

Specific to OpenAI:

- It saves no tokens and no money. The only gains are a smaller upload and
  keeping reasoning items, which OpenAI says helps reasoning models and cache
  hits. To get the reasoning gain without chaining, keep reasoning items in
  the replay instead. That is a sanitizer decision, not a state decision.

## Within one send (the only candidate)

The tool loop (`server/utils/ai/tool-loop.ts`, `stepCountIs(4)`) runs its
steps seconds apart, with the same system prompt and tools, and only appends
messages. Nothing a user edits can land in the middle. This is the one place
where either feature fits:

- **Anthropic**: at most two continue steps per send. The forced last step
  switches to `toolChoice: 'none'`, `activeTools: []` and new instructions.
  That is a fingerprint mismatch, so it must run unthreaded. The
  search-answer continuation changes tools, so it runs unthreaded too.
- **OpenAI**: `prepareStep` could pass `previousResponseId` from
  `steps.at(-1).response.id` and send only the new tool results. This saves
  upload only.
- The gain shows only on very large contexts (big project knowledge
  injections, long histories). Typical Besidka chats are far smaller.

## AI SDK details

- `@ai-sdk/openai` 4.0.108: `previousResponseId` and `conversation` (the two
  cannot be combined) are typed provider options, and `instructions` can
  change the system message on a continued chain. `store` defaults to true,
  so OpenAI already stores Besidka's responses for 30 days under the user's
  key, even though Besidka never chains them. Chaining across steps is manual
  (vercel/ai#16356, #14807).
- `@ai-sdk/anthropic` 4.0.96 (latest on 2026-11-03) has no thread support.
  vercel/ai#24397 adds `providerOptions.anthropic.thread` with `create` and
  `continue` + `previousMessageId`. It also adds the beta header
  `message-threads-2026-08-12`, omits `system` and `tools` on continue, and
  keeps thread error codes in `APICallError.data`. Its own docs say chaining
  is not automatic. A `prepareStep` has to pass only the new messages and
  `steps.at(-1).response.id`, and replay with `create` on `thread_not_found`,
  `thread_already_continued` or `thread_continue_in_flight`.
- vercel/ai#24425: AI Gateway drops `thread`. This doesn't matter here,
  because direct-provider keys never route through a gateway.

## Data handling

- Anthropic holds a thread encrypted in memory and deletes it within 1 hour
  of last use. That is shorter than the 30-day API retention the Privacy
  Policy already states.
- OpenAI already stores responses for 30 days because `store` defaults to
  true. The Privacy Policy only mentions abuse-monitoring logs "for up to 30
  days". Before Besidka chains on stored responses, or sets
  `store: false`, check that wording.
- Both providers are independent controllers under the user's own key. No
  legal text claims ZDR for either one, so adopting within-turn chaining
  needs at most a DPIA note.

## Revisit when

- vercel/ai#24397 ships in a release (Anthropic), and
- chats with large contexts show measurable time to first token or upload
  latency in Axiom, or users complain about it.

Start with the within-one-send tool loop. Do not try to chain across user
turns unless the delete, edit and branch paths drop the stored chain.

## Sources

- Anthropic: <https://claude.com/resources/articles/message-threads>,
  <https://platform.claude.com/docs/en/build-with-claude/message-threads>
- OpenAI: <https://developers.openai.com/api/docs/guides/conversation-state>
- AI SDK: vercel/ai#24397, #24409, #24425, #16356, #14807
