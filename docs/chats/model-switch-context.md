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
  model's input modalities, and since #481 the newest message's files are
  too, so an unsupported PDF fails with a clear 400 instead of a provider
  error or a silent drop.
- Since #476 the assistant turn tells the user when earlier files were left
  out of the model context.

## How history is rebuilt on every send

All paths are in `server/api/v1/chats/[slug]/index.post.ts` unless noted.

1. The request body carries exactly one message
   (`messages: z.array(incomingUserMessageSchema).length(1)` in the body
   schema). The client never sends history.
2. The route loads the earlier messages from D1, checks the newest message's
   files with `assertFilesDeliverable()`
   (`server/utils/chats/file-delivery-check.ts`), then runs
   `buildModelContextMessages`, which wraps `sanitizeMessagesForModelContext`
   (`server/utils/files/assistant-files.ts`), with the current model's input
   modalities wired in through `createCarriedMediaTypePredicate` and the text
   size of each Office file (`officeTextBytesByStorageKey`).
3. `convertFilesForAI` turns file URLs into data or text the SDK can send
   (an Office file becomes its extracted text) and reports `missingFiles` and
   `unsupportedFiles`. `assertOnlyDeliverableFileParts()` then fails with a
   400 if any `file` part other than an image or PDF is left.
4. `buildMessagesForModel` (definition in
   `server/utils/chats/model-turns.ts`) keeps the model-facing turns
   alternating: a `(no reply)` assistant turn between adjacent user turns, an
   `(earlier message deleted)` user turn between adjacent assistant turns,
   and the Google leading-assistant placeholder. It keys on the underlying
   model provider (`modelProviderId`), so gateway-routed `google/*` models get
   the placeholder too.
5. `convertToModelMessages` produces the AI SDK model messages passed to
   `streamText`; the same guard runs just before it as a backstop.

Because the model is resolved fresh from each request, switching model or
provider needs no migration step: the next send simply rebuilds the context
for the new target.

## The whitelist sanitizer

`sanitizeMessageParts` (`assistant-files.ts`) has been a whitelist
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
parts is skipped entirely.

### Consequences

- No cross-provider incompatibility for reasoning or tools. A chat that
  started on one provider with search and reasoning can move to any other
  provider without the new backend ever seeing an opaque foreign part.
- Follow-ups cannot see past sources or URLs unless they were written into
  the answer text. A "what was the second source you cited?" follow-up only
  works when the citation was in the prose.
- Multi-turn image editing has no pixels to edit: the assistant's generated
  image becomes a text note (ticket IMG-012 in
  `docs/chats/files-generation-tickets.md`).
- A deep research turn carries only its report text into later turns.

## Earlier user files

Earlier user files are carried only when all of these hold
(`selectCarriedFileParts` in `assistant-files.ts`; constants in
`server/utils/files/file-governance.ts`):

- The file belongs to one of the last 3 earlier user messages
  (`CARRIED_FILES_MAX_PREVIOUS_USER_MESSAGES`).
- No more than 8 files in total (`CARRIED_FILES_MAX_COUNT`) and 5 MB in total
  (`CARRIED_FILES_MAX_BYTES`), further reduced by the newest message's own
  files against the 10 MB request budget (`REQUEST_FILES_MAX_BYTES`).
- Text files are at most 64 KB (`CARRIED_TEXT_FILE_MAX_BYTES`).
- The current model accepts the media type. The predicate in
  `server/utils/files/carried-media-types.ts` always allows `text/*` and the
  three Office types (`.docx`, `.xlsx`, `.pptx`, which are sent as extracted
  text), allows `image/*` only when `modalities.input` includes `image`,
  allows `application/pdf` only when it includes `pdf`, and rejects
  everything else.
- An Office file is carried only when its extracted text is ready, and its
  text size (`files.text_bytes`) replaces the file size in the count, byte and
  64 KB checks. An Office file without ready text is omitted as
  `unsupported-by-model`; it never makes the send fail.

A file that fails any check becomes the text `Previously attached file
omitted from model context: <name>.` (`omittedFilePrefix`,
`assistant-files.ts:50`). Only the model sees that text; the user never does.

Gateway sends carry no earlier files at all: on the gateway branch `model`
is undefined, so `canCarryMediaType` is undefined and
`selectCarriedFileParts` returns an empty set (the early return on a missing
`canCarryMediaType`).

## Gaps found

Each gap below names the child PR that closed it. Items marked "by design"
are intentional trade-offs, and "still open" items are not addressed by
this work.

### Newest-message files were only checked for images (closed by #481)

The pre-flight check only rejected an image attachment for a model without
`image` input. PDFs on the newest message always went through. Observed per
provider before the fix:

| Provider | PDF on the newest message |
| --- | --- |
| xAI (Grok) | Always threw. `@ai-sdk/xai` (`^5.0.24`) only has the Responses model, whose converter rejects inline PDFs, yet models.dev declares `pdf` input for the Grok chat models |
| Moonshot AI (Kimi) | Threw in `@ai-sdk/moonshotai` |
| DeepSeek | Silently dropped; the SDK warning was never logged |
| Qwen, and GPT models without `pdf` | Suspected 400 from the provider; not verified live |

#481 moves the media-type predicate to `shared/utils/input-media-types.ts`
and checks every newest-message file against the model's input modalities
before the user message is persisted (so regenerate after a switch is
covered too). Image-generation models are checked against their controller
model. xAI gets a curated `excludedInputModalities: ['pdf']`, and OpenAI
vision models get `pdf` through `impliedInputModalities`, since OpenAI's
docs say they parse PDFs. `streamText` SDK warnings are now logged
(`attributes.aiWarnings`, `attributes.aiContinuationWarnings`), and provider
"does not support PDF" errors are rewritten into a clear message.

