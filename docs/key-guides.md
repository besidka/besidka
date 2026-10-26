# Key guides

Every provider card on `/profile/keys` can show a "How to get a key" guide: a
short video, four to seven steps, a "What you need" block and a button that
opens the provider's console. The text lives in Nuxt Content, one Markdown
file per provider. The same file is also the public SEO page at
`/guides/<slug>` (`app/pages/guides/[slug].vue`, TechArticle and VideoObject
JSON-LD, sitemap, footer links); that route, its SEO rules and the
`/guides` prefix are documented in `docs/seo.md` ("Public key guides"). Do not
put key guides in the `guides` collection: that one holds the `/byok` and
`/memory` explainers and stays capped (see `docs/seo.md`).

Related docs: `docs/seo.md` (public route, sign-up `next` redirect),
`docs/landing-studio.md` ("Demo video player", the R2 video route),
`docs/analytics-utm.md` (the two guide events).

## Content

One file per provider in `content/key-guides/<slug>.md`, where the slug is
query-shaped and ends in `-api-key` (`gemini-api-key.md`,
`openrouter-api-key.md`). The slug is the public URL `/guides/<slug>`; the
`provider` frontmatter ties the file to a card. Provider ids come from
`shared/utils/provider-meta.ts`: `anthropic`, `google`, `openai`, `xai`,
`deepseek`, `moonshotai`, `qwen`, `brave`, `exa`, `vercel`, `openrouter`,
`cloudflare`, `typesafe`. The collection is `keyGuides` in
`content.config.ts`, type `page`, source `key-guides/*.md` with
`prefix: '/guides'`.

`typesafe-ai-api-key.md` is the TypeSafe AI guide for the **Smart checks**
tab (`kind: 'memory-check'`, see `docs/memory-architecture.md` 3.19). It has
no `video` block yet, and its card, free-tier and sign-up facts were not
verifiable from TypeSafe AI's public pages on 2026-10-26, so the guide states
only what the official docs say. Re-check the console flow and button labels
before recording the video.

The field schema lives in `shared/utils/key-guide-schema.ts` together with
the `httpsUrl` and `siteRelativeOrHttpsUrl` helpers. `content.config.ts`
imports it and adds only `sitemap: defineSitemapSchema()`. It is not inline in
`content.config.ts` so `tests/unit/content/key-guides.spec.ts` can validate
the same schema: importing `content.config.ts` itself fails under Vitest. That
spec checks every `content/key-guides/*.md` file: the `-api-key` slug, a known
`provider`, at most one guide per provider, and that the frontmatter parses
against the schema. `tests/unit/config/content-frontmatter.spec.ts` also
covers these files (title, description and summary stay strings).

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | string | Page title and H1 on `/guides/<slug>` |
| `description` | string | Meta description and social text |
| `provider` | enum | Provider id from `providerMeta`. One guide per id |
| `summary` | string, optional | One line above the steps on the keys page |
| `updatedAt` | string | ISO date the guide last changed. `dateModified` and sitemap `lastmod` |
| `checkedAt` | string | ISO date the facts were verified. Shown as "Checked <date>" |
| `keyUrl` | https URL | Console page where the key is created |
| `keyUrlLabel` | string, optional | Full button text, e.g. "Open Google AI Studio keys page". Falls back to "Open <provider label> keys page" on the keys page |
| `requirements.card` | boolean | Whether a payment card is needed to start |
| `requirements.cardNote` | string, optional | Plain-language card answer shown instead of Required / Not required |
| `requirements.minimumTopUp` | string, optional | Smallest prepaid top-up |
| `requirements.freeTier` | string, optional | What the free tier offers |
| `requirements.sources` | `{ label, url }[]` | Official https pages the facts come from |
| `faq` | `{ question, answer }[]`, optional | FAQ accordion shown only on `/guides/<slug>`, after the key button and before the Besidka CTA. Not shown on the keys card. Answers are Markdown. No `FAQPage` JSON-LD is emitted |
| `video.src` | path or https URL | `/videos/key-guide-<id>.mp4`, with `?v=<n>` once the file has been replaced (see "Replacing a video or poster") |
| `video.poster` | path or https URL | `/key-guides/<id>.webp`, with the same `?v=<n>` |
| `video.qualities` | `{ src, size, label? }[]` | Quality menu renditions, same shape as `video.qualities` in `content/index.md`: 1080, 720 and 360. The 720 entry is the same URL as `video.src`, query included. Without entries the player has one source and no Quality menu. See "Renditions" |
| `video.duration` | ISO 8601 | e.g. `PT34S`, for VideoObject |
| `video.uploadDate` | string | `YYYY-MM-DD` (read as 00:00 UTC) or a full ISO 8601 datetime with `Z` or `±hh:mm`. Emitted as a datetime with an offset, see `docs/seo.md` |
| `video.caption` | string, optional | Visible caption under the player on `/guides/<slug>`, also the VideoObject name |
| `video.alt` | string, optional | What the video shows. Accessible name of the poster and player on the keys page |
| `video.captions` | `{ src, label, srclang, default? }[]` | WebVTT tracks for the public page player |
| `video.markers` | `{ time, label }[]` | Chapter markers, same shape as `video.markers` in `content/index.md`. `time` is `m:ss`, `mm:ss` or `h:mm:ss`. Shown on the progress bar of both players, labelled in the hover preview, and emitted as `Clip` entries in `VideoObject.hasPart` (each ends at the next marker or the video duration, and its `url` is the guide URL plus `?t=<start seconds>`, which `/guides/<slug>` honors by starting the player there) |

