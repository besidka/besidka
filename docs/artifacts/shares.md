# Artifact share links, reports and takedown (A-7, BES-269)

Public links to one artifact at `besidka.com/a/<token>`, the report flow for
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
- The token never travels in an API path. The page is `/a/<token>`; its API
  calls send the token in the `x-besidka-artifact-share` header
  (`ARTIFACT_SHARE_HEADER` in `shared/utils/artifacts.ts`).
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
those two routes as guarded by the global rule.

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

`nuxt.config.ts` `routeRules['/a/**']`: `cache: false`,
`Cache-Control: private, no-store`, `Content-Security-Policy:
frame-ancestors 'none'`, `Referrer-Policy: no-referrer`,
`X-Robots-Tag: noindex, nofollow`. `/a/**` is in the sitemap `exclude` and
deliberately **not** in `robots.disallow`: a disallowed URL is never fetched,
so its noindex would never be read (`docs/seo.md`).

`server/plugins/artifacts-frame-src.ts` adds `frame-src 'self' <artifacts
origin> <Turnstile>` on `/chats/`, `/shared/`, `/a/` and `/admin/` (the admin
report drawer frames artifacts). Nitro sets route-rule headers on the event
before rendering and the renderer then overwrites them with its own, so the
plugin merges into the event's policy when the renderer has none: `/a/` pages
send `frame-ancestors 'none'; frame-src ...`.

## Log redaction

The SSR request for `/a/<token>` carries the token in its path. The
`evlog:enrich` hook in `server/plugins/evlog-request-observability.ts` rewrites
`/a/<anything>` (and the percent-encoded `%2Fa%2F<anything>` that sign-in
and sign-up links carry in `?next=`) to `/a/[token]` in `request.path` and walks the whole wide event
(path, message, nested error fields, browser-ingested events) before any
drain (Axiom, console, file) sees it (`redactArtifactShareTokens`). The
header is never part of a wide event: request headers only reach the drain
context, and Axiom receives the event alone.

Verified on a dev server: `GET /a/<token>` produces a wide event with
`path` and `message` `/a/[token]`, and the page response carries
`content-security-policy: frame-ancestors 'none'; frame-src 'self' <artifacts
origin> <Turnstile>` plus the noindex, no-referrer and no-store headers.

The page must not throw a fatal Nuxt error for a dead link: Nuxt's own
console error and the Vue Router "no match" warning print the raw path to
the Worker console. Render the 404 and 410 states inside the page instead.

Not covered by code: Cloudflare Workers Logs (`observability.enabled` in
`wrangler.jsonc`) record each invocation's URL on Cloudflare's side, so the
SSR request's token is visible in the Workers dashboard logs for their
retention period. Turning that off needs `observability.logs.invocation_logs:
false` or a Logpush filter; that is an owner decision, not part of this layer.

## Reports

`submitArtifactReport` (`server/utils/artifacts/reports.ts`) serves both
`POST /api/v1/artifact-shares/current/report` and
`POST /api/v1/shared/[slug]/artifacts/[artifactId]/report`:

```ts
{
  reason: 'illegal' | 'copyright' | 'privacy' | 'harmful' | 'other'
    | 'csam' | 'terrorism' | 'threat-to-life' | 'phishing'
  details: string            // 20 to 2,000 characters, trimmed
  reporterName?: string      // required except for csam
  reporterEmail?: string     // required except for csam
  goodFaith: true
  turnstileToken?: string    // signed-out reporters, when Turnstile is on
  copyright?: {              // required when reason is copyright
    work: string             // element 2
    signature: string        // element 1, the typed name
    ownerName?: string       // element 4, when acting for the owner
    unauthorisedUse: true    // element 5
    authority: true          // element 6
  }
}
```

Element 3 of the Terms of Use "Copyright complaints" section, the exact URL,
is the link or shared chat the server resolved, never a URL from the client;
element 4 is the reporter's name and email. The copyright elements are stored
as labelled lines under the reporter's text in `details` (no extra columns).

Order: body validation (400) → session → rate limit (5 an hour per user or per
hashed IP, `enforceArtifactReportRateLimit`, 429) → Turnstile for signed-out
reporters (400 `turnstile_required` without a token, 403 `turnstile_failed`
when Siteverify refuses, 503 `turnstile_unavailable` when Turnstile is
enforced but its keys are missing) → target resolution (404, 410) → insert → emails.
On the `/a/` route the link is resolved first, so a dead link answers 404 or
410 before anything else.

The row stores the link (`share_id`) or the chat share (`chat_share_id`),
`priority` (`urgent` for csam, terrorism and threat to life) and no IP.

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
| `GET /api/v1/admin/artifact-reports/[id]` | | `AdminArtifactReportDetail`: the summary plus `details`, `decisionStatement`, `receiptSentAt`, `locationUrl` (the decrypted `/a/` link or the shared chat URL) and `previewVersion` |
| `GET /api/v1/admin/artifacts/[id]/versions/[version]` | | `ArtifactVersionContent` of any user's artifact, taken down or not |
| `POST /api/v1/admin/artifact-reports/[id]/action` | `{ action: 'takedown' \| 'reject', statement: 20..4000, scope: 'share' \| 'all-shares' }` | `{ reportId, status, decision, newlyTakenDown }` |
| `POST /api/v1/admin/artifact-takedowns` | `{ target, statement: 20..4000, scope: 'share' \| 'artifact' \| 'user', legalHold?: boolean }` | `{ scope, takenDown, alreadyTakenDown, artifactIds, shareId, ownerUserId, legalHoldUntil }` |
| `POST /api/v1/admin/artifact-takedowns/restore` | `{ artifactId }` or `{ shareId }` (exactly one) | `{ restored: true, artifactId, shareId }` |

