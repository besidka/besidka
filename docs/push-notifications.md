# Push notifications

Web Push keeps users informed when they are not looking at the app: a
"response ready" notification after every completed generation, and a
"shared chat ready" handoff that opens a shared link inside the installed
PWA (see [chats/shared-pwa-handoff.md](chats/shared-pwa-handoff.md)).

## Architecture at a glance

| Layer | Where | Role |
|---|---|---|
| Protocol | `server/utils/push-protocol.ts` | RFC 8291 aes128gcm encryption + RFC 8292 VAPID JWT, pure WebCrypto, zero deps |
| Send loop | `server/utils/push.ts` | Per-subscription send with outcome counts + failure details, stale-row pruning |
| Triggers | `server/api/v1/chats/[slug]/index.post.ts`, `server/api/v1/chats/shares/[slug]/{branch,handoff}.post.ts` | Generation-finished push (fire-and-forget), branch push, awaited handoff |
| Subscription API | `server/api/v1/push/{subscribe,unsubscribe}.post.ts`, `status.get.ts` | Upload/remove/report subscriptions per user |
| Client | `app/composables/push-notifications.ts`, `notification-prompt.ts` | Subscribe, permission banner, reconcile, key-rotation healing |
| Service worker | `app/service-worker/push.ts` (bundled into `app/service-worker/sw.ts` via `injectManifest`) | Always show notifications (WebKit silent-push rule), tap navigation |
| Tap navigation | `app/plugins/push-navigation.client.ts` | Navigates on SW postMessage; IndexedDB fallback for cold starts |
| Storage | `push_subscriptions` (D1) | One row per browser/install per user; endpoint is a capability URL |

## Why the protocol is implemented in-house

Every Web Push library evaluated failed one half of the protocol on
Cloudflare Workers (postmortem, 2026-07-06):

