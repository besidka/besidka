# Dependency holds

Packages that are deliberately kept below their newest release, why, and what
unblocks each one. Every hold has a matching `ignore` entry in
`.github/dependabot.yml` so Dependabot stops proposing the blocked versions.
The upgrades themselves are tracked in Linear as BES-431.

**Rule: remove the `ignore` entry in the same PR that does the upgrade**, and
delete the row here in that PR too. An ignore entry without a row in this table
is a bug.

Versions that are only younger than the pnpm `minimumReleaseAge` gate
(1440 minutes) are not holds: Dependabot's `cooldown` already waits for them,
so they get no ignore entry.

## Current holds

Recorded on 2026-11-21 during the dependency batch on
`chore/deps-2026-11-21`.

| Package | Held at | Blocked | Why | What unblocks it |
|---|---|---|---|---|
| `nuxt-studio` | 1.7.0 | >1.7.0 | 1.8.0 shipped an empty `studio.client.d.ts` (TS2306 dropped every `$plugin` injection type). 1.8.2 fixes that, but its `dist/module/module.mjs` imports `../../../dist/module/runtime/utils/media.js`, which resolves outside the package and loads only through Nuxt's jiti fallback (`NUXT_B8023`), and nuxt-content/nuxt-studio#597 (1.8.x external media loses its public URL) is open. Studio cannot be verified locally | A release that imports `media.js` from inside the package, #597 closed, and a Studio edit checked on a preview |
| `vue-router` | 5.4.0 | >=5.5.0 | 5.5 persists scroll positions to `sessionStorage["vue-router:scroll"]` at module scope, keyed by history position plus the full path with its query string, with no opt-out. UTM parameters then land in browser storage, which breaks the URL-only attribution rule (`docs/analytics-utm.md`) and adds a storage entry the Cookie Policy does not list. `tests/e2e/attribution/utm-signup.spec.ts` fails on it. nuxt 4.6.4 itself pins 5.4.0. A workspace `overrides` entry keeps `@nuxtjs/i18n` from pulling a second copy | A vue-router option to turn the persistence off (or a key without the query), or a Nuxt release that moves to 5.5 and a decision on how to keep UTM out of storage; then drop the override too |
| `@nuxtjs/color-mode` | 4.0.1 | >=4.1.0 | 4.1.0 writes `nuxt-color-mode` to localStorage in an idle callback after hydration (`onIdleAfterHydration`). `app/plugins/cookie-consent-gate.client.ts` purges the key once at startup, so the key is written for visitors who have not consented to preferences or rejected them. `tests/e2e/cookies/consent.spec.ts:240` and `:490` fail on a production build | The consent gate handles the deferred write (for example a storage option or hook that suppresses the write until consent), proven by the consent e2e spec on a production build |
| `vitest`, `@vitest/ui`, `@vitest/coverage-v8` | 4.1.12 | major 5 | 436 of 1210 unit spec files fail: projects now inherit the root config and share one Vite server by default, so the Nuxt project transforms every SFC twice (`Identifier '__temp' has already been declared`, empty SFC descriptors). The 5.0 migration guide lists about 35 breaking changes (`clearMocks` on by default, unawaited assertions fail, top-level hoisted mocks, and more) | A dedicated migration PR: project config per the 5.0 guide, then the full unit, integration and cookie-consent suites |
| `@stylistic/eslint-plugin` | 5.10.0 | major 6 | `@nuxt/eslint-config` 1.17.0 (the newest) depends on `@stylistic/eslint-plugin` ^5.10.0, and `eslint.config.js` registers the same `@stylistic` plugin name | A `@nuxt/eslint-config` release on stylistic 6 |
| `msw` | 2.15.0 | major 3 | Its only user, `tests/setup/mocks/api.ts`, is imported by no spec and is outside typecheck, so no check would exercise an upgrade. It looks unused | Delete `msw` and the mock file, or start using them; either way the hold ends |
| `nuxt-email-renderer` | 2.11.2 | major 4 | 4.0 changes the return shape of `renderEmailComponent` (always `{ html, text?, subject? }`) and rewrites the build pipeline that the `forceInlineVueI18nForEmailRenderer` module in `nuxt.config.ts` hooks into. Sending cannot be verified locally | A PR that adapts the callers and the vue-i18n inline module, then sends a real email from a preview |
| `@vite-pwa/nuxt` | 1.1.1 | major 2 | `pnpm run dev` disables the PWA module, so nothing local exercises the service worker, and the Safari service worker history (`docs/pwa-safari-dock-app-launch.md`) makes an unverified major risky | A PR with preview checks in Safari and the iOS home-screen PWA |
| `typescript` | 6.x | major 7 | The native compiler port has no stable compiler API: vue-tsc has no TS7 support (vuejs/language-tools#5381) and typescript-eslint's peer range excludes it (typescript-eslint/typescript-eslint#12518). See PR #297 | vue-tsc and typescript-eslint support TS7 |
| `@types/node` | 24.x | major 26 | Must match the Node 24 LTS runtime; `scripts/verify-node-types.mjs` fails the install on another major | The runtime moves to a newer Node LTS |

## vitest

Covers `vitest`, `@vitest/ui` and `@vitest/coverage-v8`, which move together
in the root and in `modules/cookie-consent`.

- **Held at:** 4.1.12.
- **Blocked:** major 5 (5.1.1 at the time of the batch).
- **Why:** with 5.1.1, 436 of 1210 unit spec files failed. Vitest 5 makes
  inline projects inherit the root config and share one Vite server by
  default. `vitest.config.mts` spreads the Nuxt Vite config into both the
  root and each project, so the Nuxt project transformed every SFC twice:
  `Identifier '__temp' has already been declared`, "At least one `<template>`
  or `<script>` is required" and "Element is missing end tag" from
  `@vue/compiler-sfc`. The migration guide lists about 35 more breaking
  changes, among them `clearMocks` on by default, unawaited asynchronous
  assertions failing the test, hoisted mocks required at the top level,
  `toThrow("")` matching any message, and `pretty-format` test titles.
  `@nuxt/test-utils` 4.4.0 already accepts `vitest` ^5.
- **Unblocks it:** a dedicated migration PR that restructures the project
  config per the 5.0 guide.
- **Verify:** `pnpm run test:unit` (every file, not only affected),
  `pnpm run test:integration`, `pnpm run test:cookie-consent`, the
  `--changed`/`--related` scripts and the pre-push hook, coverage thresholds
  (glob thresholds no longer inherit `perFile`), and that `@vitest/ui` opens
  (it now needs an authenticated URL).

## @stylistic/eslint-plugin

- **Held at:** 5.10.0.
- **Blocked:** major 6 (6.0.1).
- **Why:** `@nuxt/eslint-config` 1.17.0, the newest, depends on
  `@stylistic/eslint-plugin` ^5.10.0. `eslint.config.js` and
  `modules/cookie-consent/eslint.config.js` register the same `@stylistic`
  plugin name, so a second major in the tree would give two plugin objects for
  one name.
- **Unblocks it:** a `@nuxt/eslint-config` release that depends on stylistic 6.
- **Verify:** `pnpm run lint` with zero errors in both configs, the autofix
  diff from `pnpm run format` reviewed, and no rule turned off to get green.

## msw

- **Held at:** 2.15.0.
- **Blocked:** major 3 (3.0.7).
- **Why:** msw 3 is ESM only, drops the Node cookie store, renames
  `onUnhandledRequest` to `onUnhandledFrame` and moves GraphQL to
  `msw/graphql`. Its only user in this repo, `tests/setup/mocks/api.ts`, is
  imported by no spec and is outside typecheck (only `tests/nuxt/**` is
  typechecked), so nothing would exercise an upgrade.
- **Unblocks it:** a decision to delete `msw` and `tests/setup/mocks/api.ts`
  (most likely) or to start using them in specs.
- **Verify:** if kept, a spec that imports the handlers passes on 3.x and
  typecheck covers the file; if deleted, `grep -rn msw tests` is empty apart
  from words like `application/msword`.

## nuxt-email-renderer

- **Held at:** 2.11.2.
- **Blocked:** major 4 (4.1.0).
- **Why:** 4.0 changes `renderEmailComponent` to always return
  `{ html, text?, subject? }` and rewrites the build pipeline (Nuxt 4.1
  floor). The `forceInlineVueI18nForEmailRenderer` module in `nuxt.config.ts`
  hooks into that pipeline to keep `vue-i18n` inlined into the Worker, and
  `tests/integration/server/email-templates.spec.ts` imports the package's
  internal `dist/runtime/server/utils/render.js`. A broken send only shows on
  a Worker, and sending cannot be verified locally.
- **Unblocks it:** a PR that adapts the callers of `renderEmailComponent`, the
  vue-i18n inline module and the integration spec.
- **Verify:** the integration email specs, a production build whose Worker
  bundle still inlines `vue-i18n`, and one real email (password reset or
  verification) sent from a preview.

## @vite-pwa/nuxt

- **Held at:** 1.1.1.
- **Blocked:** major 2 (2.0.2 at the time of the batch).
- **Why:** `pnpm run dev` disables the PWA module, so no local check exercises
  the manifest or the push-only service worker, and this app has a history of
  Safari service-worker launch bugs (`docs/pwa-safari-dock-app-launch.md`).
- **Unblocks it:** a PR of its own with preview checks.
- **Verify:** on a PR preview, the manifest and service worker registration,
  push subscribe and a test push (`docs/push-notifications.md`), the
  build-freshness reload, Safari and the macOS Dock app, and the iOS
  home-screen PWA (AGENTS.md "iOS Simulator Testing").

## nuxt-studio

- **Held at:** 1.7.0.
- **Blocked:** everything above 1.7.0.
- **Why:** 1.8.0 shipped a 0-byte `dist/module/runtime/plugins/studio.client.d.ts`,
  which made TS2306 drop every `$plugin` injection type (for example
  `$sanitizeHtml`). 1.8.2 fixes the d.ts, but its `dist/module/module.mjs`
  imports `../../../dist/module/runtime/utils/media.js`, which resolves to a
  path outside the package; Nuxt loads the module only through its jiti
  fallback (`NUXT_B8023`). nuxt-content/nuxt-studio#597 (1.8.x external media
  items lose their public URL) is open.
