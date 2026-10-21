# Campaign attribution and activation funnel

This doc covers how Besidka measures which campaign link brings a user in, and
whether that user reaches the next steps: sign up, add a first provider key,
send a first chat message. It records what is tracked, where it lands, how to
query it, and why it is built without a cookie.

Related docs: `docs/cookie-consent.md` (analytics consent rules),
`docs/axiom-map-fields.md` (the `attributes` map field),
`docs/legal.md` and the Privacy and Cookie Policies in `content/legal/`.

## What is tracked

Four events form the funnel.

| Event | Fires when | Where it is written |
| --- | --- | --- |
| `landing_page_view` | The landing layout mounts in the browser | Analytics Engine, Axiom |
| `signup_completed` | Better Auth creates a user | Analytics Engine, Axiom, D1 ledger |
| `first_provider_key_added` | A user saves their first chat-provider key | Analytics Engine, Axiom, D1 ledger |
| `first_chat_message` | A user's first assistant message is persisted | Analytics Engine, Axiom, D1 ledger |

The other landing events (`cta_click`, `header_cta_click`, `footer_link_click`,
`video_play`, `video_complete`, `video_watch`, `github_click`,
`new_chat_created`) still write
to Analytics Engine. They are not part of the funnel. `new_chat_created` is not
`first_chat_message`.

Two more landing-family events measure the "How to get a key" guides on
`/profile/keys` (`key_guide_open`, `key_guide_video_play`). They are not part
of the funnel either. See "Key guide events" below. Video viewing time
(`video_watch`) and key saves (`attributes.keys`) are described in "Video
and key events in Axiom".

### Where the data lives

| Store | Name | Contents | Exact or sampled |
| --- | --- | --- | --- |
| Workers Analytics Engine | `besidka_cms_events` (production), `besidka_cms_events_preview` (previews) | Aggregate counters. No user id, email or IP. | Sampled |
| Cloudflare D1 | `user_attribution` | One row per user who arrived through a campaign link: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `created_at` | Exact |
| Cloudflare D1 | `user_activation_events` | Idempotency ledger. One row per (`user_id`, `event`), plus `provider` and `created_at` | Exact |
| Axiom | `besidka-prod` | Wide events with `analytics.event`, `attributes.utm.*`, `attributes.activation.provider`. The first-chat event is its own small wide event with a flat `userId`. | Exact within retention |

Both D1 tables reference `users.id` with `ON DELETE CASCADE`. Deleting an
account deletes its attribution row and its ledger rows.

Axiom is at its 256-field limit. The only flat field added is
`analytics.event`, which already existed. Everything else sits under the
`attributes` map field, so it adds no schema fields. Read
`docs/axiom-map-fields.md` before adding another field.

## Sanitizer rules

`shared/utils/utm.ts` is the single sanitizer. The client, the events endpoint
and the auth hook all use it.

- It reads only `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`.
- It trims and lowercases each value.
- A value must match `/^[a-z0-9._-]+$/` and be 1 to 64 characters long.
- A value that fails is dropped. The sanitizer does not strip characters or
  repair the value.
- An empty result means no attribution. Nothing is stored for that visit.

Use values that already match: `utm_campaign=launch-2026-10`,
`utm_source=reddit`, `utm_medium=social`. A value like `Launch 2026` or
`a/b` is dropped.

## How the campaign reaches the sign-up

No cookie, localStorage or sessionStorage is used. The campaign travels in
the URL and in in-memory client state only.

1. A visitor opens `https://besidka.com/?utm_source=reddit&utm_campaign=launch`.
2. `/` is cached with SWR, so the server render never reads the query. A client
   plugin reads `window.location.search` after hydration and keeps the
   first-touch value in `useState('utm-attribution')`. A later value never
   overwrites it.
3. The landing layout sends `landing_page_view` to `POST /api/v1/events` with
   the sanitized `utm` object. The server re-sanitizes it and writes blobs 6
   to 9.
