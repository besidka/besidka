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
~2.6 µs for the same sort on a plain array. **Measured impact (real browser):
pending** — the numbers above isolate the reactivity/sort cost in Node; a
before/after profile of an actual picker open in a browser tab hasn't landed
yet.

## The rule

Add a prefix to `iconCollections` in `nuxt.config.ts` the moment a new Iconify
collection is used directly (`name="<prefix>:...">`, or a vendor icon-name map
like `ProviderIcon.vue`'s `providerIconNames`). Skipping this doesn't break
anything — `serverBundle.remote` still serves any collection not in the list
through a per-request fallback to `api.iconify.design` — but it silently
reintroduces the per-icon latency above for whatever uses that collection.

`thesvg` is deliberately **not** in the list. It backs exactly one icon
(`ProviderIcon.vue`'s Zhipu vendor mark, `thesvg:zhipu`) and isn't part of
`@iconify/collections`, so it already resolves through the Iconify API on
every render regardless of this setting. Adding it to
`serverBundle.collections` would bundle its entire ~3.7k-icon set into the
Worker just to serve that one icon.

## Revert criteria

Revisit this pin if `@nuxt/icon` fixes `useResolvedName` upstream — either by
sorting `collections` once instead of per `<Icon>` instance, or by reading
through `toRaw()` before sorting so the reactive-proxy overhead disappears.
Check the module's changelog before reverting; the behavior was unchanged as
of `@nuxt/icon@2.5.1`.
