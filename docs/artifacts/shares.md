# Artifact share links, reports and takedown (A-7, BES-269)

Public links to one artifact at `besidka.com/artifacts/<token>`, the report flow for
everyone who sees them (DSA Art. 16 notice), and the admin decisions and
direct takedowns with a statement of reasons (DSA Art. 17). This page is the
server half: tokens, routes, states, gates, logging, emails and retention.
The pages and modals are documented with the client layer.

Chat shares (`/shared/<slug>`) are separate and keep working as built in A-4;
a report about an artifact inside a shared chat uses the same report helper.

## Token model

- A token is 32 random bytes, base64url (43 characters), made by
  `generateArtifactShareToken()` (`server/utils/artifacts/shares.ts`).
- D1 keeps `token_hash` (sha256 hex, unique index, the lookup key) and
  `token_encrypted` (`useEncryptText`), which exists only so the owner can copy
  the link again. A leak of `NUXT_ENCRYPTION_KEY` plus a D1 read exposes every
  active link; key rotation needs a re-encryption step for
  `artifact_shares.token_encrypted` (breach runbook section 2.5).
- The token is the last path segment of the link, `/artifacts/<token>`
  (owner decision, 2026-11-11, replacing the fragment form `/a#<token>` of
  2026-11-09: no artifact share existed in production besides the owner's
  own test, so no old-link compatibility is kept and `/a` is an ordinary
  404). The page request therefore carries the token in its URL, and
  Cloudflare Workers Logs record it on Cloudflare's side. That is accepted
  on the same basis as `/shared/<publicId>` chat links: Cloudflare is the
  processor, access is limited to the account owner and retention is short;
  `observability` settings are unchanged. Besidka's own logs never keep it
  (see Log redaction). The page sends `Referrer-Policy: no-referrer` and
  `Cache-Control: private, no-store`, so the token does not leave through
  `Referer` or a shared cache. The page reads the token from the route
  param and its API calls (`GET /api/v1/artifact-shares/current`, report,
  storage, bridge, complete) keep sending it in the
  `x-besidka-artifact-share` header (`ARTIFACT_SHARE_HEADER` in
  `shared/utils/artifacts.ts`), so no API URL carries it and no API route
  changed. The link is built by `buildArtifactShareUrl`
  (`server/utils/artifacts/shares.ts`) for the owner modal, MCP
  `share_artifact` and `list_artifact_shares`, and the admin `locationUrl`.
- Public share ids are `sh_` plus the Hashids encoding of the row id
  (`encodeArtifactShareId`). `_` is outside the Hashids alphabet, so a share id
  never looks like an artifact id. Logs, audit rows and emails carry share ids
  and artifact ids, never a token.

## Routes

### Owner (session and ownership)

Create and check require `requireFeature(event, 'artifacts.share')`.
List and revoke require only the global `artifacts` rule
(`requireGlobalFeature`), so an owner who loses `artifacts.share` can
still see and revoke links that are live. The conformance spec lists
those two routes as guarded by the global rule. The three writes (create,
check, revoke) also refuse requests that are not same-origin, with the
admin writes' `assertSameOriginAdminRequest` (403 for a `same-site`
sibling host or a foreign `Origin`).

| Route | Body | Response |
| --- | --- | --- |
| `POST /api/v1/artifacts/[id]/shares` | `{ duration: 'hour' \| 'day' \| 'week' \| 'month' \| 'year' \| 'never', pinnedVersion: number \| null, storageAllowed: boolean, bridgeAllowed: boolean }` | `{ share: ArtifactShareSummary, url }` |
| `POST /api/v1/artifacts/[id]/shares/check` | `{ pinnedVersion: number \| null }` | `{ warnings: string[] }` (detector kinds: `email`, `phone`, `payment-card`, `iban`, `national-id`, `tax-id`, `passport`) |
| `GET /api/v1/artifacts/[id]/shares` | | `{ shares: ArtifactShareSummary[] }`, active first, then links that ended in the last 30 days |
| `POST /api/v1/artifacts/[id]/shares/[shareId]/revoke` | | `{ revoked: number }` |

