# Opening shared chats inside the installed PWA (iOS)

iOS (through iOS/Safari 26) has no link capturing for home-screen web apps:
an `https` link tapped in a messenger or Safari always opens in a browser,
never in the installed PWA. Universal Links are native-app-only, and WebKit
implements neither `launch_handler` nor `capture_links`. The public
`/shared/<slug>` page in the browser is therefore the guaranteed baseline,
and landing inside the PWA is a layered enhancement:

## Layer 1 — "Open shared link" in the sidebar (works for everyone)

The sidebar "More Features" (⋯) menu always renders and contains an
"Open shared link" action (`app/components/Sidebar/Development.vue`). It
reads the clipboard via `useClipboardWithPaste()` (on iOS the native Paste
bubble appears), extracts `/shared/<slug>` with
`shared/utils/shared-link.ts`, and navigates in-app. This is the manual
handoff: copy the link in the messenger, open the PWA, tap ⋯ → Open shared
link.

Clipboard constraint: `navigator.clipboard.readText()` must run inside the
tap's transient activation — do not `await` anything else before it.

## Layer 2 — Push handoff from the shared page (logged-in visitors)

`app/pages/shared/[slug].vue` shows an "Open in the app" button for
logged-in visitors on iOS outside standalone mode
(`isIosExternalBrowser()`). It calls
`POST /api/v1/chats/shares/:slug/handoff`, which sends the visitor a Web
Push with `url: /shared/<slug>`; tapping the notification opens the page
inside the installed PWA. The endpoint responds `{ sent: false }` when the
account has no push subscription so the UI can explain how to enable it.

The existing branch flow (`POST /api/v1/chats/shares/:slug/branch`) keeps
its own push that deep-links to the new `/chats/<slug>` after branching.

## Layer 3 — Cold-start-safe push navigation

iOS can ignore the `clients.openWindow(url)` target when the PWA cold-starts
from a killed state (firebase-js-sdk#7698) and open `start_url` instead. To
survive that, `public/sw-push.js` persists the target path in IndexedDB
(`besidka-push` / `pending-navigation`) before opening the window, and
`app/plugins/push-navigation.client.ts` reads-and-clears the entry on
`app:mounted` and completes the navigation client-side. Entries expire after
5 minutes and are ignored when the app already sits on the target route.
