# Chat context across mid-chat model switches

Investigation write-up and reference for what the model sees when a user
switches model or provider inside an existing chat. It records how the
history is rebuilt, what survives the switch, what is lost, and the gaps
found. The fixes ship as three child PRs (see "Child PRs"); this doc is the
umbrella reference they link back to.

## Summary

- The server never replays raw persisted history. On every send it rebuilds
  the model context from the database for the currently selected model, and
  a whitelist sanitizer keeps only text from past assistant turns.
- Because of that sanitizer there is no cross-provider incompatibility for
  reasoning blocks or tool parts: they never reach the next model.
- The cost is lost context: follow-ups cannot see earlier sources, web search
  results, or generated pixels unless they appear in the answer text.
- Files are the real switch hazard. Earlier user files are gated by the new
  model's input modalities, but the newest message's files are checked only
  for images, so some PDF sends fail or are silently dropped.
- Nothing tells the user that context was omitted.

## How history is rebuilt on every send

All paths are in `server/api/v1/chats/[slug]/index.post.ts` unless noted.

1. The request body carries exactly one message
   (`messages: z.array(incomingUserMessageSchema).length(1)`, line 186). The
   client never sends history.
2. The route loads the earlier messages from D1, then runs
   `buildModelContextMessages` (call at line 577), which wraps
   `sanitizeMessagesForModelContext`
   (`server/utils/files/assistant-files.ts:75`), with the current model's
   input modalities wired in through `createCarriedMediaTypePredicate`
   (line 580).
3. `convertFilesForAI` (lines 584-587) turns file URLs into data the SDK can
   send and reports `missingFiles`.
4. `buildMessagesForModel` (call at line 1185, definition in
   `server/utils/chats/model-turns.ts`) keeps the model-facing turns
   alternating: a `(no reply)` assistant turn between adjacent user turns, an
   `(earlier message deleted)` user turn between adjacent assistant turns,
   and the Google leading-assistant placeholder. It keys on the underlying
   model provider (`modelProviderId`), so gateway-routed `google/*` models get
   the placeholder too.
5. `convertToModelMessages` (line 1312) produces the AI SDK model messages
   passed to `streamText`.

Because the model is resolved fresh from each request, switching model or
provider needs no migration step: the next send simply rebuilds the context
for the new target.

## The whitelist sanitizer

`sanitizeMessageParts` (`assistant-files.ts:269-325`) has been a whitelist
since commit `9c79d6ab` (2026-05-04, "reduce worker memory usage"). For a
past message:

| Part | Result |
| --- | --- |
| `text` | Kept. Persisted image-generation, empty-answer and oversized-response failure notices on assistant turns are dropped |
| assistant `file` | Replaced by a one-line text note ("Generated file saved in the user file library: ...") |
| user `file` (newest user message) | Kept as a file part |
| user `file` (earlier) | Kept only if selected for carry-over, otherwise replaced by the omitted-file text |
| `reasoning`, `reasoning-file` | Dropped |
| `tool-*`, including provider-executed `tool-web_search` | Dropped |
| `source-*`, `data-*`, `step-start` | Dropped |

Part metadata is stripped too: Anthropic reasoning signatures and OpenAI
`itemId` values never leave the database. A message that sanitizes to zero
parts is skipped entirely (`assistant-files.ts:84-86`).

### Consequences

- No cross-provider incompatibility for reasoning or tools. A chat that
  started on one provider with search and reasoning can move to any other
  provider without the new backend ever seeing an opaque foreign part.
- Follow-ups cannot see past sources or URLs unless they were written into
  the answer text. A "what was the second source you cited?" follow-up only
  works when the citation was in the prose.
- Multi-turn image editing has no pixels to edit: the assistant's generated
  image becomes a text note (ticket IMG-012 in
  `docs/chats/files-generation-tickets.md`, line 405).
- A deep research turn carries only its report text into later turns.

## Earlier user files

Earlier user files are carried only when all of these hold
(`selectCarriedFileParts`, `assistant-files.ts:156-215`;
constants in `server/utils/files/file-governance.ts:20-24`):

- The file belongs to one of the last 3 earlier user messages
  (`CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES`).
- No more than 8 files in total (`CARRIED_FILES_MAX_COUNT`) and 5 MB in total
  (`CARRIED_FILES_MAX_BYTES`), further reduced by the newest message's own
  files against the 10 MB request budget (`REQUEST_FILES_MAX_BYTES`).