4. After hydration, the call-to-action links to `/signup` and `/signin` add
   the `utm_*` keys. The sign-in and sign-up pages link to each other the same
   way.
5. Email sign-up passes `callbackURL: /signin?utm_...`. Social sign-up and
   sign-in (Google, GitHub) pass `callbackURL: /chats/new?utm_...`.
6. Better Auth runs `databaseHooks.user.create.after` in
   `server/utils/auth.ts`. The hook reads the UTM from
   `context.body.callbackURL`. If that has none, it reads the OAuth state's
   `callbackURL` through `getOAuthState()`.
7. On previews, `oAuthProxy` wraps the original callback in a nested
   `callbackURL` query parameter. `extractUtmFromUrl` follows one level of
   nesting, so previews attribute correctly.
8. The hook inserts the `user_attribution` row (only when a UTM is present),
   claims the `signup_completed` ledger row, and writes the Analytics Engine
   point and the log fields.

After sign-up the visitor does not always land on `/chats/new`: a `next`
parameter on `/signup` or `/signin` (see `docs/seo.md`) may send them to the
keys page instead, for example from a key guide. The UTM stays top-level
(`utm_*` keys on the sign-up URL, never inside `next`), so attribution is
unaffected.

If the visitor reaches `/signup` without a campaign link, there is no row. No
row means no campaign. Reports show those users as `none`.

### Link recommendations

Point campaign links at `/`. Only the landing layout fires
`landing_page_view`, so a campaign link to `/signup` skips the visit count.
The sign-up still gets attributed, because the UTM is in the URL it lands on.

## Activation semantics

Each activation event fires at most once per user. The ledger enforces it.

- The code runs `INSERT ... ON CONFLICT DO NOTHING RETURNING user_id` on
  `user_activation_events`. It emits the event only when a row comes back.
  The primary key is (`user_id`, `event`).
- **Only accounts created after this feature ships are tracked.** The
  `signup_completed` ledger row marks an account as tracked. The key and chat
  events fire only for users who have that row. Accounts that existed before
  the feature get no ledger rows and emit nothing, so they never count as a
  first key or a first chat. There is no history check; the ledger row is the
  whole guard.
- `first_provider_key_added` fires on the first insert of a chat provider or
  gateway key. Brave and Exa keys are search keys, not chat providers, and do
  not count.
- `first_chat_message` fires after the assistant message is persisted and the
  answer finished without an error. A failed or interrupted answer does not
  count and does not use up the once-per-user claim. `provider` is the
  provider that answered.
- Attribution for activation events comes from `user_attribution`, read by
  user id. A user without a row reports `none`.
- No call in this path can fail a sign-up, a key save or a chat. Each one is
  wrapped. A failure logs only `attributes.analytics.error` and
  `attributes.analytics.event`. It never sets the flat `analytics.event`, so a
  failure is never counted as an event.
- The `first_chat_message` Axiom event is a separate small wide event with the
  flat `userId`, `analytics.event`, `attributes.utm.*` and
  `attributes.activation.provider`. It is not part of the AI cost event.

Every ledger row belongs to a tracked account, so any query over the ledger
covers tracked accounts only. Users from before the feature appear in none of
these numbers.

## Analytics Engine blob layout

The two event families share one dataset and use the same blob columns for
different things. **`blob2` to `blob5` mean different things per event. Always
filter on `index1` or `blob1` first.** The write sets `indexes: [event name]`,
so `index1` and `blob1` hold the same value.

| Column | Landing events | Activation events |
| --- | --- | --- |
| `index1` | event name | event name |
| `blob1` | event name | event name |
| `blob2` | path | campaign (`none` if absent) |
| `blob3` | target | source (`none` if absent) |
| `blob4` | country | medium (`none` if absent) |
| `blob5` | device class | provider (`''` for `signup_completed`) |
| `blob6` | campaign (`none` if absent) | not written |
| `blob7` | source (`none` if absent) | not written |
| `blob8` | medium (`none` if absent) | not written |
| `blob9` | content (`none` if absent) | not written |
| `double1` | value (landing) | `1` |

