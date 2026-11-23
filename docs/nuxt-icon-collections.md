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
multicolor Google marks `logos:google-gmail`, `logos:google-calendar` and
`logos:google-icon` (`shared/utils/google-brand-icons.ts`), which every
installed collection only offers as `currentColor` glyphs. `@iconify-json/logos`
(gilbarbara/logos, CC0-1.0, pinned to an exact version) is a dev-only
dependency and `icon.clientBundle.icons` lists the three, so they ship in the
client bundle and the server renders them too: the page HTML carries the
`.i-logos\:google-gmail` rule with the icon as a `background-image` data URI.
A multicolor body has no `currentColor`, so `@nuxt/icon` picks background
mode, never mask mode, which keeps the colors. A brand mark must not get a
`text-*` color, opacity or a filter. The reasoning step icon box
(`Chat/Reasoning/StepIcon.vue`, `size-full` at 14px, shared with every
iconify step) forces a square, an accepted distortion that is not visible at
that size.

## `google-brand`: Google's official 2026 product icons (BES-468)

`google-brand` is a local custom collection, not an Iconify package. It holds
Google's own artwork for Drive, Docs, Sheets and Slides, in
`app/assets/google-brand/{drive,docs,sheets,slides}.svg`, and replaces both
`logos:google-drive` and the three `thesvg-color` redraws (the 2020-era
Docs, Sheets and Slides shapes, a third-party package that is no longer a
dependency). The names are constants in `shared/utils/google-brand-icons.ts`
(`GOOGLE_DRIVE_ICON`, `GOOGLE_DOCS_ICON`, `GOOGLE_SHEETS_ICON`,
`GOOGLE_SLIDES_ICON`); a component never writes `google-brand:` itself, and a
spec fails when one does.

How it is wired:

```ts
icon: {
  customCollections: [
    { prefix: 'google-brand', dir: './app/assets/google-brand' },
  ],
  clientBundle: {
    includeCustomCollections: true,
    icons: [...],
  },
}
```

- The folder is outside `app/assets/icons`, which `nuxt-svgo` scans
  (`svgo.autoImportPath`) and optimizes with `multipass` and
  `preset-default`; an optimized copy of a logo must never ship. The loader
  of `@nuxt/icon` reads `*.svg` non-recursively and does not touch the files.
- The collection is read from disk at build time and bundled whole in the
  client bundle (`includeCustomCollections: true`, set explicitly because the
  default depends on the provider) and in the server bundle. No browser
  request goes to `api.iconify.design` or to `/api/_nuxt_icon`, the same as
  for the other client-bundle icons (`fallbackToApi` is `false`).
- The prefix is not in `iconCollections`: a custom collection is added by the
  module itself, and the client `appConfig.icon.collections` array that is
  sorted per `<Icon>` stays at four entries (checked in `.nuxt/app.config.mjs`
  after `nuxt prepare`).
- The marks have no `currentColor`, so `@nuxt/icon` renders them as a
  `background-image`, never a mask. The box is square (192x192), where the
  old `logos:google-drive` was `1.08em x 1em`. Never add a `text-*` color,
  opacity or a filter; `isMulticolorBrandIcon()` in the same file is what the
  tools menu row uses to skip its faded style.
- Each file uses the ids `a`, `b` and `c`. In background mode every icon is
  its own image document, so they never meet; with `mode="svg"`, which no
  component uses, two of them on one page would reference each other's
  gradients and masks. Do not switch these icons to `mode="svg"`.
- `@iconify/utils` can only parse a file that has a `viewBox`. Google's Docs
  and Drive files have only `width="192" height="192"`, so the loader rejected
  them. The one change to those two files is the attribute
  `viewBox="0 0 192 192"`; the same viewBox is already in the Sheets and
  Slides files. `tests/unit/utils/google-brand-icons.spec.ts` removes that
  attribute again and compares the SHA-256 with Google's original, so any
  other change fails the test.

Source, fetched on 2026-11-23, all from Google (the artwork is not altered; the
files are the `192px.svg` of the 2026 product logos):