- **Unblocks it:** a release that imports `media.js` from inside the package
  and fixes #597.
- **Verify:** `pnpm install` prints no `NUXT_B8023` warning for nuxt-studio,
  `ls -la node_modules/nuxt-studio/dist/module/runtime/plugins/` shows
  non-empty d.ts files, `pnpm run typecheck` passes, and a Studio edit with
  a media item works on a preview (`docs/landing-studio.md`).

## typescript

- **Held at:** 6.x (6.0.3).
- **Blocked:** major 7.
- **Why:** the native compiler port has no stable compiler API. vue-tsc, which
  drives `pnpm run typecheck`, has no TS7 support (vuejs/language-tools#5381),
  and typescript-eslint's peer range excludes TS7 and crashes at runtime if
  forced (typescript-eslint/typescript-eslint#12518). See PR #297.
- **Unblocks it:** releases of vue-tsc and typescript-eslint that support TS7.
- **Verify:** `pnpm run typecheck` (including the artifacts, documents and
  mail-alerts `tsc` projects) and `pnpm run lint`, in the root and in
  `modules/cookie-consent`.

## @types/node

- **Held at:** 24.x (24.19.2, also pinned by a workspace override).
- **Blocked:** major 26.
- **Why:** the types must match the Node 24 LTS runtime (`engines.node`, CI and
  the Workers `nodejs_compat` surface). `scripts/verify-node-types.mjs` runs as
  `preinstall` and fails the install on another major.
- **Unblocks it:** moving the runtime to a newer Node LTS.
- **Verify:** update the override, the direct pin and
  `scripts/verify-node-types.mjs` together, then a fresh install and
  `pnpm run typecheck`.

## Video.js workarounds

Not a held version: `@videojs/html` 10.5.0 is installed. Upstream has closed
three of the gaps that `docs/video-player.md` works around, so the
workarounds can go after device checks.

- **Closed upstream:** videojs/v10#1404 (configurable playback rates, closed
  2026-11-01), videojs/v10#1442 (timed metadata, closed 2026-11-11) and
  videojs/v10#1728 (configurable controls auto-hide delay, closed
  2026-10-08). videojs/v10#944 (persisted settings) is still open, so
  `useVideoPlayerPreferences` stays.
