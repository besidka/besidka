# @nuxt/icon collections: why they're pinned to four prefixes

`nuxt.config.ts` sets:

```ts
const iconCollections = ['lucide', 'simple-icons', 'bxl', 'streamline-logos']

icon: {
  collections: iconCollections,
  serverBundle: {
    remote: 'jsdelivr',
    collections: iconCollections,
  },
},
```

This pins both `icon.collections` (the client-side `appConfig.icon.collections`
array) and `icon.serverBundle.collections` to the four Iconify collection
prefixes this app names directly (`lucide:`, `simple-icons:`, `bxl:`,
`streamline-logos:`). Left at the module's default, `serverBundle.collections`
falls back to every collection its remote can serve — with `remote: 'jsdelivr'`
and `fallbackToApi`, that's effectively the whole Iconify catalog, about 220
entries in the generated `.nuxt/app.config.mjs`.

## What actually got slow

`@nuxt/icon`'s `useResolvedName`
(`node_modules/@nuxt/icon/dist/runtime/components/shared.js`) sorts
`appConfig.icon.collections` on **every single `<Icon>` setup**, to resolve
ambiguous colon-less icon names. `useAppConfig()` is `reactive()` on the
client, and Vue 3.5 instruments `Array.prototype.sort` on a reactive array by
reading, `has`-checking and writing back every element through proxy traps —
there's no fast path for "this array never changes at runtime". With ~220
entries, that per-`<Icon>` sort dominates the cost of mounting anything that
renders a lot of icons at once, and the model picker was the worst offender
(100+ rows per open, each carrying several icons; 400+ rows on some gateway
catalogs).

Node micro-benchmarks (V8, no DOM/style/layout — a no-op Vue renderer mounting
a picker-shaped component tree), from before this fix landed:

| Scenario | 220 collections | 4 collections |
|---|---|---|
| Provider mode, 116 rows | 100 ms | 7 ms |
| OpenRouter mode, 400 rows | 340 ms | 28 ms |

A single `sort()` call on the reactive 220-entry array measured ~124 µs versus
~2.6 µs for the same sort on a plain array.

**Measured impact (real browser).** Headless Chromium, production `wrangler
dev` build, warm-open medians (before = 220 collections, attribution = this
pin alone, no other changes):

| Mode | CPU | firstFrame before → attribution | longTaskMs before → attribution |
|---|---|---|---|
| Provider | 1× | 182 ms → 96 ms (−48%) | 206 ms → 73 ms (−65%) |
| Provider | 4× | 848 ms → 348 ms (−59%) | 1145 ms → 616 ms (−46%) |
| OpenRouter | 1× | 525 ms → 257 ms (−51%) | 621 ms → 344 ms (−45%) |
| OpenRouter | 4× | 2518 ms → 1112 ms (−56%) | 3129 ms → 1810 ms (−42%) |

A CPU trace of a warm provider-mode open confirmed the mechanism directly:
`useResolvedName`'s sort plus the reactive-proxy `set` trap it triggers went
from ~9% of sampled time to ~0.4% once the collections list shrank from 220 to
4.

## The rule

