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

The client auto-resends the same user message id when the chat opens and then
again a fixed 4s after each pending response (`GENERATION_RETRY_DELAY_MS` in
`app/composables/chat.ts`, no backoff), which is about every 5s with the
round trip. This happens on desktop too, not only in the iOS
`visibilitychange` recovery. Each resend that finds the flag receives a
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

## Client stall watchdog (2026-11-20)

A reply could also stall with the connection still open: the owner saw a
DeepSeek V4 Pro send with connector calls keep its step spinner and the
stop button for minutes while nothing arrived. The server sends nothing
while a tool runs or while the provider queues, so the client could not
tell a slow tool from a dead stream.

- The client relies on a transient `data-heartbeat` part that the send
  route writes every 15 seconds from the start of the send to its end,
  also on approval and round continuations. That server half is on the
  connector-approvals branch of the 2026-11-20 fixes
  (`shared/utils/chat-stream-heartbeat.ts`), not on the reasoning-steps
  branch alone: without it the watchdog never fires.
- `useChat` (`app/composables/chat.ts`) records the time of every published
  update and every data part. While the status is `submitted` or
  `streaming` it checks every 5 seconds; once a heartbeat arrived in that
  request, 45 seconds without anything aborts the stream and settles it
  like a dropped connection (`isStreamStallAbort` in `onFinish`), not like
  a user Stop: the transport-interruption recovery regenerates the reply
  (the generation guard answers `data-generation-pending` while the old
  invocation still runs, and the client polls), or, for a request that
  answered approvals, resends the same answers. A warning toast says "The
  reply stopped arriving. Reconnecting to it. This can take a couple of
  minutes." A user Stop is never resumed.
- A stream without any heartbeat is never ended by the client. The flag
  resets when a new request starts (`submitted`). The check waits while the
  page is hidden and starts a fresh 45 seconds when it becomes visible,
  because iOS pauses both the page and its connection in the background,
  and it also starts a fresh 45 seconds after a check that ran late (more
  than 10 seconds after the previous one: the device slept or timers were
  frozen), because the connection may still deliver.
- Server-side timeouts (`provider-queued`, `provider-stalled`,
  `generation-time-limit`) end with a normal error chunk and the error
  card; the watchdog covers the case where even that never arrives.
- Tests: `tests/unit/composables/chat.stream-stall.spec.ts`.

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

## Provider stalls that look stuck (2026-11-20)

A send can also hang with the Worker alive: the provider accepts the
request and sends nothing. DeepSeek V4 Pro does this while a request waits
in its queue (SSE `: keep-alive` comments only, closed after 10 minutes).
The generation guard keeps heartbeating, so client retries answer
`generation-in-progress`, and before 2026-11-20 the send ended only at the
540 s tool-loop limit, with a silent `abort` that stored nothing.

- **Signature in Axiom.** A send `POST` with `modelId` `deepseek-v4-pro`,
  no `AI stream completed` child, and client retries answered
  `stage: generation-in-progress` for longer than a normal reply takes.
- **Now.** Direct DeepSeek streams time out after 120 s without a first
  chunk (`provider-queued`) or 90 s between chunks (`provider-stalled`),
  every server-side timeout becomes a visible `error` chunk (the 540 s
  total limit is `generation-time-limit`), and the partial
  reply is stored (`server/utils/ai/stream-stall.ts`; events carry
  `stage: 'stream-timeout'`). The route also writes a transient
  `data-heartbeat` chunk every 15 s while the send runs, so the client can
  tell a slow tool step from a dead stream. A connector call stuck before
  its remote request settles when the tool signal aborts
  (`docs/connectors.md` section 6.6).
- **Still open.** A client disconnect still cancels the invocation; that is
  the subject of the options above.

## Stop and retry (2026-11-20)

**Report.** After Stop, Retry only made the send icon flip back and forth;
no reply came and the owner branched the chat (chat
`01M7XAWDPVDVZ7DTYBZ7Z9AJBE`, iPhone PWA, `deepseek-flash`, web search).
Axiom `besidka-prod`: the send `POST` at 20:38:07 (request
`a5da419ffe1534f7`, status 200 after 1.67 s, which is when the stream
headers went out) has no `AI stream completed` child and no error; seven
retries from 20:38:41 to 20:39:07, about every 4.3 s, all answered
`stage: generation-in-progress`.

