# Session 401 recovery on `/chats/new`

Background and fix notes for issue
[#235](https://github.com/besidka/besidka/issues/235) — users intermittently
saw a `401 "You don't have access to this resource. Try to sign out and sign in
again."` on `/chats/new` while the UI still looked logged in, and the message
they had typed was erased.

## Symptom

A signed-in user opens `/chats/new` (UI shows the logged-in state), types a
message, and hits send. The message is cleared and a toast shows the 401. The
production logs for the failing requests are `anonymous: true` /
`auth.identified: false` — the server resolved **no session at all**:

```
GET  /api/v1/storage    -> 401 anonymous
PUT  /api/v1/chats/new  -> 401 anonymous
```

Signing out and back in fixes it temporarily; it recurs. It was reported by a
customer on an installed iOS PWA and never reproduced on desktop.

## Root cause

The 401 is a genuinely empty server session: API handlers call
`useUserSession()` (`server/utils/session.ts`) → Better Auth `getSession()`,
get `null`, and throw `useUnauthorizedError()`.

How `getSession` resolves (better-auth 1.6.11,
`node_modules/better-auth/dist/api/routes/session.mjs`):

1. It first reads the signed `__Secure-better-auth.session_token` cookie. If
   that cookie is missing/invalid it returns `null` immediately
   (`session.mjs:41-42`). The short-lived `session_data` cache cookie can never
   sustain — or alone defeat — a session; the token cookie is the gate.
2. With `session.cookieCache` enabled (5 min), a valid token + valid
   `session_data` cookie returns the cached session **without reading KV or
   DB** (`session.mjs:93-186`). Only the cache-miss path runs `updateSession`
   to extend the session (`session.mjs:235-237`).
3. On a cache miss, `findSession` reads Cloudflare KV first, then — because
   `session.storeSessionInDatabase` is on — falls back to a DB lookup by token
   (`internal-adapter.mjs:222-257`). It returns `null` only when the record is
   absent from **both** KV and DB.

So a 401 means: the token cookie was present but the session record was gone
from KV **and** DB (or the token cookie itself was gone). Meanwhile the client
keeps showing "logged in" because `loggedIn` is derived from in-memory
`useState('auth:session')` (`app/composables/auth.ts`), last populated from a
successful `get-session` (possibly the cookie cache), and is not re-validated
on PWA resume or before submit.

## Why the previous fix (#236) didn't resolve it

[#236](https://github.com/besidka/besidka/pull/236) added
`storeSessionInDatabase: true` so KV-only sessions gain a DB fallback. That is
correct, but:

- **It is forward-only.** The DB row is written only at session *creation*
  (`internal-adapter.mjs:164-185`); `updateSession` updates, it does not create
  a missing row. Sessions created before the #236 deploy stay KV-only forever,
  so a KV miss/eviction still yields `null` → 401. This is why the issue
  recurred after #236 shipped.
- **The client recovery was unreliable.** #236 added "on 401, refetch the
  session and redirect to `/signin` if gone." But `fetchSession()` could
  early-return on its in-flight re-entrancy guard, or observe a still-cached /
  transiently-flapping session as valid, so `session.value` stayed truthy and
  the redirect never fired — the user just saw a toast.
- **It never addressed the lost draft** (see below).

## Why it only affected the iOS PWA user

Not an iOS-specific cookie bug — WebKit's 7-day cap applies to script-writable
cookies, not the `HttpOnly` `Set-Cookie` session cookie, and there is no stale
service-worker shell here (`workbox.navigateFallback: null`). The difference is
behavioral:

| | Desktop reporter | iOS PWA customer |
|---|---|---|
| Reloads | Frequent full page loads → frequent `get-session` (cookie refresh) and fresh, DB-backed sessions | Installed PWA rarely hard-reloads; client-side navigation dominates; suspend/resume restores stale in-memory "logged-in" state |
| Net effect | Practically never sits on a dead-but-masked session | Rides one long-lived (often pre-#236) session for weeks and hits the worst path when it dies |

The PWA does not cause the bug; it maximizes exposure to it and amplifies the
symptom.

## The typed message was lost

Two independent losses:

1. **Optimistic clear.** `ChatInput.client.vue` clears the textarea
   synchronously right after emitting `submit`, before the async request
   resolves — so on any failed send the draft is gone before the failure is
   known.
2. **Consent-gated persistence.** `chat_input` is persisted through
   `usePreferenceStorage`, which writes real `localStorage` only when the
   cookie-consent `preferences` category is granted; otherwise it lives in an
   in-memory map that a redirect or relaunch destroys.

## The fix

Client resilience + diagnostics. The session config (including `cookieCache`,
kept to avoid regressing the auth-middleware change in `393015b`) is unchanged.

- **Durable draft backup** — `app/composables/chat-draft.ts`
  (`useChatDraftBackup`). The user's own unsent message is functional data, so
  it is written straight to `localStorage` (not gated by the `preferences`
  consent category) and registered under the `necessary` category in
  `nuxt.config.ts`. It stores `{ text, savedAt }` with a 24h TTL (`peek()`
  prunes expired/corrupt entries). `chats/new` `onSubmit` snapshots the draft
  **and the attached files**, restores both on failure (`ChatInput` clears
  text and files optimistically), backs up the draft only on failure, clears
  it on success, and restores it on mount (after a `/signin` redirect or a PWA
  relaunch). The backup is also cleared on `signOut` so it cannot leak to the
  next user on a shared device.
- **Reliable 401 recovery** — `fetchSession()` accepts
  `{ disableCookieCache: true }` and bypasses both the cookie cache and its
  in-flight guard (`app/composables/auth.ts`), so the recovery reflects real
  KV/DB state instead of a cached session. A transport/network error (offline,
  flaky cell, 5xx) is **not** treated as a dead session — the last-known
  session is preserved so a blip cannot force a logout; only an authoritative
  empty response clears it. A fetch-generation guard prevents a stale in-flight
  cached fetch from resurrecting a session the bypass call just found dead.
  `chats/new` `onSubmit` and `app.vue` `onException` use this before deciding
  whether to redirect to `/signin`. (The cache-bypass `get-session` response
  also expires the session cookies on a dead session, so the redirect does not
  bounce back through the auth middleware.)
- **Resume re-validation** — `app/plugins/session-revalidate.client.ts`
  re-validates (cache-bypass) on `visibilitychange`/`focus` and redirects a
  dead session to the configured guest route *before* the user types. A
  transient failure leaves the session intact (no redirect).
- **Diagnostic** — `useUserSession()` logs
  `sessionCheck.tokenCookiePresent` (a boolean, never the cookie value) when
  `getSession` returns `null`, so a 401 can be classified as a missing
  session-token cookie (client-side loss/expiry) vs a present cookie whose
  record is gone (e.g. a legacy KV-only session).

## Operational notes

- A user stuck on a legacy KV-only session is fixed permanently by one
  sign-out / sign-in (the new session gets a DB row).
- After deploy, query the `sessionCheck.tokenCookiePresent` field on 401 events
  to confirm which failure mode remains, if any.

## Tests

- `tests/unit/composables/auth.spec.ts` — `fetchSession` preserves the session
  on a transport error / thrown error, clears it on an authoritative empty
  response, passes `disableCookieCache` only on the bypass call, detects a dead
  session via bypass even when the cached path reports alive, de-dupes
  concurrent fetches, and blocks a stale in-flight fetch from overwriting a
  newer bypass result.
- `tests/unit/composables/chat-draft.spec.ts` — backup save/peek/clear,
  blank-only rejection, verbatim + cross-instance persistence, TTL expiry,
  corrupt/legacy-value discard, and graceful degradation when `localStorage`
  is missing or throws.
- `tests/unit/pages/chats-new.spec.ts` — on a failed send the draft and
  attached files are restored and the request still carries the files; on a
  dead-session 401 it redirects to `/signin`; on success the backup is cleared;
  a backed-up draft is restored on mount.
- `tests/unit/plugins/session-revalidate.client.spec.ts` — redirects only on an
  authoritative empty session, never on a transient failure, only on user-only
  routes, skips when logged out, and throttles repeated revalidations.