Omit `video` entirely when there is no real video yet: VideoObject JSON-LD is
only emitted when it is set, and the keys page then shows no video block.

The Markdown body is the ordered steps list plus optional short notes, such as
the Google free-tier data-use caveat or the "when a gateway makes sense"
sentence. It is rendered with `ContentRenderer` and the project prose styles
on both pages. That is why the FAQ is a frontmatter field and not part of the
body: a body section would also render on the keys card, and the FAQ is meant
for the public page only.

`content/key-guides/gemini-api-key.md` and `openrouter-api-key.md` carry
verified copy. When a console flow or a price changes, re-verify the facts
against `requirements.sources` and bump `checkedAt` and `updatedAt`.

After a schema change (the `video.qualities` field was one), reset the local
content database, or Studio fails with
"table _content_keyGuides has N columns but M values":

```bash
rm -f .data/content/contents.sqlite
```

If `no such table _content_*` appears in dev, `rm -rf .data/content` and
restart.

## Video and poster

- Videos are served from the `CMS_BUCKET` R2 bucket by
  `server/routes/videos/[name].ts` as `key-guide-<id>.mp4`,
  `key-guide-<id>-1080.mp4` and `key-guide-<id>-360.mp4`. The allow-list is
  explicit and derived from the `providerMeta` ids (12 ids, 3 files each), so
  any other name, such as `-720` or `-480`, is a 404. The route keeps its
  single-read, range and conditional-request behavior.
- Put the encoded files in `.files/` (gitignored) and run
  `pnpm run cms:files:upload`. Every `.files/key-guide-<id>.mp4`,
  `key-guide-<id>-1080.mp4` and `key-guide-<id>-360.mp4` that exists is
  validated with mediabunny like the demo renditions and uploaded. A missing
  one is not an error. `cms:files:download` only pulls the known demo assets,
  not the guides. Encode like the demo: H.264, `yuv420p`, fixed 2-second GOP,
  `+faststart`. The player autoplays muted and loops, so no audio is needed.
- Encode recipe: see the encoding section of `docs/landing-studio.md`. The
  key-guide renditions were encoded with mediabunny and `@mediabunny/server`
  because the local Homebrew ffmpeg was broken.
  The 1080 and 360 renditions were encoded on 2026-10-22 from the 1080
  masters (`key guides 2026-10/finals/key-guide-<id>-1080.mp4` in iCloud). The
  720 `key-guide-<id>.mp4` files are the earlier encodes and were not
  re-encoded. Settings, same for every guide:
  - Codec: libx264 High profile, `yuv420p`, preset `slow`, tune `animation`,
    no audio.
  - Quality: CRF 21 for 1080 (about 1.3 to 1.8 Mbps) and CRF 26 for 360
    (640x360, about 115 to 160 kbps). CRF, not a bitrate target, so flat UI
    frames stay small and busy ones get what they need.
  - GOP: `keyint=60:min-keyint=60:scenecut=0`, a fixed 2-second GOP at 30 fps,
    so every rendition has keyframes at the same timestamps and a quality
    switch can resume cleanly.
  - Scaling: lanczos. Colour tags are set explicitly to bt709 limited range,
    because the scale filter dropped them otherwise and players then guessed.
  - Container: faststart (moov before mdat), so playback and range requests
    start without reading the tail of the file.
  - 360p legibility: headlines and buttons are readable, fine UI text is soft.
    It is a low-bandwidth fallback, not a reading rendition.
- Tooling: mediabunny 1.55.3 with `@mediabunny/server` 1.62.0 (node-av 6.1.1,
  its postinstall build is not approved) running in Node. Stock
  `@mediabunny/server` encodes with x264 `medium` and exposes no CRF or
  scenecut control, so the encode script monkeypatches node-av in-process:
  `CodecContext.open2` for the x264 options and `FilterGraph.parsePtr` for the
  lanczos scaler. `hardwareAcceleration: 'prefer-software'` keeps it off
  VideoToolbox. The scripts (`encode.mjs`, `encode-all.sh`,
  `validate-all.mjs`, `inspect.mjs`, `still.mjs`, `color.mjs`) are kept in the
  main checkout's gitignored `.files/encode-scripts/`, not in git.
