# Safari PWA cache headers on SSR documents

## Symptom
After a production deploy, the Dock web app (macOS Safari "Add to Dock")
and iOS home-screen PWAs could relaunch onto a fully unstyled,
unhydrated page. Chrome PWAs never showed this.

## Root cause
WebKit launches an installed web app on its start URL with a cache-first
policy (`ReturnCacheDataElseLoad`): it reuses whatever document is
already stored, regardless of freshness. Only `no-store` is guaranteed
never to be stored — `no-cache`/`max-age=0` can still be replayed on
launch. Chrome revalidates the launch navigation. Our SSR HTML had no
`Cache-Control` at all; WebKit would store it, and a later deploy
hard-deletes the previous build's hashed `/_nuxt/entry.<hash>.css|js`.
Launching onto the stale shell 404s on those assets. The service worker
isn't involved (`navigateFallback: null`, no `.html` precached).

## Fix
`server/plugins/ssr-html-no-store.ts`, a Nitro `render:response` hook,
sets `Cache-Control: private, no-store` on any SSR document response
without an existing `cache-control` header.

## Why a plugin, not `routeRules`
`cloudflare_module` writes every `routeRules[*].headers` into
`.output/public/_headers`, applied by Workers Static Assets outside
Nitro's specific-rule-wins merge — including to `/_nuxt/*`. A broad
`/**` rule there risks the immutable long-lived asset headers. A
`render:response` hook only touches the actual SSR response.

## Why `/` (SWR) is skipped
`/` is SWR-cached in production (`routeRules['/'].cache`, keyed by
`buildId`); Nitro's cached-handler wrapper sets `event.context.cache`
and overwrites `cache-control` itself regardless. The plugin's
`eventContext.cache` guard isn't load-bearing there, but keeps the skip
explicit and unit-testable.

## bfcache trade-off
WebKit refuses bfcache for HTTPS main documents served `no-store`. This
doesn't affect in-app SPA routing (no new main-document fetch); only a
full-page back/forward re-fetches instead of restoring.

## Already-poisoned caches
The header stops WebKit storing a *new* stale shell — it doesn't evict
one already stored. A device that hit the bug before this fix may still
need one manual reload, or clearing site data / reinstalling.

## Considered and rejected
- Rotated `/_nuxt/*` 404s are served `immutable, max-age=1y` too —
  harmless once stale shells can't exist, only bites on a hash-revert.
- `Pwa/Refresher.client.vue` dismissing on any wrapper click (lengthens
  prompt-mode update skew): unrelated, follow-up material.
- `features.inlineStyles: true`: `entry.css` is ~295 KB raw / ~42 KB
  brotli per SSR response — too heavy to inline on every document.

## Safari verification checklist
1. Cold-launch the Dock app (fully quit first).
2. Web Inspector → Network on the launch load.
3. The start-URL document response has `cache-control: private, no-store`.
4. `.css` rows return `200`, not `404`.
