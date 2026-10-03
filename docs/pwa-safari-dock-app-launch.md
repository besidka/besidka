# macOS Safari Dock app launch bugs

Three bugs on the installed macOS Safari Dock web app: SW-served CSS not
applying on first cold load (fixed, PR #373), a stale-shell relaunch from
WebKit's session-restore cache path (mitigated below), and the update-prompt
banner reappearing/re-triggering across reloads and relaunches (mitigated
below).

## Bug 1: SW-served CSS not applied on first load

### Symptom
On macOS 26.6 Safari, opening the installed Dock web app in a **fresh Web
App process** (fully quit, then relaunched — not a reload of an already
running window) rendered a fully unstyled, unhydrated-looking page: no
Tailwind/DaisyUI CSS applied, even though the HTML and scripts were present.
Pressing ⌘R immediately "fixed" it. Chrome PWAs never showed this.

### Root cause
Unified-log forensics on the affected machine
(`log show --last 3h --style compact --predicate 'process ==
"com.apple.WebKit.Networking" AND eventMessage CONTAINS
"ServiceWorkerFetchTask"'`) showed every `.css` request on the cold-launch
document completing `200 text/css`, with
`ServiceWorkerFetchTask::processResponse ... source=8` — `source=8` is
DOMCache, i.e. the response came from the Workbox-generated service worker's
`respondWith`, not the network. Despite that 200, the page rendered
unstyled. On ⌘R, the same requests logged `source=4` (MemoryCache) — WebKit
served the reload from its in-process memory cache, bypassing the service
worker entirely, and the page was styled.

The conclusion: WebKit has a bug where it does not apply stylesheets whose
response was provided via a service worker's `respondWith` on the very first
document load of a fresh Web App process. Once the process has done one
navigation (memory cache warm), SW-served CSS applies fine — which is why
this only ever appeared on a cold Dock-app launch, never on in-app SPA
navigation or a reload.

A previous fix (PR #372, `Cache-Control: private, no-store` on SSR HTML,
`server/plugins/ssr-html-no-store.ts`) targeted a different theory (a stale
cached HTML shell after deploy) before this SW-CSS bug was diagnosed. That
theory turned out to be real too — see Bug 2 below — but `no-store` alone
never could have fixed *this* bug, since no HTML caching header changes how
WebKit applies a *SW-served CSS response*.

### Fix
Make the service worker **push-only**: no `fetch` listener, no precaching,
no Workbox runtime. `nuxt.config.ts`'s `pwa` block uses `@vite-pwa/nuxt`'s
`injectManifest` strategy with `injectionPoint: ''` (a falsy string), which
tells `vite-plugin-pwa` to skip workbox-build's manifest-injection pass
entirely — nothing from Workbox ends up in the built worker. The entry point
is `app/service-worker/sw.ts`; the push/notification handlers live in
`app/service-worker/push.ts` (this directory, not `app/utils/`, so Nuxt's
`app/utils` auto-import scan never turns `handlePush`/
`handleNotificationClick` into app-side auto-imports) and are pulled in with
a plain relative `./push` import — the worker has its own isolated Vite
build, separate from the app's auto-import graph. With no `respondWith` in
the worker, no CSS or JS response can ever come from it, so the bug has
nothing left to trigger on. This app is fully online-only, so losing
precaching costs nothing real.

The build embeds the current `buildId` as `__SW_BUILD_ID__` (a Vite
`define` from a small plugin in `pwa.injectManifest.buildPlugins.vite`), so
every deploy changes the worker's bytes even when the push logic is
unchanged — `workbox-window`'s update check is a byte comparison, so an
unchanged worker would never register as "waiting" and the prompt-mode
`Pwa/Refresher.client.vue` banner would go stale.

### Activation-transition protocol
An install that already has the old Workbox service worker keeps running it
on its **first** launch after this deploy — that launch still hits the bug.
The new push-only worker installs as *waiting* in the background. Only the
next full quit-and-relaunch (or an explicit click on the Refresher banner,
which posts `SKIP_WAITING`) activates it — and it's that *following* cold
launch that actually tests the fix.

### Considered and rejected
- Excluding `.css` from `workbox.globPatterns`: insufficient — the same bug
  applies to any SW-served response, and JS is SW-served too.
- Dropping `crossorigin` from asset tags: no supported knob for this.
- `features.inlineStyles: true`: `entry.css` is ~295 KB raw per SSR
  response — too heavy to inline on every document.

### Contingency
If a fetch-handler-less worker still reproduces the bug, the next lever is
skipping service-worker registration entirely on macOS Safari standalone
mode (`window.matchMedia('(display-mode: standalone)')` + UA sniffing),
trading away update-prompt/push registration on that one platform.

### Web Inspector checklist
1. Fully quit the Dock app, then relaunch it (not ⌘R).
2. Web Inspector → Console: `document.styleSheets` and read `.cssRules` on
   each — should not throw and should be non-empty.
3. Web Inspector → Network: `.css` rows are `200`, not missing/blocked.
4. `navigator.serviceWorker.controller.scriptURL` is `.../sw.js`.
5. `await caches.keys()` should no longer list any `workbox-*` cache name
   after the new worker has activated once.
6. `navigator.serviceWorker.controller.postMessage({ type: 'GET_BUILD_ID'
   })`, then listen for a `message` event — the reply's `buildId` should
   match the deployed build.

## Bug 2: stale shell on launch

### Root cause
- A launch restores the last-visited URL via
  `WebPageProxy::restoreFromSessionState` using `ReturnCacheDataElseLoad`;
  `makeUseDecision` returns `Use` before any freshness check. **No
  `Cache-Control` value makes a launch revalidate** (hashed JS chunks are
  unaffected — immutable).
- Under `private, no-store` (PR #372) WebKit never stores a fresh response
  and evicts the old record for that URL when a non-storable one arrives —
  but that eviction is async, on a background IO queue, so a reload
  followed immediately by quitting can race it and leave the old record
  for the next launch.
- Evidence: a network ⌘R at 10:38:00 didn't displace the record WebKit
  restored from DiskCache (`source=2`, 239 ms) at 10:38:07 — a record
  predating PR #372 (stored when HTML had no `Cache-Control` at all) that
  kept resurfacing until a launch happened to fetch from the network
  without an immediate quit after.
- Steady state: every cold launch now fetches fresh (slower first paint,
  accepted); the async-eviction race is the only path back to staleness,
  and it's rare and self-correcting, not permanent.

### Fix: `app/plugins/01.build-freshness.client.ts`
Safety net for that race (and any stale-restore path). On boot:
1. Fetch `/_nuxt/builds/latest.json` (`cache: 'no-store'`); compare `id` to
   `useRuntimeConfig().app.buildId`. Same id (or no id) → done.
2. **Timestamp guard**: `latest.json`'s `{ id, timestamp }` can itself be a
   stale edge-cached copy (1y-immutable header below), naming an old `id`
   whose `builds/meta/<id>.json` still exists too (never deleted) — an
   id-and-existence check alone would pass and reload *backwards*. Fetch
   the current build's own manifest via `getAppManifest()` (reads
   `builds/meta/<currentBuildId>.json`) and require
   `latest.timestamp > current.timestamp` before continuing; if
   `getAppManifest()` rejects (current meta already gone), fall back to
   the id-only check from step 1.
3. Past that guard: fetch `/_nuxt/builds/meta/<id>.json` as an origin-404
   guard only (confirms the newer build's meta actually exists; a 404
   rejects and is caught, no reload).
4. Call `reloadNuxtApp()` — its default 10 s `sessionStorage` `nuxt:reload`
   guard is a per-path rate limit for the session, so in practice at most
   one reload per document load.

No `persistState`; runs unconditionally (a no-op on an already-current
tab); not awaited in `setup()` (`parallel: true`), so hydration is never
blocked. `setup()` returns immediately under `import.meta.test`, matching
Nuxt's own `check-outdated-build.client.js` — without it this plugin's real
`$fetch` runs during every spec file's Nuxt bootstrap (`environment: 'nuxt'`
is global) and can steal a mocked response body from an unrelated test.
The reload's own network fetch is what evicts a stale DiskCache record — a
poisoned launch heals in one reload and stays current on every launch
after (across future deploys too, since `no-store` keeps fetching fresh).
Caveat: this only protects records created from this deploy onward — a
stale record restored from *before* this plugin shipped loads with no
plugin in it at all, so that one launch still needs a manual reload (or a
first launch into a URL with no cached document).