| File | URL | SHA-256 of Google's file |
|---|---|---|
| `docs.svg` | `https://www.gstatic.com/images/branding/productlogos/docs_2026/v1/192px.svg` | `2bb529bae5125af70bbb14e1f005756d90af9e7607298a16436683ef728442d0` |
| `sheets.svg` | `https://www.gstatic.com/images/branding/productlogos/sheets_2026/v1/192px.svg` | `359fd2a4237e2d3526fe7a95e44d0505e6321b2356698512bbb8873b786598f5` |
| `slides.svg` | `https://www.gstatic.com/images/branding/productlogos/slides_2026/v1/192px.svg` | `3ad971447ab6fc537eb8bb5eae651a0473b137ee70acbbb073a231b84235c0e6` |
| `drive.svg` | `https://www.gstatic.com/images/branding/productlogos/drive_2026/v1/192px.svg` | `60a6496d705d8bf010ce126469be89889db331622b14d8ae1645a38c2aaa23f5` |

SHA-256 of the committed `docs.svg` is
`1e236006179b0509fdb13341a0b58ece7bc37b3be5bcd26ad02b76fbe946ac07` and of
`drive.svg` `dcdebf05bef2cece561975e552f5d30d5cb4046a7a884b817799eb61d93c43ac`
(each is Google's file plus the viewBox attribute).

Why the gstatic files and not the download Google offers: the Workspace page
"Brand your internal communications with Google Workspace" (updated
2026-11-10) links a ZIP
(`https://drive.google.com/file/d/18IjIi_3-1yqMRcBruNHgpSf0qAI0dN7M/view`,
SHA-256 of the ZIP
`3dcd24266a298b2a17f49d96a5a94ccec81974e6ab1852afe13d01a76019955c`), but it
holds PNG files only (1x and 2x at 32, 48, 64 and 96dp, named
`logo_<product>_2026q2_color_...`), no SVG. A raster cannot be bundled as an
Iconify icon without wrapping it. The gstatic SVGs are the same artwork:
rendered at 192 px they differ from the ZIP's 96dp@2x PNGs by about 0.5 percent
RMSE for Docs, Slides and Drive (Google's `drive_2026/v2` PNG, which the Drive
API branding page links, is pixel-identical to the ZIP's Drive PNG; there is
no `drive_2026/v2` SVG, the SVG is `v1`). Docs, Slides and Drive match the ZIP.
The ZIP's Sheets PNG is rotated 180 degrees against the gstatic Sheets SVG,
the gstatic Sheets PNGs and the Sheets icon in Google's May 2026 announcement
(the Sheets folder in the ZIP is dated August, the others May). The announcement
and the SVG agree, so the SVG ships; the mismatch is an open item for the owner
in `docs/legal/prechecks/google.md`, row 9. The `gstatic.com` URLs are not
documented for third parties.

Terms. The ZIP page says: "By downloading the elements, you agree to the
guidelines for using the Google brand", and its guidelines say not to remove,
distort or alter an element, not to display a Google brand feature as the most
prominent element of a page, not to imply a relationship with or endorsement by
Google, and to use only Google-approved artwork. That page offers the elements
for "your organization's internal communications", which is not the same as a
public app. The Drive API branding page does allow the Drive logo in an app
to show that a file is in Drive or on a button that acts on Drive, resized
only, with the full name "Google Drive" and a tooltip on an icon button. Docs,
Sheets and Slides have no such developer page. See `docs/legal/prechecks/google.md`,
row 9, for the status and the owner step.

Adding another file: drop the unmodified SVG in the folder, give it a viewBox
only if the loader rejects it (and record both hashes here and in the spec),
add a constant to `shared/utils/google-brand-icons.ts`, and extend the spec.
There is no `THIRD_PARTY_NOTICES` file for application assets (the one under
`workers/artifacts-runtime` covers vendored libraries only), so this section is
the record.

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
source use the four pinned prefixes except `thesvg:zhipu`, the three
`logos:google-*` marks and the `google-brand` collection, which are in the
client bundle (see above). The
`logos:grok-icon` mention in `ProviderIcon.vue` is a comment, not a used icon.

## Revert criteria

Revisit this pin if `@nuxt/icon` fixes `useResolvedName` upstream — either by
sorting `collections` once instead of per `<Icon>` instance, or by reading
through `toRaw()` before sorting so the reactive-proxy overhead disappears.
Check the module's changelog before reverting; the behavior was unchanged as
of `@nuxt/icon@2.5.1`.