**Root cause.** Stop only aborted the client's fetch; no request told the
server. The disconnect canceled the invocation (the dead-invocation case
above), so the lease stayed until 120 s after its last renewal. Retry resent
the same user message id, found the lease, got `data-generation-pending`,
and the client resent it every 4 s; each resend went `submitted` then
`ready`, which flipped the Stop and Send icons.

**Why nothing was logged.** The request's own wide event is emitted when the
handler returns the streaming `Response`, so it only says "200" and carries
no stage. Everything about the reply lives on the separate `AI stream
completed` event, which the route emits after the persistence stream is
fully read and ships through `waitUntil`. When the Worker cancels the
invocation after the disconnect, that code never runs, and there is nothing
in between.

### The design

1. **Runs and leases.** Each send or continuation is a run with a random
   id. The lease `chat-generating:<chatId>:<messageId>` holds
   `{ runId, renewedAt }` (TTL 120 s). The run checks every 10 s and renews
   when 30 s have passed, so an honest holder renews at least every 40 s.
2. **Stop reaches the server.** The client's Stop calls
   `POST /api/v1/chats/[slug]/stop` with the lease's message id (the user
   message of a send, the assistant message of an approval or round
   continuation), with `keepalive`. The route
   (`server/api/v1/chats/[slug]/stop.post.ts`: cross-site guard, session,
   owner's chat or 404, 30 stops a minute per user, strict body; the path
   has no WAF-blocked word) writes `chat-generation-stop:<runId>` (5
   minutes), deletes the lease, even when its own read saw none, and
   answers `{ stopped, runId }`. Its own wide event (`generationStop`) is
   the line a user Stop always leaves.
3. **The run ends cleanly.** On its next check the run sees the marker, or
   sees its own lease gone after it had seen it once, aborts `streamText`
   with `stopped-by-user` (the `abort` chunk is kept, no error card) and
   stores what it streamed as a stopped reply: unfinished tool calls are
   dropped and `data-reply-stopped` is the last part. A stopped reply sends
   no "reply ready" push.
4. **Retry takes over.** A send for the same message waits only for a live
   run. It takes over a stopped run (marker present, or the run id the
   client got from the stop route and sends back as `stoppedRunId`) or a
   run whose last renewal is older than 90 s (`GENERATION_LEASE_STALE_MS`:
   30 s renewal + 10 s check + 30 s read cache + 20 s slack), and logs
   `attributes.generationGuard.takeover`. A second tab whose run renews on
   time still gets the pending answer, and a `stoppedRunId` that names
   another run changes nothing.