Still open after #481:

- Gateways gate images only, and only when the catalog positively lists
  input modalities without `image`; PDFs are never gated (catalogs say
  `file`, not `pdf`), and Cloudflare is skipped because its catalog needs
  user credentials.
- The deep research route does not run this check.
- No real provider calls were made; the OpenAI PDF rule rests on OpenAI's
  docs.

### No user-visible indicator (closed by #476)

Omitted earlier files were invisible to the user. #476 streams a
`data-omitted-context-files` part, and the assistant turn shows a collapsed
note listing each left-out earlier file with its reason
(`unsupported-by-model`, `over-limit`, `outside-window`,
`gateway-no-carry`). `buildModelContextMessages()` in `assistant-files.ts`
returns the list; `sanitizeMessagesForModelContext()` stays as a wrapper.

By design, there is still no notice for parts the sanitizer always drops
(reasoning, tool calls and results, sources). Still open: no notice for
window files of unknown size (missing, unowned or `data:` URLs), and the
notice lives on the live turn only, so it is not persisted. See
`docs/files.md`.

### Office files reached providers as raw file parts (closed by BES-370)

A DOCX, XLSX or PPTX (a generated document, or any Office file in the
library) attached to a message was sent as a `data:` URL `file` part, because
nothing gated types other than images and PDFs. `@ai-sdk/anthropic` throws on
it (and on `text/markdown`/`text/csv` file parts), Moonshot and the
Cloudflare gateway throw, DeepSeek drops it silently, and OpenAI needs
`passThroughUnsupportedFiles` to accept it. Office files now reach every model
as extracted text, and a file that cannot be read is a clear 400 that names
the file and the reason, never a provider error or a silent drop. The rules
are in `docs/files.md` ("Office attachments") and `resolveFileDelivery()`
(`shared/utils/file-delivery.ts`).

### Gateway sends carry no earlier files (by design)

On the gateway branch `model` is undefined, so no earlier user files are
carried. Since #476 the user sees this as `gateway-no-carry`.

### Stale documentation (closed by #478)

`docs/providers/moonshotai.md` claimed a `tool-web_search` part is resent
verbatim to a different provider after a switch, and to Moonshot itself on
every later turn. Neither is true: the whitelist sanitizer drops every
`tool-*` part from earlier turns, so the part stays in `messages.parts` and
only flows back within the turn that produced it. #478 corrects the Moonshot
and xAI docs and describes the whitelist in `docs/providers/general.md`.

### Lost context from dropped parts (by design)

Follow-ups cannot see earlier sources, search results or generated pixels
unless they are in the answer text (see "Consequences"). This is the price
of having no cross-provider incompatibility, and it is not changed.

### Adjacent same-role turns (closed by #478)

Reasoning-, source-, tool- or failure-notice-only replies are persisted,
but they sanitize to nothing, so the empty-message skip in
`buildModelContextMessages()` removes the whole message. Two user turns then reached the provider back to
back. Only `@ai-sdk/anthropic` merges adjacent user turns; the Google,
OpenAI, openai-compatible, xAI, DeepSeek and OpenRouter converters send them
separately. Single-message delete can likewise leave two assistant turns in
a row. #478 adds `buildMessagesForModel` in
`server/utils/chats/model-turns.ts`: a `(no reply)` assistant turn between
adjacent user turns, and an `(earlier message deleted)` user turn between
adjacent assistant turns, for every provider. The placeholders only exist
in the array sent to the model, never in `originalMessages` or persisted
history.

### Gateway-routed Gemini missed the leading-assistant placeholder (closed by #478)

The placeholder was keyed on `errorProviderId === 'google'`, and
`errorProviderId` is the gateway id on gateway sends, so a Gemini model
reached through a gateway never got it. #478 keys it on `modelProviderId`
(the gateway model id's vendor prefix, or the direct `provider.id`) and
leaves `errorProviderId` unchanged.
`tests/integration/api/chats-google-leading-assistant-placeholder.spec.ts`
covers Vercel `google/*`, OpenRouter `google/*`, and a Vercel non-Google
negative case; both Gemini gateway cases fail on the old keying. Cloudflare
ids are `@cf/...`, so they never match `google`.

### Test gap (narrowed by #478)

Most chat-route integration specs mock `sanitizeMessagesForModelContext` as
identity. Two run the real sanitizer:
`tests/integration/api/chats-carried-files.spec.ts` spreads the real
`assistant-files` module and covers the model-switch image case ('omits an
earlier image after switching to a text-only model'), and
`tests/integration/api/chats-model-context-real-sanitizer.spec.ts` sends a
history with an Anthropic reasoning signature, an OpenAI `itemId` and a Brave
tool result and checks that only metadata-free text with strictly alternating
roles reaches `convertToModelMessages`. #481 adds route-level integration
specs for newest-message PDF rejection.

## Child PRs

This branch (`feat/model-switch-context`) is the umbrella parent. The three
children target it rather than `main`.

1. [besidka/besidka#481](https://github.com/besidka/besidka/pull/481): gate
   newest-message files by the model's input modalities and log SDK
   warnings.
2. [besidka/besidka#476](https://github.com/besidka/besidka/pull/476): a
   user-visible notice for earlier files left out of the model context.
3. [besidka/besidka#478](https://github.com/besidka/besidka/pull/478):
   stale provider docs, adjacent same-role turns, and the gateway-routed
   Gemini placeholder.

Children get no CI of their own. This PR builds and deploys the Cloudflare
preview with every merged child; merge the children first, then squash-merge
this PR into `main`.