Errors: 404 for an unknown or foreign artifact or share (and when the flag is
off), 451 `artifact_taken_down` when creating a link to a taken-down artifact,
400 for a pinned version that does not exist, 409 `artifact_share_limit` for
an eleventh active link (taken-down, revoked and expired links do not count;
the cap is read-then-write, so two concurrent creates can overshoot by one).
The check route runs the deterministic `detectSharePii` on the title and the
chosen version's text only: no model, no key spend.

A link copies the artifact title at creation (`artifact_shares.title`, UI
and MCP alike through `createArtifactShare`), and the public view shows
`share.title ?? artifact.title`, so renaming the artifact after sharing
never reaches visitors (as `referencedTitle` does for shared chats). Rows
made before the column existed fall back to the current title.

A user-scope takedown (see Admin) writes a deny grant for `artifacts.share`,
so `requireFeature` refuses create and check for that owner (404, as for a
flag that is off) until an admin removes the grant.

`ArtifactShareSummary` (`shared/utils/artifacts.ts`): `shareId`, `url`
(decrypted, `null` once the link ended), `createdVia` (`ui` or `mcp`),
`clientName` (OAuth client name for MCP links), `pinnedVersion`, `expiresAt`,
`revokedAt`, `takedownAt` (the link's, else the artifact's), `storageAllowed`,
`bridgeAllowed`, `createdAt`, `status` (`active`, `expired`, `revoked`,
`taken-down`).

The helpers are shared with the MCP layer (A-8): `createArtifactShare`,
`listArtifactShares`, `revokeArtifactShares` (by `shareIds` or `artifactIds`,
ownership by a subquery on `artifacts`, returns `{ revoked, notFound }`),
`resolveActiveArtifactShare`, `buildActiveArtifactShareFilter`,
`hashArtifactShareToken`, `encodeArtifactShareId`/`decodeArtifactShareId`.

### Public (no session needed)

| Route | Response |
| --- | --- |
| `GET /api/v1/artifact-shares/current` | `ArtifactSharePublicView`: `{ shareId, artifactId, title, kind, version, pinned, content, createdAt, expiresAt, capabilities: { storageAllowed, bridgeAllowed } }` |
| `POST /api/v1/artifact-shares/current/report` | `{ ok: true }` |

