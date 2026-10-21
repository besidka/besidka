# Video player: Video.js v10 HTML custom elements

Besidka's two video players (the landing/guide player and the profile
key-guide player) render one shared Video.js v10 skin,
`app/components/Video/Shell.vue`, themed by
`app/assets/css/video-player-theme.css`. This replaced Plyr on 2026-10-21 in
commits `55d6bb80` (migration) and `3fcea638` (dev watcher fix). This doc is
the decision log and the architecture reference.

## Why Video.js v10, why now

- **Plyr is deprecated.** The repository announced the deprecation on
  2026-10-06 and now only receives security fixes
  (https://github.com/sampotts/plyr). Its author, Sam Potts, joined Mux, which
  stewards Video.js. The Plyr design philosophy carries into Video.js v10:
  https://www.mux.com/blog/sweating-the-pixels-how-plyr-s-design-philosophy-is-shaping-video-js-v10
- **Video.js v10 reached GA on 2026-10-01.** `@videojs/html` is pinned to
  `10.1.0` in `package.json`.
- Video.js ships an official Plyr migration guide:
  https://videojs.org/docs/framework/html/guides/migrate-from-plyr
  (version-matched copy at
  `node_modules/@videojs/html/docs/guides/migrate-from-plyr.md`). Its "Known
  gaps" section is the checklist behind most workarounds below.

## Decisions

### HTML custom elements, not a Vue wrapper

There is no `@videojs/vue` package. The Vue installation guide
(`node_modules/@videojs/html/docs/guides/installation-vue.md`) uses the HTML
custom elements (`<video-player>`, `<media-*>`) directly from a Vue app. The
Shadcn skin source that `@videojs/cli agents init` can copy into a project is
not offered for Vue, so the skin is composed by hand from the individual
`media-*` UI elements.

### A composed light-DOM skin, not the packaged `<video-skin>`

The packaged `<video-skin>` renders inside a shadow root and exposes only
eight CSS custom properties. Three requirements ruled it out:

- The owner required the look to stay identical to the Plyr player.
- The quality menu, the speed menu, the chapter titles and the thumbnail
  preview are custom UI that must live in the same DOM as the page CSS.
- DaisyUI tokens (`--color-accent`, `--color-base-*`, the `.bubble` glass
  style) have to reach every control.

`Shell.vue` is therefore a light-DOM composition of `media-*` elements. The
official HTML skin source (the shadcn registry entry at
https://shadcn.videojs.org/r/html/video.json) was used as the scaffold
reference for which elements and attributes a full video skin needs. All
selectors in `video-player-theme.css` are scoped under `.landing-player`
(the container class, kept from the Plyr theme).

## Components and contract

| File | Role |
|------|------|
| `app/components/Video/Shell.vue` | The skin. Renders `<video-player>` > `<media-container class="landing-player">`, the slot for the `<video>`, the controls, hotkeys and gestures, and an `overlay` slot |
| `app/components/landing/VideoPlayer.client.vue` | Landing/guide player (`LandingVideoPlayer`): full variant, qualities, captions, speed, chapters, thumbnails, `startAt`, demo/guide analytics, preferences |
| `app/components/Profile/Keys/GuideVideo.client.vue` | Profile key-guide player: lean variant, autoplay/visibility logic, PiP-aware pause, chapters, thumbnails, watch analytics |
| `app/composables/video-timeline.ts` | `useVideoTimeline`: chapters track, thumbnails track, snap-seek |
| `app/composables/video-player-preferences.ts` | `useVideoPlayerPreferences`: consent-gated persistence |
| `app/utils/videojs-elements.ts` | Registers elements, icons and the i18n override |
| `app/types/video-player.d.ts` | `VideoMenuOption`, `VideoShellReadyPayload` |

### `Video/Shell.vue`

Props:

| Prop | Type | Meaning |
|------|------|---------|
| `variant` | `'full' \| 'lean'` | `full`: remaining-time label, volume slider, captions button, settings menu (captions, quality, speed), AirPlay, all hotkeys. `lean`: play, timeline, mute, PiP, fullscreen and a reduced hotkey set (no volume/caption/speed controls) |
| `poster` | `string` | Passed to `<video-player>` |
| `containerClass` | `string` | Extra classes on the container (the landing player adds `js-landing-player shadow-xl`) |
| `qualities` | `VideoMenuOption[]` | Quality menu items; the Quality entry only renders with more than one |
| `selectedQuality` | `string` | Checked quality value |
| `speeds` | `VideoMenuOption[]` | Speed menu items |
| `selectedSpeed` | `string` | Checked speed value |

Emits:

| Event | Payload | When |
|-------|---------|------|
| `ready` | `{ player, timeSlider }` | The elements are defined and the player store is attached to the `<video>` (`store.target`) |
| `failed` | none | The dynamic import of the elements threw. Both players then fall back to native controls |
| `selectQuality` | `value: string` | A quality radio changed |
| `selectSpeed` | `value: string` | A speed radio changed |

Slots: default (the `<video>` element, with its `<track>` children) and
`overlay` (rendered after the controls; the landing player puts its loading
poster/skeleton there).

The `ready` signal has a 4 s fallback (`ATTACH_TIMEOUT_MS`) so the loading
overlay can never stick if the store never reports a target.

Interaction wiring owned by the shell: tooltips on every button, hotkeys
(`Space`/`k`, `m`, arrows, `j`/`l`, `0-9`, `Home`/`End`, `f`, `c`, `i`),
mouse tap toggles pause, touch tap toggles the controls, center double tap
toggles fullscreen.

### Players

- **`LandingVideoPlayer`** binds analytics and `startAt` directly to native
  `<video>` events (`play`, `timeupdate`, `pause`, `ended`, `loadedmetadata`,
  `ratechange`). `preload="metadata"`, `crossorigin="anonymous"` for the
  caption tracks. Quality renditions come from the `video.qualities`
  frontmatter; changing quality swaps `src` and restores position, paused
  state and rate on `loadedmetadata`. Speeds are `0.5, 0.75, 1, 1.25, 1.5, 2`.
- **`ProfileKeysGuideVideo`** is `muted loop playsinline preload="none"` and
  keeps its visibility/autoplay/PiP logic; see `docs/key-guides.md`. It does
  not persist preferences.

Both only render client-side (`.client.vue`).

## Element registration

`Shell.vue` registers everything with a dynamic import in `onMounted`:

```ts
await import('~/utils/videojs-elements')
await customElements.whenDefined('video-player')
```

`app/utils/videojs-elements.ts` imports each `@videojs/html/ui/*` element
side-effect module, registers the default icon set used by the skin with
`registerIcons('default', ...)`, and overrides the captions Off label with
`registerI18n('en', { menu: { off: 'Disabled' } })`.

Vue must not try to resolve `media-*` tags as components. `nuxt.config.ts`
declares `vue.compilerOptions.isCustomElement` as a lookup in an explicit
`videoJsElements` Set. The Video.js docs forbid prefix rules such as
`tag.startsWith('media-')`, so the list is explicit.

**Rule: adding a new `media-*` (or `video-*`) tag requires adding it in both
places**: an import in `app/utils/videojs-elements.ts` and an entry in the
`videoJsElements` Set in `nuxt.config.ts`. Missing the Set entry makes Vue warn
about an unresolved component; missing the import renders an inert unknown
element.

## Video.js gaps and our workarounds

| Gap in Video.js v10.1.0 | Workaround |
|-------------------------|------------|
| Plain MP4 renditions get no quality menu (HLS/Mux/DASH only) | Custom `media-menu-radio-group` fed by `qualities`; the player swaps `src` and restores time, paused state and rate |
| Fixed speed list (0.2 ... 2), custom list unsupported ([#1404](https://github.com/videojs/v10/issues/1404)) | Custom `media-menu-radio-group` with `0.5 ... 2`; the rate is set on the native `<video>` (`playbackRate` and `defaultPlaybackRate`) |
| No built-in preference persistence ([#944](https://github.com/videojs/v10/issues/944)) | `useVideoPlayerPreferences`, below |
| Chapters need a default `<track kind="chapters">`; cue-point pins not implemented ([#1442](https://github.com/videojs/v10/issues/1442)) | Chapters are a Blob-URL WebVTT track built from `video.markers`. The slider renders them as segments with gaps instead of Plyr's accent pins. A click within a snap radius of a chapter start seeks to the exact start (see below) |
| No hover-thumbnail source other than a VTT thumbnails track | Blob-URL WebVTT storyboard with `#xywh` cues pointing at the mediabunny sprite |
| No full-window fullscreen fallback | Native element fullscreen only. On iPhone Safari the video's native fullscreen presentation takes over with system controls, which matches Plyr's `iosNative` behavior |
| Controls auto-hide delay not configurable ([#1728](https://github.com/videojs/v10/issues/1728)) | While a mouse pointer is over the control bar, the shell holds `store.requestControlsLock()` and releases it on `pointerleave`, so the bar and the preview never hide under the pointer (as in Plyr). Touch pointers are ignored |
| Captions: tracks flagged `default` show on load | Caption `<track>`s carry no `default`, so captions start off. The Off option reads "Disabled" through `registerI18n` |

### Chapters, thumbnails and snap-seek

`useVideoTimeline` owns three things:

- **Chapters.** `buildChaptersVtt(markerPoints)` creates a WebVTT document;
  each chapter ends at the next one and the last is open-ended
  (`359999` s, clamped by the player to the media duration). The Blob URL is
  the `src` of a `<track kind="chapters" default>`.
- **Thumbnails.** The mediabunny sprite from `useLandingVideoThumbnails` is
  generated once, on the first `pointerenter` or `focusin` on the time slider
  (never on mount or play; see `docs/landing-studio.md`). `buildThumbnailsVtt`
  then emits one cue per tile with `<sprite url>#xywh=x,y,w,h`, exposed as a
  `<track kind="metadata" label="thumbnails" default>`. Generation takes an
  `AbortSignal`; dispose aborts it, revokes both Blob URLs and cleans the
  sprite. Playback never waits on it.
- **Snap-seek.** On `pointerup` (less than 6 px from `pointerdown`) the click
  position is mapped to a time; if the nearest chapter start is within
  `max(0.4 s, 4% of duration)` the video seeks to that start. The seek is
  deferred with `setTimeout(0)`, after the slider's own pointer handling.

`enableMetadataTracks` flips `chapters` and `metadata` tracks from `disabled`
to `hidden` so the cues load without rendering as captions.

### Preferences and consent

`useVideoPlayerPreferences` persists `{ volume, muted, speed, quality,
captions: { enabled, language } }` as JSON under the localStorage key
`video-player`. The key is declared in the `preferences` category of the
consent manifest in `nuxt.config.ts` (`id: 'video-player'`) and listed in the
cookie policy and `i18n/locales/cookie-consent.*.ts`.

- Reads and writes are gated on `useCookieConsent().isAllowed('preferences')`
  and re-gated through `onConsentChange`: a grant writes immediately, a deny
  removes the key. The composable owns this gating itself and does not go
  through `usePreferenceStorage()`.
- Values are validated with `parseVideoPlayerPreferences`; anything malformed
  is ignored.
- Restore happens once, after the store has a `target`. Captions restore when
  the first caption track list arrives.
- Speed is read from the native `<video>`, not from the store, because the
  store keeps a stale `playbackRate` after a source switch.
- The legacy Plyr key is removed on mount by
  `removeLegacyPlyrPreferences()` (`localStorage.removeItem('plyr')`). The
  `plyr` manifest entry was replaced by `video-player`, so the consent cleanup
  routine no longer covers `plyr`; this on-mount removal is what clears old
  values. See `docs/cookie-consent.md`.

## Fragile seams: re-check on every `@videojs/html` upgrade

1. **`publishMenuOptionState`.** Video.js radio groups propagate option state
   up to the settings trigger and would hide the gear button on pages with no
   caption tracks (the captions group reports unavailable). The shell calls
   `publishMenuOptionState(false, false, 'available')` on each
   `.js-video-custom-options` group (quality, speed) on define, on attach and
   whenever the selection or quality list changes. This method is undocumented.
   If a release renames it or changes the propagation, the settings button
   vanishes on caption-less pages (the key guides).
2. **`<template>` content through `v-html`.** `media-time-slider-chapters` and
   `media-captions-radio-group` clone `template.content`. Vue children of a
   `<template>` element do not populate `.content`, so the item templates
   (`CHAPTER_TEMPLATE`, `RADIO_ITEM_TEMPLATE`) are strings set with `v-html`.
   This produces two accepted `vue/no-lone-template` lint warnings.
3. **Stale store `playbackRate`.** After a `src` switch the store's
   `playbackRate` does not follow the media. Speed UI and persistence read the
   `<video>` directly. Re-test once the store tracks `ratechange` reliably.
4. **Store `target` as the ready signal.** `ready` relies on `store.target`
   and `store.subscribe`. Re-check them against the changelog.
5. **Cue-point and slider internals.** Segment gaps, the slider preview and the
   `data-controls-visible` caption shift in the theme target current element
   structure and attributes.

## Dev server: `tsconfig.json` `watchOptions`

Nuxt runs two `vite-plugin-checker` vue-tsc watch programs in dev (client and
SSR). TypeScript's default watcher opens one `fs.watch` handle per program
file. With the Video.js type graph (about 900 `.d.ts` files) the dev process
crossed roughly 10.6k open descriptors, past Darwin's `OPEN_MAX` of 10240.
miniflare's workerd spawn then failed with `spawn EBADF`, the wrangler
bindings proxy never started, and every page returned 500 "DB binding
missing".

`tsconfig.json` excludes `node_modules` from the watchers:

```json
{
  "watchOptions": {
    "excludeDirectories": ["**/node_modules"],
    "excludeFiles": ["**/node_modules/**"]
  }
}
```

This drops the dev process to about 3.4k descriptors. App sources are still
watched and re-checked; a change inside `node_modules` (after an install)
needs a dev-server restart, as before. If a similar `EBADF` or "DB binding
missing" failure shows up after adding another type-heavy dependency,
measure open descriptors for the dev process before suspecting miniflare.

## Agent skill and bundled docs

- The Video.js agent skill is vendored at `.agents/skills/videojs/SKILL.md`
  (with `references/`). Read it before changing the player.
- Version-matched docs ship in the package:
  `node_modules/@videojs/html/docs/llms.txt` indexes the guides and the API
  reference as relative `.md` links. Prefer these over the live site; they
  match the installed version.
- To refresh the skill or re-check install guidance, run
  `pnpm dlx @videojs/cli agents init` (prints version-matched instructions
  without changing files). Use `pnpm`, not `npx`, in this repository.

## Upgrading

1. Bump `@videojs/html` in `package.json` (kept as an exact version) and run
   `pnpm install`; respect the pnpm `minimumReleaseAge` policy.
2. Read the new `node_modules/@videojs/html/docs/guides/migrate-from-plyr.md`
   "Known gaps" and the changelog. For each gap issue
   (#944, #1404, #1442, #1728, plus the full-window fullscreen fallback), if
   it is fixed, delete the matching workaround and its row above.
3. Diff the shadcn registry skin (https://shadcn.videojs.org/r/html/video.json)
   against `Shell.vue` for renamed elements, attributes or parts.
4. Go through the fragile seams above.
5. Run `pnpm run format && pnpm run typecheck`, the player unit tests and the
   landing/guide e2e specs, then check a PR preview in Chromium, Safari
   (including iPhone) and Firefox: controls, chapters, thumbnails on hover,
   settings menu on a page with and without captions, fullscreen, PiP, and
   preference restore after consent.
6. Confirm `pnpm run dev` still serves pages after the upgrade (the `EBADF`
   failure above shows up there first).

## Revert criteria

Plyr is deprecated and receives security fixes only, so reverting to it is a
last resort. Reconsider only if a Video.js release breaks a seam above with no
fix on the release train and the breakage blocks playback in a supported
browser. Reverting means `git revert 55d6bb80`, re-adding `plyr` to
`package.json` and `pnpm-workspace.yaml`, and restoring the `plyr` consent
manifest entry. The individual workarounds, by contrast, should be removed
as soon as the upstream issues close.