Report decisions:

- `takedown` + `share`: sets the link's `takedown_at`/`takedown_reason`;
  decision `restricted`. Needs a report about an `/a/` link: a shared-chat
  report answers 400 `report_without_share` (use `all-shares`).
- `takedown` + `all-shares`: sets the artifact's fields, so `/a/`, the
  shared-chat route and the owner view all stop on the next request;
  decision `removed`.
- `reject`: decision `no-action`.
- The report gets `status` (`actioned`/`rejected`), `decision`,
  `decision_statement`, `decided_at` and `resolved_at`. The report is closed
  first, only while it is still `open`, so two admins deciding at once cannot
  both act (the second gets 409 and nothing else is written); the takedown
  and the audit row then go in one D1 batch. A deleted artifact cannot be
  taken down (409, reject instead).

Direct takedowns resolve `target` in this order: a full `/a/<token>` link or a
bare token (hashed, looked up by `token_hash`; the target is never logged),
then for `user` a numeric user id or an email (case-insensitive), then an
artifact public id. `share` disables one link, `artifact` the artifact,
`user` every artifact of the owner. `legalHold` sets `legal_hold_until` to
six months from now (TCO Art. 6(2)), never shortening an existing hold, on
the artifact(s) even for `share`. Content already taken down is counted in
`alreadyTakenDown` and gets no second email. The takedown updates, the
legal hold and the audit row are one D1 batch; the statement of reasons is
sent after it.

Restore clears the takedown fields (the update and the audit row are one
D1 batch), keeps the legal hold and sends no email:
a restore follows a dispute handled by email from the privacy mailbox, and the
answer to the owner (and, for copyright, to the reporter) is written there.
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
| T1 receipt (Art. 16(4)) | The reporter | When they gave an email; sets `receipt_sent_at` |
| T2 decision (Art. 16(5)) | The reporter | Every decision, when they gave an email |
| T3 statement of reasons (Art. 17) | The owner | When content is newly taken down, by a report or directly |

No email contains a token, the `/a/` URL or an IP. Emails name the link by
its share id and the artifact by its title and id. The registry entries are
`content-report-receipt`, `content-report-decision` and
`content-statement-of-reasons` in `shared/utils/account-emails.ts`, so the
Privacy Policy list stays generated.

`NoticeEmail` renders the body as one paragraph in HTML (whitespace
collapses); the plain-text part keeps the line breaks.

## Retention and restores

- Revoke is soft: `revoked_at` is set and the row stays, because viewer
  saved progress is purged 30 days after the last link ended
  (`sweepViewerArtifactStorage`, keyed on `revoked_at`, `expires_at` and
  `takedown_at` of the links and the artifact's `takedown_at`). Deleting the
  artifact (`deleteArtifacts`) still removes its link rows together with its
  versions and viewer storage.
- Report rows are never deleted with the artifact; the report sweep removes
  closed ones after 12 months (24 for a copyright removal).
- A D1 restore revives revoked and taken-down links, restores and report
  decisions; replay them from Axiom by share id, artifact id and report id
  (`docs/d1-restore-reconciliation.md`, "Artifacts").

## Client

- `app/pages/a/[token].vue` in the chrome-free `artifact-share` layout (no
  sidebar, no promo, no backlink). The API is fetched on the client only
  with the token in the `x-besidka-artifact-share` header, so SSR serves the
  neutral title "Shared artifact" and link-preview scrapers never get the
  artifact title. Banner region with the AI line, "Never enter passwords or
  payment details here.", the Report button and, only when the link allows
  saving and the viewer is signed out, "Sign in to save your progress". A
  visually hidden "Skip to report" link precedes the frame. 404 and 410
  states render inside the page.
- The Frame takes the source `public-share` with the token and the link's
  capabilities: storage and the bridge turn on only for a signed-in viewer
  with their own flag and a link that allows it; anonymous viewers get
  memory storage and no handlers, so nothing reaches the server.
- `app/components/Artifact/ReportModal.client.vue` serves `/a/` and the
  shared-chat Report button; Turnstile (action `report`) only when signed
  out and a site key is set.
- `app/components/Chat/Artifact/ShareModal.client.vue` from the panel's
  actions menu (owner, `artifacts.share`); default duration one week.
- `app/pages/admin/artifact-reports.vue`, the report detail in the side
  panel with a read-only preview (memory storage, no bridge) and the direct
  takedown form; an admin-only "Content reports" Search popup row.
- `app/plugins/cloudflare-web-analytics.client.ts` never loads the beacon on
  `/a/**` or when `?next=` points at `/a/`.

MCP share tools come with A-8.