### Key guide events

`key_guide_open` and `key_guide_video_play` use the landing column layout. The
client sends `path` `/profile/keys`, so the events endpoint allows that path
next to the public landing slugs and, since the video analytics change, `/byok`
and `/guides/<slug>`. Without an allowed path every event gets a 400, and the
client swallows the error. The endpoint also requires `target` to be a
`providerMeta` id (checked with `Object.hasOwn`) for these two events, and it
strips a trailing slash from `path`, so `/profile/keys/` is accepted.

| Column | `key_guide_open` | `key_guide_video_play` |
| --- | --- | --- |
| `blob2` | `/profile/keys` | `/profile/keys` |
| `blob3` | provider id, e.g. `google` | provider id |
| `double1` | `0` when the guide opened on its own, `1` when the user expanded it | `1` when the user started playback, `0` for muted autoplay |

`key_guide_open` fires at most once per provider per visit to the keys page,
so the first open decides the value: an auto-open (`0`) that the user later
collapses and expands again is not counted a second time as `1`.
`key_guide_video_play` fires at most once per provider and per value, so an
autoplay (`0`) never hides a later user-started play (`1`). The client resets
this memory when the page is created. The writes carry no
user id. The campaign blobs `blob6` to `blob9` are `none`, because only
`landing_page_view` sends a campaign.

```sql
SELECT
  blob1 AS event,
  blob3 AS provider,
  sum(_sample_interval) AS events
FROM besidka_cms_events
WHERE blob1 IN ('key_guide_open', 'key_guide_video_play')
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY event, provider
ORDER BY provider, event
```

Mixing the families gives wrong answers. `blob2` is a path on a landing row
and a campaign on an activation row, so `GROUP BY blob2` without a `blob1`
filter returns both.

Activation events carry no `content`. Campaign content is stored in
`user_attribution.utm_content` and in the landing blobs only.

Rows written before this change have `blob6` to `blob9` empty (`''`), not
`none`. They report as campaign `''`. `none` means "the visit had no valid
UTM". `''` means "the row predates attribution".

## Video and key events in Axiom

The owner questions this section answers: how often and for which providers
people add keys, whether they open the video guides, whether a play was
autoplay or a click, and how long they watched. It covers the keys page, the
public `/guides/<slug>` pages and the home page video.

Only `attributes.*` carries the new fields. `attributes` is a declared Axiom
map field (see `docs/axiom-map-fields.md`), so none of them adds to the
256-field schema. The only flat field involved is `analytics.event`, which
already existed. Query a nested key with `attributes.analytics.<key>` and cast
it (`todouble(...)`, `tostring(...)`) because a map value is untyped.

### Client events (`POST /api/v1/events`)

Every accepted client event logs `analytics.event` (flat) and
`attributes.analytics.target`, `.surface` and `.path`. A key is omitted when
the client did not send it. The server derives `surface` from `path`.

`target` is logged only when it is validated. For `key_guide_open`,
`key_guide_video_play` and `video_watch` the endpoint already rejects anything
but a provider id (or `demo` for `video_watch`), so the value is logged as is.
For every other event `target` is free text from the client, so it is logged
only when it matches `^[a-z0-9/_#.:-]{1,100}$` and is otherwise omitted from
the wide event. Analytics Engine keeps its own 100-character truncation of the
raw `target` regardless of this rule.

| `surface` | `path` |
| --- | --- |
| `home` | `/` |
| `keys` | `/profile/keys` |
| `guide` | `/guides/<slug>` (`^/guides/[a-z0-9-]{1,64}$`) |
| `byok` | `/byok` |
| `legal` | `/privacy-policy`, `/terms-of-use`, `/cookie-policy` |

The endpoint used to reject `/byok` and `/guides/<slug>` with a 400 (the client
swallows the error), so every event from those pages was lost. A trailing slash
is stripped before the path is checked.