`latest.json` currently gets a doubled `cache-control` header (`public,
max-age=31536000, immutable, public, max-age=1, immutable`, two overlapping
Nitro `_headers` blocks) and `cf-cache-status: HIT` even on a fresh query
string, yet has been observed to serve the new id right after deploy. If
the reload doesn't fire, check the network log for `builds/latest.json`
and `sessionStorage.getItem('nuxt:reload')`.

### Verification checklist
1. Build+serve an old `NUXT_BUILD_ID`, load once to record it client-side.
2. Build+serve a new one without touching the open tab — one reload, then
   steady (no loop).
3. `curl -sI /signin` still `private, no-store`; `curl -sI /` still the
   unchanged SWR `cache-control`.
4. `curl -s /_nuxt/builds/latest.json` reflects the new id; requesting
   `/_nuxt/builds/meta/<new>.json` succeeds.

### Public pages get `no-cache`, not `no-store`
WebKit refuses bfcache for any HTTPS main document served
`Cache-Control: no-store`, so Safari back/forward on these pages re-fetches
instead of restoring instantly. `/privacy-policy`, `/terms-of-use`,
`/cookie-policy` and `/shared/<publicId>` are not the app shell and carry no
per-user state, so the stale-restore concern above doesn't apply to them —
`server/plugins/ssr-html-no-store.ts` gives them `no-cache` instead (stored,
revalidated on normal navigation, same effective network behaviour since
they carry no validators, but bfcache-eligible). The build-freshness plugin
(Bug 2 fix, above) still runs unconditionally on every route including
these, so a stale bfcache restore still gets caught and reloaded. `/` is
unaffected either way — it already has its own SWR `cache-control` from
`nuxt.config.ts`'s `routeRules`, so this plugin's early-return on an
existing header skips it entirely. Under `no-cache`, a revoked share on
`/shared/**` may still be restored once from that device's bfcache until
the next reload — identical to pre-#372 behaviour and to bfcache anywhere,
and accepted deliberately.

