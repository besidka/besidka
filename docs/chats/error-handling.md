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
