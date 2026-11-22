# Google: Drive, Calendar and Gmail (Phase 4b)

Status: **design, not built yet** (2026-11-22). Only the contracts exist on
the umbrella branch `feat/google-connectors`: the four `google.*` flags in
`shared/utils/features/registry.ts` (all `available: false`, stage
`internal`, `optIn: 'required'`), `shared/utils/google-scopes.ts` and
`shared/utils/google-data-policy.ts`, and the schema child's single migration
(section 8). No route, no UI and no legal text exists. This file grows with every child of the umbrella; each
child replaces a "design" marker below with what was built.

Binding inputs: `docs/legal/prechecks/google.md` (G-11, BES-313) and
`docs/agentic-capabilities-roadmap.md`. Where this file and the pre-check
disagree, the pre-check wins until it is amended.

## 1. Overview and scope

Phase 4b lets a user bring Google content into a chat and, for the owner
only, work with mail and calendar:

| Capability | Flag | Client | Scopes | State |
|---|---|---|---|---|
| Pick Drive files, read them, save one file back | `google.drive` | Besidka's client | `drive.file` and identity | Design |
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
| `last_refreshed_at`, `last_used_at` | timestamp | named by BES-273 with no reader in its routes or card; open for the connections child to use or cut (`last_used_at` costs a D1 write on every token use) |

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
timestamp of its own; `status` and `updated_at` carry it. How the access-ended
sweep reads them is the connections child's design: with two modes per user,
a lingering `needs_reauth` row of one mode must not make it delete the files
of the other, still active, mode.

Rotating `NUXT_ENCRYPTION_KEY` without re-encrypting breaks every stored
Google token; users reconnect.