- Upload: `pnpm run cms:files:upload --remote -e preview`, then
  `-e production --yes`. The 24 new objects (12 guides, 1080 and 360) were
  uploaded on 2026-10-22; existing objects are skipped without `--force`.

### Renditions

Each guide has three files, picked from the quality menu on both surfaces:

| Height | File | Where it is in the frontmatter |
| --- | --- | --- |
| 1080 | `key-guide-<id>-1080.mp4` | `video.qualities`, no query |
| 720 | `key-guide-<id>.mp4` | `video.src` and `video.qualities`, with `?v=<n>` if replaced |
| 360 | `key-guide-<id>-360.mp4` | `video.qualities`, no query |

The 720 file keeps the original name so every existing URL, R2 object and
cached copy stays valid. It is also what the hover-preview thumbnails always
use, whatever rendition is playing. `tests/unit/content/key-guides.spec.ts`
pins the three entries per guide and that the 720 one equals `video.src`.
`video.src` stays required: it is the JSON-LD `contentUrl` and the single
source for a guide without `qualities`.

The starting rendition is chosen at mount by `pickInitialQuality` (player
width, pixel ratio, data saver, slow network) and falls back to 720; see
"Starting quality" in `docs/video-player.md`. The pick is never saved: only the
`/guides/<slug>` player shares the `video-player` preference with the home
page (a deliberate menu pick is stored there), while the `/profile/keys`
player persists nothing.

A rendition replaced later is versioned on its own entry
(`/videos/key-guide-<id>-1080.mp4?v=2`); the query is harmless for the same
reasons as on the 720 file below.
- Posters are committed at `public/key-guides/<id>.webp`, 16:9, taken from
  the paste step of the recording. The component tolerates a missing poster
  and shows a plain box.

### Replacing a video or poster

The video route answers with `Cache-Control: public, max-age=86400` and the
posters are static public files, so a replaced file under the same URL can
stay stale in browsers and at the edge for a day. Version the URLs in the
guide frontmatter instead of renaming files: bump `?v=<n>` on both
`video.src` and `video.poster` (`/videos/key-guide-<id>.mp4?v=3`,
`/key-guides/<id>.webp?v=3`) in the same change that replaces either file,
and on the 720 entry of `video.qualities`, which must stay identical to
`video.src` (a `-1080` or `-360` file is versioned on its own entry only),
and upload the new mp4 with `pnpm run cms:files:upload --force`. A guide
that was never replaced has no query.

The query is harmless everywhere it flows. Router params never contain it, so
`server/routes/videos/[name].ts` still resolves `key-guide-<id>.mp4` against
the allow-list and the R2 key. `siteRelativeOrHttpsUrl` only checks the start
of the value. The `VideoObject` `contentUrl` and `thumbnailUrl` are resolved
with `new URL()` and stay valid absolute URLs with the query. The players use
`src` as an opaque URL: the Video.js player, the `<video>` element and the mediabunny
hover-preview thumbnails (`new URL(src, location.href)` then `UrlSource`) all
keep it. Analytics derive the provider from the `provider` prop, never from
the filename. `tests/unit/content/key-guides.spec.ts` pins the shape: the
file name must match the provider id, the query may only be `?v=<digits>`,
and the poster file must exist.

## Where it renders

- `app/pages/profile/keys.vue` loads every guide once with `useAsyncData` and
  `queryCollection('keyGuides').all()`, keys them by provider, and passes each
  card its `guide`. No guide for a provider means no disclosure.
- `app/components/Profile/Keys/Guide.vue` is one `<details>` below the key form
  and Save/Delete row, so the key input stays at the top of the card on
  mobile. It takes `provider`, `doc` and `status`. The status comes from the
  card, not from `useUserKeys()`, because the Cloudflare card derives its own
  status from its endpoint.
- Default state: server-rendered and hydrated closed. It opens once the key
  status resolves to missing and stays closed when saved. The first resolved
  status wins. A user toggle is never overridden. The status is `unknown`
  during hydration (`ProviderKeyCard.vue` reads `useNuxtApp().isHydrating`),
  because the user-keys summary can already be loaded by the time the lazy
  card hydrates and would otherwise cause a hydration mismatch. On an in-app
  navigation the cached summary is used on the first render, so the badge and
  the guide state do not flash.
- `Card.vue` binds `open` directly, so an explicit `?provider=` card is
  server-rendered open with no layout shift. It emits `expandedChange` on
  mount, on an `open` prop change and on every native `toggle`; the key cards
  pass it up and give the guide `card-open`. The guide counts as visible when
  the card is open and the guide is open.
