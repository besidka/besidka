# Opening shared chats inside the installed PWA (iOS)

For the full push stack (protocol, VAPID keys, subscription lifecycle,
service worker, platform notes, troubleshooting) see
[../push-notifications.md](../push-notifications.md).

iOS (through iOS/Safari 26) has no link capturing for home-screen web apps:
an `https` link tapped in a messenger or Safari always opens in a browser,
never in the installed PWA. Universal Links are native-app-only, and WebKit
implements neither `launch_handler` nor `capture_links`. The public
`/shared/<slug>` page in the browser is therefore the guaranteed baseline,
and landing inside the PWA is a push-based enhancement.

## Push handoff from the shared page (logged-in visitors)

`app/pages/shared/[slug].vue` shows an "Open in the app" button for
logged-in visitors on iOS outside standalone mode
(`isIosExternalBrowser()`). It calls
`POST /api/v1/chats/shares/:slug/handoff`, which sends the visitor a Web
Push with `url: /shared/<slug>`; tapping the notification opens the page
inside the installed PWA.

The send is awaited, not fire-and-forget, so the response reflects reality:

- `{ sent: true }` — at least one push service accepted the notification.
- `{ sent: false, reason: 'no-subscriptions' }` — the account has no push
  subscription rows.
- `{ sent: false, reason: 'not-configured' }` — the environment is missing
  VAPID keys.
- `{ sent: false, reason: 'delivery-failed' }` — every subscription was
  rejected by its push service (stale rows are deleted on 404/410, so a
  retry after re-subscribing gets a clean slate).

The endpoint is guarded by a `sec-fetch-site` cross-site check and a
KV-backed 60-second per-user cooldown.

The existing branch flow (`POST /api/v1/chats/shares/:slug/branch`) keeps
its own fire-and-forget push that deep-links to the new `/chats/<slug>`
after branching.

## Per-install subscriptions vs the account-level prompt state

`notificationPromptState` is an account-level user setting, but browser
notification permission and the push subscription are per-install (and on
iOS, per home-screen app). A fresh PWA install starts at permission
`default` with no subscription even when the account already opted in — so
`useNotificationPrompt` re-shows the prompt banner in that state
(`state === true && permission === 'default'`); otherwise a new install
could never subscribe and pushes would only reach older installs.

## Cold-start-safe push navigation

iOS can ignore the `clients.openWindow(url)` target when the PWA cold-starts
from a killed state (firebase-js-sdk#7698) and open `start_url` instead. To
survive that, `public/sw-push.js` persists the target path in IndexedDB
(`besidka-push` / `pending-navigation`, internal paths only, written only on
the `openWindow` branch) before opening the window, and
`app/plugins/push-navigation.client.ts` reads-and-clears the entry on
`app:mounted` and on return-to-visibility to complete the navigation
client-side. Entries expire after 5 minutes and are ignored when the app
already sits on the target route.
