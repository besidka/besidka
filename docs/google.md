# Google: Drive, Calendar and Gmail (Phase 4b)

Status: **in progress** (2026-11-22) on the umbrella branch
`feat/google-connectors`. Built so far: the four `google.*` flags in
`shared/utils/features/registry.ts` (stage `internal`, `optIn: 'required'`;
only `google.drive` is `available: true`), `shared/utils/google-scopes.ts`,
`shared/utils/google-data-policy.ts`, the schema child's single migration
(section 8), and the connection flow of the connections child (section 9):
connect and disconnect Google Drive with Besidka's client, the token store,
and deletion when Google access ends. No Picker, no Drive tool and no legal
text exists yet. This file grows with every child of the umbrella; each
child replaces a "design" marker below with what was built.

Binding inputs: `docs/legal/prechecks/google.md` (G-11, BES-313) and
`docs/agentic-capabilities-roadmap.md`. Where this file and the pre-check
disagree, the pre-check wins until it is amended.

## 1. Overview and scope

Phase 4b lets a user bring Google content into a chat and, for the owner
only, work with mail and calendar:

| Capability | Flag | Client | Scopes | State |
|---|---|---|---|---|
| Pick Drive files, read them, save one file back | `google.drive` | Besidka's client | `drive.file` and identity | Connection built (section 9); Picker and tools design |
| Calendar text: list events, find free time, create an event | `google.calendar` | Either client | `calendar.events` (provisional) | Design |
| Connect Google with the user's own OAuth client | `google.byo` | Owner's own client | `drive.readonly` and identity | Design, owner-only |
| Gmail: search, read a thread, create a draft | `google.gmail` | Owner's own client | `gmail.readonly`, `gmail.compose` | Design, owner-only |

`google.gmail` is a child of `google.byo`, which is a child of `google.drive`:
a child is on only while every flag above it is on. Every flag needs the
user's opt-in because each one sends Google data to Google or, through a chat,
to a model provider.

Delivery: one parent PR into `main` with a preview, children opened with
`--base feat/google-connectors` (`docs/stacked-prs.md`, "Umbrella pattern").
Child one owns every D1 migration. Owner decision of 2026-11-21: nothing else
in the agentic program starts until Phase 4b is finished.

## 2. The two client modes

| | Besidka's client (`besidka`) | Bring your own client (`byo`) |
|---|---|---|
| Who | Every user the flag reaches | The owner only, behind `internal` |
| OAuth client | The Google Cloud project `chernenko-chat` | A project the owner creates and publishes "In production" |
| Scopes | `drive.file`, identity, later `calendar.events` | `drive.readonly`, `gmail.readonly`, `gmail.compose`, `calendar.events`, identity |
| Picker | Yes: the Picker needs the API key and project number of the project that owns the client | No |
| Restricted scopes | Never | Yes, on the owner's own project |
| Callback | `/api/v1/google/oauth/callback` | `/api/v1/google/byo/callback`, a separate path so a block of one does not take down the other |

Why BYO stays owner-only: no Google text permits or forbids a hosted service
that runs many users' personal OAuth clients, and the pre-check recommends
NO-GO for the public (question row 1 and "Owner items"). Public Gmail waits
for Google's official Workspace MCP servers to leave Developer Preview. Use of
the owner's own project by the owner is personal use. Hard rule for every BYO
and Gmail route: check the admin role, not only the flag stage.

`shared/utils/google-scopes.ts` is the single map of scope strings. It lists
which client may request each capability, normalizes the short identity names
(`email`, `profile`) to the expanded `userinfo.*` form Google returns, and
exposes `hasScopes(granted, required)` for the comparison after every
callback. A spec asserts that Besidka's client can request no BYO-only scope.
Calendar is marked provisional until a narrower Calendar scope has been
checked in the Cloud console.

## 3. G-1 questions: Picker and token

Answer on `localhost` against the connection code of the connections child, as
a gate before the Picker child. Answers are recorded here, in the same PR.