- `web-push` signs its VAPID JWT through jws/asn1.js, which throws
  `hasOwnProperty is not a function` in the bundled workerd runtime — every
  send died before any network call, invisibly while sends were
  fire-and-forget. Upstream Workers support is still unendorsed
  (web-push-libs/web-push#718).
- `@block65/webcrypto-web-push` and `@pushforge/builder` emit only the
  legacy pre-RFC `aesgcm` coding (source-verified), which Apple's
  `web.push.apple.com` (RFC 8291-only) rejects.
- `web-push-browser` writes the RFC 8188 record-size field little-endian.

`push-protocol.ts` implements both halves on WebCrypto — workerd's native
API. WebCrypto's ECDSA signature is the raw `r||s` JWS ES256 needs, so no
ASN.1/DER is involved at all. The encryption is pinned byte-for-byte to the
official RFC 8291 Appendix A test vector in
`tests/unit/utils/push-encryption.spec.ts`; never trust a library's claimed
encoding without reproducing an official vector against the real code path
(mocked-library unit tests hid the asn1 failure for days).

## VAPID keys

- Formats: `NUXT_PUBLIC_VAPID_PUBLIC_KEY` is base64url of the raw 65-byte
  uncompressed P-256 point; `NUXT_VAPID_PRIVATE_KEY` is base64url of the raw
  32-byte scalar (the JWK `d`).
- Generate a matching pair with `node scripts/generate-vapid-keys.mjs`. The
  public key lives in `wrangler.jsonc` `vars` (committed — CI deploys read
  the committed file), the private key is a Worker secret
  (`pnpm exec wrangler secret put NUXT_VAPID_PRIVATE_KEY`) and `.dev.vars`
  locally. Always ship both halves in the same release: `wrangler secret
  put` applies to the live worker immediately, while a local-only
  wrangler.jsonc edit does nothing until committed and deployed — a split
  brain fails every send with "Invalid EC key in JSON Web Key" (workerd
  validates the pair on JWK import; `push-protocol.ts` rewraps that into an
  actionable message).
- Rotation invalidates every existing subscription (each is bound to the
  `applicationServerKey` it was created with). The client self-heals:
  `refreshState()`/`subscribe()` detect a stale-key subscription,
  unsubscribe it, and re-subscribe under the current key — no user action
  needed where permission is already granted.

## Subscription lifecycle

Two independent states that are easy to conflate:

- `notificationPromptState` (user setting, **account-level**): `null` never
  asked, `true` enabled, `false` declined.
- Browser notification permission + PushManager subscription
  (**per-install, per-origin**): every browser profile, home-screen install,
  and PR-preview subdomain starts at `default` with no subscription.

`useNotificationPrompt` reconciles them on chat pages
(`maybeShowProactively`, called from the chat layout):

- state `null` and permission `default` → show the enable banner.
- state `true` and permission `default` → re-show the banner (fresh
  install/origin; without this a user who opted in elsewhere could never
  subscribe the new install).
- state `true` and permission `granted` with no live subscription →
  subscribe **silently**, once per session (`pushManager.subscribe()` needs
  no gesture once permission is granted). This closes the dead end where
  permission was granted through browser site settings or a PWA install
  prompt — paths that never run `subscribe()`.
- Enabling uploads the subscription via `POST /api/v1/push/subscribe`;
  `GET /api/v1/push/status` reports whether the account has any rows (used
  to gate the shared page's "Open in the app" button).
- `subscribe` and `unsubscribe` reject `sec-fetch-site: cross-site` with 403
  before the session lookup, using the same `assertNotCrossSiteRequest()`
  guard as handoff (`server/utils/cross-site-guard.ts`). A missing header
  (older Safari) passes.

### Server-side pruning

Status-based pruning alone cannot keep `push_subscriptions` clean. A 404/410
from the push service deletes the row (`sendToSubscription` in
`server/utils/push.ts`), but WebKit revokes subscriptions on-device (silent
pushes, PWA reinstall, cleared site data) while `web.push.apple.com` keeps
answering 2xx for those endpoints — production logs showed 257/257 accepted
sends while known-revoked rows existed. Liveness therefore comes from two
extra mechanisms:

1. **`previousEndpoint` on resubscribe (instant cleanup).** The client keeps
   the last successfully uploaded endpoint in `localStorage`
   (`besidka:push-endpoint`, every access wrapped in try/catch) and sends it
   as `previousEndpoint` in each `POST /api/v1/push/subscribe` — from
   `subscribe()`, from `refreshState()`'s normal re-POST, and from its
   stale-key heal path — when it differs from the endpoint being uploaded.
   The server deletes the row `WHERE endpoint = previousEndpoint AND user_id =
   <session user>` in addition to the upsert, so another user's row is never
   touched. `unsubscribe()` clears the stored value.
2. **`last_seen_at` + TTL sweep (backstop).** `push_subscriptions.last_seen_at`
   (nullable, no SQL default — set in application code to avoid a table
   rebuild) is refreshed by every `subscribe.post.ts` call, which includes
   the re-POST that runs on each authenticated page load. The Nitro plugin
   `server/plugins/push-subscription-sweep.ts` runs on the existing hourly
   cron (`0 * * * *`) and deletes rows with `last_seen_at` older than
   `PUSH_SUBSCRIPTION_TTL_DAYS` (60), plus rows with `last_seen_at IS NULL`
   and `created_at` older than the cutoff, in a single `DELETE`. The
   migration backfills existing rows with the current time so they get a full
   grace window.

A device not opened for 60 days loses its row and silently resubscribes on
its next open (the chat layout's reconcile, see above).

The sweep logs only under the `attributes` map field
(`attributes.pushSweep.{cron,scheduledTime,cutoff,deleted,error}`) and the
subscribe endpoint under `attributes.push.previousEndpointRemoved`, so no new
top-level paths count against the Axiom 256-field cap
(see `docs/axiom-map-fields.md`). Endpoints and keys are never logged.

### Settings-menu toggle

A bell button in the user settings dropdown (`Sidebar/PushToggle.client.vue`,
after the API keys button) gives a second, manual entry point alongside the
banner. It reflects only this device's live `permission`/subscription state,
never `notificationPromptState` alone — an account that enabled push on one
device but never subscribed this browser must not show as "on" here. Clicking
it:

- silently (re)subscribes when permission is already `granted` (no dialog),
- opens the disclosed banner when permission is `default` (never calls
  `Notification.requestPermission()` directly — the same compliance
  requirement as above),
- disables the button when permission is `denied` — the browser will never
  re-show the dialog once blocked, so there is nothing left to do here.

This is also the only way back in for an account stuck at
`notificationPromptState === false` on a fresh origin: the proactive banner
above deliberately never re-shows for a declined state until a notification
is missed first.

## Sending

- **Generation finished** (`chats/[slug]/index.post.ts`): always sends when
  a subscription exists, via `waitUntil` (fire-and-forget). There is no
  reliable "is the client still watching" signal server-side (iOS
  suspension), so every push is delivered and the service worker always
  displays it — see the silent-push rule below. Payloads are always generic
  strings: they transit Google/Mozilla/Apple infrastructure and can render
  on a lock screen, so never include generated content, titles, or prompts.
- **Shared-chat handoff** (`chats/shares/[slug]/handoff.post.ts`): awaited,
  not fire-and-forget — the response reports the real outcome (`sent: true`
  only when a push service accepted; otherwise `reason:
  'not-configured' | 'no-subscriptions' | 'delivery-failed'` plus per-host
  failure details). Guarded by a `sec-fetch-site` cross-site check and a
  10-second per-user cooldown (KV timestamp compare — KV's minimum TTL is
  60s, so the TTL alone can't express it).
- Sends are sequential per subscription (Workers' 6-connection cap), and
  outcome counts + failure details (host/status/reason only — never
  endpoints or keys, both are capability secrets) go into the evlog wide
  event.
- **Origin scoping**: `sendPushNotificationToUser` takes an optional
  `targetOrigin` and filters delivery to subscriptions whose stored `origin`
  matches, falling back to the full subscription set when nothing matches
  (legacy rows with no origin, or a caller that omits it) — so this can never
  silently drop a notification. The `chats/[slug]/index.post.ts` call site
  passes `getRequestURL(event).origin` (same derivation as
  `push/subscribe.post.ts`) specifically to avoid duplicate notifications
  when one account has subscriptions from multiple PR-preview subdomains,
  since all previews share one D1 database.

## Service worker behavior (`app/service-worker/`)

The service worker is push-only: `app/service-worker/sw.ts` is the entry
point, built via `@vite-pwa/nuxt`'s `injectManifest` strategy
(`nuxt.config.ts` `pwa`) with `injectionPoint: ''` — this tells
`vite-plugin-pwa` to skip workbox-build's manifest-injection step entirely,
so nothing from Workbox (precaching, a `fetch` listener, `self.__WB_MANIFEST`)
ends up in the built worker. The push/notification handlers themselves live
in `app/service-worker/push.ts` and are imported by the entry with a plain
relative `./push` import — see
[pwa-safari-dock-app-launch.md](pwa-safari-dock-app-launch.md) for
why the SW was stripped down to push-only (a WebKit bug where the first
document load in a fresh Web App process silently ignores CSS/JS the SW
served from its cache).

- The SW source lives under `app/service-worker/` rather than `app/utils/`
  so Nuxt's `app/utils` auto-import scan never picks up `handlePush`/
  `handleNotificationClick` as client auto-imports — they only make sense
  bundled into the worker.
- The build embeds the current `buildId` into the worker as
  `__SW_BUILD_ID__` (a Vite `define`, set by a small plugin in
  `nuxt.config.ts`'s `pwa.injectManifest.buildPlugins.vite`), so every deploy
  changes the worker's bytes even when the push logic itself didn't change —
  `workbox-window`'s update check is byte-comparison based, so an unchanged
  worker would never register as "waiting" and the update-prompt banner
  would go stale. A page can read it back by posting `{ type: 'GET_BUILD_ID'
  }` to the controlling worker and listening for the `{ type: 'BUILD_ID',
  buildId }` reply (see the Web Inspector checklist in
  [pwa-safari-dock-app-launch.md](pwa-safari-dock-app-launch.md));
  this also keeps the constant from being minified away as unused.
- **Silent-push rule (always show)**: the push handler calls
  `showNotification` for every push event, including events with no data or
  unparseable JSON (those show a generic "Besidka" / "You have a new update."
  fallback pointing at `/`). WebKit (Safari, macOS Dock web apps, iOS
  home-screen apps) counts every push that ends without a displayed
  notification as a "silent push", and the 3rd silent push revokes the push
  subscription. The counter is cumulative and never reset by later successful
  notifications, and there is no focused-window exemption (unlike Chrome).
  A `waitUntil` promise that rejects counts as silent too — the handler
  attaches a `.catch` to the `showNotification` promise so a display failure
  cannot reject it. Since WebKit 2026-05, showing a notification and
  immediately `close()`-ing it also counts as silent (WebKit 313831@main
  adds a minimum notification lifetime before `close()` so it cannot drive
  silent background runtime, see
  <https://github.com/WebKit/WebKit/commit/7ab26d3bed>), so there is no
  show-then-hide workaround, and the SW does not UA-sniff WebKit. Source:
  WebKit `Source/WebKit/Shared/WebPushDaemonConstants.h` `maxSilentPushCount`
  and <https://webkit.org/blog/12945/meet-web-push/>. The fixed `tag`
  collapses repeated notifications into one. Accepted trade-off: desktop
  users now see a notification even while the app is focused.
- **Tap navigation**: if a window is running, the SW `postMessage`s the
  target path to it (preferring the focused client) and the plugin navigates
  — deterministic, no storage involved. `clients.openWindow()` on iOS merely
  refocuses a running PWA without honoring the URL, and IndexedDB access
  inside a briefly-woken SW is unreliable, so those are reserved for the
  true cold start: persist the path in IndexedDB, `openWindow`, and let the
  plugin consume the entry on boot/visibility/focus (5-minute TTL, internal
  paths only — iOS can drop the openWindow URL entirely when the app was
  killed, firebase-js-sdk#7698).
- `manifest.webmanifest` declares `launch_handler: { client_mode:
  "focus-existing" }`: with Chrome 139+ desktop navigation capturing,
  notification clicks and in-scope links open the installed PWA window
  instead of a browser tab. Safari ignores unknown manifest members.

## Platform notes

- **iOS (16.4+)**: pushes only reach home-screen installs that subscribed
  from the installed app. Permission is per-install — deleting/re-adding the
  PWA resets it (the banner re-shows thanks to the account-level state).
  Web Push is the only channel that works while the app is
  suspended/killed; page-context timers/notifications do not survive
  backgrounding.
- **Desktop Chrome/Edge (macOS)**: the subscription belongs to the browser
  profile + origin — installing the PWA does not create a second one.
  Chrome must be running for delivery (FCM cannot wake a fully-quit
  browser). macOS keeps separate Notification Center entries for Chrome and
  for each installed PWA — both need to be allowed. Notifications render via
  native macOS Notification Center.
- **Long-uptime Chrome GCM wedge** (diagnosed live 2026-07-06): after many
  days of Chrome process uptime, its persistent FCM socket can wedge —
  every layer looks healthy and FCM accepts sends (201), but the SW `push`
  event never fires. Fix: fully quit Chrome (⌘Q) and restart. Check
  `chrome://gcm-internals` → Connection State.
- **Safari vs. macOS Dock web app**: these are separate data stores —
  separate SW registration, notification permission, push subscription and
  silent-push counter. Add to Dock copies only cookies (the session), not
  the SW or subscription, and Safari's SW cannot see the web-app window.
  Each one subscribes and gets revoked independently.
- **PR previews**: every preview subdomain is a separate origin — separate
  cookies, separate permission, separate subscription. A grant on one
  preview does nothing for another.

## Testing and troubleshooting

- Inspect subscriptions:
  `pnpm exec wrangler d1 execute besidka-preview --remote --command="SELECT id, user_id, substr(endpoint,1,45) AS endpoint, datetime(created_at,'unixepoch') AS created FROM push_subscriptions"`
  — Apple endpoints are iOS installs, `fcm.googleapis.com` is Chrome.
  Remember pushes go to the account that owns the chat; multiple accounts
  across devices are easy to mix up.
- **Deterministic delivery bisect**: `POST
  /api/v1/chats/shares/<share-slug>/handoff` from the target browser is a
  truthful probe — `sent: true` means the push service accepted a message
  for this exact machine; `failures` names the rejecting host, HTTP status,
  and body. Mind the 10s cooldown (429).
- Verify display independently of macOS settings:
  `(await navigator.serviceWorker.getRegistration()).getNotifications()` in
  the page console lists what the SW actually displayed.
  Non-empty there + nothing on screen = macOS presentation settings.
- Client state audit (page console): `Notification.permission`,
  `(await navigator.serviceWorker.ready).pushManager.getSubscription()`
  (compare `options.applicationServerKey` with the configured public key),
  and `permissionState({ userVisibleOnly: true })`.
- Common failures: success toast but nothing arrives → check `failures` in
  the handoff response; `status 0` with an exception message → the Worker
  threw before sending (key pair or code); `403 VapidPkHashMismatch` →
  subscription bound to a different key than the sender (rotate + let the
  client heal); rows silently disappearing → the service returned 404/410
  and pruning removed them, or the row was replaced via `previousEndpoint` /
  expired by the 60-day `last_seen_at` sweep.
- `Notification.permission === 'granted'` but `getSubscription()` returns
  `null` on WebKit → the subscription was revoked for silent pushes (see the
  silent-push rule above). The chat layout's reconcile re-subscribes silently
  once per session.

The unit/integration suites cover the protocol (RFC vector), the send loop,
both endpoints, and the prompt/reconcile logic:
`pnpm vitest run tests/unit/utils/push-encryption.spec.ts tests/unit/utils/push.spec.ts tests/unit/composables/push-notifications.spec.ts tests/unit/composables/notification-prompt.spec.ts tests/integration/api/push-subscriptions.spec.ts tests/integration/api/push-status.spec.ts tests/integration/api/chats-shares-handoff.spec.ts tests/integration/server/push-subscription-sweep-plugin.spec.ts`