| `analytics.event` | Fires when | `target` |
| --- | --- | --- |
| `key_guide_open` | A key guide accordion on `/profile/keys` becomes open, either by the user (`trigger` `user`) or on its own because the key is missing (`trigger` `auto`). Never on collapse. Once per provider per visit. | provider id |
| `key_guide_video_play` | A guide video starts. Keys page: the guide player. `/guides/<slug>`: the shared landing player with `guideProvider` set. | provider id |
| `video_play` | The home page demo video starts. Once per page view. | `demo` |
| `video_complete` | Playback ends. | `demo`, or the provider id on a guide page |
| `video_watch` | A viewing session ends. See below. | `demo` or provider id |

`/guides/<slug>` has no accordion, so it sends no `key_guide_open`.

Extra `attributes.analytics.*` keys:

| Key | Events | Values |
| --- | --- | --- |
| `trigger` | `video_play`, `key_guide_video_play`, `video_watch` | `autoplay` or `user` |
| `trigger` | `key_guide_open` | `auto` or `user` |
| `watchedSeconds` | `video_watch` | played media time, rounded to 0.1 s, 0 to 86400 |
| `durationSeconds` | `video_watch` | video length, rounded to 0.1 s, 0 to 86400 |
| `completionPercent` | `video_watch` | furthest position reached / duration, integer 0 to 100 |
| `endReason` | `video_watch` | `pause`, `ended`, `hidden`, `offscreen`, `unmount` |

The Analytics Engine `value` (`double1`) stays as before: `0` autoplay and
`1` user for the two play events, `0` auto and `1` user for `key_guide_open`,
and `watchedSeconds` for `video_watch`. The
server fills `value` from `watchedSeconds` when the client omits it.
`video_watch` needs `target`, `trigger`, `watchedSeconds`, `durationSeconds`,
`completionPercent` and `endReason`, and a `target` of `demo` or a provider id,
or it gets a 400. It also gets a 400 when `watchedSeconds` exceeds
`durationSeconds` by more than 1 s; the client clamps `watchedSeconds` to the
duration, so a larger value is not a real session.

The endpoint checks `trigger` per event. `key_guide_open` accepts only `auto`
or `user`, the three video events accept only `autoplay` or `user`, and a value
from the other family gets a 400. `trigger` stays optional for
`key_guide_open`. `user` means the user acted to see the guide: expanding the
guide's own accordion, or expanding the key card whose guide inside was already
open. `auto` means the guide became visible without a user action: the page
loaded with a `?provider=` deep link or the default card expanded, or the key
status resolved to missing. The key card reports who expanded it (a native
toggle is `user`, the `open` prop flipping is `auto`) and the guide reads that
when it becomes visible.

#### Autoplay or user

Only the keys page guide player autoplays: muted, when it is at least half
visible, unless the user prefers reduced motion or has data saver on. A play
that comes from that path is `autoplay`. A play from the player's play button, a click
on the video, or the keyboard is `user`. The home video and the `/guides/<slug>`
player never autoplay, so their plays are always `user`.

An autoplayed video that the user then unmutes counts as a `user` play: the
guide player sends a `key_guide_video_play` with `trigger: 'user'` (once per
provider and visit) and the open watch session switches to `user`. A play after
a user pause is also `user`. A scroll-out pause followed by an automatic
resume stays `autoplay`.

The session trigger is decided when the session starts: a video that is
unmuted at play start is `user`, so a viewer who unmuted earlier stays `user`
on later autoplay resumes. The one-time upgrade on unmute still applies to a
session that started muted. A `playing` event after a rebuffer is not a new play.

#### Event source

Both players bind analytics to the native `<video>` events (`play`,
`playing`, `pause`, `ended`, `timeupdate`, `volumechange`), not to a player
library API. The Video.js v10 skin only renders the controls and drives the
same `<video>`, so a change of skin or library does not change what is
tracked. See `docs/video-player.md`.

#### Watch sessions