Add a prefix to `iconCollections` in `nuxt.config.ts` the moment a new Iconify
collection is used directly (`name="<prefix>:...">`, or a vendor icon-name map
like `ProviderIcon.vue`'s `providerIconNames`). Skipping this doesn't break
anything — `serverBundle.remote` still serves collections it can reach from
the Worker, and an icon outside the pinned collections no longer renders at all in the browser
(`fallbackToApi` is `false`, see below), and it silently reintroduces the
per-icon latency above for whatever uses that collection.

`thesvg` is deliberately **not** in the list. It backs exactly one icon
(`ProviderIcon.vue`'s Zhipu vendor mark, `thesvg:zhipu`). Adding it to
`serverBundle.collections` would bundle its entire ~3.7k-icon set into the
Worker just to serve that one icon. Instead `@iconify-json/thesvg` is a
dev-only dependency and `icon.clientBundle.icons` lists `thesvg:zhipu`, so that
single icon (about 0.3 KB) ships in the client bundle and needs no request at
all. Any other icon from a non-pinned collection must be added the same way
(or its collection added to `iconCollections`).

`logos` is not in the list either. It backs exactly three icons, the
multicolor Google marks `logos:google-drive`, `logos:google-gmail` and
`logos:google-calendar` (`shared/utils/google-brand-icons.ts`), which every
installed collection only offers as `currentColor` glyphs. `@iconify-json/logos`
(gilbarbara/logos, CC0-1.0, pinned to an exact version) is a dev-only
dependency and `icon.clientBundle.icons` lists the three (about 7 KB
uncompressed), so they ship in the client bundle and the server renders them
too: the page HTML carries the `.i-logos\:google-drive` rule with the icon as
a `background-image` data URI. A multicolor body has no `currentColor`, so
`@nuxt/icon` picks background mode, never mask mode, which keeps the colors;
the box is `1.08em x 1em` (the mark's own 256x238 ratio). A brand mark must
not get a `text-*` color, opacity or a filter, and should keep that box: a
forced square size stretches the image (measured: the Drive triangle fills a
96px square edge to edge, about 8 percent taller). The reasoning step icon
box (`Chat/Reasoning/StepIcon.vue`, `size-full` at 14px, shared with every
iconify step) still forces a square, an accepted distortion that is not
visible at that size.

`thesvg-color` follows the same rule (BES-468). It backs exactly three icons,
the Google Docs, Google Sheets and Google Slides marks
(`shared/utils/google-brand-icons.ts`: `GOOGLE_DOCS_ICON`,
`GOOGLE_SHEETS_ICON`, `GOOGLE_SLIDES_ICON`), because `logos` has no Docs or
Sheets mark that is colored and the plain `thesvg` set is mono. The prefix is
not pinned in `icon.collections`; `@iconify-json/thesvg-color` (MIT, exact
version `1.2.28`, released 2026-11-17, older than the 1440 minute
`minimumReleaseAge`) is a dev-only dependency and `icon.clientBundle.icons`
lists the three icons (about 5 KB), so they ship in the client bundle and
render on the server from it. They are third-party redraws, not Google's
artwork; the branding status and the owner step to replace the three constants
are in `docs/google.md` 19.14 and `docs/legal/prechecks/google.md`, row 9.
`GOOGLE_SLIDES_ICON` has no component yet because no Slides create kind
exists.

## The landing footer logos are in the client bundle too

The landing page (footer and `content/index.md`) uses three
`streamline-logos:` icons: `github-logo-2-solid`, `linkedin-logo-block` and
`twitter-logo-1-solid`. `@iconify-json/streamline-logos` is a dev-only
dependency and `icon.clientBundle.icons` lists all three (about 1 KB), so the
landing page never calls `/api/_nuxt_icon/streamline-logos.json`.

Why: `serverBundle.remote: 'jsdelivr'` makes the Worker fetch the whole
collection from jsDelivr on the first request (`createRemoteCollection` in
`@nuxt/icon`, no timeout, cached only after a success), and the route is a
Nitro cached handler that shares one in-flight promise per key
(`pending[key]` in nitropack's `cache.mjs`). When that first fetch stalls (or
its request is aborted by a quick reload), every later request for the same
icon set awaits the same promise and never completes. In CI that left
`/api/_nuxt_icon/streamline-logos.json` pending through three attempts of
`theme.spec.ts › should persist theme preference on page reload`, whose
`waitForLoadState('networkidle')` then timed out (run 43886840471, 2026-11-16,
unrelated to the connectors branch; simple-icons and bxl share the same
exposure but are not on the landing page).

Any icon used on a page that must load without extra requests follows the same
route as `thesvg:zhipu`: install the `@iconify-json/<prefix>` package as a dev
dependency and list the icon in `icon.clientBundle.icons`.

## Icons of client-only Google components are in the client bundle (BES-449)

The cards on the Google tab of API Keys (`Profile/Google/Connection.vue`,
`OwnClient.vue`) and the workbook map chip render on the client after a lazy
fetch, so their icons are not in the server-rendered HTML and a browser has
to get each one from the same-origin `/api/_nuxt_icon/lucide.json` route.
That route is the one described above (a Worker fetch of the whole collection
from jsDelivr on the first request, one shared in-flight promise). The
reading of the code, which was not reproduced on the preview: when that route
does not answer, an `<Icon>` renders an empty box. On the preview the
Disconnect button's `lucide:unplug` had a zero-width box, so only the 8 px
`gap-2` of `ui/Button.vue` was left and pushed the label off center, while the
Delete buttons of the API key cards, rendered on the server, showed theirs.
The `lucide` prefix was already pinned and the icon exists in the installed
collection, so the cause is most likely where the icon was resolved, not the
prefix list. `icon.clientBundle.icons` now lists every
`lucide:` icon those components use (`circle-alert`, `copy`, `info`,
`key-round`, `trash`, `triangle-alert`, `unplug`) and `lucide:table-2`, the
icon of a Google Sheet's workbook map chip; `@iconify-json/lucide` is
already a dev dependency. `tests/unit/config/client-icons.spec.ts` reads every
`icon-name` and `name` literal in `Profile/Google/*.vue` and fails when one is
missing from the list, so a new icon there cannot reintroduce this. That the
label is centered on the deployed preview is NOT VERIFIED by a unit test.

## `fallbackToApi` is `false`

`icon.fallbackToApi` is pinned to `false`. Two reasons:

- The browser never requests `api.iconify.design`. That host is a third party
  and would receive every visitor's IP address (and the icon names they load)
  without consent. With the fallback off, the browser only ever asks the
  same-origin `/api/_nuxt_icon` route, and anything the bundles cannot serve
  simply does not render.
- The Worker never fetches upstream on `/api/_nuxt_icon`. An attacker-chosen
  collection or icon name there would otherwise turn the route into an
  unauthenticated outbound fetch and KV key generator. Server-side rendering
  still resolves icons from the bundled collections and
  `serverBundle.remote`. See `docs/security-audit-2026-10.md`.

It was `'client-only'` before; that value is what sent browsers to
`api.iconify.design` whenever the same-origin route had no answer. All icons in
source use the four pinned prefixes except `thesvg:zhipu` and the three
`logos:google-*` marks, which are in the client bundle (see above). The
`logos:grok-icon` mention in `ProviderIcon.vue` is a comment, not a used icon.

## Revert criteria

Revisit this pin if `@nuxt/icon` fixes `useResolvedName` upstream — either by
sorting `collections` once instead of per `<Icon>` instance, or by reading
through `toRaw()` before sorting so the reactive-proxy overhead disappears.
Check the module's changelog before reverting; the behavior was unchanged as
of `@nuxt/icon@2.5.1`.