- Text files are at most 64 KB (`CARRIED_TEXT_FILE_MAX_BYTES`).
- The current model accepts the media type. The predicate in
  `server/utils/files/carried-media-types.ts` always allows `text/*`, allows
  `image/*` only when `modalities.input` includes `image`, allows
  `application/pdf` only when it includes `pdf`, and rejects everything else.

A file that fails any check becomes the text `Previously attached file
omitted from model context: <name>.` (`omittedFilePrefix`,
`assistant-files.ts:50`). Only the model sees that text; the user never does.

Gateway sends carry no earlier files at all: on the gateway branch `model`
is undefined, so `canCarryMediaType` is undefined and
`selectCarriedFileParts` returns an empty set (line 571-573 in the route,
early return at `assistant-files.ts:163-169`).

## Gaps found

### Newest-message files are only checked for images

The pre-flight check at `index.post.ts:314-327` rejects a message with an
image attachment when the model does not advertise `image` input. There is
no equivalent check for PDFs or other media types on the newest message, so
the model's declared modalities are not enforced for the file the user is
sending right now. Observed per provider:

| Provider | PDF on the newest message |
| --- | --- |
| xAI (Grok) | Always throws. `@ai-sdk/xai` (`^5.0.24`) `xai()` selects the Responses API, which rejects non-image inline data, yet the models.dev snapshot (`providers/data/models-dev-snapshot.json`) declares `pdf` input for the Grok chat models (for example `grok-4.7` and `grok-4.20-*`) |
| Moonshot AI (Kimi) | Throws in `@ai-sdk/moonshotai` |
| DeepSeek | Silently dropped; the SDK emits only a warning that is never logged |
| Qwen, and GPT models without `pdf` | Suspected 400 from the provider; not verified live |

### No user-visible indicator

Omitted earlier files, dropped parts and gateway-stripped files are all
invisible to the user. The chat looks complete while the model answers from
a reduced context.

### Stale documentation (fixed)

`docs/providers/moonshotai.md` claimed a `tool-web_search` part is resent
verbatim to a different provider after a switch, and to Moonshot itself on
every later turn. Neither is true: the whitelist sanitizer drops every
`tool-*` part from earlier turns, so the part stays in `messages.parts` and
only flows back within the turn that produced it. The Moonshot and xAI docs
and `docs/providers/general.md` now say so.

### Edge cases (confirmed and fixed)

- Back-to-back user messages when an assistant turn sanitizes to empty.
  Reasoning-, source-, tool- or failure-notice-only replies are persisted
  but the skip at `assistant-files.ts:84-86` removes them. Only
  `@ai-sdk/anthropic` merges adjacent user turns; the other converters send
  them separately. `buildMessagesForModel` now inserts a `(no reply)`
  assistant turn, and also bridges adjacent assistant turns left by
  single-message delete.
- The gateway-routed Gemini leading-assistant placeholder was missed because
  it keyed on `errorProviderId`, which is the gateway id on gateway sends. It
  now keys on `modelProviderId` (the gateway model id's vendor prefix).

### Test gap (narrowed)

Most chat-route integration specs mock `sanitizeMessagesForModelContext` as
identity. Two run the real sanitizer:
`tests/integration/api/chats-carried-files.spec.ts` spreads the real
`assistant-files` module and covers the model-switch image case ('omits an
earlier image after switching to a text-only model'), and
`tests/integration/api/chats-model-context-real-sanitizer.spec.ts` sends a
history with an Anthropic reasoning signature, an OpenAI `itemId` and a Brave
tool result and checks that only metadata-free text with strictly alternating
roles reaches `convertToModelMessages`, with the empty turn replaced by the
`(no reply)` placeholder. PDFs on the newest message are still covered only
by the unit spec `tests/integration/server/assistant-files.spec.ts`.

## Child PRs

This branch (`feat/model-switch-context`) is the umbrella parent. The three
children target it rather than `main`.

1. Gate the newest message's files by the model's input modalities and log
   SDK warnings, so unsupported PDFs fail with a clear 400 and DeepSeek-style
   silent drops become visible in the logs. (PR link added when opened)
2. A user-visible indicator for omitted context. (PR link added when opened)
3. Stale docs plus the empty-turn and placeholder edge cases. (PR link added
   when opened)

Children get no CI of their own. This PR builds and deploys the Cloudflare
preview with every merged child; merge the children first, then squash-merge
this PR into `main`.