`app/composables/video-watch-analytics.ts` is shared by both players. One
session starts at a play and ends at the first of: `pause` (a real user pause),
`offscreen` (the guide player paused itself because it scrolled out of view,
or PiP closed while off screen), `ended`, `visibilitychange` to hidden or
`pagehide` (`hidden`), or the component unmounting (`unmount`). Each session is sent at
most once. The next play starts a new session with its own trigger. If the tab
is hidden while the video keeps playing, a new `autoplay` or `user` session
(same trigger) starts when the tab is visible again and playback continues.

- `watchedSeconds` adds the `timeupdate` deltas. A delta above 1.5 s (a seek)
  or below 0 (a seek back, a loop restart) adds nothing. The total is capped at
  `durationSeconds`, so a looping guide video tops out at its length.
- The guide videos loop, so `ended` never fires for them. A session
  that watches several loops ends by `pause`, `offscreen`, `hidden` or
  `unmount`, and its `watchedSeconds` clamps at the duration instead of
  counting every loop. Read `watchedSeconds` equal to `durationSeconds` as
  "watched at least one full pass".
- `completionPercent` uses the furthest position, not the played time.
- A session under 1 s of played time is not sent.
- `hidden` and `unmount` use `fetch` with `keepalive: true` so the request
  survives the page unload. `pause` and `ended` use a normal request.

The consent behaviour is unchanged: these events carry no user id and no
cookie and use the same endpoint as the other landing events.

```kusto
['besidka-prod']
| where ['analytics.event'] == 'video_watch'
| summarize avg(todouble(attributes.analytics.watchedSeconds)) by tostring(attributes.analytics.target)
```

Watch time and completion by surface and trigger:

```kusto
['besidka-prod']
| where ['analytics.event'] == 'video_watch'
| summarize
    sessions = count(),
    avg_watched = avg(todouble(attributes.analytics.watchedSeconds)),
    avg_completion = avg(todouble(attributes.analytics.completionPercent))
  by tostring(attributes.analytics.surface), tostring(attributes.analytics.trigger)
```

Autoplay versus user plays per provider:

```kusto
['besidka-prod']
| where ['analytics.event'] == 'key_guide_video_play'
| summarize plays = count() by tostring(attributes.analytics.target), tostring(attributes.analytics.trigger)
```

Guide opens by provider:

```kusto
['besidka-prod']
| where ['analytics.event'] == 'key_guide_open'
| summarize opens = count() by tostring(attributes.analytics.target)
```

Open to play to watched, per provider (events, not people):

```kusto
['besidka-prod']
| where ['analytics.event'] in ('key_guide_open', 'key_guide_video_play', 'video_watch')
| summarize count() by tostring(attributes.analytics.target), tostring(['analytics.event'])
```

### Key saves (server)

Every key `POST` and `DELETE` handler under `server/api/v1/profiles/keys/<provider>/`
calls `recordKeyEvent` from `server/utils/analytics/key-events.ts`, which logs:

| Field | Values |
| --- | --- |
| `attributes.keys.provider` | the `providerMeta` id: `google`, `openai`, `anthropic`, `xai`, `deepseek`, `moonshotai`, `qwen`, `openrouter`, `brave`, `exa`, `vercel`, `cloudflare` |
| `attributes.keys.action` | `created`, `updated`, `deleted` |

The `vercel-gateway` and `cloudflare-gateway` routes log `vercel` and
`cloudflare`. `attributes.activation.provider` (first key only) still holds the
stored `keys.provider` value, so it reads `vercel-gateway` and
`cloudflare-gateway`. The helper never sets `analytics.event`, so it does not
clobber `first_provider_key_added` on the same request. A `deleted` row is
logged even when no key existed, because the handler does not check first.
These events live on the request's own wide event, so filter on the route to
isolate them, or on the field being present.

```kusto
['besidka-prod']
| where isnotnull(attributes.keys.provider)
| summarize saves = count() by tostring(attributes.keys.provider), tostring(attributes.keys.action)
```

## Analytics Engine queries

Rules for every query:

- Use `SUM(_sample_interval)`, never `COUNT()`. Analytics Engine samples. Each
  row carries `_sample_interval`, the inverse of its sample rate. `COUNT()`
  returns stored rows, which undercounts. Cloudflare's own docs show
  `SELECT SUM(_sample_interval)` as the replacement for `SELECT COUNT()`.
- Filter by time with `timestamp > NOW() - INTERVAL '7' DAY`.
- Filter by event with `blob1` or `index1` in the same `WHERE`.
- Write the dataset name in `FROM`. Use `besidka_cms_events_preview` for
  previews.
- Retention is three months. A 90-day window is the maximum useful range.

`sumIf(expression, condition)` is a documented aggregate function. It sums the
first expression over the rows where the condition is true. The queries below
use it for the conditional sums.

### Visits by campaign

```sql
SELECT
  blob6 AS campaign,
  sum(_sample_interval) AS visits
FROM besidka_cms_events
WHERE blob1 = 'landing_page_view'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY campaign
ORDER BY sum(_sample_interval) DESC
```

For 30 days, change `'7'` to `'30'`.

### Sign-ups by campaign

```sql
SELECT
  blob2 AS campaign,
  sum(_sample_interval) AS signups
FROM besidka_cms_events
WHERE blob1 = 'signup_completed'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY campaign
ORDER BY sum(_sample_interval) DESC
```

### First provider key by campaign

```sql
SELECT
  blob2 AS campaign,
  blob5 AS provider,
  sum(_sample_interval) AS first_keys
FROM besidka_cms_events
WHERE blob1 = 'first_provider_key_added'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY campaign, provider
ORDER BY sum(_sample_interval) DESC
```

### First chat message by campaign

```sql
SELECT
  blob2 AS campaign,
  blob5 AS provider,
  sum(_sample_interval) AS first_chats
FROM besidka_cms_events
WHERE blob1 = 'first_chat_message'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY campaign, provider
ORDER BY sum(_sample_interval) DESC
```

For all four queries, run again with `INTERVAL '30' DAY` for the 30-day view.

### Combined funnel

One query, one row per campaign. `campaign` comes from `blob6` on landing rows
and from `blob2` on activation rows. This is the query `scripts/utm-report.mjs`
runs.

```sql
SELECT
  if(blob1 = 'landing_page_view', blob6, blob2) AS campaign,
  sumIf(_sample_interval, blob1 = 'landing_page_view') AS visits,
  sumIf(_sample_interval, blob1 = 'signup_completed') AS signups,
  sumIf(_sample_interval, blob1 = 'first_provider_key_added') AS first_key,
  sumIf(_sample_interval, blob1 = 'first_chat_message') AS first_chat
FROM besidka_cms_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob1 IN (
    'landing_page_view',
    'signup_completed',
    'first_provider_key_added',
    'first_chat_message'
  )
GROUP BY campaign
ORDER BY sumIf(_sample_interval, blob1 = 'landing_page_view') DESC
```

How to read it:

- It is not a cohort. A sign-up this week can come from a visit last week, so
  `signups / visits` is a rate of the window, not of a group of people. For an
  exact cohort, use the D1 query below.
- `visits` counts every landing-layout page view, including `/byok` and the
  legal pages. Add `AND blob2 = '/'` to the visit condition to count only the
  home page.
- Bots are filtered out of landing events by user agent, not out of
  activation events.
- Rows with campaign `''` are visits that predate this change.

### How to run them

**Cloudflare dashboard.** Cloudflare's docs describe the dashboard as backed
by the GraphQL API and do not document a SQL editor for Analytics Engine. Run
SQL through the API below, or through Grafana, which Cloudflare documents as an
external client of the SQL API.

**API.** Create a token with only the permission "Account Analytics: Read".
Do not reuse a token that can write.

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $CLOUDFLARE_ANALYTICS_TOKEN" \
  --data "SELECT blob6 AS campaign, sum(_sample_interval) AS visits FROM besidka_cms_events WHERE blob1 = 'landing_page_view' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY campaign"
