# Chat error handling

Scope:
- structured chat errors returned by `POST /api/v1/chats/[slug]`,
- client-side rendering of failed assistant responses,
- Cloudflare request IDs and provider request IDs,
- `/chats/test` scenarios for manual verification.

Main files:
- `server/api/v1/chats/[slug]/index.post.ts`
- `server/utils/chats/errors.ts`
- `app/composables/chat.ts`
- `app/pages/chats/[slug].vue`
- `server/api/v1/chats/test/index.get.ts`
- `server/api/v1/chats/test/index.post.ts`
- `shared/types/chat-errors.d.ts`
- `shared/utils/chat-test-errors.ts`

## Goals

The chat flow must do three things when generation fails:

1. Show a clear user-facing explanation instead of a generic `Server Error`.
2. Preserve enough metadata to debug the failure in Cloudflare and provider logs.
3. Keep retry and regenerate behavior safe so failed partial assistant output does not corrupt the next request.

## Server-side behavior

### Structured error payload

The chat server normalizes failures into a common payload:

```ts
interface ChatErrorPayload {
  code:
    | 'provider-rate-limit'
    | 'provider-quota-exceeded'
    | 'provider-unavailable'
    | 'provider-auth'
    | 'message-persist-failed'
    | 'chat-request-invalid'
    | 'unknown'
  message: string
  why?: string
  fix?: string
  status?: number
  requestId?: string
  providerId?: 'openai' | 'google'
  providerRequestId?: string
}
```

### What the provider said (2026-11-14)

A spend cap or quota problem used to read as a generic "the provider returned
an internal error". For `provider-unavailable`, `provider-quota-exceeded` and
`provider-rate-limit`, `normalizeChatError` now puts a short line in `why`
built by `summarizeProviderError` (`server/utils/chats/provider-error-summary.ts`):

- Google: `Google returned 429 RESOURCE_EXHAUSTED: <message>` (the code is
  `error.status`).
- Anthropic: `Anthropic returned 529 overloaded_error: Overloaded` (the code is
  `error.type`).
- OpenAI: `OpenAI returned 429 insufficient_quota: <message>` (the code is
  `error.type` or a string `error.code`).
- No body: `Google returned 500`. No status at all: the generic copy stays.

Only 402, 429 and 5xx are summarized, because there the provider's text is
about its own state. A 400 can echo the user's content ("Invalid value: '...'"),
so it is never included. URLs, key-shaped tokens (`sk-`, `AIza`, `xai-`, long
opaque strings) and `api_key`/`token`/`Bearer` assignments are removed, control
characters and runs of spaces collapse, a free-text field cannot pose as the
code (it must look like an identifier), and the line stops at 160 characters.
An explicit `why` from the caller always wins.

### Retried errors and spend caps (2026-11-21)

