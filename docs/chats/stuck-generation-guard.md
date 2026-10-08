# Stuck "generation pending" chat (dead invocation + generation guard)

Incident write-up and reference for a chat that showed an endless loader
after the Worker invocation serving it died. The guard mechanism itself is
documented in `docs/chats/error-handling.md` ("Generation-in-progress
guard"); this doc covers the incident, how it was reproduced, how to
investigate the next one, and what is still unresolved.

## Symptom

- The chat shows an endless loader on the assistant bubble plus a retry
  button.
- Restarting the app or PWA does not help; every open of the chat shows the
  same state.
- It resolves "by itself" after about 11 minutes (old code).

Reported 2026-10-07 on an iOS PWA (one user, chat on Gemini 3.6 Flash with web
search). Starting `wrangler tail` coincided with the recovery but was
unrelated: the guard TTL simply expired at that moment.

## Timeline (2026-10-07 UTC, original incident)

- 19:12:35 - send starts; the guard is set with a fixed 660s TTL.
- 19:12:53 - the client reports `Load failed`. The invocation died: no
  assistant row in D1, no `AI stream completed` event, no stream error, and
  the `finally { kv.delete }` never ran.
- 19:12:55 to 19:21:47 - about 45 client retries of the same user message id,
  each answered with `stage: generation-in-progress`.
- about 19:23:35 - the guard expired.
- 19:24:46 - the next retry generated and persisted the reply.

## Root cause

Two things combined.

1. On Cloudflare Workers a client disconnect mid-stream can cancel the
   invocation. The Workers limits docs say: "When the client disconnects or
   the response is complete, tasks associated with that request may be
   canceled." Nitro's `cloudflare_module` preset gives the handler no
   disconnect signal, and the generation is not under `waitUntil`.
2. The issue #275 generation-in-progress KV guard
   (`chat-generating:<chatId>:<userMessageId>`) used a fixed 660s TTL sized as
   the worst-case generation time. That conflated maximum duration with
   liveness, so a dead invocation held the chat for 11 minutes.

The client auto-resends the same user message id when the chat opens and
roughly every 5s afterwards (on desktop too, not only the iOS
`visibilitychange` recovery). Each resend that finds the flag receives a
transient `data-generation-pending` response, which renders as the loader.

## Why it was rare before

It needs both an invocation death and a same-id resend. Axiom history showed
only this one stuck occurrence. Earlier guard hits lasted 0-42s, which are
legitimate reconnects while the original invocation was still alive.

## Deterministic repro (2026-10-08)

1. Desktop Chrome, signed in.
2. Start a new chat on Gemini 3.5 Flash-Lite with web search enabled.
3. Send a prompt asking for a 3000-word comparison.
4. Close the tab about 15s into streaming.
5. Reopen the chat after 20-45s.

Expected: loader plus retry button.

Evidence that the invocation died:

- No `AI stream completed` event whose `_parentRequestId` equals the original
  POST's `requestId` (baseline: 74 such events in the prior 3 days).
- No assistant row for the user message in D1.

Notes:

- Planting a fake guard key in prod KV via wrangler was blocked by the agent
  safety classifier.
- Planting a key would not have tested the new code anyway: a foreign 660s key
  blocks on both versions.

### Results

| | Old code (prod, pre-merge) | New code (PR preview) | New code (prod, post-merge) |
| --- | --- | --- | --- |
| send to generation restarts | 11:01 | n/a (no Axiom on preview) | 2:02 |
| send to reply persisted | 11:41 | 3:03 | 2:43 |
| guard renewals logged | not tracked | n/a | 1 (40s retry generation) |

On the preview the persisted reply text differed from the abandoned stream, so
it was a new generation after the lease expired, not a late drain of the dead
one.

## Fix (PR #409, merged as ccb235bd)

- 120s lease plus a 30s timer heartbeat in
  `server/utils/ai/generation-guard.ts`.
- `stop()` waits up to 5s for an in-flight put before the `finally` delete.
- `attributes.generationGuard.heartbeats` is recorded on the AI wide event.
- Guard errors are logged under `attributes.generationGuard.{operation,error}`
  because `besidka-prod` is near Axiom's 256-field cap (see
  `docs/axiom-map-fields.md`).

Mechanism details live in `docs/chats/error-handling.md`; they are not
duplicated here.

Remaining user-visible effect: a dead invocation still shows the loader for
about 2-3 minutes (120s lease plus up to about 60s of KV edge read cache).
After that the chat recovers by itself and the next resend generates.

The user is billed for the dead partial generation plus the retry.

## How to investigate next time

Axiom (dataset `besidka-prod`; prod only, the preview has no Axiom dataset).
APL examples:

- Count same-chat POSTs by stage. Long `generation-in-progress` runs mean a
  stuck guard:

  ```txt
  ['besidka-prod']
  | where tostring(path) contains '<chatSlug>' and method == 'POST'
  | summarize count(), first=min(_time), last=max(_time) by stage
  ```

- Did the original request finish? A missing event means the invocation died:

  ```txt
  ['besidka-prod']
  | where message == 'AI stream completed'
    and _parentRequestId == '<requestId of original POST>'
  ```

- Is the heartbeat timer firing? Generations longer than 30s should have
  `heartbeats >= 1`; `0` on a long one means the timer is not firing:

  ```txt
  ['besidka-prod']
  | where message == 'AI stream completed'
  | project _time, heartbeats = attributes['generationGuard']['heartbeats']
  ```

- APL gotcha: `or` of different `_time` ranges is unsupported; use separate
  queries.

Other sources:

- D1: check whether an assistant row exists for the user message.
- `wrangler tail` is unreliable here: on prod it stalled after one event, and
  PR preview (version alias URL) traffic is not tailed. Use `--env
  production`, not `--production`.
- Cloudflare dashboard, Workers, Observability: filter by ray id and read
  `$workers.outcome` (`canceled` versus `ok`) to confirm cancellation. This
  was not retrieved for the original incident (ray `a46f37d63958c405`).
- Lease math if heartbeats look wrong: KV minimum `expirationTtl` is 60s, one
  write per second per key, and about 60s propagation.

## Can the invocation death itself be fixed? (options, not decided)

The current fix only bounds the damage. Researched 2026-10-08 against the
Cloudflare docs listed at the end.

### 1. `ctx.waitUntil()` plus `enable_request_signal`

Wrap generation and persistence in `ctx.waitUntil()`. `waitUntil` extends
execution only "up to 30 seconds after the response is sent or the client
disconnects" (a budget shared across all `waitUntil` calls; pending promises
are canceled after it). It therefore rescues only generations that would
finish within about 30s.

The `enable_request_signal` compatibility flag (opt-in, changelog 2025-05-22)
only exposes `request.signal` so cancellation can be detected; it does not
prevent it. There are reports of it not firing under some frameworks
(opennextjs-cloudflare #691), so verify under Nitro; earlier research also
noted workerd mid-stream signal bugs.

Effort is low and the result is a partial mitigation, not a fix. Wiring a
signal into the generation must not regress the #263 idempotent replay; the
AI SDK abort semantics and the reason `abortSignal` is not wired today are
documented in the chat route notes.

### 2. Decouple generation from the HTTP request (Queues or Workflows)

Run generation in a Cloudflare Queue consumer (15 min wall time per
invocation, 30s CPU by default and up to 5 min, CPU excludes I/O wait) or in a
Workflow (unlimited wall time per step; a step should be the whole generation
because step retries restart it). Persist chunks or the final message to
D1/KV; the client polls or resumes.

This mirrors the existing deep-research async job architecture
(`docs/deep-research.md`: job table, poll, cron sweep). Effort is moderate and
it is a full fix, but direct same-request streaming is lost unless a resume
channel is built.

### 3. Per-chat Durable Object

A Durable Object runs the generation with chunk buffering and a resumable
stream. This is the pattern Cloudflare's Agents SDK `AIChatAgent` uses: chunks
are buffered to SQLite, generation continues after the client disconnects, and
a reconnecting client receives the buffered chunks and then live ones;
`chatRecovery` handles eviction. Durable Object limits: no hard wall limit
while the caller is connected; alarms run up to 15 min; CPU 30s by default and
up to 5 min.

UNVERIFIED: whether a Durable Object request is canceled when the calling
Worker's client disconnects. The safest design is for the request to only
enqueue, with the Durable Object running the work from an alarm or detached
task.

Effort is highest; it is the most complete option with the best UX.

### Recommendation

If the 2-3 minute recovery window becomes a recurring complaint, prefer option
2 (it reuses the deep-research job pattern) over option 3. Option 1 alone is
not worth it except as a cheap add-on.

### Sources

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/context/
- https://developers.cloudflare.com/changelog/2025-05-22-handle-request-cancellation/
- https://developers.cloudflare.com/queues/platform/limits/
- https://developers.cloudflare.com/workflows/reference/limits/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- https://developers.cloudflare.com/agents/api-reference/chat-agents/

## Related

- Issue #275: guard origin, iOS wake/`visibilitychange` auto-recovery.
- Issue #263: idempotent replay.
- PR #409: lease and heartbeat fix.
- `docs/chats/error-handling.md`: guard mechanism.
- `docs/providers/general.md`: tool loop timeouts.
- `docs/axiom-map-fields.md`: `attributes` map-field convention.