| # | Question | Where the answer goes | Answer |
|---|---|---|---|
| 1 | Is the Picker's app id the project number of the project that owns the OAuth client? | Picker child | |
| 2 | Can the Picker reuse an access token the server issued, or must the browser run its own token flow? Does that need Google Identity Services and therefore JavaScript origins on the client? | Picker child, console step | |
| 3 | Does the grant for a picked file persist on the token, so the server can read the file later with `drive.file`? | Picker child | |
| 4 | Do files from shared drives and files shared with the user work with `drive.file` after a pick? | Picker child | |
| 5 | Which fields does the Picker return for a pick (id, name, MIME type, modified time, size), and is the modified time enough to detect a stale snapshot? | Picker child | |
| 6 | Does the Picker open and return correctly in iOS Safari and in the installed PWA (popup, focus, return to the chat)? | "Done" list of the Picker child | |
| 7 | Does the Picker set cookies the Cookie Policy must list? | Legal child (G-10) | |
| 8 | Can text be extracted from Google-native files (Docs, Sheets, Slides) through export, and what are the size limits? | Drive tools child | |
| 9 | Does the token endpoint return the expanded `userinfo.*` identity scopes, so `hasScopes` compares the stored set correctly? | Connections child | |
| 10 | Is `calendar.events` sensitive or restricted in the console, and is there a narrower scope that fits the Calendar tools? | Console step G-2, Calendar child | |
| 11 | Does Google's official Workspace MCP work with `drive.file` alone? | Later, not in this phase | |

## 4. Google Cloud console configuration

Project: `chernenko-chat`. Nothing below is done by an agent. No client id,
client secret or API key is written in this repository; the Picker API key and
project number are public values the owner sends and an agent then commits as
public variables.

### 4.1 Redirect URIs on Besidka's client

The callback path is `/api/v1/google/oauth/callback`. The redirect URI sent in
the OAuth request is built from the request's public origin
(`server/utils/request-public-origin.ts`), not from the configured base URL,
because on a preview the base URL points at the long-lived preview, which runs
`main`.

| Where | Redirect URI |
|---|---|
| Local development | `http://localhost:3000/api/v1/google/oauth/callback` |
| Long-lived preview | `https://preview-besidka.chernenko.workers.dev/api/v1/google/oauth/callback` |
| Pull-request preview | `https://pr-<n>-besidka.chernenko.workers.dev/api/v1/google/oauth/callback`, added once the parent PR number `n` exists |
| Production | `https://besidka.com/api/v1/google/oauth/callback` |

JavaScript origins are added only if question 2 above says the Picker needs
Google Identity Services. After the merge the `pr-<n>` URI is removed.

### 4.2 Picker API key

| Setting | Preview key | Production key |
|---|---|---|
| Referrers | `https://*-besidka.chernenko.workers.dev/*`, `localhost:3000`, `https://docs.google.com/*` | `besidka.com/*`, `docs.google.com/*` |
| API restriction | Google Picker API only | Google Picker API only |

The Picker also needs the project number as its app id (question 1).

### 4.3 Data access, verification and branding

| Step | Needed for | State |
|---|---|---|
| Add `drive.file` under Data access and confirm it is non-sensitive | Connections child | Owner, open |
| Brand verification with Search Console proof of the authorized domain | Leaving test users with `drive.file` | After the legal child is live |
| `calendar.events` verification: Limited Use statement live, demo video in English with a test account, consent screen app name and client id visible | Calendar for the public | After the legal child is live |
| Check the Calendar scope table for a narrower scope | Calendar child | Open (question 10) |

### 4.4 Branding

Always "Google Drive" in full, the Drive logo unmodified, a tooltip such as
"Save to Google Drive" on an icon button, and Besidka's logo larger when both
appear. Gmail and Calendar appear as text only until their brand guidelines
are checked.

## 5. The data rule

Once a chat holds Google data, every model call in that chat obeys the
allow-list. The pre-check's table is data in
`shared/utils/google-data-policy.ts`, with the source date of each row
(2026-11-07).

| Recipient | Verdict | Condition |
|---|---|---|
| Anthropic, OpenAI, xAI | Allowed | None (xAI: which terms bind a self-serve key is unverified) |
| Google (Gemini API) | Conditional | The user confirmed the key is on a project with billing enabled |
| Qwen | Conditional | Only models Alibaba serves itself |
| DeepSeek, Moonshot AI | Refused | Blocked, shown unavailable with the reason |
| Vercel AI Gateway | Conditional | Zero data retention sent, and the upstream provider is allowed |
| OpenRouter | Conditional | Zero-data-retention endpoints requested, and the upstream provider is allowed |
| Cloudflare AI Gateway | Conditional | Payload logging off, and the upstream provider is allowed |
| Cloudflare Workers AI | Allowed | Only through the Cloudflare gateway, whose condition still applies |
| Brave, Exa, TypeSafe AI | Refused | Skipped in a flagged chat until the owner checks their terms |