5. **One reply per message.** The replay short-circuit (#263) skips stopped
   replies and the model history of the retry leaves them out. Right before
   any send stores its reply, it reads D1 (consistent, unlike KV) for the
   messages after its user message (`readTurnBeforeReply` in the route,
   `server/utils/chats/stopped-replies.ts`): a stopped reply is not stored
   once anything follows the user message; any other reply is not stored
   once the turn already has an answered reply (a run that KV still showed
   as current); otherwise the turn's stopped replies are deleted with the
   regular message delete only after the new reply's insert succeeded, so
   a failed insert never leaves the message with no reply at all. Before that, a
   run whose lease now names another run stores nothing (`confirmState`
   reads the lease once more right before storing). The D1 read and the
   insert are not one transaction; two inserts inside that gap of a few
   milliseconds remain possible.
   Continuations write their lease only after they won their claim, so a
   duplicate that loses the claim never leaves its run id in the lease.
   **Two retries of one stopped run** (two tabs, a double click) both see
   it stopped. A run that took over writes its lease at the start of the
   stream, waits 300 ms (`GENERATION_TAKEOVER_SETTLE_MS`) and reads it back
   (`confirmLeaseHolder`): the run whose write landed last goes on, the
   other answers `data-generation-pending` before any provider call. If
   both read the other's write through a cache, both give way and the
   client's resend 4 s later goes through. The lease is written there, not
   right after the request's first lease read: an earlier lease would
   outlive any setup error before the stream (a missing key, a bad file)
   and block every retry for the stale window, because those paths have no
   cleanup. The setup itself (file checks, key decryption, tool loading)
   runs twice in that race; only the provider call is guarded.
   The client sends `stoppedRunId` once, with the first retry after the
   stop, so a stale id cannot take over a later run.
6. **One steady state.** While a resend keeps getting
   `data-generation-pending`, the Stop button stays (no flip on each 4 s
   retry) and the loader says "Waiting for the previous reply to stop… Ns"
   with Cancel (`Chat/Loader.client.vue`, `waitingForPreviousReplySince` in
   `useChat`). Cancel ends the wait only and never calls the stop route, so
   a reply another tab is writing keeps running; Stop is the button that
   ends it. Retry and a new message wait at most 2 s for a pending stop
   request, so the retry can carry `stoppedRunId`.
7. **A line when the client leaves.** The response stream is wrapped
   (`withClientDisconnect` in `server/utils/chats/stream-disconnect.ts`);
   when the client stops reading it, the route ships an `AI stream client
   disconnected` wide event (`stage: client-disconnected`, status 499,
   `_parentRequestId`, `attributes.generationGuard.runId`) through
   `waitUntil`.

### KV caching: what can go wrong and what the design does

Sources:

- <https://developers.cloudflare.com/kv/concepts/how-kv-works/>: KV is
  eventually consistent. Changes are "usually immediately visible" in the
  location where they are made, "however, this is not guaranteed". Other
  locations may take "up to 60 seconds or more", longer where a previous
  version was read recently. Negative lookups are cached too.
- <https://developers.cloudflare.com/kv/api/read-key-value-pairs/>:
  `cacheTtl` defaults to 60 and its minimum is 30 seconds; existing and
  missing keys are both cached at the edge; "Once a key has been read with
  a given `cacheTtl` in a region, it will remain cached in that region until
  the end of the `cacheTtl` or eviction"; a write revalidates KV's regional
  and central caches with the new value.

Every read in `generation-lease.ts` passes `cacheTtl: 30`.

| Question | Answer | What the design does |
| --- | --- | --- |
| Can the retry, after the stop route deleted the lease, still read the old lease? | Yes. In the same location it is usually gone at once; not guaranteed, and in another location up to the cache lifetime (30 s with our reads, 60 s or more when another reader used the default). | The client sends the stopped run id back as `stoppedRunId`; a lease that names it counts as stopped without any fresh read. Without it the retry would also have to read the marker, whose "missing" answer the old run's own polling keeps cached. A cached old lease is only ever older, so a dead run still turns stale on time. |
| Can a still-running invocation keep reading a cached "no marker" and miss the stop? | Yes, for up to one cache lifetime, because it polls its marker every 10 s and so keeps a negative entry cached in its location. | Two independent signals: the marker and its own lease disappearing (the stop route deletes it even when its read saw nothing). Both are bounded by one cache lifetime. If the run still renews once in that window, it rewrites its old lease over a retry's: the retry knows the run it took over (`supersededRunId`) and writes its own lease back instead of ending, and the old run ends as `taken-over` on its next fresh read. |
| Can a second tab judge a live run stale from a cached `renewedAt`? | Yes, the cached value can be up to 30 s older than the real one. | The stale threshold (90 s) is above the longest honest age (40 s between renewals + 30 s cache). |
| Can two replies be stored for one message? | Through KV alone, yes: a stopped run can read its own cached lease and no marker for up to 40 s and finish as `current`. | Not left to KV: right before the insert every send reads D1; the first answered reply of a turn wins, a stopped reply never lands after anything, and stopped replies are deleted by the reply that replaces them. Which reply wins in that race is the first one stored, not always the one on screen. |
| Does the Worker abort path help? | A client disconnect may cancel the invocation; then nothing is stored and the lease expires. | The stop route frees the lease at once anyway, so Retry does not depend on the old invocation being alive. |

What is tested and what is reasoned: the unit tests use a fake KV, plus one
fake that serves cached reads with the requested `cacheTtl` and never
invalidates on write (the worst case the docs allow). They show that a
retry without `stoppedRunId` would still see a live run, that the old run
stops within one cache lifetime, and that its late renewal does not end the
retry. Cross-location propagation, the real cache lifetime in production and
how often the "usually immediate" same-location visibility fails are
reasoned from the documentation only.

### Limits

- Workers may still cancel an invocation right after the client
  disconnects. Then the stopped reply is not stored (the user keeps what
  their screen showed until they reload) and only the disconnect line and
  the stop route's line are logged.
- Whether workerd calls `cancel()` on the response stream when the client
  goes away is not verified on Workers; the unit test proves the cancel
  passes through the same pipes the response uses, in Node.
- A run that is a continuation (approval or round) stores nothing when it
  is stopped, as before: its stored message stays as it was. Its takeover
  has no `supersededRunId` protection against the old run's late renewal.
  Its tool-approval claims that recorded no result get their lease ended at
  once (`expireUnfinishedClaims`), so a retry of the same answers says
  "Interrupted. Ask again" right away instead of "still working" for up to
  two minutes; the pending approval records were deleted when the answers
  were claimed, so the calls cannot be released for a fresh run. Claims
  whose call finished replay as before.
- A stop in the first 10 s of a run can be missed when the stop route's own
  lease read comes from a stale cache (no marker is written; the lease is
  still deleted). The run has not seen its lease yet, so the missing lease
  does not count as a stop, and it writes the lease back at its first
  renewal; the retry then waits for it like a live run, and the user can
  press Stop again. Treating a missing lease as a stop before the run saw
  its own lease would stop healthy runs whose first read is a cached miss,
  so this is left as is.
- Public shares drop the `data-reply-stopped` marker; branch copies keep
  it, so a retry in the branch replaces the copied partial; the MCP
  `get_chat` transcript reads text parts only.
- A second tab watching the same reply gets the `abort` and shows the
  partial reply without the stopped marker until it reloads.
- A missing lease ends a run as stopped only while its own renewals are
  recent; after two minutes of failed KV writes the lease may expire and
  the run keeps going.
- Not verified on a real iPhone PWA.

## Disconnect, retry storm and stale chunks (2026-11-21)

**Report.** Chat `01M7YRJC119HE955SE4KQ7M72X`, Gemini 3.8 Flash, version
`4d48892a` (deployed about 10:50 UTC while the page still ran the previous
build). The 10:52 send was not hung: its reasoning steps ran for over 200 s
and it ended at 10:56:16 as `AI stream client disconnected` (499). Retries
after that still got `generation-in-progress`. At 10:56:10 the page sent 151
`POST /api/v1/chats/client-errors` ("Load failed") in five seconds, and
Cloudflare answered with 1015 rate-limit bans. The chat then showed the raw
HTML of the 1015 page as the error, a right-click showed "Importing a module
script failed.", and Stop and Retry were visible at the same time.

**Not a server hang.** `tests/integration/api/chats-stream-lifecycle.spec.ts`
runs the real `@ai-sdk/google` stream against a fetch that returns Google's
429 spend-cap body: the route stream finishes, `AI stream completed` is
emitted with `errorCode: provider-quota-exceeded`, and the lease is deleted.

**Root causes and fixes.**

1. *A disconnected run kept its lease.* Workers cancel the invocation after
   a client disconnect, so the run's `finally` never deleted the lease and a
   retry waited until it went stale (up to 90 s plus the 30 s read cache).
   The disconnect hook now ends the run (`endDisconnectedRun` in
   `generation-lease.ts`): it marks the run stopped in-process
   (`GenerationRun.markStopped`, so the reply is stored as stopped even when
   cached KV reads still show the lease and no marker), remembers the run as
   ended in this isolate (a retry served by the same isolate takes over at
   once), writes the run's stop marker and deletes the lease while it still
   names this run, inside the same `waitUntil` as the disconnect event, which
   records `generationGuard.leaseReleased`. A retry in another isolate whose
   read comes from a cache that has not seen the writes waits at most one
   cache lifetime (30 s) instead of the 90 s stale window.
   The run is also registered with `waitUntil` from its start, so after a
   disconnect the invocation gets the documented extra time (up to 30 s
   after the client goes away) to store the partial reply. Cloudflare does
   not guarantee that time ("may be canceled"), so a stopped reply after a
   disconnect is likely, not certain. A disconnect now means stop: the
   partial reply is stored as stopped and no "response is ready" push is
   sent; before, a surviving run kept generating for nobody. Continuations
   (approval answers, tool rounds) keep the earlier behavior on a disconnect
   (no stop, the lease turns stale), because a stopped continuation stores
   nothing and could lose a side-effecting tool result; an explicit Stop
   still ends them.
1a. *Leaving the chat inside the app.* The request kept streaming in the
   background while the user was on another page, and the next visit
   dropped it, so the run died and nothing was stored (chat
   `01M7YWDH2JERM3QHF6MZ882RHG`, 13:01 to 13:04 UTC). `useChat` now calls the
   stop route on unmount while a reply streams (`stopGenerationOnLeave`) and
   ends the local request; a wait for another run only ends the local
   polling. The waiting loader also hides while an assistant bubble with
   content ends the chat (`shouldShowWaitingLoader`), so two assistant
   bubbles never show at once.
2. *Transport errors retried in a tight loop.* Every "Load failed" called
   `recoverFromTransportInterruption`, which resent at once, up to the
   attempt cap (150, hence 151 reports). Only the first attempt of a
   recovery is immediate now; later ones, and the "still generating" polls,
   back off 4 s, 8 s, then 15 s (`getGenerationRetryDelayMs`), with 42
   attempts for about 10 minutes.
3. *The error reporter had no limit.* Each report carried a fresh random
   request id, so the id dedupe never matched. Reports are now deduped by
   code and text and capped at 3 a minute and 10 a page session, and a
   report about the reporter's own request is never sent.
4. *Non-JSON error bodies became message text.* The chat transport turns a
   failed non-JSON response into the app's JSON error ("Too many requests.
   Wait a moment and try again." for 429 or a 1015 page, short copy
   otherwise), and `normalizeChatClientError` never returns markup
   (`app/utils/chat-request-errors.ts`).
