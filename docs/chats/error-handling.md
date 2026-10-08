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
about 20s in), the invocation died mid-generation (most likely canceled after
the client disconnected; the Workers Logs outcome was not retrieved at the
time). Neither the persist step nor the `finally { kv.delete }` runs. The flag was originally written with
a fixed 660s TTL sized as the worst-case generation time, so it outlived the
dead invocation by about 11 minutes: every client retry (roughly every 4s) got
`generation-pending`, showing an endless loader and a retry button until the
key expired. A fixed TTL conflated "maximum generation duration" with
"liveness".

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