Anything not in the table is refused. The evaluator takes the conditions the
caller has verified; it never assumes one.

Rules that go with the table:

- A chat is flagged as carrying Google data from the first Google part or tool
  result. A flagged chat is excluded from memory extraction, and sharing it
  needs an explicit opt-in that names the Google content.
- Tool results from Drive, Gmail and Calendar are saved as references only
  (id, title or subject, date). The model sees the body only in the turn that
  fetched it.
- Google tools ask before they run ("Allow once" or "Allow in this chat"); no
  "Always allow". Writes ask once only. There is no tool that sends mail.
- Copies of Google files live in the user's files with
  `external_source = 'google'` (`GOOGLE_EXTERNAL_SOURCES`, one value, as the
  pre-check says) and are labeled at attach time ("Saves a copy in your
  Besidka files for 30 days"). They are kept out of MCP `list_files` and
  `read_file`, and a flagged chat is withheld or marked in `get_chat`.
- Save to Drive is per file and user-initiated, never automatic or bulk.

### 5.1 What is deleted, and when

When Google access ends, Besidka revokes the token at Google, deletes the
stored tokens, and deletes every file with `external_source` in
`GOOGLE_EXTERNAL_SOURCES` together with its R2 object, within 24 hours.
"Access ends" means:

- the user disconnects in Besidka (synchronous);
- a refresh returns `invalid_grant` (the connection becomes `needs_reauth`);
- the account is deleted;
- the hourly sweep finds either of the above that was missed.

A D1 Time Travel restore brings connections back; the post-restore runbook
has a "wipe Google tokens" step (2d) in `docs/d1-restore-reconciliation.md`.

## 6. Owner runbook outline: bring your own client

Design only. Written in full by the BYO child. The values are pasted into the
app and never into chat, files or tickets.

1. Create a Google Cloud project of your own and enable the Gmail, Drive and
   Calendar APIs.
2. Configure the consent screen with a name that shows both the owner and
   Besidka, a homepage and a privacy policy on `besidka.com`, and publish it
   "In production" (Testing mode expires refresh tokens after seven days).
3. Create a Web client with the redirect URI for the host in use, path
   `/api/v1/google/byo/callback`: localhost, the long-lived preview, `pr-<n>`
   or production.
4. Paste the client id and secret into the app as a key of the Google kind.
5. Connect, approve the scopes, and check that the granted set equals the
   requested set.
6. To stop: disconnect in Besidka, then remove the project's client or its
   secret in the Cloud console; breach handling rotates the secret there
   (`docs/legal/breach-runbook.md`, to be extended).

There is no public BYO guide page and no video: a page under
`content/key-guides` would be public on `/guides`, in the sitemap and in
`llms.txt`.

## 7. Not in this phase

- Media for the launch content (BES-423), a public BYO guide or video, public
  BYO, sending Gmail, Gmail attachment downloads, a Workspace MCP preset
  while the servers are in Developer Preview.
- Folder picking, Docs editing, background or scheduled reads, Cross-Account
  Protection signals, a KMS for token keys, Drive files as project knowledge.
- Any legal notice or consent version change. The Privacy Policy and Terms
  text for Google is written by the legal child, hashed, and then the owner
  decides whether and when to announce it in `/admin/legal`. An agent never
  schedules, approves or sends a notice.
- A `beta` stage or percentage rollout for any `google.*` flag.

## 8. Data model

One migration owns the whole phase; no other child generates one. Every
addition is `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN` (nullable, no SQL
default) or `CREATE INDEX`, so no existing table is rebuilt. Nothing here has
a foreign key to `users`; account deletion removes the rows explicitly.

`google_connections` (`server/db/schemas/google-connections.ts`), one row per
user and client mode (unique `(user_id, client_mode)`, index on `user_id`):

| Column | Type | Consumer |
|---|---|---|
| `user_id` | integer, not null | every lookup; purge |
| `client_mode` | text `besidka` or `byo`, not null | the connection flow and the client resolver |
| `google_subject` | text | the callback: a different subject for the same mode revokes the old grant and replaces the row |
| `google_email` | text | the connection card in the Google tab and `login_hint` on reconnect; never returned by MCP |
| `granted_scopes` | JSON array of strings, not null | `hasScopes` after every callback and before every token use; the picker-token gate |
| `refresh_token`, `access_token` | text, encrypted with `useEncryptText`, null after revoke | `server/utils/google/tokens.ts` only |
| `access_token_expires_at` | timestamp | lazy refresh under the KV lock |
| `status` | text `active`, `needs_reauth` or `revoked`, not null | the access-ended sweep and the reconnect prompt |

Columns on existing tables:

| Column | Type | Consumer |
|---|---|---|
| `chats.google_data_at` | timestamp | the provider allow-list guard (child 3): set from the first Google part or tool result, never cleared |
| `files.external_source` | text, one of `GOOGLE_EXTERNAL_SOURCES` | Drive snapshots (child 5); deletion when access ends (child 2) |
| `files.external_id` | text | the Drive file id of a snapshot; reuse of an unchanged snapshot |
| `files.external_modified_at` | timestamp | live sync: re-export when Drive's `modifiedTime` is newer |
| `files.drive_copy_id` | text | the id of the copy saved to Drive, so a second "Open in Google" or "Save to Google Drive" opens the same copy (BES-283 owner addendum); kept apart from `external_*`, which describe files imported from Google |
| `keys.paid_tier_confirmed_at` | timestamp | the `gemini-paid-tier-confirmed` condition of the allow-list |

`idx_files_user_external` is a partial index on
`(user_id, external_source, external_id) WHERE external_source IS NOT NULL`,
so the rows of ordinary uploads add nothing to it. A query that selects Google
files must compare `external_source` with a value (`=` or `IN`), which implies
the predicate.

A connection's `connectedAt` is `created_at`. The end of access has no
timestamp of its own; `status` and `updated_at` carry it. The access-ended
sweep never reads them per mode: files carry no client mode, so it deletes a
user's Google files only when the user has no `active` connection at all
(section 9.6). A lingering `needs_reauth` row of one mode therefore never
deletes the copies of another, still active, mode.

Rotating `NUXT_ENCRYPTION_KEY` without re-encrypting breaks every stored
Google token; users reconnect.

## 9. Connecting Google (connections child, G-3)

Built on `feat/google-connections`. Code: `server/utils/google/`
(`client.ts`, `http.ts`, `oauth.ts`, `oauth-state.ts`, `refresh-lock.ts`,
`tokens.ts`, `store.ts`, `connection.ts`, `access-ended.ts`, `route.ts`),
`server/api/v1/google/`, `server/plugins/google-access-sweep.ts`,
`app/components/Profile/Google/Connection.vue` and the Google tab of
`app/pages/profile/keys.vue`.

### 9.1 Routes

| Method and path | What it does | Gate |
|---|---|---|
| `POST /api/v1/google/oauth/start` | Body `{ returnTo? }`; answers `{ authorizationUrl }` for the browser to open | Same-origin write guard, session, `google.drive` active, 10 per minute |
| `GET /api/v1/google/oauth/callback` | Google's redirect target; always redirects to the return path with `?google=<result>` | Session, `google.drive` active, 20 failed callbacks per 10 minutes per IP |
| `GET /api/v1/google/connections` | `{ connection }`: client mode, status, Google email, granted capabilities, connected date; never a token | Session, `google.drive` active, 60 per minute |
| `POST /api/v1/google/connections/disconnect` | Revokes, deletes the copies, deletes the row; `{ disconnected, filesDeleted, filesPending }` | Same-origin write guard, session, `google.drive` active, 10 per minute |

`google.drive` must be active (enabled for the user and opted in); otherwise
every route answers 404. The result values are `connected`, `denied`
(`error=access_denied`), `missing_scope`, `expired` (no such state) and
`error`; the reason is logged, never put in the URL. A token, the code, the
state value or an email never appears in a URL Besidka generates.
`server/plugins/evlog-request-observability.ts` drops the callback's query
from the wide event.

### 9.2 Flow, state and PKCE

1. Start resolves the client (`resolveGoogleClient`: Besidka's mode reuses
   `googleClientId` and `googleClientSecret`, the sign-in client; the BYO
   mode answers 404 until its child), builds the redirect URI from
   `resolveRequestPublicOrigin` plus `/api/v1/google/oauth/callback`, creates
   a 32-byte state and an S256 PKCE pair, and stores
   `{ userId, clientMode, codeVerifier, redirectUri, returnTo, createdAt }`
   encrypted under `google:oauth:<state>` for 600 s. `returnTo` must pass
   `resolveSafeNextPath`; otherwise it is `/profile/keys?tab=google`
   (`google` is a valid tab of `KEYS_PAGE_TAB_IDS`).
2. The consent URL carries `access_type=offline`,
   `include_granted_scopes=true` (incremental authorization, as BES-273
   decided), the scopes `openid`, `userinfo.email`, `userinfo.profile` and
   `drive.file` (never Calendar or a BYO scope), `prompt=consent` only when
   no refresh token is stored for the mode, `select_account` when there is
   no `login_hint`, and the stored email as `login_hint` on a reconnect.
3. The callback deletes the state on first read (single use), refuses it
   when it is older than 600 s or belongs to another user, exchanges the code
   with the stored verifier and the exact stored redirect URI, and compares
   the granted scopes with `hasScopes(granted, [drive.file])`. A grant
   without `drive.file` is revoked at once and nothing is stored.
4. The Google account comes from the ID token in the token response: issuer
   `accounts.google.com`, audience equal to the client id, not expired. It
   arrived straight from the token endpoint over TLS, so the signature check
   is skipped (OpenID Connect Core 3.1.3.7); there is no userinfo call.
5. A different Google subject for the same mode first revokes the old grant,
   marks the row `revoked` and deletes the old account's copies; if that
   cleanup cannot finish, the new grant is revoked and the result is `error`.
   A first connection without a refresh token is refused the same way.
6. The row is upserted on `(user_id, client_mode)` with status `active`.

### 9.3 Token storage and key management

Tokens are encrypted with `useEncryptText` (`NUXT_ENCRYPTION_KEY`, the same
path as the `keys` table) and decrypted only in `server/utils/google/tokens.ts`;
`tests/unit/server/utils/google/token-boundary.spec.ts` fails if any other
server file reads the token columns. They are never logged, never returned
by a route and never sent to the browser (the Picker token of a later child
is the one planned exception). Key-management position (pre-check row 12): a
Worker secret is acceptable for `drive.file`, a non-sensitive scope; a KMS or
HSM-backed key is required before any public restricted-scope path. Rotating
`NUXT_ENCRYPTION_KEY` without re-encrypting makes every stored token
undecryptable; `getGoogleAccessToken` then ends the connection like
`invalid_grant` and users reconnect.

### 9.4 Getting a token and the refresh lock

`getGoogleAccessToken({ userId, clientMode, requiredScopes })` answers
`ok`, `not_connected`, `needs_reauth` or `missing_scope`;
`requireGoogleAccessToken` turns the last three into 404 or 409. The cached
token is used while it has more than 120 s left. Otherwise one request
refreshes under `google:refresh:<connectionId>` (KV entry of 60 s with its
own 30 s expiry, read-write-read like `connectors:refresh:`). A request that
loses the lock waits up to three times 500 ms for a new access token on the
row, then answers 503 instead of spending the refresh token twice. Every
write is a compare-and-set on the refresh-token ciphertext that was read, so
a parallel rotation or a reconnect is never overwritten. A rotated refresh
token from Google is stored; otherwise the old one is kept. Timeouts, 5xx
and errors other than `invalid_grant` (for example `invalid_client` after a
secret rotation) throw 502 or 504 and never end a connection.

### 9.5 Outbound requests

`googleFetchJson` (`server/utils/google/http.ts`) is the only way the server
calls Google: HTTPS on an exact host of `GOOGLE_FETCH_HOSTS`
(`oauth2.googleapis.com` today; `accounts.google.com` is opened by the
browser only), `redirect: 'manual'` with any 3xx refused, a 15 s timeout
that covers the body, a 64 KiB answer cap, form bodies (the revoke token goes
in the body, never the URL). Every caller awaits each call before the next,
so a request holds one Google connection at a time, well under the six
simultaneous connections a Worker allows.

### 9.6 When access ends

| Event | Revoke at Google | Tokens | Copies with `external_source` in `GOOGLE_EXTERNAL_SOURCES` | Row |
|---|---|---|---|---|
| Disconnect | Refresh token (ends the grant), best effort, logged with ids | Cleared | Deleted before the answer | Deleted when the cleanup finished, else left `revoked` for the sweep |
| `invalid_grant` on refresh | The old access token if it was still valid, best effort | Cleared | Deleted at detection | `needs_reauth` |
| Different Google account connects | Old refresh token | Replaced | Old copies deleted first | Replaced |
| Account deletion | Every stored grant, one at a time, 10 s deadline, never blocks | Deleted with the row | Deleted with the user's `files` | Deleted (`purgeUserGoogleConnections`) |
| Hourly sweep | No | Cleared on any row that is not `active` | Deleted for users with Google files and no `active` connection, 25 users per run | `revoked` rows removed once nothing is left |

The deletion (`deleteGoogleDerivedFiles`) works in batches of 50: one R2
batch delete per batch (with derived Office text keys), the KV file cache one
key at a time, the D1 rows, the documents and knowledge texts that pointed at
them, then the storage cache. An R2 failure stops before D1 so the sweep can
retry. Files carry no client mode, so copies are deleted only when no other
connection of the user is still active; with Besidka's client the only mode
in use, that is always the case today. The BYO child must revisit this if
BYO ever makes copies of its own. The sweep runs on the `0 * * * *` cron and
has no flag on purpose; crons do not run on Cloudflare Previews, so on a
preview only the synchronous paths delete.

### 9.7 KV keys

| Key | Value | TTL |
|---|---|---|
| `google:oauth:<state>` | Encrypted pending connection | 600 s, deleted on first read |
| `google:refresh:<connectionId>` | Refresh lock owner and time | 60 s entry, 30 s lock |
| `google:callback-failures:<sha256(ip)>` | Failed callback count | 10 minutes |
| `google-rate-limit:<userId>` | Writes per minute (start, disconnect) | At least 60 s |
| `google-read-rate-limit:<userId>` | Status reads per minute | At least 60 s |

### 9.8 Logging

Wide events carry `attributes.google` (steps, outcomes, connection ids,
counts of granted scopes), `attributes.googleToken` (refresh outcome:
`refreshed`, `waited`, `lost-race`, `superseded`, `invalid-grant`,
`undecryptable`, `lock-busy`, `failed` with Google's error code),
`attributes.googleAccessEnded` and `attributes.googleAccessSweep` (counts),
and `attributes.googlePurge`. Never a token, a code, a state value, an email
or a file name.

### 9.9 UI

The API Keys page gets a Google tab, last, only while `google.drive` is
active; it holds one bubble with the Google Drive card. Not connected: one
sentence ("Besidka can only see the files you pick.") and Connect Google
Drive. Connected: the Google account's email, what Besidka can access, and
Disconnect behind a confirmation that says the Google Drive files copied
into Besidka will be deleted, also whenever Google access ends. Needs
re-authorization: a warning and Reconnect. The callback's `?google=` value
becomes a toast and is removed from the URL. The card is on an existing page,
so there is no new profile tab and no search popup row.

### 9.10 Testing locally

Add `http://localhost:3000/api/v1/google/oauth/callback` as a redirect URI on
the Google client whose id and secret are in `.dev.vars`
(`NUXT_GOOGLE_CLIENT_ID`, `NUXT_GOOGLE_CLIENT_SECRET`), add `drive.file`
under Data access and your account as a test user, give yourself the
`google.drive` flag (admin role or a grant) and opt in under Labs, then use
the Google tab on `/profile/keys`. Specs mock Google entirely
(`tests/setup/helpers/google-connections.ts`); no test calls Google.

### 9.11 Open items

- The connection reuses the sign-in OAuth client. Check with a real account
  whether revoking the Drive grant also ends the user's "Sign in with Google"
  grant for Besidka (Google revokes per client and user); if it does,
  sign-in still works but asks for consent again.
- While `google.drive` is off for a user who is still connected, every route
  answers 404, so the user cannot disconnect in Besidka (revoking at
  myaccount.google.com/permissions still works, and the next refresh then
  ends the connection and deletes the copies).
- G-1 question 9 (does the token endpoint return the expanded `userinfo.*`
  scopes) is still open; the comparison needs only `drive.file`, so either
  answer works.
- The KV refresh lock is best effort across locations; the D1
  compare-and-set settles the rare double refresh.