5. *Stop and Retry together.* Retry is hidden whenever Stop shows
   (`displayRegenerate` in `useChat` and `canShowRegenerate` in
   `ChatInput.client.vue`).
6. *Stale chunks after a deploy.* `app/plugins/02.chunk-error.client.ts`
   handles `app:chunkError` (Nuxt forwards `vite:preloadError`, which also
   covers lazy components) and the error boundary in `app.vue` hands chunk
   errors to it instead of showing a toast. It reloads once through
   `reloadNuxtApp` with a 60 s `ttl`, waits while `chat-streaming` is true
   so a reply is never cut off, and when the page already reloaded for the
   same path in that window it asks the user to reload instead of looping.
   The guard reads Nuxt's own `nuxt:reload` record, so it adds no storage
   key and needs no Cookie Policy change.

## Stopped replies labeled as empty answers (2026-11-21)

**Report.** On version `201f0b55`, chat `01M7YWDH2JERM3QHF6MZ882RHG`
(iPhone PWA, `deepseek-flash`): leaving the chat mid-answer stored the
partial reasoning with the error "The model finished searching but didn't
write an answer". Axiom 17:17:31 UTC: the stop route (from
`stopGenerationOnLeave`), `AI stream client disconnected`
(`leaseReleased: false`, because the stop route had already deleted the
lease) and `AI stream completed` with `toolLoop.steps: 3` and
`errorCode: assistant-empty-answer`.

**Cause.** The persistence path knew the run was stopped
(`storesStoppedReply`), but its follow-up-tool check
(`ranFollowUpToolWithoutAnswer`) did not look at that, so a stopped run with
tool steps and no text got the empty-answer notice, an `error` chunk and the
error telemetry.

**Fix.** A stopped run never takes the empty-answer path: it is stored with
`data-reply-stopped` only, and the AI wide event carries
`stage: 'stopped'` and `attributes.assistantPersist.stopped` instead of an
error code. The search-answer continuation asks the run state first
(`isRunStopped`: the in-process abort, then `confirmState`, which reads the
stop marker), so no forced continuation runs after a stop. A stopped reply
without answer text ends with a neutral "Stopped." line
(`Chat/ReplyStopped.vue`); one with text stays as it was.

## Related

- Issue #275: guard origin, iOS wake/`visibilitychange` auto-recovery.
- Issue #263: idempotent replay.
- PR #409: lease and heartbeat fix.
- `docs/chats/error-handling.md`: guard mechanism.
- `docs/providers/general.md`: tool loop timeouts.
- `docs/axiom-map-fields.md`: `attributes` map-field convention.