```

The default response format is JSON. Add `FORMAT JSONEachRow` or
`FORMAT TabSeparated` at the end of the query to change it.

**Script.** `scripts/utm-report.mjs` runs the combined funnel and prints a
table with a conversion column (`signups / visits`).

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_ANALYTICS_TOKEN=... \
  node scripts/utm-report.mjs --days=30
node scripts/utm-report.mjs --days=7 --dataset=besidka_cms_events_preview
```

The script reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_ANALYTICS_TOKEN`. It
falls back to `CLOUDFLARE_API_TOKEN` if the first token is unset. `--days`
defaults to 7. `--dataset` defaults to `besidka_cms_events`. With the
variables unset it prints which ones are missing and exits with code 1.

## D1 fallback queries

D1 holds exact numbers, not samples. Use these when a campaign is small and
sampling noise matters, or to check an Analytics Engine figure. Timestamps are
Unix seconds (Drizzle `timestamp` mode).

Read-only. Run against production with:

```bash
npx wrangler d1 execute besidka --env production --remote --command="<query>"
```

### Sign-up cohort funnel by campaign

Each user is counted once, under the campaign of their sign-up. Users who
joined before attribution existed have no `signup_completed` row and are not
included.

```sql
SELECT
  COALESCE(a.utm_campaign, 'none') AS campaign,
  COUNT(s.user_id) AS signups,
  COUNT(k.user_id) AS first_key,
  COUNT(c.user_id) AS first_chat
FROM user_activation_events s
LEFT JOIN user_attribution a ON a.user_id = s.user_id
LEFT JOIN user_activation_events k
  ON k.user_id = s.user_id AND k.event = 'first_provider_key_added'
LEFT JOIN user_activation_events c
  ON c.user_id = s.user_id AND c.event = 'first_chat_message'
WHERE s.event = 'signup_completed'
  AND s.created_at >= unixepoch('now', '-30 days')
GROUP BY campaign
ORDER BY signups DESC;
```

Change `'-30 days'` to `'-7 days'` for the week view.

### Campaigns by source and medium

```sql
SELECT
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
  COUNT(*) AS signups
FROM user_attribution
WHERE created_at >= unixepoch('now', '-30 days')
GROUP BY utm_source, utm_medium, utm_campaign, utm_content
ORDER BY signups DESC;
```

### First chat provider by campaign

```sql
SELECT
  COALESCE(a.utm_campaign, 'none') AS campaign,
  c.provider,
  COUNT(*) AS first_chats
FROM user_activation_events c
LEFT JOIN user_attribution a ON a.user_id = c.user_id
WHERE c.event = 'first_chat_message'
  AND c.created_at >= unixepoch('now', '-30 days')
GROUP BY campaign, c.provider
ORDER BY first_chats DESC;
```

Ledger rows exist only for accounts created after the feature shipped, so every
query above covers those accounts and no others. The sign-up cohort query is
still the better choice for a funnel: it counts each user once under the
campaign of their sign-up.

## Axiom APL queries

Axiom holds exact counts within its retention window. The activation events and
the landing view (when a UTM is present) log `analytics.event` and, under the
`attributes` map field, `attributes.utm.*` and `attributes.activation.provider`.
Map-field access uses bracket syntax, as in the other dashboards in this repo
(`attributes['ai']['webSearchUnits']`).

**Activation events by campaign:**

```apl
['besidka-prod']
| where _time > ago(7d)
| where ['analytics.event'] in ('signup_completed', 'first_provider_key_added', 'first_chat_message')
| extend campaign = tostring(attributes['utm']['campaign'])
| extend campaign = iff(isempty(campaign), 'none', campaign)
| summarize count() by event = tostring(['analytics.event']), campaign
```

**Sign-ups by campaign, source and medium:**

```apl
['besidka-prod']
| where _time > ago(30d)
| where ['analytics.event'] == 'signup_completed'
| summarize count() by
    campaign = tostring(attributes['utm']['campaign']),
    source = tostring(attributes['utm']['source']),
    medium = tostring(attributes['utm']['medium'])