Both read the token from the header. Every response, errors included, carries
`Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and
`X-Robots-Tag: noindex, nofollow`. `artifactId` is the public id the viewer
sends to the storage and bridge routes together with the header.

States:

| State | Answer |
| --- | --- |
| Global `artifacts` rule off (kill switch) | 404 |
| No header, malformed or unknown token | 404 |
| Revoked or expired link | 404 |
| Link or artifact taken down | 410, `code: 'artifact_taken_down'`, `data: { takenDown: true }` |
| Version object missing in R2 | 410, `code: 'artifact_content_missing'` (no `takenDown`) |

A link that is revoked or expired answers 404 even if it was also taken down.

### Viewer features through a link

`resolveArtifactViewerAccess` (`server/utils/artifacts/access.ts`) resolves
the owner first (full access, 451 when taken down). Anyone else needs the
header token of an active link to exactly that artifact; `storageAllowed` and
`bridgeAllowed` then come from the link. Any failure is the same 404 as an
unknown id. The storage routes and the bridge routes keep their own
`requireFeature(event, 'artifacts.storage' | 'artifacts.llm-bridge')` first,
so the viewer's own flag stays required, and they answer **403** when the link
does not allow the feature (unchanged from A-5 and A-6). Anonymous viewers
never reach those routes (they need a session).

## Pages and headers

`nuxt.config.ts` sets the same route rule on `/artifacts` and on
`/artifacts/**`: `cache: false`, `Cache-Control: private, no-store`,
`Content-Security-Policy: frame-ancestors 'none'`,
`Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`. Links are
always `noindex`: there is no switch to list one in search engines, and the
share dialog says so (an always-visible `alert alert-info`, plus "Hidden from
search engines" on every link in the Links list). `/artifacts` and
`/artifacts/**` are in the sitemap `exclude` and deliberately **not** in
`robots.disallow`: a disallowed URL is never fetched, so its noindex would
never be read (`docs/seo.md`).

`/artifacts/<token>` (`app/pages/artifacts/[token].vue`) is the only page.
Vue Router matches pages without regard to case, but the route rules match
`/artifacts` exactly, so `/Artifacts/<token>` would render the link page
without those headers, and `/artifacts/<token>/more` would carry a token in a
deeper path. `server/middleware/02.artifact-share-path.ts`
(`isNonCanonicalArtifactSharePath`) answers a plain-text 404 with the
no-store, no-referrer, noindex and `frame-ancestors 'none'` headers to every
path that matches `/^\/artifacts(\/.*)?$/i` (query ignored) except the
lower-case `/artifacts/<one segment>`: `/artifacts`, `/artifacts/`,
`/Artifacts/...` and `/artifacts/<token>/<more>`. `isArtifactShareLocation`
(`app/utils/artifact-share-location.ts`) matches `/artifacts` and
`/artifacts/...` in any case, and `?next=` pointing there, so analytics never
loads on a link page. `/chats/artifacts` (the library) and
`/api/v1/artifacts/...` are different paths and untouched. There is no
`/artifacts` collision with a route, a robots rule, a PWA navigate fallback
(`navigateFallback` is only the dev option) or a middleware.

`server/plugins/artifacts-frame-src.ts` adds `frame-src 'self' <artifacts
origin> <Turnstile>` on `/chats/`, `/shared/`, `/admin/` and `/artifacts/`
(prefixes; the admin report drawer frames artifacts, and `/about` and `/api`
never match). Nitro sets route-rule headers on the event before rendering
and the renderer then overwrites them with its own, so the plugin merges into
the event's policy when the renderer has none: the link page sends
`frame-ancestors 'none'; frame-src ...`.

## Log redaction

The page request is `GET /artifacts/<token>`, so the token is in the URL of
that one request; the API calls send the header. Besidka's logs must not
keep it, so the `evlog:enrich` hook in
`server/plugins/evlog-request-observability.ts` rewrites the token of every
`/artifacts/<token>` form to `[token]`: the plain path, a full URL, a query
value (`next=%2Fartifacts%2F<token>`) and any percent-encoding of the
slashes once or more (`%252Fartifacts%252F<token>`), in any case. Only a link
whose `artifacts` segment starts the path counts, so
`/api/v1/artifacts/<id>/shares` keeps its id. The same applies to a
browser-ingested evlog event or a client error report that carries the page
address (`location.href`, or the error boundary's `route.fullPath` in
`app/app.vue`) and to a link a reporter pastes into a report. The hook
rewrites `request.path` and walks the whole wide event (path, message,
nested error fields, browser-ingested events from `/api/_evlog/ingest`,
whose enrich hook runs before any output) before any drain (Axiom, console,
file) sees it. The helpers live in `server/utils/artifacts/share-redaction.ts`
(`redactArtifactSharePath`, `redactArtifactShareTokens`); the report flow
uses the same function on the report details. The header is never part of
a wide event, and the hook also deletes `x-besidka-artifact-share` from the
hook context's request headers, which is the same object the drain context
receives, so no drain or later hook sees it. The chat client error report
(`/api/v1/chats/client-errors`) takes only fixed fields (message, codes,
ids), never a URL.

The page response carries `content-security-policy: frame-ancestors 'none';
frame-src 'self' <artifacts origin> <Turnstile>` plus the noindex,
no-referrer and no-store headers.

The page must not throw a fatal Nuxt error for a dead link: Nuxt's own
console error and the Vue Router "no match" warning print the raw path to
the Worker console. Render the 404 and 410 states inside the page instead.

Cloudflare Workers Logs (`observability.enabled` in `wrangler.jsonc`) record
each invocation's URL on Cloudflare's side, so they now hold the token of a
link page request. This is accepted on the same basis as `/shared/<publicId>`
chat links: Cloudflare is the processor, access is account-only and
retention is short. No Workers Logs setting changed. Note that revoking or
expiring a link ends access immediately, while a logged URL stays in
Cloudflare's retention window; it no longer opens anything.

## Reports

`submitArtifactReport` (`server/utils/artifacts/reports.ts`) serves both
`POST /api/v1/artifact-shares/current/report` and
`POST /api/v1/shared/[slug]/artifacts/[artifactId]/report`:

```ts
{
  reason: 'illegal' | 'copyright' | 'privacy' | 'harmful' | 'other'
    | 'csam' | 'terrorism' | 'threat-to-life' | 'phishing'
  details: string            // 20 to 2,000 characters, trimmed
  reporterName?: string      // required except for csam; one line
  reporterEmail?: string     // required except for csam
  goodFaith: true
  turnstileToken?: string    // signed-out reporters, when Turnstile is on
  version?: number           // shared-chat route: the version in the panel
  copyright?: {              // required when reason is copyright
    work: string             // element 2
    signature: string        // element 1, the typed name; one line
    ownerName?: string       // element 4, when acting for the owner; one line
    unauthorisedUse: true    // element 5
    authority: true          // element 6
  }
}
```

`reporterName`, `copyright.signature` and `copyright.ownerName` refuse line
breaks and other control characters (`/^[^\p{Cc}]*$/u`, 400), so a name
cannot add lines to the mailbox email. Any `/artifacts/<token>` link
pasted into `details` (or the copyright work), encoded or not, is reduced to
`/artifacts/[token]` with
`redactArtifactSharePath` before the row is written and the mailbox email
is sent.

Element 3 of the Terms of Use "Copyright complaints" section, the exact URL,
is the link or shared chat the server resolved, never a URL from the client;
element 4 is the reporter's name and email. The copyright elements are stored
as labelled lines under the reporter's text in `details` (no extra columns).

The reported version (`artifact_reports.reported_version`) is evidence of
what the reporter saw. The link route stores the version the link resolved
(its pinned one, else the current one) and ignores any `version` in the
body. The shared-chat route takes the optional `version` and checks it with
`resolveSharedChatArtifact({ version })`, the same membership check as the
version reads: a version the shared chat does not reference answers 404.
The panel's Report button sends the version it shows.

Order: body validation (400) → session → rate limit (5 an hour per user or per
IP, `enforceArtifactReportRateLimit`, 429) → Turnstile for signed-out
reporters (400 `turnstile_required` without a token, 403 `turnstile_failed`
when Siteverify refuses, 503 `turnstile_unavailable` when Turnstile is
enforced but its keys are missing) → target resolution (404, 410) → insert → emails.
On the link route the link is resolved first, so a dead link answers 404 or
410 before anything else.

The row stores the link (`share_id`) or the chat share (`chat_share_id`),
the reported version, `priority` (`urgent` for csam, terrorism and threat to
life) and no IP.

Rate limit keys never hold an address: a signed-in reporter is keyed by user
id; a signed-out one by `ip:` plus the HMAC-SHA256 (hex) of
`resolveRateLimitKey(ip)` (IPv6 by /64) keyed with the existing
`encryptionKey` (`hashArtifactReportLimitKey` in
`server/utils/artifacts/report-rate-limit.ts`; no new secret, and the route
answers 500 if the key is missing). The KV entry expires with its window.
A KV error in the limiter answers 429 with `Retry-After: 1`, like the bridge
limiter. Only this limiter hashes; the consents limiter is unchanged.

Receipts (T1): a signed-out reporter gets the receipt at the address they
typed. A signed-in reporter gets it only at their verified account email,
whatever they typed (the typed address is still stored as the contact and
gets the T2 decision); with an unverified account email no receipt is sent.
Each address gets at most 3 receipts per 24 hours, counted in KV under the
HMAC of the lowercased address (`consumeArtifactReportReceiptSlot`). Over
the cap, or when KV or the key fails, the report is saved and only the
receipt is skipped and logged (`attributes.artifacts.receiptSkipped`).

`verifyTurnstileToken` (`server/utils/turnstile.ts`) posts to Siteverify with
`turnstileSecretKey`. It is skipped when Turnstile is not configured and
not enforced (as on Cloudflare Previews). `turnstileEnforced` without keys
fails closed (signed-out reports answer 503) and is logged once. When enforced, the action must be `report` and the
hostname one of the auth allowed hosts (the dummy test keys answer with
neither, so those checks are off locally). A network error fails closed.

## Admin

All routes: `requireAdmin`; writes also go through
`createFeatureAdminWriteContext` (same-origin check) and write a
`feature_audit_log` row with `flag: 'artifacts'` and the owner as
`targetUserId`. Snapshots hold the takedown and hold timestamps, the scope,
the report id and public ids; never content, statements or tokens.

| Route | Body or query | Response |
| --- | --- | --- |
| `GET /api/v1/admin/artifact-reports` | `?status=open\|actioned\|rejected&offset&limit` (max 100) | `{ items: AdminArtifactReportSummary[], total }`: open urgent first, then open, then closed, newest first |
| `GET /api/v1/admin/artifact-reports/[id]` | | `AdminArtifactReportDetail`: the summary plus `details`, `decisionStatement`, `receiptSentAt`, `locationUrl` (the decrypted `/artifacts/<token>` link or the shared chat URL), `reportedVersion`, `currentVersion` and `previewVersion` (`reportedVersion ?? pinnedVersion ?? currentVersion`) |
| `GET /api/v1/admin/artifacts/[id]/versions/[version]` | | `ArtifactVersionContent` of any user's artifact, taken down or not |
| `POST /api/v1/admin/artifact-reports/[id]/action` | `{ action: 'takedown' \| 'reject', statement: 20..4000, scope: 'share' \| 'all-shares' }` | `{ reportId, status, decision, newlyTakenDown }` |
| `POST /api/v1/admin/artifact-takedowns` | `{ target, statement: 20..4000, scope: 'share' \| 'artifact' \| 'user', legalHold?: boolean }` | `{ scope, takenDown, alreadyTakenDown, artifactIds, shareId, ownerUserId, legalHoldUntil }` |
| `POST /api/v1/admin/artifact-takedowns/restore` | `{ artifactId }` or `{ shareId }` (exactly one) | `{ restored: true, artifactId, shareId }` |

Report decisions:

- `takedown` + `share`: sets the link's `takedown_at`/`takedown_reason`;
  decision `restricted`. Needs a report about an `/artifacts/` link: a shared-chat
  report answers 400 `report_without_share` (use `all-shares`).
- `takedown` + `all-shares`: sets the artifact's fields, so `/artifacts/` links, the
  shared-chat route and the owner view all stop on the next request;
  decision `removed`.
- `reject`: decision `no-action`.
- The report gets `status` (`actioned`/`rejected`), `decision`,
  `decision_statement`, `decided_at` and `resolved_at`. The report is closed
  first, only while it is still `open`, so two admins deciding at once cannot
  both act (the second gets 409 and nothing else is written); the takedown
  and the audit row then go in one D1 batch. If that batch (or, for a
  reject, the audit insert) throws, the report is reopened (`status 'open'`,
  decision fields null, matched on the `decided_at` just written so it never
  undoes someone else's decision) and the error is rethrown, so a report is
  never left closed with nothing done; no email is sent. A deleted artifact
  cannot be taken down (409, reject instead).

Direct takedowns resolve `target` in this order: a link in any pasted form
(`https://<host>/artifacts/<token>`, `/artifacts/<token>`,
`artifacts/<token>`) or a bare token (`extractArtifactShareToken`; hashed,
looked up by `token_hash`; the target is never logged; the old `/a#<token>`
form is no longer accepted),
then for `user` a numeric user id or an email (case-insensitive), then an
artifact public id. `share` disables one link, `artifact` the artifact,
`user` every artifact of the owner. `legalHold` sets `legal_hold_until` to
six months from now (TCO Art. 6(2)), never shortening an existing hold, on
the artifact(s) even for `share`. Content already taken down is counted in
`alreadyTakenDown` and gets no second email. The takedown updates, the
legal hold and the audit row are one D1 batch; the statement of reasons is
sent after it.

A `user` takedown also withdraws link sharing: the same batch upserts a
deny grant for `artifacts.share` on the owner (`feature_grants`, reason
"Artifact takedown at user scope", no expiry, over any existing grant) with
a `grant.set` audit row and an `attributes.featureAccess` log line, so the
owner cannot publish new links to any artifact. The T3 email says so.
Restoring the artifacts does not lift it: remove the deny grant in Admin →
Features → `artifacts.share` when a person decides sharing may resume.

Restore clears the takedown fields (the update and the audit row are one
D1 batch), keeps the legal hold and sends no email:
a restore follows a dispute handled by email from the privacy mailbox, and the
answer to the owner (and, for copyright, to the reporter) is written there.
The update only clears a takedown that is still set; a batch cannot make the
audit insert depend on it, so when two restores race past the pre-check the
loser deletes its own audit row right after the batch and answers 409 (if
that delete fails, one extra `artifact.restore` row stays, logged as
`restoreAuditDiscardError`).
Viewer progress deleted by the sweep after a takedown does not come back.

Nothing is cached: every public and owner read checks D1, so a takedown,
restore or revoke takes effect on the next request.

## Emails

`server/utils/artifacts/report-emails.ts`, from `docs/legal/content-incidents.md`
section 9, rendered with `NoticeEmail` plus a plain-text part that keeps the
paragraphs. Replies go to the privacy mailbox (`replyTo`, new in
`useEmail`). A failed send is logged with its kind and never fails the
report or the decision.

| Email | To | When |
| --- | --- | --- |
| Mailbox notice | `runtimeConfig.public.privacyEmail` | Every report. Report id, reason, priority, artifact id, share or chat share id, reporter contact if given, details. Subject prefix `[URGENT]` for urgent reasons |
| T1 receipt (Art. 16(4)) | The reporter | Signed out: the typed address. Signed in: the verified account email only. At most 3 per address per 24 hours; sets `receipt_sent_at` |
| T2 decision (Art. 16(5)) | The reporter | Every decision, when they gave an email (the stored contact) |
| T3 statement of reasons (Art. 17) | The owner | When content is newly taken down, by a report or directly |

No email contains a token, the `/artifacts/` link or an IP. T1 and T2 name the
content by reference id only (the share id, or the artifact id for a shared
chat), never the artifact title: a reporter could otherwise make Besidka
mail text of their choice to an address they typed. T3 goes to the owner
and names the artifact by title and id. The registry entries are
`content-report-receipt`, `content-report-decision` and
`content-statement-of-reasons` in `shared/utils/account-emails.ts`, so the
Privacy Policy list stays generated.

`NoticeEmail` renders the body with `white-space: pre-line`, so the blank
lines between the paragraphs show in HTML too, as in the plain-text part.
The other `NoticeEmail` callers (`server/utils/account/security-emails.ts`,
`server/utils/features/schedule-notify.ts`) pass one-line bodies built by
string concatenation, and the template's own whitespace around the body is
condensed by the Vue compiler, so they render as before (checked in
`tests/integration/server/email-templates.spec.ts`). Legal notices use
`LegalNoticeEmail`, which this does not touch.

## Retention and restores

- Revoke is soft: `revoked_at` is set and the row stays, because viewer
  saved progress is purged 30 days after the last link ended
  (`sweepViewerArtifactStorage`, keyed on `revoked_at`, `expires_at` and
  `takedown_at` of the links and the artifact's `takedown_at`). Deleting the
  artifact (`deleteArtifacts`) still removes its link rows together with its
  versions and viewer storage.
- Report rows are never deleted with the artifact; the report sweep removes
  closed ones after 12 months (24 for a copyright removal).
- A D1 restore revives revoked and taken-down links, restores, report
  decisions and lifts the user-scope sharing deny grant; replay them from
  Axiom by share id, artifact id, report id and user id
  (`docs/d1-restore-reconciliation.md`, "Artifacts").

## Client

- `app/pages/artifacts/[token].vue` (route `/artifacts/<token>`) in the
  chrome-free `artifact-share` layout (no sidebar, no promo, no backlink).
  SSR never fetches: it renders the loading state with the neutral title
  "Shared artifact", so link-preview scrapers never get the artifact title.
  The page reads the token from the route param and checks it against
  `ARTIFACT_SHARE_TOKEN_PATTERN` (`^[A-Za-z0-9_-]{43}$`); anything else shows
  "This link is not available" without a request. A valid token is sent
  only in the `x-besidka-artifact-share` header (`useFetch` with
  `server: false`, `immediate: false`, `watch: false`, a fixed key and
  `execute()`). A change of the param clears the data and fetches again, and
  the Frame is keyed by the token, so moving from one link to another never
  shows the previous artifact. Banner region with the AI line, "Never enter
  passwords or payment details here.", the Report button and, only when the
  link allows saving and the viewer is signed out, "Sign in to save your
  progress". A visually hidden "Skip to report" link precedes the frame. 404
  and 410 states render inside the page, so a dead token never raises a
  Nuxt error that prints the raw path. The token is never in the title or
  any head tag.
- Sign in from a link: the caption goes to
  `/signin?next=/artifacts/return` and, on click, writes the token to
  `sessionStorage` under `artifacts:share-return`
  (`ARTIFACT_SHARE_RETURN_STORAGE_KEY`, wrapped in try/catch), so the token
  is never in a sign-in query string. `resolveSafeNextPath`
  (`shared/utils/auth-redirect.ts`) accepts `/artifacts/return` (exactly,
  query and hash dropped) for sign-in, sign-up, 2FA, OAuth `callbackURL` and
  the signed-in guest redirect. `return` is a reserved segment, never a valid
  token (a token has 43 characters). On `/artifacts/return` the page reads
  the key once, removes it, and, when it is a valid token, calls
  `router.replace({ path: '/artifacts/<token>' })`, a client-side navigation
  that makes no server request, then loads the link; otherwise it shows
  "This link is not available". The key is listed in the cookie dialog
  (necessary) and in the Cookie Policy.
- The Frame takes the source `public-share` with the token and the link's
  capabilities: storage and the bridge turn on only for a signed-in viewer
  with their own flag and a link that allows it; anonymous viewers get
  memory storage and no handlers, so nothing reaches the server.
- `app/components/Artifact/ReportModal.client.vue` serves the link
  page and the shared-chat Report button; Turnstile (action `report`) only when signed
  out and a site key is set. Its optional `version` prop goes into the body;
  the shared-chat button passes the version the panel shows. A signed-in
  reporter is told the receipt goes to their account email.
- `app/components/Chat/Artifact/ShareModal.client.vue` from the panel's
  actions menu (owner, `artifacts.share`) and from the library row; default
  duration one week. The panel menu's `mousedown` is default-prevented
  (`@mousedown.prevent` on `artifact-actions-menu`): Safari does not focus a
  pressed button, so focus fell back to the panel (`tabindex="-1"`), the
  menu's `focusout` handler closed the menu before the click landed, and
  "Share link" (and every other item) did nothing in Safari (BES-364).
- `app/pages/admin/artifact-reports.vue`, the report detail in the side
  panel with a read-only preview (memory storage, no bridge) and the direct
  takedown form; an admin-only "Content reports" Search popup row. The
  preview has a version select (v1 to the current version, opening on
  `previewVersion`, the reported one marked "(reported)").
- `app/plugins/cloudflare-web-analytics.client.ts` never loads the beacon on
  `/artifacts` (any case, also `/artifacts/...`) or when `?next=` points
  there.

## MCP (A-8)

`share_artifact` (scope `artifacts:share`), `list_artifact_shares` and
`revoke_artifact_shares` use the same helpers. MCP links always expire within
30 days, never allow storage or the bridge, carry `createdVia: 'mcp'` and the
OAuth client id (the owner's list shows "Created by connected app <name>"),
return the deterministic PII warnings, and are capped at 10 per user per day.
See `docs/mcp-server.md`, "The artifacts scopes".
