# Nuxt 4.6 upgrade: decision log

This is the decision log for the `chore/updade-nuxt-4-6` branch
(`git log --oneline 46e48246..HEAD`). It records what moved, which flags were
turned on or deliberately left off, and the known loose ends, so a reviewer can
audit the choices without replaying the session.

## Summary

| Package | Before | After |
|---|---|---|
| `nuxt` / `@nuxt/kit` | 4.5.2 | 4.6.0 |
| `vue` | 3.5.41 | 3.6.0-rc.10 |
| `vue-router` | 5.2.x | 5.3.1 |
| `vite` | (transitive) | 8.3.2 |
| `unhead` / `@unhead/vue` / `@unhead/bundler` (override) | 3.2.1 | 3.4.2 |

Vue is pinned through `pnpm-workspace.yaml` `overrides`: `vue` plus eleven
`@vue/*` core packages (`shared`, `reactivity`, `runtime-core`, `runtime-dom`,
`runtime-vapor`, `server-renderer`, `compiler-core`, `compiler-dom`,
`compiler-sfc`, `compiler-ssr`, `compiler-vapor`). All twelve must move
together; a single `@vue/*` package left on 3.5 produces two runtimes in one
bundle. `modules/cookie-consent/package.json` was bumped in lockstep.

**A Vue release candidate runs in production by explicit owner choice.** This is
a pet project and the owner wants the newest Vue. The cost is accepted: RC
builds can change between `rc.N` bumps, so bump the twelve overrides as one
unit and re-run build plus e2e every time.

## Release-age gate

pnpm 11+ enforces `minimumReleaseAge` (1440 minutes by default) locally and in
CI. The Nuxt 4.6.0 packages were under 24 hours old at upgrade time (published
2026-10-05 around 22:25Z), so a plain `pnpm install` refused them.

- Installed with the one-shot env var `pnpm_config_minimum_release_age=0`.
  Nothing is persisted: no `minimumReleaseAgeExclude` entry exists anywhere in
  the repo, and none should be added.
- pnpm 12 writes a `minimumReleaseAgeExclude` block into
  `pnpm-workspace.yaml` automatically when it bypasses the gate. Delete it
  before committing.
- CI passes once the packages are older than 24 hours.
- CI simulation before pushing: run `pnpm install --frozen-lockfile` with NO
  env var. If it aborts on the gate, the packages are still too fresh to push.

## compat-5 flips applied automatically

Nuxt 4.6 runs with `compatibilityVersion: 5` semantics for these, no config
needed:

- **`typedPages`**: `useRoute('route-name')` returns typed params, and
  `'slug' in route.params` narrows the union. Touched: `app/pages/chats/[slug].vue`,
  `new.vue`, `projects/[id].vue`, `shared/[slug].vue`,
  `app/composables/chat-title.ts` and `app/components/Sidebar/Development.vue`.
- **`routeTypedFetch`**: route-typed `$fetch` inference (see `strictRouteTypes`
  below for the enforcement boundary).
- **`inlineErrorRendering`**, **`navigateToEarlyReturn`**,
  **`extractSerializablePageMeta`**: behavior changes with no code impact here.
- **`router.options.sensitive`**: routes are now case-sensitive. `/SIGNIN`
  returns 404 where it used to resolve. Accepted; no link in the app uses
  non-canonical casing.
- **PostCSS**: `autoprefixer` and `cssnano` are off by default. Tailwind v4 and
  Lightning/esbuild minification already cover both; `vite.build.cssMinify`
  stays pinned to `esbuild` (see `docs/vite-css-minify.md`).

## Experimental flags