```

**First chat message by provider:**

```apl
['besidka-prod']
| where _time > ago(30d)
| where ['analytics.event'] == 'first_chat_message'
| summarize count() by provider = tostring(attributes['activation']['provider'])
```

**Analytics errors (attribution never blocks a request, so check here).**
Failures set only `attributes.analytics.error` and `attributes.analytics.event`,
never the flat `analytics.event`, so the event queries above never count a
failure:

```apl
['besidka-prod']
| where isnotnull(attributes['analytics']['error'])
| summarize count() by
    event = tostring(attributes['analytics']['event']),
    error = tostring(attributes['analytics']['error'])
```

Axiom log lines carry a pseudonymous user id. A campaign value in a log line is
therefore linked to a user for as long as logs are retained. That is covered in
the privacy policy. Keep campaign values out of the free-text fields.

## Privacy reasoning

- **No device storage.** The campaign lives in the URL and in memory. Nothing is
  written to or read from the visitor's device, so ePrivacy Art. 5(3) and
  PKE Art. 399 do not apply to attribution.
- **Aggregate counters have no identity.** The Analytics Engine write holds an
  event name, a path or provider, a country, a device class and the four
  sanitized campaign values. It holds no user id, email or IP address.
- **The first-touch campaign is personal data once it sits next to an
  account.** `user_attribution` is keyed by user id, so it is personal data.
  The legal basis is legitimate interest, GDPR Art. 6(1)(f): measuring whether
  my own campaigns work. The data is four short strings of the link the user
  clicked. It is stored once, never updated, and deleted with the account.
- **Logs.** Campaign values in Axiom sit next to the pseudonymous user id the
  logs already carry. This adds no new identifier. Retention is the existing
  log retention.
- **Strict sanitizing limits what can be stored.** A campaign link cannot carry
  free text, an email address or a token into the database, because every
  value must match `/^[a-z0-9._-]+$/` and be at most 64 characters.
- **Minimization.** No attribution row is written for users without a valid
  campaign link. The activation ledger has a row for every user, but it holds
  only the user id, event name, provider and a timestamp.

Check `content/legal/privacy-policy.md` and `content/legal/cookie-policy.md`
whenever this changes. Both state that no cookie is used for attribution.

## Decision: no analytics-consent cookie

An earlier draft added an optional cookie that remembered the campaign across
visits, behind a new consent category. It is not built.

- A cookie would need the `analytics` consent category. That category is
  commented out in `nuxt.config.ts` (`cookieConsent.categories`) today,
  because nothing needs it. Enabling it
  adds a banner category and re-prompts every user whose stored choice does not
  include it.
- Most users would decline, or the banner would be dismissed. The cookie would
  then cover few visits and bias the data toward people who accept cookies.
- URL propagation covers the case that matters: the user clicks a campaign
  link and signs up in the same visit. Every sign-up link carries the UTM, and
  the callback URL carries it through email and OAuth.
- The cost of URL propagation is that a visitor who leaves and returns later
  through a plain link is not attributed to the campaign. That is accepted.

If you add a UTM cookie in the future, put it in the `analytics` category with
consent, add it to the Cookie Policy table, and update `docs/cookie-consent.md`
and the Privacy Policy. Do not set it before consent.

## Files

- `shared/utils/utm.ts`: sanitizer and URL helpers
- `server/db/schemas/attribution.ts`: both D1 tables
- `server/utils/analytics/activation.ts`: ledger claim and event emit
- `server/utils/landing/analytics-events.ts`: landing writes
- `server/api/v1/events/index.post.ts`: landing endpoint with `utm`
- `server/utils/auth.ts`: sign-up hook
- `app/composables/utm-attribution.ts`, `app/plugins/utm-attribution.client.ts`:
  client capture
- `app/composables/key-guide-analytics.ts`: once-per-provider guide events
- `scripts/utm-report.mjs`: funnel report
