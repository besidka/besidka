# Issue #263 — "The message could not be saved." (message-persist-failed)

## TL;DR

A re-sent message after a dropped stream collided with a `UNIQUE`
constraint. The first turn fully succeeded **server-side** (both the user
message and the AI reply were written to the DB), but the customer's iPhone
Safari never received the finished stream. When the client retried, it
re-sent the **same** user message id. The server's duplicate-detection guard
only looked at the *last* persisted message and required it to be a `user`
row — but after a completed turn the last row is the **assistant**, so the
guard was blind, the handler re-inserted the user message with an
already-used `public_id`, and `messages.public_id UNIQUE` threw
`message-persist-failed`.

This never reproduces on a stable desktop connection because the finished
stream arrives before any disconnect, so the client never retries and the
duplicate-insert path is never reached.

---

## Confirmed root cause

`server/api/v1/chats/[slug]/index.post.ts`

- Each turn writes **two** rows that share one `UNIQUE` column,
  `messages.public_id` (`server/db/schemas/chats.ts:58`):
  - the **user** row uses `publicId = newMessage.id` (the client-generated
    ULID, stable across retries),
  - the **assistant** row uses `publicId = ulid()` (a fresh server ULID).
- The guard `isDuplicateUserMessage` was anchored on
  `lastPersistedMessage?.role === 'user'`. After a completed turn the last
  persisted message is the assistant, so the guard short-circuits to `false`
  regardless of a matching id.
- With the guard `false`, the handler calls `insertMessageWithPublicId(...)`
  with the **existing** client `public_id` → SQLite `UNIQUE constraint
  failed: messages.public_id` → caught and re-thrown as
  `message-persist-failed`, `stage = persist-user-message`.

### Production timeline (from the issue logs, 2026-06-22)

| Time (UTC) | Event |
|---|---|
| 14:14:31 | `POST /chats/<slug>` → 200. **User row persisted** (`public_id = 01KVQT…3V`). |
| 14:14:43 | `AI stream completed`, `finishReason=stop`. **Assistant row persisted** server-side. |
| 14:15:00 | Client beacon → `client-transport`: *"The connection was interrupted before the response finished streaming."* The phone never got the reply. |
| 14:15:02 | Retry `POST` → **500 `message-persist-failed`** (`persist-user-message`), same `public_id`. |
| 14:15:06 | Retry again → **500**, same `public_id`. |
| 14:15:26 | User opens the chat → **sees the real AI reply** (proving both rows were persisted in the first turn). |

The two failed POSTs carry the **identical** `public_id`
(`01KVQTXGM8WP6ZHD443JT1973V`), proving the client re-sent a stable id rather
than generating a new one.

---

## Why previous fixes did not catch it

The duplicate-detection logic has been touched four times, and each fix
addressed an adjacent problem while leaving the guard's *single-last-row,
role==='user'* shape intact:

| PR | Commit | What it did | Why it missed #263 |
|---|---|---|---|
| #139 | `a3ab74a` | Introduced `isDuplicateUserMessage` to stop re-inserting the user message every turn. | Born as a single-last-row + `role==='user'` check; no id check at all yet. |
| #187 | `94da333` | Aligned SDK and DB message ids — the client ULID now lands in `public_id`. | This is what makes a re-sent id actually **collide**. Added id-equality to the guard, but kept it gated on the last row being a `user`. |
| #205 | `0a4bf26` | Added structured errors + the `persist-user-message` try/catch that emits the exact `message-persist-failed` signature. Its own review flagged a "publicId duplicate-submission race." | Made the failure **observable**, not **prevented**. |
| #207 | `36d26b1` | Reverted `insertMessageWithPublicId` to a single atomic insert (fixing an orphan-row risk from #205). | Hardened insert *atomicity*; the broken component was duplicate *detection*. |

**Structural defect, unchanged across all four:** the guard inspected only
the last persisted message and required it to be a `user` row. Once an
assistant row exists, it sits last and the guard can never fire for a re-sent
user id. Every existing duplicate test seeded only a trailing **user**
message, so CI stayed green through every fix.

---

## Why it happens for the customer but never on your machine

This is a **state-assumption bug exposed by a network race**, not a network
bug. There is a vulnerability window:

> **Window opens** the instant the assistant row is committed (~14:14:43)
> **and stays open** until the client either fully receives the stream or
> gives up. Any *disconnect → retry* inside that window triggers the
> duplicate-insert.

**The customer's setup lands inside the window; yours never does.**

- **Mobile Safari amplifiers** (all present in this report):
  1. **Long stream** — `msToFirstChunk` 6.7s, total ~11s. The connection has
     to stay open far longer than a quick reply.
  2. **"Make a new photo" flow** — taking a photo foregrounds the camera and
     backgrounds Safari; iOS aggressively suspends/throttles network for
     backgrounded tabs.
  3. **Cellular ⇄ Wi-Fi handoff** and a flaky last mile tear down the
     in-flight Cloudflare Workers stream.
  4. **Safari's aggressive idle-connection teardown** kills long-lived
     streaming responses.
  In every case the server has *already committed both rows* — the teardown
  only loses **delivery**, not **persistence**.
- **Desktop immunity:** a fast, stable wired/Wi-Fi connection receives the
  finished stream before any disconnect. `onFinish` has the assistant
  content, the client never retries, and the duplicate-insert branch is never
  reached. That is precisely the "works on my machine" asymmetry.

The retry itself is a **user-initiated Regenerate** (the AI SDK does **not**
auto-retry in this configuration). After a transport "Load failed" the
Regenerate button appears; `regenerate()` drops the trailing assistant error
stub and re-sends the surviving user message **with its original id**, so the
`public_id` collides.

---

## The fix

Server-only change in `server/api/v1/chats/[slug]/index.post.ts`. Three
parts, all preserving the intentional `message-persist-failed` behavior for
**genuine** DB failures and the #205/#207 atomic-insert fix:

1. **Deterministic order.** Add `orderBy(asc(messages.id))` to the messages
   relation so persistence order (the model context **and** the
   user/assistant adjacency) is explicit, not an implicit D1 rowid contract.

2. **Replay the stored reply (the core fix).** Before any model work, scan
   the persisted history for a user message whose `publicId === newMessage.id`
   and check whether the **next** persisted message is an assistant. If so,
   the turn already completed: **replay** the stored assistant back to the
   client as a UI-message stream (`buildPersistedAssistantReplayChunks`) and
   return. No model call, **no token recharge, no duplicate assistant row, no
   re-insert** — exactly the issue's acceptance criterion ("if the AI response
   was stored, display it without error"). This is unambiguous because the UI
   only re-sends a completed turn's user id on a disconnect retry; there is no
   per-message Regenerate that would legitimately want a fresh reply.

3. **Idempotent insert (belt-and-suspenders).** The user-message insert now
   uses `ON CONFLICT(public_id) DO NOTHING` (still a single atomic statement),
   so even a concurrent double-retry that slips past the in-memory scan turns
   a duplicate into a no-op instead of a 500. The assistant insert keeps
   strict behavior so real DB failures still surface loudly.

### Why it won't happen again

- The reported flow (disconnect after a fully-persisted turn → retry) now
  hits the **replay** path: no insert at all, so the `UNIQUE` collision is
  structurally impossible.
- Any *other* path that re-sends an existing `public_id` (degenerate
  histories, or a sub-second concurrent double-retry that slips past the
  in-memory scan) is absorbed by `ON CONFLICT DO NOTHING`.
- Together: a duplicate `public_id` can **no longer** produce
  `message-persist-failed`. (One honest residual: in the rare sub-second
  concurrent-retry window the losing request still streams its own reply, so
  it can leave a second assistant row — no error, no data loss. Fully
  serializing that would need a lock/transaction, not worth it for D1 at this
  probability.)

### Tests added (`tests/integration/api/chats-duplicate-message.spec.ts`)

- Disconnect retry after a fully-persisted turn → **no insert, no model call,
  replays the stored assistant** (start/text-delta/finish with the stored
  text and the assistant's `public_id`).
- Multi-turn chat → replays the assistant **adjacent** to the matched user
  message, not a later turn.
- Reasoning gating → reasoning parts are not replayed when `reasoning='off'`.
- The three pre-existing duplicate tests remain green (the trailing-user
  re-stamp path is untouched).