| Flag | Decision | Why |
|---|---|---|
| `asyncContext` | enabled | Nuxt-level flag; it forwards to and replaces `nitro.experimental.asyncContext`, which was removed |
| `early404` | enabled | Unknown paths 404 in about 11 ms before the app renders; route status list verified below |
| `stripNeverHydratedData` | enabled | No `hydrate-never` usage yet; future-proofing |
| `strictRouteTypes` | enabled | See enforcement boundary below |
| `viteEnvironmentApi`, `watcher` | removed | Now compat-5 defaults; the explicit entries were redundant |
| `componentIslands` | kept `true` | `'auto'` raises `NUXT_B3002` under the `ssr: false` vitest environment |
| `nitroAutoImports` | kept `true` | Server code relies on auto-imported `server/utils` |
| `typescriptPlugin`, `extractAsyncDataHandlers`, `prefetchPreloadTags` | kept | Deliberately on, unchanged |
| `ssrStreaming` | skipped | unhead's streaming path is where the 3.1.8 `cloudflare_module` bug lived |
| `nitroViteEnvironment` | skipped | Not supported on Nuxt 4 |
| `server.builder: 'vite'` | skipped | No storage/tasks support |
| `prerenderErrorPages` | skipped | `cloudflare_module` strips prerender rules |

`routeRules` redirects keep `statusCode`, not `status`: the Nitro 2 runtime
ignores `status` there.

### `early404` verified route statuses

Checked against a production-mode build:

- 200: `/`, `/signin`, `/signup`, `/privacy-policy`, `/terms-of-use`,
  `/robots.txt`, `/sitemap.xml`, `/__nuxt_content/landing/sql_dump.txt`,
  `/manifest.webmanifest`, `/sw.js`, `/shared/x`, `/2fa`, `/cookie-policy`
- 301: `/privacy`, `/terms`
- 302: `/_studio` and the auth-gated pages
- 404 in about 11 ms: any unknown path

### `strictRouteTypes` enforcement boundary

Strict route typing is enforced for `useFetch`, `useLazyFetch`,
`useRequestFetch()`, and `$fetch` imported from `#build/fetch`. It is **not**
enforced for the global auto-imported `$fetch`, which Nitropack types as
accepting any string. Do not assume a typo in `$fetch('/api/...')` is caught.

## Vapor mode

Vue 3.6 Vapor mode compiles a component to direct DOM operations with no
virtual DOM diffing. It is opt-in per block: `<script setup lang="ts" vapor>`
or `<template vapor>`. `nuxt.config.ts` sets `vue.vapor: true` so the compiler
accepts the attribute. Vapor and VDOM components interoperate, so migration
can be incremental.

### Converted components (20)

`Auth/InAppAlert`, `Auth/LastUsed/Badge`, `Auth/LastUsed/Container`,
`Chat/Container`, `Chat/ErrorCard`, `ChatInput/ModelsTrigger/KeyPrompt`,
`Logo`, `LogoLink`, `Profile/Keys/Card`, `Profile/Keys/GatewaysInfo`,
`Profile/Keys/SearchProvidersInfo`, `Profile/Security/SectionCard`,
`Sidebar/Skeleton`, `Welcome`, `ui/Alert`, `ui/Bubble`, `ui/Form/Field/Badge`,
`ui/Form/Field/Label`, `ui/Form/Fieldset`, `ui/Form/Label`.

### Eligibility rules used

A component stays VDOM if it:

- uses VueUse composables or `useI18n` (their instance assumptions are not
  Vapor-safe yet);
- calls `getCurrentInstance` or `useField`: `app/composables/field.ts` uses
  `getCurrentInstance`, so `ui/Form/Input` and `ui/Form/Select` stay VDOM;
- inspects slots (`useSlots`, `$slots` content checks);
- renders `ContentRenderer` or MDC;
- sits inside a VDOM `v-for`;
- lives under `content/**` or `landing/**` and is rendered from MDC.

### `@nuxtjs/mdc` `viteMDCSlot` crash

`@nuxtjs/mdc` registers a `viteMDCSlot` node transform that reads
`context.nodeTransforms[0]`. The Vapor compiler's transform context has no
`nodeTransforms`, so every SFC compiled through Vapor crashed the build. The
local `guardMdcSlotTransformForVapor` module in `nuxt.config.ts` wraps that
transform and returns early when `context.nodeTransforms` is missing. It is
still unguarded upstream in `@nuxtjs/mdc` 0.23.2. Remove the module once
upstream guards it.

