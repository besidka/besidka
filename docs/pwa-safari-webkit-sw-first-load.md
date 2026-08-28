# WebKit not applying SW-served CSS on the PWA's first load

## Symptom
On macOS 26.6 Safari, opening the installed Dock web app in a **fresh Web
App process** (fully quit, then relaunched — not a reload of an already
running window) rendered a fully unstyled, unhydrated-looking page: no
Tailwind/DaisyUI CSS applied, even though the HTML and scripts were present.
Pressing ⌘R immediately "fixed" it. Chrome PWAs never showed this.

## Root cause
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
`server/plugins/ssr-html-no-store.ts`) targeted a different, wrong theory (a
stale cached HTML shell after deploy) before this was diagnosed. It stays as
hygiene — still correct behavior — but never could have fixed this, since no
HTML caching header changes how WebKit applies a *SW-served CSS response*.

## Fix
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

## Activation-transition protocol
An install that already has the old Workbox service worker keeps running it
on its **first** launch after this deploy — that launch still hits the bug.
The new push-only worker installs as *waiting* in the background. Only the
next full quit-and-relaunch (or an explicit click on the Refresher banner,
which posts `SKIP_WAITING`) activates it — and it's that *following* cold
launch that actually tests the fix.

## Considered and rejected
- Excluding `.css` from `workbox.globPatterns`: insufficient — the same bug
  applies to any SW-served response, and JS is SW-served too.
- Dropping `crossorigin` from asset tags: no supported knob for this.
- `features.inlineStyles: true`: `entry.css` is ~295 KB raw per SSR
  response — too heavy to inline on every document.

## Contingency
If a fetch-handler-less worker still reproduces the bug, the next lever is
skipping service-worker registration entirely on macOS Safari standalone
mode (`window.matchMedia('(display-mode: standalone)')` + UA sniffing),
trading away update-prompt/push registration on that one platform.

## Web Inspector checklist
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