- `app/components/Profile/Keys/GuideVideo.client.vue` is a lean Video.js v10
  player (it also plays the optional `/memory` explainer video: pass
  `explainer="memory"` instead of `provider`, and it sends `guide_video_play`,
  see `docs/analytics-utm.md`): the shared `Video/Shell.vue` skin with `variant="lean"` and the
  `.landing-player` theme (see `docs/video-player.md`). It is not
  `LandingVideoPlayer`: that one hard-codes the demo analytics, captions and
  preference persistence. It shares the chapter
  markers and the lazy hover-preview thumbnails with it through
  `useVideoTimeline` (a Blob-URL chapters track and a Blob-URL storyboard
  track); frames are generated on the first time-slider hover or focus, never
  on mount, and the markers appear once the video has loaded its metadata
  (`preload="none"`). The control bar has a picture-in-picture button
  (`media-pip-button` covers Chromium's PiP API and Safari's presentation
  mode; `disablepictureinpicture` must never be set on the `<video>`). While it is in PiP the scroll-out pause is
  skipped, and it pauses once PiP closes with the box off screen. The poster
  `<img loading="lazy">` shows first. The player mounts only once the guide is
  open and the video box is within 300px of the viewport, observed against the
  `.js-page-content` scroll container. It autoplays muted and looping when at
  least half visible, and pauses when out of view or after the user pauses. It
  never autoplays under `prefers-reduced-motion: reduce` or
  `navigator.connection.saveData`. Then the poster and a play button show. If
  the `<video>` fires `error` (missing file, 404), the player emits `failed`,
  `Guide.vue` unmounts it and shows the poster with the note "Video
  unavailable. Follow the steps below.". The settings menu has Quality
  (1080p, 720p, 360p) above Speed. A quality switch swaps `src` and restores
  time, rate and play state (`useVideoQuality`, shared with the home player);
  a muted autoplay keeps playing, and the pause, `play` and `playing` events
  it causes are ignored by the autoplay, offscreen and analytics bookkeeping
  until the resumed `play()` settles, so a switch is never counted as a user
  play or pause. The poster `alt` carries the
  `video.alt` accessible name; the player's `<video>` uses the same label.
- The steps text is the full alternative to the video.

## Deep link contract

`/profile/keys?provider=<id>` accepts the same ids as `resolveSafeNextPath` in
`shared/utils/auth-redirect.ts`: an enabled direct provider (providers tab),
an enabled gateway (gateways tab) or an enabled search provider (search tab).
Anything else, including inherited object keys such as `__proto__` and
`constructor` (`Object.hasOwn` guard), is ignored. The page expands that card
and scrolls it to the top of the `.js-page-content` scroller. The target
`<li>` carries `data-testid="key-provider-target"` for tests. It has no
`scroll-margin-top`: the re-alignment below measures drift from the scroller
top, so a scroll margin would read as permanent drift.

The scroll starts only after the target card has rendered and reported itself
expanded (`expandedChange`), so it works on a hard load and when the lazy card
mounts late after an in-app navigation. The router's own scroll-to-top and
late layout above the card (the async Cloudflare card) would undo a single
scroll, so the page keeps re-aligning the card, on list resize and on scroll
drift, until the user wheels, touches, presses a key or clicks, or two seconds
pass. `provider` wins over `?tab=`. `?tab=` still works alone;
`app/composables/chat-input.ts` links to `?tab=search`.

With neither query and no saved key at all, the page opens the providers tab
and expands the Google card. That decision waits for hydration to finish, so
this is the only case where a card expands after mount.

A signed-out visitor who opens `/profile/keys?provider=google` is sent to
`/signin?next=/profile/keys?provider=google` by
`app/middleware/00.auth.global.ts`, and sign-in, sign-up, OAuth, passkey and
2FA return to it. The middleware only adds `next` when `resolveSafeNextPath`
accepts the page and it is not the default `/chats/new`; other protected pages
still go to bare `/signin`. The full `next` contract is in `docs/seo.md`
("Sign-up redirect (`next`)").

## Analytics

`key_guide_open` fires once per provider per visit to the keys page when the
guide is open and its card is expanded. The condition comes from explicit
state, not from a native `toggle` event, so a card server-rendered open still
reports. It carries `trigger` `auto` (value `0`, the guide opened because the
key is missing) or `user` (value `1`, the user expanded the guide).
`key_guide_video_play` fires on the first `playing` for each of two
values per provider and visit: `0` for autoplay and `1` when the user started
it, so an autoplay does not hide a later user play. Both use `target` =
provider id and no personal data. The events endpoint rejects a `target` that
is not a provider id. Columns and queries are in `docs/analytics-utm.md`.
