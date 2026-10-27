# Nuxt 4.6 upgrade: decision log

This is the decision log for the `chore/updade-nuxt-4-6` branch
(`git log --oneline 46e48246..HEAD`). It records what moved, which flags were
turned on or deliberately left off, and the known loose ends, so a reviewer can
audit the choices without replaying the session.

## Summary

| Package | Before | After |
|---|---|---|
| `nuxt` / `@nuxt/kit` | 4.5.2 | 4.6.0 |
| `vue` | 3.5.41 | 3.6.0-rc.12 |
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

A Vapor component with `<script setup>` must also import every auto-imported
function, composable, util, or constant its template uses explicitly in the
script block (for example
`import { buildChatErrorLines } from '~/composables/chat'`). Components and
`$`-prefixed globals are unaffected. See the next section for why.

### Template auto-imports in production Vapor builds

Since Vue `3.6.0-rc.11` ([vuejs/core#15839](https://github.com/vuejs/core/pull/15839),
commit `7d0928be7`, "read unknown identifiers from props in templates and css
vars"), the Vapor compiler emits an identifier that is unknown to an inlined
`<script setup>` template as `__props.name`. Up to rc.10 it emitted the bare
`name`. `@vitejs/plugin-vue` inlines the template into `setup()` only in
production builds. The dev server compiles the template separately, and that
output still reads `_ctx.name`.

Nuxt resolves template auto-imports through unimport. Its `vueTemplate` addon
rewrites only `_ctx.name` accesses, and its script transform only sees bare
identifiers. A production `__props.name` access matches neither, so the import
is never injected and the call resolves against the props object. The first
case was `Chat/ErrorCard`: its template called the auto-imported
`buildChatErrorLines(error)`, and production threw
`e.buildChatErrorLines is not a function` (`e` is the minified `__props`)
when a chat request failed, so the error card never rendered.

Neither dev nor unit tests catch this. `pnpm run dev` compiles the separate
`_ctx.name` form, which unimport still rewrites. `tests/unit` strips the `vapor`
attribute (see below), so those specs compile VDOM output. The guard is
`tests/unit/config/vapor-template-auto-imports.spec.ts`. It compiles every
Vapor SFC under `app/` with `inlineTemplate` and `isProd`, and fails on any
`__props.name` that is not a declared prop. Only `Chat/ErrorCard` was affected
among the 20 converted components. Template-only Vapor components
(`<template vapor>` with no script) compile in non-inline mode to `_ctx.name`,
so unimport still handles them.

The fix is the explicit import, not a Vue pin. #15839 is a deliberate
semantics change, so a later rc will not revert it. Remove the explicit-import
rule only when unimport or Nuxt resolves auto-imports in the production Vapor
`__props` form.

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

## 2026-10-18: Vue rc.11 to rc.12 (WebKit `NotFoundError` on `/chats/new`)

**Symptom.** In production, macOS Safari (WebKit) only, Chrome unaffected:
after a chat page `/chats/<slug>` had been shown, a client-side navigation back
to `/chats/new` raised the toast "The object can not be found here." (WebKit's
default `NotFoundError` message) and left the page in the empty error-boundary
state. The toast comes from `<NuxtErrorBoundary @error="onException">` in
`app/app.vue`.

**Root cause (confirmed in source).** `@vue/runtime-vapor@3.6.0-rc.11`
`removeNode(block, parent)` called `parent.removeChild(block)` with the parent
recorded when the block was created. When Suspense has moved the node during a
page swap, the real `parentNode` differs and `removeChild` throws
`NotFoundError`. `3.6.0-rc.12` (published 2026-10-16) reads
`const current = block.parentNode` and removes only when it is set. The Vapor
components on these pages are `Chat/Container`, `ui/Bubble`, `Logo` and
`Welcome`.

**Fix.** All twelve `overrides` in `pnpm-workspace.yaml` plus the `vue` pins in
`package.json` and `modules/cookie-consent/package.json` moved to
`3.6.0-rc.12` in lockstep, installed with a plain `pnpm install` (rc.12 was
older than the 1440 minute release-age gate, no bypass). The rc.11
`__props` auto-import guard and the `viteMDCSlot` guard still apply unchanged.

**Observability.** `onException` in `app/app.vue` now also forwards the error
(name, message, stack, route) to the evlog client logger as
`action: 'client-error-boundary'` under `attributes.clientError`, so a future
client error reaches Axiom instead of only showing a toast.

**Regression spec and WebKit.** `tests/e2e/chat/new-chat-navigation.spec.ts`
covers: SSR chat page then the sidebar "Start new chat" button, SSR new chat
then client push then browser back, a mocked first turn sent from
`/chats/new`, and repeated round trips. It wraps `Node.prototype.removeChild`,
`insertBefore` and `replaceChild` to log the stack when they throw, settles for
4 seconds and asserts no error toast and no DOM-mutation throw. It runs under
the default `chromium` project in CI.

The `webkit` Playwright project is opt-in: `E2E_WEBKIT=1 pnpm exec playwright
test --project=webkit new-chat-navigation` after `pnpm exec playwright install
webkit`. It is scoped to this spec through `testMatch`, and CI is unchanged
(it installs chromium only). The project sets `serviceWorkers: 'block'`:
Playwright's WebKit never finishes loading the app with the service worker
registered (`document.readyState` never reaches `complete` and `page.evaluate`
hangs), while the same pages load instantly with workers blocked. The service
worker is push-only, so blocking it does not affect the removal path under
test.

**Repro status.** Against rc.11, in both the dev server and a production
build served by `wrangler dev` (`CI=true` vars, `NUXT_PUBLIC_E2E_TEST_HOOKS_ENABLED`),
Playwright WebKit (build 2370) did NOT reproduce the toast or any DOM throw in
any scenario above, so the spec is a regression guard but did not fail before
the bump. The failure was only observed on real Safari in production; real
Safari was not driven from this repository. If the toast reappears, the
`client-error-boundary` event carries the stack that was missing before.

## Known issues and follow-ups

- **Dev dependency scan failed on every `nuxt dev` start (fixed locally,
  upstream [nuxt#36473](https://github.com/nuxt/nuxt/issues/36473)).** The
  log read `Failed to run dependency scan ... Missing "#components" specifier
  in "@nuxtjs/i18n" package`. Caused by this upgrade: Nuxt 4.5.2 starts clean.
  Nuxt 4.6's `nuxt:optimize-deps` plugin (`installedScanEntries` in
  `@nuxt/vite-builder`) adds every component, plugin and middleware file under
  `node_modules` to the client `optimizeDeps.entries`. One of them is
  `@nuxtjs/i18n/dist/runtime/components/NuxtLinkLocale.js`, which imports
  `NuxtLink` from `#components`. Nuxt only rewrites that specifier in a
  transform hook, and the scanner never runs transforms. Vite's scanner also
  checks `optimizeDeps.exclude` only for bare ids (`/^[\w@][^:]/`), so
  `#components` reached `vite:resolve` as a Node subpath import of the i18n
  package, and the whole scan aborted. Every dependency was then optimized on
  demand, and those reloads caused the e2e full reloads in the middle of tests.
  The local fix in `nuxt.config.ts` is
  `externalizeComponentsImportInDependencyScan`, a rolldown plugin in
  `vite.optimizeDeps.rolldownOptions.plugins` (which only runs in the scanner
  and the optimizer). It marks the exact id `#components` as external. With the
  fix, a cold start pre-bundles 42 dependencies (base: 27), and only
  `@better-auth/passkey/client`, `web-haptics/vue` and `zod/v4` are still
  discovered later. Delete the plugin once #36473 ships.
- **`AuthTurnstile` hydration mismatch on `/signin`, `/signup` and
  `/reset-password` (fixed).** Caused by this upgrade, not pre-existing. The
  earlier note blamed nothing in the upgrade because the mismatch persisted
  with Vapor off, but on the 4.5.2 base it does not happen at all. Nuxt 4.6
  added `nuxt:components:client-component-stub`, which resolves a `*.client.vue`
  file imported by path to the server placeholder in the SSR build. The client
  only gets the `createClientOnly` wrapper through `#components`. The three
  pages imported `Turnstile.client.vue` by path, so the server rendered
  `<!--placeholder-->` while the client hydrated the raw `<div>`. The pages now
  use the auto-imported `<AuthTurnstile>` and keep a type-only import for the
  ref type. `onMounted` awaits `nextTick()` because, under `createClientOnly`,
  the template renders one tick after mount while hydrating. Without that tick
  the widget never renders and `execute()` returns an empty token. Do not
  import any `*.client.vue` file by path for rendering.
- **`<ChatsNew>` node mismatch (server node vs client `Symbol(v-fgt)`) and the
  `<NuxtLoadingIndicator>` style mismatch (server `right:0`, client
  `right:0;left:0`). Pre-existing, not caused by this upgrade.** Both appear
  together, and only when the browser hydrates `/signin` HTML that was
  rendered for a guest while the session cookie is already set. The client
  `00.auth.global` middleware then calls `fetchSession()`, sees a user, and
  redirects to `/chats/new` during hydration, so Vue hydrates the
  multi-root `ChatsNew` fragment against the sign-in markup. A Playwright probe
  that serves guest `/signin` HTML to a signed-in context reproduces both
  warnings identically on the 4.5.2/Vue 3.5 base and on this branch. Loading
  `/chats/new` or `/signin` directly with a session gives no warnings on either
  (the server redirects `/signin` itself), and neither does Vapor. In e2e, the
  trigger was the dev-only optimize-deps full reload around the sign-in submit
  that the `signIn()` helper comment describes. The dependency scan failure
  above made that reload far more frequent. After the scan fix, `signin.spec.ts`
  and `context-menu-image-desktop.spec.ts` with `--repeat-each=3` pass 13 of 13
  with zero hydration warnings (the full run before had 39 `ChatsNew` and 40
  `NuxtLoadingIndicator` warnings). A production build has no such reload. The
  underlying design gap, the middleware redirecting on the client after a
  guest render, is out of scope for this upgrade.
- **`/profile/preferences` reasoning tabs nested in the skeleton on a direct
  load (fixed). Pre-existing, not caused by Vapor.** Loading the page directly
  sometimes mounted the Off/Low/Medium/High inputs inside the
  `preferences-reasoning-skeleton` `<div>`, unstyled and stacked. Client-side
  navigation was fine. Vapor was suspected because the content sits in the
  slot of the Vapor `Profile/Security/SectionCard`, but removing its `vapor`
  attribute left the same mismatches. The cause is a hydration mismatch. The
  server always renders the skeletons, because the settings load only in the
  client plugin `10.user-settings-sync.client.ts`. The profile layout is a
  lazy async component, so the page subtree hydrates only after the layout
  chunk resolves. When the `/api/v1/profiles/settings` response arrived
  first, `isSettingsLoaded` was already `true` at hydration, and the client
  rendered the `v-else` tab list against the server's `v-if` skeleton. Both
  are `<div>`s, so Vue reused the server element, appended the missing
  children into it, and left its `class` and `data-testid` in place: a
  production build never corrects attribute mismatches. `pnpm run dev`
  shows it on most loads because the unbundled dev server resolves the
  layout slowly; a production build shows it when the layout chunk loads
  after the settings response (a slow or cold network). The push row had a
  deterministic variant: `isSupported` is `false` on the server and `true`
  in the browser, so the label kept the server's `opacity-60` while the
  toggle was enabled. The page now gates every client-only value behind an
  `isMounted` flag set in `onMounted`, so the hydration render matches the
  server and the real state renders one tick later, like
  `Profile/Memory/CacheInfo.vue`. `tests/e2e/profile/preferences.spec.ts`
  forces the order by holding the profile layout chunk until the settings
  response arrives. Hold the layout chunk, not the page chunk: the router
  resolves the page chunk before the later plugins run, so holding it delays
  the settings request too. Any template that reads `useState` written by a
  client plugin, or a browser-only API, needs the same gate.
- **`gateway-image-generation.spec.ts:202` fails first-attempt-only under
  `--retries=0`. Pre-existing, not caused by this upgrade.** Run alone with
  `--retries=0`, it fails 3 of 3 on the 4.5.2/Vue 3.5 base (`46e48246`) and 3
  of 3 on this branch, with the same signature: the progress card is never the
  problem, but `[data-role="assistant"] .js-message-text` is not found, the
  textarea is empty, and the user bubble shows the `GET /chats/test` seed
  ("Test message") instead of the typed prompt. Playwright's call log shows
  `navigated to .../chats/test?scenario=gateway-image` after the click, so the
  page was reloaded mid-turn by the dev-only optimize-deps full reload that
  `playwright.config.ts` describes (it only reproduces on a cold
  dev server). The default local
  retry hits warm dependencies and passes. A production build or `wrangler
  dev` (CI) has no such reload.
- **nuxt#36471** (backtick plus `publicAssetsURL` in inlined CSS) was checked
  and does not apply: the fonts are referenced from the external entry CSS, not
  inlined CSS.
- **evlog `useLogger` typing** does not accept the portable event yet; the
  mismatch is contained inside `useRequestLogger`.
- **Upstream issue to file** for `@nuxtjs/mdc` `viteMDCSlot` against the Vapor
  compiler context, so `guardMdcSlotTransformForVapor` can be deleted.
- **Upstream issue to file** against unimport's `vueTemplate` addon (or Nuxt):
  production Vapor templates read unknown identifiers as `__props.name` since
  Vue rc.11 (vuejs/core#15839), so template auto-imports silently stop
  resolving. Once that is handled upstream, the explicit-import rule in
  "Template auto-imports in production Vapor builds" can be dropped.
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