- **What can go:** the custom speed radio group in favor of the player's
  `defaultPlaybackRates`; the chapter workaround if timed metadata now covers
  chapter cue points; the `requestControlsLock()` hover lock if the auto-hide
  delay option covers it. Each removal follows "Upgrading" in
  `docs/video-player.md`.
- **Verify:** the player unit tests, the landing and guide e2e specs, and the
  checklist in `docs/video-player.md` on a PR preview in Chromium, Safari
  (including iPhone) and Firefox, with special care for the settings button on
  caption-less pages (the `publishMenuOptionState` seam).

## vue-router

- **Held at:** 5.4.0 (direct pin plus a workspace override).
- **Blocked:** 5.5.0 and later.
- **Why:** 5.5 keeps scroll positions in `sessionStorage["vue-router:scroll"]`,
  written at module scope whenever `history.scrollRestoration` is `manual`,
  keyed by history position plus the full path including the query string,
  with no option to turn it off. UTM parameters then persist in browser
  storage, which breaks the URL-only attribution rule (`docs/analytics-utm.md`)
  and adds a storage entry the Cookie Policy does not list.
  `tests/e2e/attribution/utm-signup.spec.ts` fails on a production build. nuxt
  4.6.4 itself pins vue-router 5.4.0; the override stops `@nuxtjs/i18n` from
  resolving a second 5.5 copy.
- **Unblocks it:** a vue-router option to disable or scope the persistence
  (for example a key without the query), or a decision on how the app keeps
  UTM parameters out of storage once Nuxt moves to 5.5.
- **Verify:** `utm-signup.spec.ts` and the consent specs on a production build,
  no `vue-router:scroll` string in `.output/public/_nuxt`, a single
  `vue-router` in `pnpm why vue-router`, and the override removed with the pin.

## @nuxtjs/color-mode

- **Held at:** 4.0.1.
- **Blocked:** 4.1.0 and later.
- **Why:** 4.1.0 writes `nuxt-color-mode` to localStorage from an idle callback
  after hydration (`onIdleAfterHydration` in `dist/runtime/plugin.client.js`)
  instead of during its plugin. `app/plugins/cookie-consent-gate.client.ts`
  purges the key once, synchronously at startup, so the key now appears for
  undecided visitors and after Reject all. `tests/e2e/cookies/consent.spec.ts`
  fails at lines 240 and 490 on a production build.
- **Unblocks it:** a consent gate that keeps the deferred write out of storage
  until preferences consent (for example by intercepting
  `setPreferenceToStorage`, or an upstream storage option), without a
  write-then-purge race.
- **Verify:** `consent.spec.ts` on a production build in CI mode, theme
  switching with and without preferences consent, and no theme flash on load.