## Bug 3: refresh prompt reappears / re-triggers on relaunch

### Symptom
On both iOS Safari-installed and macOS Safari-installed ("Add to Dock") PWAs,
the "The app has been updated. Please refresh it to see the latest changes."
banner (`app/components/Pwa/Refresher.client.vue`, gated by `$pwa?.needRefresh`
in `app/app.vue`) did not reliably clear on click. Clicking Refresh once
often left the banner showing; a second click cleared it. Separately, fully
quitting the installed app (⌘Q) and relaunching it re-showed the same banner
even with no new deploy in between.

### Root cause
This app uses `@vite-pwa/nuxt` with `registerType` left at its default,
`'prompt'` — a deliberate UX choice (manual banner + click-to-update, not
`'autoUpdate'`). In `'prompt'` mode, `vite-plugin-pwa`'s client wrapper
(`workbox-window` underneath) only posts `SKIP_WAITING` to the waiting worker
when `updateServiceWorker(true)` is called; the actual page reload after
activation is wired up internally via a `controllerchange` listener that the
library re-registers every time a new `waiting` service worker is detected.

This exact failure mode — a refresh prompt that survives one click and
reappears on the next load with no new deploy — matches several **unresolved**
upstream issues in vite-pwa/vite-plugin-pwa:
[#282](https://github.com/vite-pwa/vite-plugin-pwa/issues/282)
("onRegistered callback is called prompt again after reload in safari"),
[#717](https://github.com/vite-pwa/vite-plugin-pwa/issues/717)
("Prompt - Reload - not reloading"), and
[#583](https://github.com/vite-pwa/vite-plugin-pwa/issues/583)
("updateServiceWorker() not always working with multiple tabs"). There is no
merged upstream fix for any of these. The accepted workaround, used here, is
for the consuming app to own the reload itself via the raw
`navigator.serviceWorker` API instead of trusting the library's internal
reload wiring, which has known listener-leak and Safari `controllerchange`
timing issues.

### Fix
`app/components/Pwa/Refresher.client.vue`'s Refresh button now drives its own
reload instead of relying on `updateServiceWorker`'s internal wiring:
1. A `controllerchange` listener is registered directly on
   `navigator.serviceWorker` (`{ once: true }`) *before* calling
   `updateServiceWorker`, so a fast activation can't race past it.
2. A bounded ~4s fallback timer also triggers the reload if
   `controllerchange` never fires, covering the cases the upstream issues
   describe (Safari not firing the event reliably, or firing it before the
   listener from a previous prompt cycle was cleaned up).
3. Both paths funnel through a single `reloadOnce` guard so the page is never
   reloaded twice, and a local `isRefreshing` flag (also disabling the button)
   makes a second click while a refresh is already pending a no-op.
4. `updateServiceWorker(true)` is still called — the `reloadPage` argument is
   currently inert in this library version per the upstream issues above, but
   passing it is harmless and future-proof if that changes.

`app/service-worker/sw.ts`'s `activate` handler now also calls
`self.clients.claim()` alongside `deleteLegacyCaches()`, and this is load-
bearing, not just hygiene: activating a new worker does **not** by itself
hand it control of a tab that was already open and controlled by the
*previous* worker — that tab keeps its old controller until it reloads,
navigates, or the new worker calls `clients.claim()`. `workbox-window`'s own
source confirms this (`node_modules/workbox-window/Workbox.js`, the dev-only
warning logged on the `'activated'` state: *"The registered service worker
is active but not yet controlling the page. Reload or run `clients.claim()`
in the service worker."*), matching MDN's `Clients.claim()` documentation.
Without it, the already-open tab showing the banner would never see
`controllerchange` fire from the fast path above — every refresh would
silently degrade to the ~4s fallback timer instead. With it, `clients.claim()`
takes over the open tab immediately on activation, so the fast
`controllerchange` path (step 1 above) actually fires. The worker is
currently push-only (no `fetch`/`respondWith` handler — see Bug 1), so
`clients.claim()` taking control immediately has no effect on resource
loading today; if a `fetch` handler is ever reintroduced, revisit this,
since `clients.claim()` would then make the worker start intercepting the
*current* page's in-flight requests immediately rather than after the next
navigation.

### Investigated and ruled out
- **`/sw.js` edge caching.** Repeated `curl -I` against production showed a
  consistent `cache-control: public, max-age=0, must-revalidate` —
  Cloudflare's safe default for a non-hashed static asset, and not
  implicated. `run_worker_first` is not set in `wrangler.jsonc`, so a Nitro
  `routeRules` header override for `/sw.js` would be a no-op anyway (it's
  asset-served directly, never reaching the Nitro pipeline) — not added.
- **`periodicSyncForUpdates` unit.** `client.periodicSyncForUpdates: 60 * 5`
  in `nuxt.config.ts` is correctly interpreted as seconds (5 minutes) by
  `@vite-pwa/nuxt@1.1.1` — confirmed, not a bug, left untouched.
- **A duplicate `navigator.serviceWorker.register()` call.**
  `app/composables/push-notifications.ts` and
  `app/plugins/push-navigation.client.ts` were both checked — neither
  registers a service worker; there is exactly one registration path, owned
  by `@vite-pwa/nuxt`.

### Caveat
This is a downstream workaround for an unresolved upstream library bug, not a
root-cause fix inside `vite-plugin-pwa`/`workbox-window` itself. If those
projects ship a fix for #282/#717/#583, this component's manual reload
wiring becomes redundant (but still correct/harmless) rather than required —
re-evaluate removing it against the fixed library version, don't assume it's
safe to drop preemptively.

### Web Inspector verification checklist
1. Deploy a build that changes the service worker's bytes (any change to
   `app/service-worker/**` or a new `buildId`); load the installed Dock app
   once so it registers the new worker as *waiting*.
2. The Refresher banner should appear once. Click Refresh once — the page
   should reload and the banner should not reappear afterward on that same
   session.
3. Web Inspector → Console: `navigator.serviceWorker.controller.scriptURL`
   should point at the newly deployed worker's URL immediately after the
   reload from step 2.
4. Fully quit the Dock app (⌘Q) and relaunch it. With no new deploy since
   step 2, the banner must **not** reappear.
5. Repeat steps 1–4 across a real deploy boundary: the banner should appear
   at most once per actual deploy, and always clear in exactly one click.

### 2026-09-25: dismiss-forever and stuck-on-old-JS follow-up

`periodicSyncForUpdates` (5 min) means `$pwa.needRefresh` reliably flips true
on an open tab well before the user notices, but the banner was the only
path to actually applying that update, and dismissing it (a click anywhere
in the alert body, per the `@click` on `UiAlert` in the original version of
this component) hid it **permanently** for that session — the open tab then
ran stale JS until the user thought to ⌘Q the whole app. Three changes to
`app/components/Pwa/Refresher.client.vue` (plus a small pure-logic
composable, `app/composables/pwa-auto-refresh.ts`) address this without
touching `registerType: 'prompt'` or the SW lifecycle from Bug 3 above:

1. **Explicit dismiss only.** The alert's `@click` now goes through
   `handleDismiss` instead of setting `isVisible` directly, and still only
   fires from `UiAlert`'s own built-in icon-only "Hide" (✕) button — the
   same close affordance `NotificationPrompt.client.vue` uses. There is no
   separate whole-body dismiss handler to remove; the fix is what
   `handleDismiss` does next.
2. **Deferred, not permanent, dismissal.** `handleDismiss` hides the banner
   for `PWA_REFRESHER_DISMISS_INTERVAL_MS` (30 minutes), persisted to
   `sessionStorage` (`pwa:refresher-dismissed-until`, read/written through
   try/catch since storage can be unavailable) so a reload of the same tab
   during that window keeps it hidden, then re-shows automatically via a
   `setTimeout` if `$pwa.needRefresh` is still true. The user is never stuck
   past 30 minutes without being asked again.
3. **Auto-apply while genuinely idle.** On mount and on every
   `visibilitychange`, `checkAutoApply()` applies the update itself — the
   same `updateServiceWorker(true)` → `controllerchange` → reload path (and
   4s fallback) the Refresh button uses — when ALL of: the tab is
   `document.visibilityState === 'hidden'`, no chat turn is streaming, and
   the chat composer has no unsent draft text. The streaming signal is a
   new app-wide `useState<boolean>('chat-streaming')` set by
   `useChat()` (`app/composables/chat.ts`) around its SDK `status` changes,
   since the existing streaming state was local to whichever chat page
   happened to be mounted; the draft signal reuses the `chat_input` key
   already written to `usePreferenceStorage()` by both `useChat()` and
   `app/pages/chats/new.vue`, which works from any route since it's a
   storage read, not a live component reference. A `sessionStorage` guard
   (`pwa:auto-refresh-applied-until`, 5-minute cooldown) bounds this to at
   most one auto-apply attempt per pending update, so if `needRefresh` ever
   fails to clear after a reload (e.g. the Studio SW-conflict case
   documented in `app.vue`) a hidden tab can't reload itself in a loop.

**`autoUpdate` is still rejected, deliberately.** All three changes above
exist specifically so the update is applied automatically only when nothing
is at risk — switching `registerType` to `'autoUpdate'` would instead let
`vite-plugin-pwa` reload on its own schedule regardless of tab visibility or
chat state, which would kill an in-flight response mid-stream or discard
unsent input the moment a new deploy lands. The manual-banner
architecture from Bug 3 stays; only the idle-detection layer on top of it is
new.

## Deliberately not done: caching through the service worker

Investigated and rejected. Re-litigate with new evidence, not by assuming it
was overlooked.

- **A `fetch` listener for caching, at all.** The worker stays push-only on
  purpose (Bug 1, above). Do not add one without re-reading this section.
- **Why it's all-or-nothing.** Once any `fetch` listener exists, every
  in-scope request dispatches to the worker and pays worker start-up on the
  critical path — the exact property PR #373 removed. There is no
  "cache only `/api/v1/chats`" variant.
- **File downloads.** `server/routes/files/[key].get.ts` serves
  `private, no-store, max-age=0` on purpose — share revocation must stop
  retrieval, and a CacheStorage copy would outlive revocation on-device.
  Anti-recommended, not just unnecessary.
- **Chat history / model list instant paint.** That's a client-cache
  problem, not a worker one: `useFetch` + `getCachedData` (already used for
  the landing GitHub-stars badge) or a last-known list in IndexedDB rendered
  optimistically then revalidated. Same perceived speed, no worker in the
  path, testable in the existing harness, sign-out cleanup is ordinary app
  code. A worker cache of an authenticated API response also creates a
  logout-purge obligation that's easy to forget.
- **WebKit risk is unquantified for this path.** The first-load defect (Bug
  1) is proven for stylesheets via `respondWith` in a fresh Web App process
  and untested for `fetch()` JSON through the same code path. Any future
  worker-caching proposal carries that unknown and must go through the
  preview-Dock-app protocol (Web Inspector checklist, above) before merge.
- **What would change this.** Offline reading of past chats as a product
  goal, or richer push/background behaviour that needs the worker anyway.