### Unit tests do not run Vapor

Vue 3.6 rc's Node export is the CJS build, which has no Vapor runtime exports.
The `besidka:strip-vapor-attribute` plugin in `vitest.config.mts` strips the
`vapor` attribute from `<script>` and `<template>` blocks so specs compile the
same SFCs as VDOM. Vapor output is therefore exercised only by the production
build and Playwright e2e, never by `tests/unit`.

### Revert criteria and next candidates

Revert a component (delete its `vapor` attribute) if it shows a hydration
mismatch, a missing reactive update, or an e2e failure that disappears in VDOM.
Revert globally (`vue.vapor: false` plus removing the attributes) if an `rc.N`
bump breaks several components at once.

Next candidates: the chat message list, after the MDC question above is settled,
and VueUse-free variants of components currently excluded for VueUse.

## `nuxt/server` migration

Server handlers and request helpers now import from `nuxt/server` so they keep
working when the server runtime moves to Nitro v3 / h3 v2. Rules, the
`NUXT_E8012` failure mode, and test conventions live in
`docs/nuxt-server-imports.md`; this log does not duplicate them. A follow-up
commit also moves the remaining handlers from h3's auto-imported `createError`
to evlog's (`status` and `message`, with technical detail in `why`).

## Smaller refactors

- **Typed routes**: `chat-title.ts` calls `useRoute('chats-slug')`, and
  `Sidebar/Development.vue` narrows with `'slug' in route.params` through a
  `routeSlug` computed instead of casting `route.params.slug as string`.
- **`useRequestFetch`**: the `import.meta.server ? useRequestFetch() : $fetch`
  ternary in `chats/[slug].vue`, `chats/new.vue` and `chats/projects/[id].vue`
  collapsed to a single `useRequestFetch()` call, which is correct on both
  sides.
- **`NuxtLink`**: removed the explicit `external` prop from
  `Profile/Keys/CloudflareGateway.vue` and `Profile/Keys/ProviderKeyCard.vue`.
- **`app/composables/field.ts`**: `checkParent` takes
  `Field | Field['parent']` because Vue 3.6 types a parent instance as
  `GenericComponentInstance`, not `ComponentInternalInstance`.

## Known issues and follow-ups

- **Hydration mismatch on `/signin` and `/signup`** from `AuthTurnstile`.
  Pre-existing: it reproduces with Vapor off, so this upgrade did not cause it.
- **nuxt#36471** (backtick plus `publicAssetsURL` in inlined CSS) was checked
  and does not apply: the fonts are referenced from the external entry CSS, not
  inlined CSS.
- **evlog `useLogger` typing** does not accept the portable event yet; the
  mismatch is contained inside `useRequestLogger`.
- **Upstream issue to file** for `@nuxtjs/mdc` `viteMDCSlot` against the Vapor
  compiler context, so `guardMdcSlotTransformForVapor` can be deleted.
- **Pre-existing low-severity findings** from the security audit of this
  branch. None were introduced by the migration:
  - `server/utils/auth.ts` (~line 128) falls back to `x-forwarded-for` after
    `cf-connecting-ip` for the Better Auth rate-limit IP. It is spoofable only
    when traffic reaches the Worker without passing through Cloudflare.
  - `server/api/v1/internal/files/recompute-expiry.post.ts` (~line 25)
    compares the maintenance token without a constant-time comparison.
  - `?search=a&search=b` yields an array that is cast `as string`, so
    `.trim()` throws a 500 in the history and projects list handlers.
  - The portable `readBody` uses `JSON.parse` and does not filter `__proto__`
    the way h3's `destr` does. Mitigated because every `readBody` result goes
    through zod.
- **`nuxt/server` parsing behavior**: `readValidatedBody` always JSON-parses
  and throws a generic 400 on malformed JSON, and route params must go through
  `getDecodedRouterParams`. Details in `docs/nuxt-server-imports.md`.
