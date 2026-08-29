# macOS Safari Dock app launch bugs

Two bugs on the installed macOS Safari Dock web app's launch: SW-served CSS
not applying on first cold load (fixed, PR #373), and a stale-shell relaunch
from WebKit's session-restore cache path (mitigated below).

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