The AI SDK retries a 408, 409, 429 or 5xx twice (2 s, then 4 s) and then
hands `onError` a `RetryError` ("Failed after 3 attempts. Last error: ...")
that has no status of its own. The provider's `APICallError`, with the status
and body, is `RetryError.lastError`. Before this change the status was lost,
so the summary above never ran and the "failed after 3 attempts" text fallback
turned every retried 429 into `provider-unavailable` ("The upstream model
provider returned an internal error"). Owner report: a Google AI Studio
project over its monthly spend cap failed every Gemini send after about 7 s
that way. `unwrapRetryError` now reads status, request id and summary from
`lastError`; the code is still classified from the full `RetryError` text, so
a retried network failure with no status keeps `provider-unavailable`.

A billing limit is `provider-quota-exceeded` with its own copy, matched on the
provider's text:

- Spend cap (`spend cap` or `spending cap`): Google answers 429
  `RESOURCE_EXHAUSTED` "Your project has exceeded its monthly spending cap."
  or "Your billing account has exceeded its monthly spending cap." (wording
  from Google AI developer forum reports; Google's billing docs do not list
  the response). Message "Your Google API key reached its spend cap.", fix
  pointing to the Spend page, `aistudio.google.com/spend`.
- Empty prepaid balance: Anthropic answers 400 `invalid_request_error` "Your
  credit balance is too low to access the Anthropic API." Message "Your
  Anthropic account is out of credits." It is a 400, so no provider line is
  added to `why`.
- OpenAI `insufficient_quota` and any 402 were already
  `provider-quota-exceeded` and keep the generic copy.

### Pre-stream failures

Failures that happen before the AI stream starts return a non-2xx JSON response body that contains the full `ChatErrorPayload`.

Examples:
- missing or invalid provider key,
- provider auth failure,
- provider quota failure,
- provider setup failure.

This path is important because the AI SDK transport reads the raw non-2xx body text. Returning JSON directly preserves metadata such as `code`, `requestId`, and `providerRequestId`.

### Stream failures

Failures that happen after the stream starts are serialized as UI stream `error` chunks. The `errorText` field contains the same `ChatErrorPayload` as JSON.

Examples:
- provider failure after partial output,
- assistant persistence failure after `onFinish`,
- synthetic `/chats/test` stream failures.

### Logging

The server logs stage-specific metadata with `evlog`:
- `stage`
- `errorCode`
- `providerStatus`
- `providerRequestId`
- safe request context such as provider/model/reasoning/file counts

The dedicated `AI stream completed` wide event (the one shipped to Axiom)
also carries a failed send: the flat `errorCode`, and
`attributes.streamError` with `stage`, `code`, `status` (what the client got),
`providerStatus` and `providerCode` (the provider's own HTTP status and short
code, for example `RESOURCE_EXHAUSTED`), `attempts` (the SDK's retry count)
and `summary` (the safe line above, only for 402, 429 and 5xx). Before
2026-11-21 these fields went only to the request logger and a standalone
`log.error`, never to `aiLogger`, so the owner's failed Gemini sends showed
`toolLoop.steps 0` and no error fields in Axiom.

The server does not log raw prompts or file contents.

## Client-side behavior

### Error rendering

The chat client parses both:
- non-2xx JSON bodies from pre-stream failures,
- JSON `errorText` payloads from streamed failures.

It then:
- shows a toast,
- appends or replaces the last assistant message with an inline error text block.

### Retry safety

When the last assistant message already contains streamed parts, the error stays attached to that same assistant message.

Why this matters:
- `chatSdk.regenerate()` removes the last assistant message before retrying,
- keeping the error on the same assistant message ensures partial failed output does not stay behind in conversation context,
- already streamed source parts remain visible for inspection until the user retries.

### Request IDs in the UI

The inline error text includes:
- `Provider request ID: ...` when available,
- otherwise `Request ID: ...` when available.

In production on Cloudflare, `requestId` usually comes from `cf-ray`.

## Cloudflare observability

### What is logged

Each request-wide `evlog` event now includes:
- `requestId`
- `requestMeta.cfRay`

Chat requests that call the AI SDK also include an `ai` block with fields such as:
- `ai.provider`
- `ai.model`
- `ai.inputTokens`
- `ai.outputTokens`
- `ai.totalTokens`
- `ai.reasoningTokens`
- `ai.finishReason`
- `ai.responseId`
- `ai.msToFirstChunk`
- `ai.msToFinish`
- `ai.tokensPerSecond`
- `ai.toolCalls`

### How to search by request ID

In Cloudflare dashboard:

1. Open `Workers & Pages`.
2. Select the production Worker.
3. Open `Observability`.
4. Set the time range first.
5. Use the search bar or Query Builder.

Primary query:

```txt
requestId = "9e826a92fa133452"
```

Fallback query:

```txt
requestMeta.cfRay = "9e826a92fa133452"
```

### Useful chat failure queries

Find one failed request:

```txt
requestId = "9e826a92fa133452" AND status >= 400
```

Find assistant persistence failures:

```txt
errorCode = "message-persist-failed"
```

Find assistant persistence failures for one request:

```txt
requestId = "9e826a92fa133452" AND errorCode = "message-persist-failed"
```

Find a specific chat stage:

```txt
requestId = "9e826a92fa133452" AND stage = "persist-assistant-message"
```

Find provider-side failures:

```txt
providerStatus >= 400
```

Find rate limit failures:

```txt
errorCode = "provider-rate-limit"
```

### Useful AI queries

Find all requests that called Google:

```txt
ai.provider = "google"
```

Find all requests for one model:

```txt
ai.model = "gemini-3-flash"
```

Find slow model responses:

```txt
ai.msToFinish >= 10000
```

Find slow first token / first chunk:

```txt
ai.msToFirstChunk >= 2000
```

Find expensive requests by total tokens:

```txt
ai.totalTokens >= 20000
```

Find requests with tool calls:

```txt
ai.toolCalls:*
```

Find one request and inspect the AI details:

```txt
requestId = "9e826a92fa133452" AND ai.calls >= 1
```

### Operational notes

- `requestId` search only works for requests after the request observability plugin was deployed.
- Production logs are sampled at `1`, so request lookup should be reliable.
- Production traces are sampled at `0.1`, so a request may exist in logs without having a trace.
- Bot traffic such as `/admin` or `/wp-admin` will also appear in logs if it reaches the Worker.

## Generation-in-progress guard (stuck "generation pending" chat)

`POST /api/v1/chats/[slug]` sets a KV flag
(`chat-generating:<chatId>:<userMessageId>`) for the duration of a generation.
A client retry of the same user message id (issue #275: iOS auto-recovery on
`visibilitychange`) that finds the flag gets a transient
`data-generation-pending` response instead of starting a duplicate, double
billed `streamText()` call.

### Failure mode

When the client drops the connection mid-generation (observed on an iOS PWA
about 20s in), the invocation dies mid-generation. Closing the tab while a
response is streaming deterministically kills the invocation (reproduced
2026-10-08). Neither the persist step nor the `finally { kv.delete }` runs.
The flag was originally written with a fixed 660s TTL sized as the worst-case
generation time, so it outlived the dead invocation by about 11 minutes: every
client retry (roughly every 4s) got `generation-pending`, showing an endless
loader and a retry button until the key expired. A fixed TTL conflated
"maximum generation duration" with "liveness".

Full incident write-up, repro, investigation runbook and options in
`docs/chats/stuck-generation-guard.md`.

### Lease and heartbeat

The flag is now a short lease renewed by a timer while the invocation is alive
(`server/utils/ai/generation-guard.ts`):

- `GENERATION_GUARD_LEASE_TTL_SECONDS = 120`: the TTL of every put.
- `GENERATION_GUARD_HEARTBEAT_INTERVAL_MS = 30_000`: how often
  `startGenerationGuardHeartbeat()` re-puts the key.

A live invocation keeps the flag indefinitely, so fast reconnects still see
"still working" and never trigger a duplicate generation. A canceled
invocation stops renewing it and the flag disappears after the 120s lease
plus up to about 60s of KV edge read caching (the guard check's
`useKV().get` uses the default `cacheTtl`), so about 2-3 minutes in the worst
case.
`execute()` awaits the first put, starts the heartbeat, and the `finally`
awaits the heartbeat's stop function (which also waits for an in-flight
renewal) before `kv.delete`, so a late tick cannot resurrect a deleted flag.
Heartbeat put failures are swallowed and recorded as
`attributes.generationGuard.operation = 'heartbeat'`.

To verify the lease is actually renewed in production, the `AI stream
completed` wide event carries `attributes.generationGuard.heartbeats`, the
count of successful renewals. A generation lasting longer than 30s should show
`heartbeats >= 1`; a long generation reporting `0` means the timer is not
firing and the lease will lapse after 120s.

The numbers follow Cloudflare KV limits: the minimum `expirationTtl` is 60s, a
key can be written at most once per second, and a write can take up to about
60s to become visible in other colos. 120s leaves the 30s interval plus
propagation lag inside the lease, so a healthy invocation's flag never lapses.
The timer is interval-driven, not chunk-driven, because a single provider step
can stream nothing for 60-90s. The tool-loop timeouts no longer size the
guard.

### Runs, Stop and takeover (2026-11-20)

The chat send no longer uses `startGenerationGuardHeartbeat` for its own
lease (memory leases still do). Each send or continuation is a run with a
random id (`server/utils/chats/generation-lease.ts`):

- The lease value is `{ runId, renewedAt }` instead of `'1'`. The run checks
  every 10 s (`GENERATION_STOP_CHECK_INTERVAL_MS`) and renews the lease when
  30 s have passed since the last renewal. Every KV read uses
  `cacheTtl: 30`, the documented minimum.
- Stop in the app calls `POST /api/v1/chats/[slug]/stop`
  (`{ messageId }`, keepalive). The route writes the stop marker
  `chat-generation-stop:<runId>`, deletes the lease and answers
  `{ stopped, runId }`. The run aborts `streamText` with `stopped-by-user`
  (the `abort` chunk stays, no error card) and stores what it streamed as a
  stopped reply: the parts end with `data-reply-stopped`, unfinished tool
  calls are dropped, and no "reply ready" push is sent.
- A send for the same message takes the lease over when the holder was
  stopped (marker, or the `stoppedRunId` the client got from the stop
  route) or missed its heartbeat window (90 s, `GENERATION_LEASE_STALE_MS`)
  instead of answering `data-generation-pending`; a live holder (a second
  tab) still gets the pending answer.
- Retry of a message whose stored reply is stopped generates a fresh reply:
  the replay short-circuit skips stopped replies, the model history leaves
  them out, and the new reply deletes them once its own insert succeeded
  (`readTurnBeforeReply`, `server/utils/chats/stopped-replies.ts`).
- Two retries that take over the same stopped run (two tabs) both write
  the lease at the start of the stream, wait 300 ms and read it back; only
  the run whose write landed last calls the provider (`confirmLeaseHolder`).
- A stopped continuation ends the lease of its unfinished tool-approval
  claims (`expireUnfinishedClaims`), so its retry says "Interrupted. Ask
  again" at once.
- A run that was taken over stores nothing. Right before any send stores
  its reply it reads D1 for the messages after its user message: the first
  answered reply of a turn wins, and a stopped reply never lands after
  anything.
- `release()` deletes the lease only while the run still holds it.

Details, the KV caching analysis and the incident:
`docs/chats/stuck-generation-guard.md`, "Stop and retry".

## `/chats/test` support

The `/chats/test` harness now supports an extra query parameter:

- `error=<id>`

Supported IDs:

- `provider-auth`
  - phase: pre-stream HTTP failure
  - status: `401`
  - purpose: verify provider auth/config messaging
- `provider-rate-limit`
  - phase: pre-stream HTTP failure
  - status: `429`
  - purpose: verify rate-limit messaging and retry guidance
- `provider-quota-exceeded`
  - phase: pre-stream HTTP failure
  - status: `429`
  - purpose: verify quota/billing messaging
- `provider-unavailable`
  - phase: streamed failure after partial output
  - status in payload: `503`
  - purpose: verify partial assistant output + source preservation + inline error
- `message-persist-failed`
  - phase: streamed failure after partial output
  - status in payload: `500`
  - purpose: verify post-generation persistence failure messaging

### Query examples

- `/chats/test?scenario=short&messages=1&error=provider-auth&regenerate`
- `/chats/test?scenario=short&messages=1&error=provider-rate-limit&regenerate`
- `/chats/test?scenario=short&messages=1&error=provider-quota-exceeded&regenerate`
- `/chats/test?scenario=short&messages=1&error=provider-unavailable&regenerate`
- `/chats/test?scenario=short&messages=1&error=message-persist-failed&regenerate`

The `error` parameter affects both:
- `GET /api/v1/chats/test` for cache identity and chat title/id,
- `POST /api/v1/chats/test` for the actual simulated failure mode.

## Manual test cases

### 1. Pre-stream auth error

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=1&error=provider-auth&regenerate`

Steps:
1. Start the app with `pnpm run dev`.
2. Open the URL.
3. Wait for auto-regenerate to fire.

Expected:
- no assistant stream starts,
- a toast appears,
- the assistant bubble shows a friendly auth/config message,
- the bubble includes a request ID or provider request ID,
- clicking regenerate repeats the same error without leaving partial assistant content behind.

### 2. Pre-stream rate-limit error

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=1&error=provider-rate-limit&regenerate`

Expected:
- message explains rate limiting,
- retry guidance says to wait and retry,
- request ID metadata is visible when present.

### 3. Pre-stream quota error

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=1&error=provider-quota-exceeded&regenerate`

Expected:
- message explains quota exhaustion,
- fix guidance points to billing or a different key,
- no partial assistant response is left behind.

### 4. Mid-stream provider failure

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=1&error=provider-unavailable&regenerate`

Expected:
- one assistant message appears,
- the assistant message includes:
  - a synthetic source entry,
  - partial assistant text,
  - appended inline error text,
- regenerate removes that failed assistant message and retries cleanly,
- the next request does not include the failed partial assistant output in context.

### 5. Post-stream persistence failure

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=1&error=message-persist-failed&regenerate`

Expected:
- assistant output begins,
- the final inline error explains that persistence failed,
- request ID is visible for support/debugging,
- regenerate removes the failed assistant message and retries cleanly.

## Local verification commands

Run these before shipping changes to this flow:

```bash
pnpm run format
pnpm run typecheck
pnpm vitest run tests/integration/api/chats-test-endpoint.spec.ts tests/integration/api/chats-message-id-stream.spec.ts tests/unit/composables/chat.spec.ts
```
