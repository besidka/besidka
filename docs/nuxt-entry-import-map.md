# Nuxt `entryImportMap`: stale lazy chunks and duplicate entry CSS

`nuxt.config.ts` pins `experimental.entryImportMap: false`. Nuxt 4.6 enables it
by default.

## Symptom

Lazy JS chunks kept the same filename across builds while their content
changed. Each chunk's `__vite__mapDeps` list points at that build's
`entry.<hash>.css`. For example, `QmCYiupf.js` referenced `entry.CCa1RwOg.css`,
then `entry.DZt2tCwM.css`, then `entry.D69MTh7R.css` in three consecutive
builds. About 460 chunks behaved this way.

`/_nuxt/*` assets are served `cache-control: immutable` for a year. A returning
browser therefore keeps the old copy of such a chunk. When that chunk is
loaded it preloads the previous build's `entry.*.css`:

- If the old CSS is still cached, it is injected after the current CSS. The
  full Tailwind/DaisyUI bundle is then applied twice and the cascade breaks.
  Example: `.join { --join-v: 0 }` from the stale copy overrides
  `.join-vertical { --join-v: 1 }`, so the diagram viewer's vertical zoom
  buttons got horizontal corner radii on the PR preview.
- If the old CSS is not cached (new device, evicted cache), the preload
  requests a file that no longer exists and fails with a 404.

## Detection

- A page has two `entry.*.css` `<link>` elements, and the second one was
  injected by a lazy chunk rather than present in the server-rendered HTML.
- The same chunk filename exists in two builds with different content
  (`cmp` differs), typically only in the `entry.<hash>.css` string inside
  `__vite__mapDeps`.
- Non-entry chunks contain `"#entry"` imports and the SSR HTML contains an
  import map with a `#entry` key.

## Root cause

With `experimental.entryImportMap` on, Nuxt rewrites imports of the entry
chunk to the bare specifier `#entry` in `renderChunk` and resolves it through
an import map in the HTML. Because the entry filename is no longer embedded in
lazy chunks, entry changes do not reach a lazy chunk's filename hash, while
the `entry.<hash>.css` name in its `__vite__mapDeps` still changes with every
build. Result: content changes, filename stays.

Tracked upstream as https://github.com/nuxt/nuxt/issues/36136 (open). A partial
fix, https://github.com/nuxt/nuxt/pull/36198, is already included in Nuxt
4.6.2 and does not resolve it.

## Why `entryImportMap: false`

- **A custom `generateBundle` plugin** that strips the entry closure from
  `__vite__mapDeps` would be a regex over minified Rolldown output. It breaks
  silently whenever the minifier or Vite's preload helper changes shape.
- **A per-build `buildAssetsDir`** makes filenames unique but throws away
  cross-deploy caching of every asset.
- **A stable (unhashed) CSS name** requires non-immutable caching for that file
  and reintroduces revalidation on every navigation.

Disabling the flag restores ordinary Rolldown behavior: lazy chunks import the
entry by its real hashed filename, so any entry change flows into their hash.

## Trade-off

The entry hash now cascades: chunks that reference the entry CSS or import
the entry get new names when it changes, and so do their importers. More files
are re-downloaded after a deploy than with the import map. In a CSS-only
change measured against this repo, 86 of 461 JS chunk names changed (14
referencing the entry CSS directly, the rest through the import cascade) and
375 stayed.

## Revert criteria

When nuxt/nuxt#36136 is fixed in a released Nuxt version, remove
`entryImportMap: false` and re-run the verification below. Keep the flag off if
any same-name-different-content chunk appears.

## Verification

Use a scratch directory outside the repo.

1. `env -u NUXT_PUBLIC_BASE_URL pnpm run build`, then
   `grep -l '"#entry"' .output/public/_nuxt/*.js` must print nothing, and the
   rendered HTML must have no import map containing `#entry`.
2. `cp -R .output/public/_nuxt <scratch>/a`.
3. Append a trivial CSS-only change, for example `.hash-probe{color:red}` to
   `app/assets/css/diagram-theme.css`, rebuild, and
   `cp -R .output/public/_nuxt <scratch>/b`. Revert the probe.
4. For every `.js` file name present in both `a` and `b`, `cmp` must report
   identical content. Zero same-name-different-content files is the pass
   condition.
5. Chunks whose `__vite__mapDeps` references `entry.<hash>.css` must have new
   names in `b`, and no chunk in `b` may reference the old entry CSS name.
6. Rebuild once more so `.output` matches the source.
