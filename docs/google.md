# Google: Drive, Calendar and Gmail (Phase 4b)

Status: **partly built** (2026-11-22), on the umbrella branch
`feat/google-connectors`. Built so far: the four `google.*` flags in
`shared/utils/features/registry.ts` (stage `internal`, `optIn: 'required'`;
`google.drive`, `google.byo`, `google.gmail` and `google.calendar` are
`available: true`),
`shared/utils/google-scopes.ts`,
`shared/utils/google-data-policy.ts`, the schema child's single migration
(section 8), the chat runtime every Google tool registers into (section 5.2:
approvals, taint, the chat flag, references-only results and the approval
panel rows), the data guard of the allow-list (section 5.3), the connection
flow of the connections child (section 9: connect and disconnect Google
Drive, the token store, and deletion when Google access ends), and the
owner-only bring-your-own client (section 10: the stored client, the admin
gate, its own callback), the MCP status and disconnect tools (section 11),
and the Drive Picker (section 12: the token route,
the import into Besidka storage, the composer row, the `data-drive-file`
part), the Drive tools (section 13: list, read and save for chat models,
and the "Save to Google Drive" action) and the Gmail tools on the owner's own
client (section 14: search, read a thread, create a draft, and Drive search),
and the Calendar tools on the owner's own client (section 15: list events,
free and busy time, create one event that invites nobody).
Not built yet: the legal text. This file grows with every
child of the umbrella; each child replaces a "design" marker below with
what was built.

Binding inputs: `docs/legal/prechecks/google.md` (G-11, BES-313) and
`docs/agentic-capabilities-roadmap.md`. Where this file and the pre-check
disagree, the pre-check wins until it is amended.

## 1. Overview and scope

Phase 4b lets a user bring Google content into a chat and, for the owner
only, work with mail and calendar:

| Capability | Flag | Client | Scopes | State |
|---|---|---|---|---|
| Pick Drive files, read them, save one file back | `google.drive` | Besidka's client | `drive.file` and identity | Connection (section 9), Picker (section 12) and the list, read and save tools (section 13) built |
| Calendar: list events, check free and busy time, create one event | `google.calendar` (a child of `google.byo`) | Owner's own client only | `calendar.events.owned` and `calendar.events.freebusy` | Built (section 15), owner-only |
| Connect Google with the owner's own OAuth client | `google.byo` plus the admin role | Owner's own client | Identity plus what the owner ticks: `drive.readonly`, `gmail.readonly`, `gmail.compose`, `calendar.events.owned` with `calendar.events.freebusy` | Built (section 10), owner-only; the tools of sections 14 and 15 use it |
| Gmail: search, read a thread, create a draft; Drive search | `google.gmail` (Drive search needs only `google.byo`) | Owner's own client | `gmail.readonly`, `gmail.compose`, `drive.readonly` | Built (section 14), owner-only |

`google.gmail` and `google.calendar` are children of `google.byo`, which is a
child of `google.drive`:
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
| Who | Every user the flag reaches | Admins only (role checked on the server, never the flag alone), behind `internal` |
| OAuth client | The Google Cloud project `chernenko-chat` | A project the owner creates and publishes "In production" |
| Scopes | `drive.file` and identity, never a Calendar scope | `drive.readonly`, `gmail.readonly`, `gmail.compose`, `calendar.events.owned`, `calendar.events.freebusy`, identity |
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
The `calendar` capability is the two narrow scopes of section 15 and is
allowed for the `byo` client only: Besidka's client never asks for a Calendar
scope, so the Drive Picker token can never carry one (and a Picker token
route refuses a grant that holds any).

## 3. G-1 questions: Picker and token

The answers below come from Google's documentation, read by a researcher on
2026-11-22. **None of them has been run against a real Google account.**
Each answer is marked: documented (the docs say it), inferred (the docs imply
it, or show it only for a neighbouring case) or NOT VERIFIED (nothing
documented; a real run settles it, see the owner checklist in section 12.9).
The Picker child built on the documented and inferred answers and put every
NOT VERIFIED one behind a clear failure path.

| # | Question | Answer | State |
|---|---|---|---|
| 1 | Is the Picker's app id the project number of the project that owns the OAuth client? | Yes. `setAppId` takes the Cloud project **number** (not the id), it is required for `drive.file`, and the OAuth client and the app id must be in the same project. What a wrong or missing id does is not documented. | Documented; wrong-id behavior NOT VERIFIED |
| 2 | Can the Picker reuse an access token the server issued, or must the browser run its own token flow? Does that need Google Identity Services and JavaScript origins? | A server-issued access token passed to `setOAuthToken` should work: the docs show Google Identity Services only as one way to get a token, and the component README says an existing token can be passed. No GIS and no JavaScript origins are needed then. The API key needs website restrictions for Besidka's origin and `https://docs.google.com/*`. The token is minted at pick time only, never cached, never the refresh token. | Inferred; only a real pick confirms it |
| 3 | Does the grant for a picked file persist on the token, so the server can read the file later with `drive.file`? | A fresh access token reaches files the user granted through the Picker earlier, and `files.get` and `files.export` accept `drive.file`. How long a grant lasts, and whether revoke plus re-grant restores old grants, is not documented. Revoking removes every scope granted to the project across its clients; refresh tokens also end after six months unused or at 100 per client; a consent screen in Testing gives seven-day refresh tokens. | Documented; duration and re-grant NOT VERIFIED |
| 4 | Do files from shared drives and files shared with the user work with `drive.file` after a pick? | `DocsView.setEnableDrives(true)` shows shared drives; `files.get` takes `supportsAllDrives`; `files.export` has only `mimeType`. Files not owned by the user are expected to work after a pick. Shared-drive files and the children of a picked folder were not documented. | Inferred; shared drives NOT VERIFIED |
| 5 | Which fields does the Picker return, and is the modified time enough to detect a stale snapshot? | `id`, `name`, `mimeType`, `lastEditedUtc`, `sizeBytes`, `url`, `iconUrl`, `parentId`, `resourceKey`, plus `driveSuccess` and `driveError` to check before reading. Staleness is judged on the server from `files.get`: `modifiedTime` is stored (`files.external_modified_at`, whole seconds). `version` is read but not stored: no column was added. `md5Checksum` and `headRevisionId` exist for binary files only. The `resourceKey` goes into the `X-Goog-Drive-Resource-Keys: <fileId>/<key>` header. | Documented |
| 6 | Does the Picker open and return correctly in iOS Safari and in the installed PWA? | The Picker is an iframe on `docs.google.com`, and the user must be signed in to Google in that browser; the token decides which account it shows. Everything about iOS Safari, the standalone PWA, third-party cookies and tracking prevention is not documented. Google documents a redirect picker in a new tab for apps (`trigger_onepick=true`), not verified for a web client, and not built here. | NOT VERIFIED |
| 7 | Does the Picker set cookies the Cookie Policy must list? | Nothing documented. Do not claim zero storage on Besidka's origin; check Web Inspector Storage on a real run (for G-10). | NOT VERIFIED |
| 8 | Can text be extracted from Google-native files through export, and what are the size limits? | Docs export to txt, md, html, docx and pdf; Sheets to csv and tsv (**first sheet only**), xlsx and pdf; Slides to txt, pdf and pptx; Drawings to pdf, png, jpeg and svg. `files.export` is capped at 10 MB. `alt=media` needs `capabilities.canDownload`; native files must use export. Quota: export and download count 200 units, a metadata read 5, 325,000 units a minute per user. That Docs accept `text/markdown` is documented in the export table; Besidka falls back to `text/plain` when Drive answers 400. | Documented |
| 9 | Does the token endpoint return the expanded `userinfo.*` identity scopes? | `scope` is space-delimited with full URLs for API scopes, and granular consent lets the user untick `drive.file` (so the scope string is checked). Whether `email` or `userinfo.email` appears and whether `openid` is listed is not documented; `hasScopes` accepts both forms. | Documented; the identity forms NOT VERIFIED |
| 10 | Is `calendar.events` sensitive or restricted, and is there a narrower scope? | `gmail.readonly`, `gmail.compose` and `drive.readonly` are restricted; `drive.file` is non-sensitive. Calendar tiers show only in the console. By the per-method scope lists the narrowest Calendar set is `calendar.events.owned` (list and create on the primary calendar) plus `calendar.events.freebusy`; the Calendar child replaced `calendar.events` with them in `shared/utils/google-scopes.ts` (section 15.2 has the method-by-method check, read from Google's reference on 2026-11-22). | Documented; Calendar tier NOT VERIFIED |
| 11 | Does Google's official Workspace MCP work with `drive.file` alone? | Google's Drive MCP is a Developer Preview that needs a special OAuth client type. Not a dependency. | Documented |

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

These URIs go on the client Drive actually uses: the dedicated Drive client
(`NUXT_GOOGLE_DRIVE_CLIENT_ID`, `NUXT_GOOGLE_DRIVE_CLIENT_SECRET`) when it is
set, otherwise the sign-in client (`NUXT_GOOGLE_CLIENT_ID`), which then keeps
its existing `/api/auth/callback/google` URIs too. The dedicated client is
required before `google.drive` leaves `internal` (section 9.12). Put it in
the same project `chernenko-chat`, so the Picker key and project number stay
valid, and give it only the Drive redirect URIs above.

### 4.2 Picker API key

| Setting | Preview key | Production key |
|---|---|---|
| Referrers | `https://*-besidka.chernenko.workers.dev/*`, `localhost:3000`, `https://docs.google.com/*` | `besidka.com/*`, `docs.google.com/*` |
| API restriction | Google Picker API only | Google Picker API only |

The Picker also needs the project number as its app id (question 1). Both
values are public: the key goes in `NUXT_PUBLIC_GOOGLE_PICKER_API_KEY` and the
number in `NUXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER` (public runtime config
`googlePickerApiKey` and `googleCloudProjectNumber`; `wrangler.jsonc` public
vars once the owner sends them, `.dev.vars` locally). While either is empty
the token route answers 503 `google_picker_not_configured` and the chat page
adds no Google frame source.

### 4.3 Data access, verification and branding

| Step | Needed for | State |
|---|---|---|
| Add `drive.file`, `openid` and `userinfo.email` under Data access and confirm `drive.file` is non-sensitive (`userinfo.profile` is not requested) | Connections child | Owner, open |
| Brand verification with Search Console proof of the authorized domain | Leaving test users with `drive.file` | After the legal child is live |
| Calendar scope verification (now `calendar.events.owned` and `calendar.events.freebusy`; the tier of each is shown only in the console): Limited Use statement live, demo video in English with a test account, consent screen app name and client id visible | Calendar for the public (Calendar runs on the owner's own client only for now, so it needs no verification for the owner's own use) | After the legal child is live |
| Check the Calendar scope table for a narrower scope | Calendar child | Done in section 15.2 (the two narrow scopes replace `calendar.events`); the console tier is still to be read |

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
  Besidka files"; section 12.10 on why the number of days is gone). They
  are kept out of MCP `list_files` and
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

### 5.2 Google tools: approvals, taint and references-only results

Built (child 4, 2026-11-22): the runtime rules every built-in Google tool
registers into. The first Google tools are the Drive tools of section 13;
the rules are proven with fake tool descriptors in `tests/unit/server/utils/tool-approval/google.spec.ts`
and with a fake registered tool through the chat route in
`tests/integration/api/chats-tool-approval-request.spec.ts` and
`chats-tool-approval-continuation.spec.ts`.

**Registering a tool.** A Google tool joins a send only through
`getGoogleSendTools` (`server/utils/tool-approval/google-send-tools.ts`),
the one place the chat route assembles Google tools, with entries built by
`buildGoogleApprovalEntry` (`server/utils/tool-approval/send.ts`):

- Nothing is offered unless tool approvals are active for the send
  (`canOfferGoogleTools`, `shared/utils/google-tool-approvals.ts`):
  `getGoogleSendTools` returns nothing and `buildGoogleApprovalEntry`
  throws, because without approvals no Google rule would run.
- The route removes every other tool named `google__` (any letter case)
  from the send (`withGoogleSendTools`), so no other tool source can slip a
  Google tool in.
- The exposed name must start with `google__` (`GOOGLE_TOOL_NAME_PREFIX`),
  matched in any letter case, or registration throws. The kind is `read`
  or `write`; any other kind is a write. A `google__` tool the send did not
  describe gets a fallback entry that is a Google write asking with Allow
  once only, never the native write entry, which runs without asking.
- The tool's `execute` only runs a call the policy cleared
  (`guardNativeWrites` covers Google reads too).
- Each tool caps its output at `GOOGLE_TOOL_OUTPUT_MAX_BYTES` (64 KiB of
  serialized JSON) and returns `{ references: [{ id, kind?, title?, link?,
  date? }], ...body }` (`GoogleToolOutput`).
- Pass the tool's chat grant hash from `readGoogleChatGrantHashes`
  (`server/utils/tool-approval/google.ts`).

**Rules** (`resolveToolApproval`, `server/utils/tool-approval/policy.ts`):

| Call | Decision | Options | What lifts it |
|---|---|---|---|
| Google read | Ask (`default`, rule 11) | Allow once, Allow in this chat | A Google chat grant with the same name and definition hash |
| Google write | Ask (`always-ask`, rule 11) | Allow once | Nothing: Always allow, the permission mode and taint are ignored |
| Connector call while the send holds `google` taint | Ask (`google-egress`, rule 12) | Allow once, Allow in this chat | The tool's Google egress grant in this chat; the call then goes through the ordinary connector rules |
| Besidka tool that is not a plain read, while the send holds `google` taint | Ask (`untrusted-output`, rule 13) | Allow once | Nothing: its Allow mode, Always allow and chat grants are ignored (`create_file`, `add_project_text`, `add_project_note`, `update_project_instructions`, `branch_chat`, `share_artifact` and every other Besidka write) |
| Besidka read after `google` taint | Its existing rules | As before | As before |
| Native write after `google` taint | Ask (`untrusted-output`, rule 2) | Allow once | Nothing (artifact and document writes now count `google` taint too) |
| Run code (provider code execution) | Not offered in a chat that holds Google data; withheld from the steps after `google` taint appears in the same send | None | Nothing |

The final order inside `resolveToolApproval`: rule 0 (invalid, Blocked),
rule 11 (Google tools), rule 10 (consent gate), the native rules (1, 2, 5,
8), rule 12 (Google egress), rule 13 (Besidka writes after Google content),
then rules 6, 7, 2, 3, 5 and 9.

No Google prompt ever offers Always allow. Blocked still denies. The
egress prompt says "Content from Google in this chat may be sent to this
connector". Its Allow in this chat stores only the egress grant, never the
ordinary chat grant: an ungranted write can ask a second time, which keeps
a send or delete tool from running unprompted after one egress answer.

**Run code.** Code execution runs in the provider's own sandbox, inside the
provider's response, so no approval can stop one call, and its code,
output and files are stored without any Google marking. In a chat that
holds Google data, the send does not offer it at all
(`withholdCodeExecutionForGoogleData`). Within one send, the step guard
(`withProviderToolEgressGuard`) removes it from every step after `google`
taint appears. Gap: on direct Anthropic routes the guard keeps every tool
declaration (Anthropic rejects tool history without them), so there code
execution stays available in the steps after a Google read of the same
send; it is dropped from the next send of that chat.

**Taint and the chat flag.** A Google call that runs records `google` taint
and the `google` read source as a tool read, so web search, URL tools and
Brave and Exa are withheld for the rest of the turn and memory writes lock.
The persist step sets `chats.google_data_at` (`markChatGoogleData`) the
first time a reply holds a Google result: a static `tool-google__*` part
with an output; a failed or model-invented `google__` call does not count.
The flag is never cleared. `chatHoldsGoogleData` reads three things: the
flag, a `tool-google__*` result in the stored parts (a chat from before the
flag), and the `holdsMarkedOrigin` extra of the chat query (a marked artifact
or document that names the chat as its origin, see section 5.3). It does not
read file parts: a Google copy or a marked file attached to a message is
found by `resolveSendGoogleContent` at send start, which flags the chat
before the guard runs. It is the one function every send, branch and later
data guard asks. A send in a flagged
chat starts with `google` taint and the Google tool read
(`presetApprovalTaint`), so the egress ask, rule 13 and the web search
hold-back survive deleting the message that held the Google part. A branch
copies the flag (`branchGoogleDataAt` in `server/utils/chats/branch.ts`,
used by the branch route, the MCP and Besidka `branch_chat` tool through
`branchChat`, and the shared-chat branch route), because a branch strips
tool parts. A `{ continue }` round restores `google` taint and the tool
read from the reply's own parts (`createToolRoundApprovalState`,
`server/utils/tool-approval/round-state.ts`).

**Records from another deploy.** A turn record with a taint kind this
version does not know reads it as `google`, the strictest kind. A pending
record with an unknown family loads with family null and the replay denies
that call (`invalid-input`). An unknown reason reads as `default` and the
answer applies to that one call only: its remember options become Allow
once, so no grant is stored.

**Grants** (no D1 change):

| Grant | Where | Key | Value |
|---|---|---|---|
| Google read, Allow in this chat | `besidka_chat_settings.alwaysAllowTools` | The exposed `google__` name | Definition hash |
| Google egress, Allow in this chat | The connector's `connector_chat_settings.alwaysAllowTools` | `google-egress:<exposed connector tool name>` | Definition hash |

The chat panel lists both under Approvals (`listChatToolApprovalGrants`):
a Google read grant as "Google · Allowed in this chat", an egress grant as
the connector tool with "May receive Google content in this chat". Reset
clears both, and they are deleted with the chat. There is no per-row
revoke for chat grants, as for every other chat grant.

**Caps.** Google calls count against the built-in calls per turn
(`TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN`, shared with Besidka tools) in the
send and on replay.

**References only.** `redactGoogleToolPartsForPersistence` runs in the
persistence chain of the chat route at every persist, pause and end: a
Google result keeps only its sanitized references, `bodyRemoved: true` and
a short `note` for the model ("kept only for the reply that fetched it");
an error keeps one fixed sentence. The part count, type, state and tool
call id stay, so a resumed reply never shrinks and the flag scan still
finds the call. For a turn paused for approval, the bodies live only in KV
and the continuation gives them back to the model (`stashedResults` in
`buildResumedAssistantMessages`); the stored parts stay references.

What is NOT redacted, and why: a Google tool's input stays in the stored
part. A write's input (a draft, an event title and description) is content
the user and the model composed, not data fetched from Google, and the
approval step shows it to the user. It may still quote Google content the
model read earlier; the data guard child decides what leaves the chat.
Assistant text that summarizes a Google result is not redacted either.

| KV key | Holds | TTL | Deleted by |
|---|---|---|---|
| `tool-approval:result:<id>`, `<id>` = base64url SHA-256 of message public id and tool call id | One Google result body or error text of a paused turn, with user, chat and message ids checked on read | 24 hours | A finished continuation (`deleteResumedTurn`), a new user message, chat deletion and account purge, through the `resultIds` list of the per-chat index `tool-approval:chat:<chatPublicId>` |

The stash is written by `recordToolApprovalPause` with the pause records,
and every id of one pause (pending, turn and result ids) goes into the
per-chat index in ONE write, because KV takes about one write a second per
key. Result ids have their own bounded list (`resultIds`, 200), so stashed
bodies never push pending approvals out of the index. The stash runs only
when a pending record was written, so a pause nobody can answer leaves no
body behind. A body over 64 KiB is stored as its references with a note
that it was too large and the user should narrow the request; a missing,
foreign or unreadable record gives the model the references with a note
that the content could not be kept. The continuation never fails over a
stash.

**Residual gaps** (for the tool children; section 5.3 closed the memory,
share, MCP, web search and model-recipient gaps):

- Google content still leaves through artifact and document writes the
  user approves, an artifact public link, and the user's own copy actions
  (branch, copy, export), all inside the user's control.
- Code execution on direct Anthropic routes within the send of the Google
  read (see Run code above).
- A user with more than 200 chats, or an id the index lost to its bound or
  a write race, keeps a stashed body until the 24 hour TTL.
- A pending record with an unknown access or remember option still reads
  as expired.

### 5.3 Data guard

Built (child 3, 2026-11-22). Once a chat holds Google data
(`chatHoldsGoogleData`: the sticky `chats.google_data_at`, a Google
result in the stored parts of a chat from before the flag, or a marked
artifact or document whose origin is the chat; attached files are read by
`resolveSendGoogleContent`, not by this function), its content
reaches only recipients the pre-check's allow-list accepts, and never leaves
through a side door. The guard runs on the flag and is proven with specs that
set it; the Drive tools (section 13) are the first tools that set it.

**The module.** `server/utils/google/data-guard.ts` wraps
`shared/utils/google-data-recipient.ts`, which wraps the table in
`shared/utils/google-data-policy.ts` (no copy of it). A recipient is a
direct provider and model, or a gateway and a model id. The gateway's
upstream comes from the model id: `@cf/` and `@hf/` are Workers AI,
`vendor/model` names the vendor through the alias map, anything else is
unknown and refused. Unknown, unverifiable or refused means no.

| Condition | How it is established |
|---|---|
| `gemini-paid-tier-confirmed` | `keys.paid_tier_confirmed_at` of the user's Gemini key, set by the user with the pre-check's sentence "This key is on a Google Cloud project with billing enabled". Read from D1 only for a direct Gemini model in a flagged chat. Never carried onto a gateway route: a gateway model has no Gemini key to confirm, so Gemini through a gateway is refused |
| `alibaba-served-model` | A direct Qwen model whose id starts with `qwen`, `qwq` or `qvq`: the whole curated Qwen catalog. Never carried onto a gateway route, so Qwen through a gateway is refused |
| `zero-data-retention` | Sent by Besidka on every gateway call of a flagged chat, and on no other gateway call (`planGoogleSendTools` in `server/utils/tool-approval/google-send-tools.ts` decides the candidates and the safeguards together: on a gateway, Google tools are candidates only when the chat already holds Google data, so a candidate never exists on a gateway call without the safeguards, and an ordinary gateway chat of a connected user sends the request options it always did; on a direct provider candidates need no safeguards; the candidates come from `buildGoogleSendToolCandidates`: the Drive tools for a user with an active Besidka-client connection that holds `drive.file`, the Gmail and Drive search tools of section 14 and the Calendar tools of section 15 for the admin owner with an active `byo` connection): Vercel `providerOptions.gateway.zeroDataRetention: true`, OpenRouter chat setting `provider: { zdr: true }` (the field confirmed in the installed `@openrouter/ai-sdk-provider` types, which the pre-check left to confirm). The condition counts as met only on that path (`gatewaySafeguardsSent`) |
| `payload-logging-disabled` | Sent on the same calls: the header `cf-aig-collect-log-payload: false` on the Cloudflare client |

**Enforcement points.**

| Call site | What is checked | What the user sees |
|---|---|---|
| Send start: Google content in the request (`resolveSendGoogleContent`) | Before the guard, the send looks up the files of every file part (a Google copy, `external_source` in `GOOGLE_EXTERNAL_SOURCES`, or a marked file; this is the only path that reads file parts, `chatHoldsGoogleData` does not) and every attached or referenced artifact (marked). Any hit flags the chat (`flagChatGoogleData`, not best effort) and the guard below runs on it; content new in this message also clears the share opt-in | The guard's answer below |
| Send start: marked origin (`holdsMarkedOrigin`) | A send killed after a marked artifact or document was written, before its reply was stored, leaves the row in a chat with no flag and no `data-artifact` part. The chat query of the send route and of deep research carries one extra (`chatMarkedOriginExtras`: two `exists` subqueries over `idx_artifacts_origin_chat` and `idx_documents_chat`), so a chat without such rows costs no query and no round trip. A hit counts as Google data, flags the chat (`flagChatGoogleData`, not best effort) and the guard runs on it, so a refused model never sees the artifact context or the document titles | The guard's answer below |
| Google data enters a send (`withGoogleDataFlag`, `server/utils/google/send-flag.ts`) | Every function tool of a send under tool approvals is wrapped (inside the cleared-call guard, so continuation replays too). A Google tool flags the chat right after its result exists, and not because of its own failure; the send is Google-derived from the approval of a Google call on, though, so any other tool flags before it runs once that happened (also after a failed Google call, which keeps taint), so a marked write never lands in an unflagged chat, and again after it returned if taint appeared while it ran. The write is `markChatGoogleData` with `failClosed`: one awaited `update chats set google_data_at ... where google_data_at is null` per send (`createGoogleDataFlagger`, shared by parallel callers, skipped when the chat is flagged). If it fails the tool call fails and its result is dropped. The persist step flags a Google-derived send too (flagged chat, or taint from a Google call) when the reply holds a flag trigger (`holdsStickyGoogleFlagTrigger`: a Google result that returned content, a file part or a code run), before generated images and container files are stored, so a stopped reply carries the flag; a reply with only failed or empty Google calls and no such part does not set it. A failed write fails the persist | A tool error, or the usual save error |
| Chat send, `{ continue }` rounds and approval continuations (`server/api/v1/chats/[slug]/index.post.ts`, every request kind takes the same path) | `assertGoogleDataRecipient` right after the provider or gateway is resolved, before any search, TypeSafe AI call, user message persist or model call; this covers every step of the tool loop and the search answer continuation, which reuse the same model | A 403 shown through the chat error: "This model cannot be used in a chat with Google data.", the reason and the fix (pick an allowed model, or confirm the Gemini paid tier). On a continuation the paused reply keeps the model of its pending record, so the message says the reply cannot continue and the fix is a new message on an allowed model |
| Model switch mid-chat | The same check, on the model of each send | The same error; the picker already marks the model |
| Models that search the web by themselves | `decideGoogleDataRecipient` refuses a model id that searches on its own whatever tools the send declares, with the reason `searches-by-itself`, before the provider or gateway rule: a trailing `:online` (OpenRouter's web plugin on any model), `-search-preview` or `-search-api` in the id (OpenAI's search models, also through a gateway) and `sonar` as a word of the id (Perplexity: `sonar`, `perplexity/sonar-pro`, `sonar-reasoning-pro`; `claude-sonnet` is left alone). The catalogs have no flag for this (`supportsWebSearch` only says a search tool can be switched on, and a flagged chat removes those tools), so `SELF_SEARCHING_MODEL_PATTERNS` in `shared/utils/google-data-recipient.ts` is the check, tested per pattern. Not covered: a self-searching model under another name, a provider that turns search on by a request flag the catalog does not show, and a search backend a gateway adds behind a model id without one of these markers | The picker marks the model ("This model searches the web by itself, so your Google data could reach a search service."), and a send is refused with the fix "Pick the same model without its online or search variant, or a model from Anthropic, OpenAI or xAI that does not search by itself, or start a new chat." |
| Gateway sends | `useGateway(..., { googleDataSafeguards: plan.gatewaySafeguards })`: true exactly in a flagged chat, false otherwise, so a user who only turned on `google.drive` or connected Drive keeps the request options of before | Nothing; the gateway applies its own setting. A Vercel 403 or `zdr_not_attested` on such a call becomes a Google-specific chat error in the stream (`googleSafeguardGatewayErrorOverride`: Hobby teams cannot request zero data retention, or the upstream key is not ZDR-attested). Title, the artifact bridge and deep research never send the safeguards on a gateway call (title skips gateways in a flagged chat; the bridge and research use direct keys only), so they cannot receive that error |
| Google tools (`getGoogleSendTools`) | No candidate unless tool approvals and `google.drive` are active, and on a gateway only when the chat already holds Google data; with a candidate, no tool when the send would register no other function tool either (`toolCallingAllowed` of the send route, the predicate that already gates memory, Besidka and connector tools: false for a model without tool calling, a forced tool choice, exclusive native web search or image generation; logged as `googleTools: 'tool-calling-off'`); no tool when the chat holds no Google data yet and the send declares a provider-run tool that stays callable after a Google read (direct Anthropic with any provider tool, whose route keeps every declaration; a Qwen send with `enable_search`, a request flag for the whole send: `hasUnremovableProviderTool`); then `mayReceiveGoogleData` (the guard with the plan's gateway condition, and the Gemini key read only for a direct Gemini model), because a Google result would reach the model in the next step of the same send | No Google tool is offered; the "+" menu says in one sentence where the Drive tools work (section 13.2) |
| Title (`title.patch.ts`) | A refused direct provider, or any gateway, when `chatHoldsGoogleData` (flag, or a Google result in the loaded first message) | The fallback title built from the first message, with no model call |
| Deep research (`chats/[slug]/research/index.post.ts`) | `chatHoldsGoogleData` over the loaded messages plus the send-start lookup of the new message; the research provider, before the user message is stored | The same 403 |
| Artifact LLM bridge (`artifacts/[id]/complete.post.ts`) | The bridge model, when the artifact carries the derived mark (`artifacts.google_derived_at`), so a deleted origin chat changes nothing | The same 403, before the key and caps are used |
| Derived mark on writes | Every artifact, document and file written in a send whose chat is flagged or whose approval state holds `google` taint gets `google_derived_at`: artifact create and update (native and Besidka tools), `create_document` (the document row, copied to its file at finalize), `create_file`, generated images and code execution files. Connector images are not marked (connector data) | Nothing |
| Documents with images (`resolveOwnedImageFiles`, `loadDocumentImageAssets`) | A Google copy or a marked file is refused as an image (reported as a missing id) unless the document is Google-derived: the chat tool allows it only in a flagged or tainted send, where the document is marked through the send; MCP `create_document` never allows it; the render route allows it only for a document that carries the mark, so a document made outside such a send cannot launder a marked image into an unmarked file | A tool error naming the unknown image id, or `asset_invalid` at render |
| Reading a marked item later | MCP: `list_files`, `list_artifacts` leave marked items out and `read_file`, `get_artifact`, `update_artifact` (so an edit probe and a write alike), `share_artifact` and `rename_file` answer 404 (`403` withheld notice for the Besidka tools of a send without Google data); delete, revoke and the list of shares stay open, because the owner must be able to remove their own marked item or link and they return no content. Besidka chat tools in a send without Google data or taint: listed items are left out and a direct read answers 403 with "This item holds content from Google and is not available in this chat" (withheld, see Decisions). In a flagged or tainted send the read is allowed, because that send's recipient already passed the guard. Attached at send start: flags the chat first (row 1) | The withheld notice, or not found over MCP |
| Project-level spread and free text outside the chat | In a flagged or tainted send `add_project_text`, `add_project_note`, `update_project_instructions`, `update_project_knowledge_item`, `share_artifact`, and the free-text writers `create_project` and `update_project` (the name goes into the system prompt of every chat in the project), `update_chat` (the title is listed by `search_chats`), `rename_file` and `update_settings` (`favoriteModels` takes free strings that `get_settings` reads back in every chat) are blocked before the send (`withoutGoogleSpreadingTools`, `GOOGLE_SPREADING_BESIDKA_TOOLS`) and refused if called after taint appears mid-send, on a continuation replay too (the check sits in the tool handler). The other chat-exposed writers take ids, booleans or enums only (`move_chats_to_project`, the delete and revoke tools) or are marked or flagged themselves (`create_file`, `branch_chat`) | The tools are not offered, or a 403 tool error |
| Artifact public links | A marked artifact cannot get a public link (409, `ARTIFACT_SHARE_GOOGLE_DATA_CODE`), and an existing link to an artifact marked later resolves as not found. `artifact_shares` has no opt-in column, so refusing replaced the chat-share-style opt-in | The share action fails with the reason |
| Web search, Brave, Exa | Every web search tool is removed from the send in a flagged chat (`withoutWebSearchForGoogleData`), whatever the tool approvals setting; the Brave and Exa keys are never read | The search tools are not offered; the reply has no search |
| TypeSafe AI roles on the send path | Auto web search, skill selection, past-chat pre-retrieval and the rerank resolver are skipped in a flagged chat; in the send that first brings Google data, the rerank resolver stops once `google` taint appears (`withGoogleTaintRerankStop`); the share personal-data check skips its TypeSafe AI call | Auto web search keeps the chosen tools (minus search); the share check shows the generic reminder |
| Connectors with tool approvals off | A flagged chat offers no connector unless tool approvals are active (`mayOfferConnectorsWithGoogleData`), because only the Google egress ask (rule 12) keeps Google content from a user-added MCP server, and it needs approvals | Connectors are not offered in that chat |
| Flag write with the reply | The assistant message that brings the first Google result and the flag (with the share opt-in cleared) are one `db.batch` (`buildGoogleContentPersistStatements`); if the batch fails the reply is not persisted | The usual save error |
| Flag repair | A send that finds a Google result in the stored parts while `google_data_at` is null sets the flag | Nothing |
| What sets the sticky flag | A Google tool result that returned data (a static `tool-google__*` part with an output, for a tool that returns Google content), a marked write, or a marked file or code run at the persist step (`holdsStickyGoogleFlagTrigger`). A Google call that only failed (an approved read of a bogus id, a Drive error) or an empty Drive list (`emptyListHoldsNoContent`, 13.2) keeps the transient taint for the rest of the send, so the send stays guarded, but never sets the flag by itself; a later tool of the same send that flags after it ran (an artifact or document write) still does, because the send is tainted. A Google tool that returns no Google content (`GOOGLE_TOOL_PROPERTIES`, today the Drive save) taints nothing and flags nothing unless the file it saves carries the derived mark (`google_derived_at`; a Drive copy is refused by the save) | Nothing |
| Memory | Flagged chats leave the extraction sweep, the backfill queue, project memory refresh and settle, the extract-now path (checked before and after the model call), the guarded entry insert, and the `search_chats` and `read_chat` tools of other chats; `memory_write` and `memory_forget` are not offered inside a flagged chat | Memory stays as it was; the chat is never cited |
| Shares | `POST /share` needs `includeGoogleContent: true` for a flagged chat (409 otherwise) and stores it as `chat_shares.google_opt_in_at`, recorded in the wide event as `googleDataGuard.shareOptIn`; a share of a flagged chat is visible only while that column is set (`isShareVisibleForGoogleData`, read with the share in one query in `resolveActiveShareBySlug`, and by the tokened file route). Every write that brings new Google content clears it in the same batch, so the link pauses until the owner opts in again. `indexable` is forced off for a flagged chat (on the stored row, the owner and shared reads, and the dialog). Google copies get no `chat_share_files` grant | The share dialog names the Google items (reference titles and Google or marked file names, at most 20), asks "Share the Google content in this chat", says when a link is paused, disables the indexing toggle, and Generate waits for the box |
| MCP and Besidka tools | `get_chat` replaces every message text with a fixed notice when `chatHoldsGoogleData` (flag, or a Google result in the loaded messages); `list_chats` treats a content match in a flagged chat as no match (only a title match lists it); `list_files`, `read_file` and the `get_chat` context files never include a Google copy or a marked file (`fileHoldsNoGoogleContent`); `list_artifacts` and `get_artifact` hide marked artifacts. The tool descriptions say so (MCP 5.4.1) | The withheld notice in place of the text; the items are not found |
| Project knowledge | Linking a Google copy or a marked file answers 400; knowledge screening and the sweep only ever see linked files, so neither reaches TypeSafe AI with one | "A file with Google content cannot be added to project knowledge" |
| Model picker | The same allow-list on the client (`useGoogleDataRecipientReason`), with the Gemini paid-tier state from the keys summary. The send route writes a transient `data-google-data` chunk at the start of a send in a flagged chat and after the first step with a Google result, so the picker updates without a reload | "Not for Google data" on each refused model, the reason as its tooltip and screen-reader text, and the row cannot be picked |
| Chat context panel | The chat page records the flag (`useChatGoogleData`) | "This chat holds content from Google, so only models on the Google data list can answer here. Memory and TypeSafe AI skip this chat, web search is off for new messages, and a share link needs your confirmation." |

**Decisions.**

- Native web search in a flagged chat is withheld too, not only Brave and
  Exa: a query the model writes can carry Google content to a search
  engine, and Vercel's gateway search is Perplexity, a third party outside
  the table. This also closes the gap of section 5.2 where a chat flagged
  earlier kept web search with approvals off.
- Every TypeSafe AI role of the send path and the share check is skipped in
  a flagged chat, including the ones that read only knowledge or search
  results, as the pre-check says ("TypeSafe AI checks ... are skipped in
  flagged chats"). `add_memory`, `update_memory` and `create_skill` are
  `chat.excluded`, so a chat never offers them.
- Chat search and the FTS index keep flagged chats: the pre-check says
  nothing about them, and the search runs inside Besidka for the owner. The
  model-facing tools that copy another chat into a send exclude them.
- `get_chat` withholds the whole transcript rather than cutting at the flag
  time, because the flag is chat-wide and a branch copies it.
- The share opt-in is stored (`chat_shares.google_opt_in_at`) and cleared
  by every write that brings new Google content, so an opt-in covers only
  the Google content the owner saw named in the dialog. The tokened file
  route (`hasShareTokenFileAccess`) applies the same pause. A legacy chat
  flagged only by a parts scan gets `google_data_at` on its next send (flag
  repair).
- A marked item read inside the tool loop of a send without Google data is
  withheld, not asked about and then flagged as the coordinator's plan
  described: approvals are decided before a tool runs and cannot see which
  item the call will return, and a prompt-injected read would otherwise
  flag a chat permanently. Attaching the item, which the user does, flags
  the chat before the guard instead.
- Files made in a flagged chat keep their share grants when the owner opted
  in: the opt-in covers replies that repeat Google content, and these files
  are such replies. Google copies stay ungranted.
- Names-only rendering of Google items in the shared view is built by the
  Picker child (section 12.7): the `data-drive-file` part reaches a share as a
  name, and the Google copy itself stays without a grant.
- The Gemini paid-tier confirmation is cleared when the Gemini key is
  replaced, because a new key can sit on another project.

**Open after this child.**

- A Besidka read of a marked item from another chat, in a send that already
  holds Google data, does not clear the share opt-in or add the item to the
  names the share dialog lists; only a Google tool result does. Acceptable
  for now: the owner opted in to sharing Google content in that chat, the
  item stays out of MCP and other chats. Still open after the Drive tools
  (section 13): they read only the user's own Drive copies, through their own
  Google result, which flags the chat and keeps references, so they do not
  make a Besidka read of a marked item more common and did not add the
  recording of an allowed marked read.
- CLOSED by not offering the tools (13.2, built option (b)): provider-run
  tools that cannot be removed between the steps of a send. Direct Anthropic
  keeps every declaration (Anthropic rejects tool history without them, so
  the step guard is skipped there) and Qwen's `enable_search` is a request
  flag for the whole send, so a search or a code run could follow a Drive
  read in the same send, with the file's text in the query and nobody asked
  (a read under a chat grant does not pause). A send that declares such a
  tool and whose chat holds no Google data registers no Google tool
  (`hasUnremovableProviderTool` in `getGoogleSendTools`). In a chat that
  holds Google data the send withholds search, URL fetch and code execution
  before its first step, so a Google tool and a search tool are never
  callable in the same call; a route test shows both directions on direct
  Anthropic (`chats-tool-approval-request.spec.ts`). Why not option (a), a
  Google read ending the model call so that the answer continues with
  withheld tools: the round continuation on Anthropic keeps a tool's
  declaration whenever the stored history already called it, so it cannot
  guarantee the tool is gone. A provider tool the stored history of the
  same reply already called stays declared on Anthropic in that continuation,
  so the gap is limited to a reply that called such a tool before the chat
  came to hold Google data (a flagged chat declares none from its first step,
  and an unflagged one gets no Google tool while it declares one); it is not
  widened here. Native web
  search tools of other providers are removed per step by the step guard
  (`withProviderToolEgressGuard`), as before.
- Deep research runs the provider's own agent, which searches the web with
  queries it writes from the conversation. The guard checks the research
  provider, but those searches leave the allow-list's scope. Acceptable
  until the custom research track (Phase 3) replaces the provider agent with
  Besidka's own search loop, where the web search skip applies.
- Rows written before the migration carry no mark. Acceptable: no Google
  tool or Google copy existed in production before this child, so no
  Google-derived row can predate the column.
- A 403 at send start (a Google copy sent to a refused model) flags the chat
  but writes no `data-google-data` chunk, so the picker updates on the next
  load. Acceptable: the server refuses every later send on that model with
  the same reason; the Picker child marks the chat on the client when the
  copy is attached.
- The user can still download a marked artifact or document, copy its
  text, or paste Google content into another chat: the mark follows stored
  items, not what the user retypes.
- Project knowledge text extracted on the client from a Google copy before
  this child cannot be told apart from other text.
- The marked-origin backstop covers artifacts and documents, the two kinds
  the model reads back by origin chat. A marked file (a generated image, a
  container file, a `create_file` result) has no origin chat: a send killed
  after it was written leaves a row that is reached only by id, hidden over
  MCP and withheld from the Besidka tools of a send without Google data, or
  through a file part of a stored message, which flags the chat at send start.
  Files from provider code execution are marked when the stream saves them
  and the chat is flagged at the persist step, so a send killed in between can
  leave an unflagged chat with a marked file nobody references.
- A flag write that fails at the persist step fails the persist, so the user
  sees the save error and retries; the tool-level write has already failed
  the call that would have brought the data in.

## 6. Owner runbook: bring your own client

For the owner only, in a Google Cloud project of the owner's own (never
`chernenko-chat`, which carries Besidka's sign-in and the Picker). The client
id and secret are pasted into the app and never into chat, files, tickets or
a terminal.

Before you start: your Besidka account is an admin right now (verified
email, two-factor authentication on, the `admin` role or your email in
`NUXT_ADMIN_EMAILS`), and you turned on "Google Drive" and "Your own Google
client" under Labs. Without all of that the card does not appear and every
bring-your-own route answers 404.

1. **Project.** In the Google Cloud console create a new project (or pick
   one you own). Under APIs and services, Library, enable the APIs for what
   you will tick: Google Drive API, Gmail API, Google Calendar API. The
   OpenID and email scopes need no API.
2. **Consent screen** (Google Auth Platform, Branding and Audience). User
   type External (a personal Google account cannot pick Internal). App name
   that shows both you and Besidka, for example "<your name>'s client for
   Besidka", never a name that suggests Google or Besidka itself made it.
   Support and developer email: yours. Homepage `https://besidka.com` and
   privacy policy `https://besidka.com/privacy-policy`. Then **Publish app**
   so the status is "In production": in "Testing" Google expires refresh
   tokens after seven days, and every expiry ends the connection. Leave the
   app unverified; it is for your personal use, and Google shows its
   "unverified app" screen, which you accept for your own account.
3. **Scopes** (Data access). Add `openid`, `.../auth/userinfo.email` and
   only the scopes of what you will tick in Besidka:
   `.../auth/drive.readonly`, `.../auth/gmail.readonly`,
   `.../auth/gmail.compose`, and for Google Calendar the two scopes
   `.../auth/calendar.events.owned` and `.../auth/calendar.events.freebusy`
   (add both: the tools need each). The Gmail and full Drive scopes are
   restricted; that is why this client stays yours and never serves other
   users. If an earlier connection holds the old broad
   `.../auth/calendar.events` scope, Besidka no longer asks for it and does
   not use it; the grant stays at Google until you Disconnect, which revokes
   the whole grant.
4. **Client** (Clients, Create client). Type "Web application". Authorized
   redirect URIs: copy the exact URI the Besidka card shows (it is built
   from the address you opened the page on, path
   `/api/v1/google/byo/callback`). Add one per host you use:
   `http://localhost:3000/api/v1/google/byo/callback`,
   `https://pr-<n>-besidka.chernenko.workers.dev/api/v1/google/byo/callback`,
   `https://preview-besidka.chernenko.workers.dev/api/v1/google/byo/callback`,
   `https://besidka.com/api/v1/google/byo/callback`. No JavaScript origins
   are needed. Create, then copy the client id and the client secret from
   the dialog (Google shows the secret in full only there).
5. **Paste in Besidka.** API Keys, Google tab, "Your own Google OAuth
   client": paste the client id and the secret, Save client. The card then
   says only that a client is saved; it never shows either value again.
   Besidka refuses its own sign-in or Drive client here.
6. **Connect.** Tick what Besidka may request (nothing is ticked for you)
   and press Connect. On Google's screens pick your account, accept the
   unverified-app warning and leave every box you want granted ticked.
   Back in Besidka the card lists what Google granted; "Google granted only
   part of the access" means you unticked something, and only the granted
   part is stored.
7. **Change what is granted.** To add access while connected, tick the
   new boxes under "Add access" and press Add access; what Google granted
   before is kept. To remove access, Disconnect (which revokes the whole
   grant), then Connect again with fewer boxes.
8. **Rotate the secret.** In the console add a new secret to the same
   client, paste the client id and the new secret in Besidka and save (the
   connection stays, its refresh token belongs to the client, not to the
   secret), then delete the old secret in the console. Saving a different
   client id ends the connection made with the old client first.
9. **Remove.** Delete client on the card (it disconnects first: revokes the
   grant at Google, clears the tokens, then deletes the stored id and
   secret), then delete the client or the project in the console. Check
   myaccount.google.com/connections that the app is gone.
10. **Breach.** Revoke and delete as in step 9, delete the client secret in
    the console, and follow `docs/legal/breach-runbook.md`. The runbook has
    no Google line yet; it is to be added with the Google legal text
    (G-10), using the note at the end of section 10.9.

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

Two migrations: the phase migration, and the data guard's
`20261122040503_fuzzy_quasimodo` (four `ALTER TABLE ... ADD COLUMN`, below).
Every addition is `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN` (nullable, no
SQL default) or `CREATE INDEX`, so no existing table is rebuilt. Nothing here
has a foreign key to `users`; account deletion removes the rows explicitly.

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
| `files.drive_copy_id` | text | the id of the copy saved to Drive, so a second "Open in Google" or "Save to Google Drive" opens the same copy (BES-283 owner addendum); kept apart from `external_*`, which describe files imported from Google. While a save runs it holds a claim `pending:<epoch ms>` (section 13.1), so a reader must use `readSavedDriveCopyId` (`shared/utils/google-drive-tools.ts`), which returns the Drive id or null, and never the raw column |
| `keys.paid_tier_confirmed_at` | timestamp | the `gemini-paid-tier-confirmed` condition of the allow-list |
| `artifacts.google_derived_at` | timestamp | the derived mark (section 5.3): set on create or on any later version written in a flagged or tainted send, never cleared; MCP and Besidka tool filters, the artifact bridge, public links, send-start lookup |
| `files.google_derived_at` | timestamp | the derived mark on generated files (images, code execution output, `create_file`, rendered documents); `fileHoldsNoGoogleContent`, `isGoogleContentFile`, project knowledge refusal, send-start lookup |
| `documents.google_derived_at` | timestamp | carries the mark from `create_document` to the file that `finalize` writes later, because the spec lives in R2 and the file row does not exist yet |
| `chat_shares.google_opt_in_at` | timestamp | the stored share opt-in for a flagged chat; cleared in the batch that persists new Google content |

No index is added: every reader filters rows it already selected by user,
storage key or id.

`idx_files_user_external` is a partial index on
`(user_id, external_source, external_id) WHERE external_source IS NOT NULL`,
so the rows of ordinary uploads add nothing to it. A query that selects Google
files must compare `external_source` with a value (`=` or `IN`), which implies
the predicate.

A connection's `connectedAt` is `created_at`. The end of access has no
timestamp of its own; `status` and `updated_at` carry it. Files carry no
client mode; copies belong to the copy-making modes
(`GOOGLE_COPY_CLIENT_MODES`, only `besidka`), so the cleanup deletes a
user's Google files when no connection of those modes is `active`, whatever
the bring-your-own connection does (section 10.6).

Rotating `NUXT_ENCRYPTION_KEY` without re-encrypting breaks every stored
Google token; users reconnect.

## 9. Connecting Google (connections child, G-3)

Built on `feat/google-connections`. Code: `server/utils/google/`
(`client.ts`, `http.ts`, `oauth.ts`, `oauth-state.ts`, `refresh-lock.ts`,
`tokens.ts`, `store.ts`, `connection.ts`, `access-ended.ts`, `route.ts`),
`server/api/v1/google/`, `server/plugins/google-access-sweep.ts`,
`app/composables/google-connection.ts`,
`app/components/Profile/Google/Connection.vue` and the Google tab of
`app/pages/profile/keys.vue`.

### 9.1 Routes

| Method and path | What it does | Gate |
|---|---|---|
| `POST /api/v1/google/oauth/start` | Body `{ returnTo? }`; answers `{ authorizationUrl }` for the browser to open | Same-origin write guard, session, `google.drive` active, 10 per minute |
| `GET /api/v1/google/oauth/callback` | Google's redirect target; redirects to the return path with `?google=<result>`, or once back to Google with `prompt=consent` | Session, `google.drive` active, 20 failed callbacks per 10 minutes per IP; no `Sec-Fetch-Site` check (Google's redirect is a cross-site navigation) |
| `GET /api/v1/google/connections` | `{ connection, canConnect, dedicatedClient, byo }`: status, Google email, granted capabilities, connected date, whether `google.drive` is active, whether Drive runs on its own client, and the bring-your-own part (section 10.2); never a token, a client secret or a full client id | Cross-site `Sec-Fetch-Site` refused, session, 60 per minute; no flag |
| `POST /api/v1/google/connections/disconnect` | Body `{ clientMode? }` (`besidka` by default, or `byo`). Revokes, deletes the copies, deletes the row; `{ disconnected, revoked, filesDeleted, filesPending }` | Same-origin write guard, session, 10 per minute; no flag, no admin role |

Start and callback answer 404 unless `google.drive` is active (enabled for
the user and opted in). The two callbacks skip the cross-site read guard:
Google returns the browser through a cross-site top-level redirect, which
carries `Sec-Fetch-Site: cross-site`, and the earlier guard refused every
real callback (no test sent that header); the single-use state bound to the
user and the client mode protects them instead. The status read and
disconnect never check the flag:
a user who is connected can always see and end the connection, also after
the flag is turned off or they opt out in Labs. The result values are
`connected`, `denied` (`error=access_denied`), `missing_scope`, `expired`
(no such state) and `error`; the reason is logged, never put in the URL. A
token, the code, the state value or an email never appears in a URL Besidka
generates. `server/plugins/evlog-request-observability.ts` drops the
callback's query from the wide event.

### 9.2 Flow, state and PKCE

1. Start resolves the client (`resolveGoogleClient`: the dedicated Drive
   client when configured, otherwise the sign-in client; the BYO mode reads
   the owner's stored client, section 10), builds the redirect URI from
   `resolveRequestPublicOrigin` plus `/api/v1/google/oauth/callback`, creates
   a 32-byte state and an S256 PKCE pair, and stores
   `{ userId, clientMode, codeVerifier, redirectUri, returnTo, forcedConsent,
   createdAt }` encrypted under `google:oauth:<state>` for 600 s. `returnTo`
   must pass `resolveSafeNextPath`; otherwise it is `/profile/keys?tab=google`
   (`google` is a valid tab of `KEYS_PAGE_TAB_IDS`).
2. The consent URL carries `access_type=offline`,
   `include_granted_scopes=true` (incremental authorization, as BES-273
   decided), the scopes `openid`, `userinfo.email` (the email is shown on the
   card) and `drive.file`, never `userinfo.profile`, Calendar or a BYO scope;
   `prompt=consent` when no refresh token is stored for the mode or consent is
   forced, `select_account` when there is no `login_hint`, and on a reconnect
   the stored Google subject (`sub`) as `login_hint`, which Google's OAuth
   web-server guide accepts ("an email address or `sub` identifier"), so no
   email is put in a URL.
3. The callback deletes the state on first read (single use), refuses it
   when it is older than 600 s or belongs to another user, exchanges the code
   with the stored verifier and the exact stored redirect URI, and compares
   the granted scopes with `hasScopes(granted, [drive.file])`. A grant
   without `drive.file` is revoked at once and nothing is stored.
4. The Google account comes from the ID token in the token response: issuer
   `accounts.google.com`, audience equal to the client id, not expired. It
   arrived straight from the token endpoint over TLS, so the signature check
   is skipped (OpenID Connect Core 3.1.3.7); there is no userinfo call.
5. If Google sent no refresh token and none can be kept (a first connection,
   or a different account chosen in Google's account chooser), nothing is
   revoked or deleted: the callback sends the user back to Google once with
   a new state and `prompt=consent`. A second miss answers `error`.
6. Only then does a different Google subject replace the old connection: the
   old grant is revoked, the row marked `revoked` and the old account's
   copies deleted; if that cleanup cannot finish, the new grant is revoked
   and the result is `error`.
7. The row is upserted on `(user_id, client_mode)` with status `active`.

### 9.3 Token storage and key management

Tokens are encrypted with `useEncryptText` (`NUXT_ENCRYPTION_KEY`, the same
path as the `keys` table) and decrypted only in `server/utils/google/tokens.ts`.
`tests/unit/server/utils/google/token-boundary.spec.ts` fails if another
server file names a token column of the table (directly or through an alias,
except inside `isNotNull`), or, in a file that names the table, uses a bare
`.select()` or `.returning()` or a relational query, which would read every
column. Tokens are never logged, never returned by a route and never sent to
the browser (the Picker token of a later child is the one planned
exception). Key-management position (pre-check row 12): a Worker secret is
acceptable for `drive.file`, a non-sensitive scope; a KMS or HSM-backed key
is required before any public restricted-scope path. Rotating
`NUXT_ENCRYPTION_KEY` without re-encrypting makes every stored token
undecryptable. `getGoogleAccessToken` then answers 500 and changes nothing,
so a wrong key on one deployment never ends connections or deletes copies;
after a deliberate rotation, wipe the tokens by hand (the restore runbook's
step 2d) and users reconnect.

Better Auth keeps its own Google tokens for sign-in in `accounts`, outside
this boundary. Two settings keep a Drive-scoped token out of that table and
out of the browser: the Google sign-in provider sets
`includeGrantedScopes: false` (Better Auth 1.7 otherwise sends
`include_granted_scopes=true`, so a sign-in after a Drive connection on the
shared client would return a token covering `drive.file`), and
`/get-access-token` and `/refresh-token` are in `DISABLED_AUTH_PATHS`
(`server/utils/auth.ts`); nothing in the app called them.

### 9.4 Getting a token and the refresh lock

`getGoogleAccessToken({ userId, clientMode, requiredScopes })` answers
`ok`, `not_connected`, `needs_reauth` or `missing_scope`;
`requireGoogleAccessToken` turns the last three into 404 or 409. The cached
token is used while it has more than 120 s left. Otherwise one request
refreshes under `google:refresh:<connectionId>` (KV entry of 60 s with its
own 30 s expiry, read-write-read like `connectors:refresh:`). The owner
re-reads the row after taking the lock and skips the refresh when another
request already stored a fresh token. A request that loses the lock waits up
to three times 500 ms for a new access token on the row, then answers 503
instead of spending the refresh token twice. When KV fails, the refresh runs
unlocked. Every write is a compare-and-set on the refresh-token ciphertext
that was read, so a parallel rotation or a reconnect is never overwritten. A
rotated refresh token from Google is stored; otherwise the old one is kept.
Only a parsed `invalid_grant` ends a connection; timeouts, 5xx and other
errors (for example `invalid_client` after a secret rotation) throw 502 or
504 and change nothing.

### 9.5 Outbound requests

`googleFetchJson` (`server/utils/google/http.ts`) is the only way the server
calls Google: HTTPS on an exact host of `GOOGLE_FETCH_HOSTS`
(`oauth2.googleapis.com` and, since the Picker child, `www.googleapis.com`;
`accounts.google.com` is opened by the browser only; the Drive downloads use
the byte fetcher of section 12.4), `redirect: 'manual'` with any 3xx refused and its body
canceled, a 15 s timeout that covers the body, a 64 KiB cap enforced while
the body streams in, form bodies (the revoke token goes in the body, never
the URL). Every caller awaits each call before the next, so a request holds
one Google connection at a time, well under the six simultaneous
connections a Worker allows.

### 9.6 When access ends

| Event | Revoke at Google | Tokens | Copies with `external_source` in `GOOGLE_EXTERNAL_SOURCES` | Row |
|---|---|---|---|---|
| Disconnect | Refresh token (ends the grant), best effort; the answer says whether Google confirmed it | Cleared | Deleted before the answer | Deleted when the cleanup finished and the row is still `revoked`; otherwise left for the sweep |
| `invalid_grant` on refresh | The old access token if it was still valid, best effort | Cleared | Deleted at detection | `needs_reauth` |
| Revoke made at Google | None needed | Cleared by the next refresh | Deleted when the sweep's daily check refreshes and gets `invalid_grant` | `needs_reauth` |
| Different Google account connects | Old refresh token | Replaced | Old copies deleted first | Replaced |
| Account deletion | Every stored grant, one at a time, 10 s deadline, never blocks | Deleted with the row | Deleted with the user's `files` | Deleted (`purgeUserGoogleConnections`) |
| Hourly sweep | No | Cleared on any row that is not `active` | Deleted for users with Google files and no `active` connection | `revoked` rows removed once nothing is left |

`deleteGoogleDerivedFiles` only touches files created no later than the
moment access ended, so a file picked after a reconnect is never deleted,
and it re-checks before every batch that the user still has no active
connection of a copy-making mode: a reconnect while the cleanup runs stops
it (the user regained access, and the copies made under the earlier grant
stay with the new one). An active bring-your-own connection does not stop
it (section 10.6). Each
batch of up to 50 files is one R2 batch delete (with derived Office text
keys), the KV file cache one key at a time, the D1 rows, the documents and
knowledge texts that pointed at them, then the storage cache. An R2 failure
stops before D1 so the sweep can retry.

The sweep runs on the `0 * * * *` cron with no flag on purpose. Each run:
refreshes up to 10 active connections whose access token expired more than
24 hours ago, oldest first (a revoke made at Google is otherwise never
noticed, so it is detected within about a day and the `invalid_grant` path
runs); clears tokens left on rows that are not active; cleans at most 25
users, 2,000 files and 20 seconds, walking users in id order from the KV
cursor `google:sweep-cursor` so a user whose cleanup keeps failing cannot
starve the rest; and removes `revoked` rows with nothing left to clean.
Crons do not run on Cloudflare Previews, so on a preview only the
synchronous paths delete.

What can stay alive at Google: the account purge revokes under a 10 s
deadline and never waits longer, so a slow Google leaves a grant alive until
the user removes it at myaccount.google.com/connections or Google expires
it; the restore runbook's token wipe (`docs/d1-restore-reconciliation.md`,
step 2d) clears tokens without revoking them, so revoke first wherever the
tokens are still readable.

### 9.7 KV keys

| Key | Value | TTL |
|---|---|---|
| `google:oauth:<state>` | Encrypted pending connection | 600 s, deleted on first read |
| `google:refresh:<connectionId>` | Refresh lock owner and time | 60 s entry, 30 s lock |
| `google:callback-failures:<sha256(ip)>` | Failed callback count | 10 minutes |
| `google:sweep-cursor` | Last user id the sweep cleaned | 7 days |
| `google-rate-limit:<userId>` | Writes per minute (start, disconnect) | At least 60 s |
| `google-read-rate-limit:<userId>` | Status reads per minute | At least 60 s |

### 9.8 Logging

Wide events carry `attributes.google` (steps, outcomes, connection ids,
counts of granted scopes, whether the dedicated client is in use),
`attributes.googleToken` (refresh outcome: `refreshed`, `already-refreshed`,
`waited`, `lost-race`, `superseded`, `invalid-grant`, `undecryptable`,
`lock-busy`, `lock-unavailable`, `failed` with Google's error code),
`attributes.googleAccessEnded` and `attributes.googleAccessSweep` (counts,
including the stale-connection check), and `attributes.googlePurge`. Never a
token, a code, a state value, an email or a file name.

### 9.9 UI

The API Keys page gets a Google tab, last, while `google.drive` is active or
the user has a connection; it holds one bubble with the Google Drive card.
The status is fetched once per session (`useGoogleConnection`) and fetched
again after a connect or disconnect. States:

- Loading: a skeleton. Load error: an error with Try again, never a Connect
  button.
- Not connected: three plain lines (Besidka gets access only to the Google
  Drive files you pick; picked files are copied into your Besidka files;
  the account's email is read to show which account is connected) and
  Connect Google Drive while the flag is active.
- Connected: the Google account's email, what Besidka can access, and
  Disconnect behind a confirmation that says the copies will be deleted,
  also whenever Google access ends, and, while the sign-in client is shared,
  that Google will ask for consent again at the next Sign in with Google.
- Needs re-authorization: a warning and, while the flag is active,
  Reconnect.

After Disconnect a toast says the copies were deleted (or that the deletion
finishes shortly), a second toast with the link to
myaccount.google.com/connections appears when Google did not confirm the
revoke, a polite live region announces the change, and focus moves to
Connect Google Drive (or the card heading). The callback's `?google=` value
becomes a toast and is removed from the URL. The card is on an existing page,
so there is no new profile tab and no search popup row. Focus rings come
from the global `:focus-visible` rule in `main.css` (not checked in a
browser).

### 9.10 Testing locally

Add `http://localhost:3000/api/v1/google/oauth/callback` as a redirect URI on
the client in use (the dedicated Drive client in `.dev.vars` as
`NUXT_GOOGLE_DRIVE_CLIENT_ID` and `_SECRET`, or the sign-in client), add the
scopes of section 4.3 and your account as a test user, give yourself the
`google.drive` flag (admin role or a grant) and opt in under Labs, then use
the Google tab on `/profile/keys`. Specs mock Google entirely
(`tests/setup/helpers/google-connections.ts`); no test calls Google.

### 9.11 Open items

- G-1 question 9 (does the token endpoint return the expanded `userinfo.*`
  scopes) is still open; the comparison needs only `drive.file`, so either
  answer works.
- The KV refresh lock is best effort across locations; the D1
  compare-and-set settles the rare double refresh.
- Nothing has been checked against a real Google account: the consent
  screens, the restart with `prompt=consent`, the revoke effect on sign-in
  and the daily revoke detection.

### 9.12 Shared or dedicated OAuth client

Google revokes per OAuth client and Google account. On the shared sign-in
client, revoking the Drive connection (disconnect, account deletion, a
different account replacing it) also ends the user's "Sign in with Google"
consent for Besidka: sign-in still works, but Google shows its consent
screen again. It also ends the Drive connection of any other Besidka user
who connected the same Google account. A dedicated Drive OAuth client
(`googleDriveClientId` and `googleDriveClientSecret`, env
`NUXT_GOOGLE_DRIVE_CLIENT_ID` and `NUXT_GOOGLE_DRIVE_CLIENT_SECRET`) removes
the first problem, and `resolveGoogleClient` uses it whenever both values
are set. The status response's `dedicatedClient` tells the card whether to
warn about the sign-in consent. **The dedicated client is required before
`google.drive` leaves `internal`.** Switching clients makes stored
connections unusable (their refresh tokens belong to the old client): the
next refresh answers `invalid_grant` or `invalid_client`; wipe the tokens and
have users reconnect when switching.

## 10. The owner's own OAuth client (BYO child, G-7)

Built on `feat/google-byo-client`. Owner-only, as the pre-check requires
(`docs/legal/prechecks/google.md`, row 1: a public bring-your-own client is
an owner risk call, recommended NO-GO; owner-only use is personal use). Code:
`shared/utils/google-byo.ts`, `server/utils/google/byo-access.ts`,
`server/utils/google/byo-client.ts`, `server/utils/google/callback.ts`, the
`byo` branches of `client.ts`, `connection.ts` and `tokens.ts`, the routes
below, and `app/components/Profile/Google/OwnClient.vue`. The owner steps are
section 6.

### 10.1 Where the client lives

One `keys` row per user with provider `google-oauth-client`
(`GOOGLE_BYO_KEY_PROVIDER`). Its `api_key` is one value encrypted with
`useEncryptText` (`NUXT_ENCRYPTION_KEY`, as every BYOK key): the JSON
`{ clientId, clientSecret }`, the same shape the Cloudflare gateway key uses
for its three values. No migration: `keys.provider` is a plain `text`
column in D1 (the Drizzle enum is a TypeScript list, not a CHECK and not in
the migration snapshot, so `db:generate` produces nothing), and the unique
`(user_id, provider)` index allows one client per user. The new kind stays
out of every provider list: it is not in `providerMeta`, and the keys
summary route (`GET /api/v1/profiles/keys`) leaves it out.

- Decrypted only in `server/utils/google/byo-client.ts`
  (`readGoogleByoClient`), and only to start, exchange or refresh.
  `token-boundary.spec.ts` fails if another server file reads that row's
  value, and also if any other `keys` value read names its provider with
  anything but a literal or a reviewed expression (research, gateways,
  Jev, code execution), so no generic reader can be handed this kind.
- Write-only: no route returns the secret or the client id. The status
  answers only `hasClient`, read without decrypting (an id-only select),
  so a status read never touches the secret.
- Saved in one upsert on `(user_id, provider)`, so two saves at once never
  collide on the unique index.
- Validation: the client id matches
  `^[0-9a-z][0-9a-z-]*\.apps\.googleusercontent\.com$` (at most 200
  characters) and is neither Besidka's sign-in client nor the dedicated
  Drive client (`isBesidkaGoogleClientId`, also re-checked when the client
  is resolved); the secret is 20 to 128 visible ASCII characters with no
  spaces. Errors never echo the input; logs carry `byoClient` (`saved`,
  `deleted`, `missing`), `clientReplaced` and `connectionEnded` only.
- Deleted with the account: the `keys` row cascades with `users`, and the
  account purge revokes every stored Google grant first (revoking needs only
  the token, not the client secret).

### 10.2 Routes

| Method and path | What it does | Gate |
|---|---|---|
| `POST /api/v1/profiles/keys/google-oauth-client` | Body `{ clientId, clientSecret }`; saves or replaces the client; `{ saved, connectionEnded }` | Same-origin write guard, session, admin and `google.byo`, 10 writes per minute |
| `DELETE /api/v1/profiles/keys/google-oauth-client` | Removal only: ends the bring-your-own connection (as Disconnect), then deletes the client; `{ deleted, connectionEnded, revoked }`, 404 when there was neither; a failure to read the connection fails the request and deletes nothing | Same-origin write guard, session, 10 writes per minute; no flag and no admin role, so a former admin can remove the secret |
| `POST /api/v1/google/byo/start` | Body `{ capabilities, returnTo? }` with capability names only (`drive-read`, `gmail-read`, `gmail-compose`, `calendar`, at least one); answers `{ authorizationUrl }`; 409 when no client is saved | Same as the save route |
| `GET /api/v1/google/byo/callback` | Google's redirect target for the owner's client; redirects with `?google-byo=<result>`; a refused gate (signed out, not admin, flag off) redirects to the Google tab with `?google-byo=error` instead of an error page | Session, admin and `google.byo`, the callback failure budget; no `Sec-Fetch-Site` check |
| `GET /api/v1/google/connections` | Adds `byo`: `null` for a user with nothing; `{ canManage: true, redirectUri, hasClient, connection }` for a user who passes the gate; `{ canManage: false, redirectUri: null, hasClient, connection }` for a user who no longer passes it but still holds a client or a connection | Section 9.1 |
| `POST /api/v1/google/connections/disconnect` | `{ clientMode: 'byo' }` ends the bring-your-own connection. A JSON body is always parsed (411 without `Content-Length`); only a clearly bodyless request means Besidka's client; any other body is refused (400), so the destructive direction is never guessed | Section 9.1: no flag and no admin role, so access can always be ended |

The callback path is separate from Besidka's, so the owner's client
registers its own redirect URI, a block of one path never takes down the
other, and the state check refuses a code from one flow on the other path.

### 10.3 The admin gate

`checkGoogleByoAccess({ db, userId })` in
`server/utils/google/byo-access.ts` is the one gate. It answers `allowed`
only when the user is an admin right now (`isAdminUser`: verified email, 2FA
outside dev and CI, the `admin` role or an env admin email) and `google.byo`
is active for the user through the real evaluator (the flag and its parent
`google.drive` resolved, and both Labs opt-ins on). A flag grant or the
tester role alone is never enough, because stage `internal` still allows
grants. It needs no request, so it runs:

- in the save, start and callback routes (`requireGoogleByoAccess`, an
  early 404; the callback redirects instead); removal (Delete client,
  Disconnect) never needs it;
- in the hourly sweep (`endUngatedGoogleByoConnections`,
  `server/utils/google/byo-sweep.ts`, section 10.6), which ends the
  connection of a user who no longer passes it;
- inside `resolveGoogleClient('byo')`, so start, the code exchange in the
  callback and every token refresh (including the hourly stale check) pass
  it again;
- at the top of `getGoogleAccessToken` for the `byo` mode, so even a cached
  token is never handed to a later tool for a user who no longer passes it.

A refusal is the same 404 as an unavailable feature and logs
`attributes.google.byoGate` (`not-admin` or `flag-off`) only.
`tests/integration/api/google-byo.spec.ts` proves it with a non-admin whose
flag grants make `google.byo` active (the evaluator says active, save and
start answer 404, the callback redirects with an error) and with an admin
who did not opt in; the callback test removes the admin role between start
and callback. `google.byo` also carries `adminOnly: true` in the registry,
so Labs lists its toggle only for an admin.

### 10.4 Scopes and capabilities

The owner ticks capabilities; nothing is ticked by default, and the browser
never sends scope strings. `getGoogleByoScopes` maps them through the scope
map (`shared/utils/google-scopes.ts`), and `filterByoCapabilityScopes` drops
anything the map does not allow for the `byo` client, also when it reads the
requested set back from the stored state on a restart with consent. The
request always adds `openid` and `userinfo.email` (the email is shown on
the card), never `drive.file` or `userinfo.profile`.

| Capability | Scope | Tool today |
|---|---|---|
| `drive-read` | `drive.readonly` (restricted) | `google__drive_search` (section 14) |
| `gmail-read` | `gmail.readonly` (restricted) | `google__gmail_search`, `google__gmail_read_thread` (section 14) |
| `gmail-compose` | `gmail.compose` (restricted; Google's scope for managing drafts and sending mail) | `google__gmail_create_draft` (section 14); Besidka has no send tool and creates drafts only, a limit of the product, not of the permission |
| `calendar` | `calendar.events.owned` and `calendar.events.freebusy` (both, or the capability is not granted; each tool needs only its own, section 15.2) | `google__calendar_list_events`, `google__calendar_free_busy`, `google__calendar_create_event` (section 15); offered on the card and accepted by the start route only while `google.calendar` is active for the owner |

Scope minimization (pre-check row 10, "smallest set of scopes"): the card
offers every capability that has a tool, unticked (Calendar only while
`google.calendar` is active for the owner), and says what each one allows.

Adding and narrowing (choice for the stored set): the request keeps
`include_granted_scopes=true`, so adding a capability later works without
a disconnect. While connected the card shows the capabilities not granted
yet under "Add access" and sends the union of what is granted and what is
ticked, and the start route adds the scopes already stored on an active
connection to the request as well. What is stored is only the granted
scopes that were requested plus identity (`scopesToStore`): Google's answer
can list earlier grants of the same client that this flow never asked for,
and those are not recorded. A refresh may narrow the stored set but never
widen it (`refreshedScopes`). To narrow a grant the owner disconnects
(which revokes the whole grant) and connects with fewer boxes.

After the exchange the granted set is compared with the requested
capability scopes: none granted is refused and revoked (`missing_scope`);
some granted is saved with exactly what Google granted and reported as
`partial`, never as a full connection; all granted is `connected`. Tools
check `hasScopes` against the stored set before each use
(`getGoogleAccessToken({ requiredScopes })`).

### 10.5 Flow

The same code as Besidka's client (section 9.2): `startGoogleConnection` and
`completeGoogleConnection` with `clientMode: 'byo'`, one callback handler
(`handleGoogleOAuthCallback`) parameterized by the mode. The KV state also
holds `requestedScopes`; a state whose mode differs from the callback path
is refused (`state-mode-mismatch`) before any token request, in both
directions. The ID token's audience must be the owner's client id.

### 10.6 Ending access, and two connections

Disconnect, `invalid_grant`, account deletion and deleting or replacing the
stored client all end the bring-your-own connection through the same code
as section 9.6: revoke at Google (no client secret needed), clear the
tokens, run the access-ended cleanup. Deleting the client ends the
connection first; saving a different client id (or over a stored value that
can no longer be read) ends it before the new client is saved, because the
refresh token belongs to the old client; a new secret for the same client
id keeps it.

Losing the gate also ends access. Every hour, before the stale check, the
sweep reads up to 25 active bring-your-own rows (least recently updated
first) and runs `checkGoogleByoAccess` for each owner; a refusal (not admin
any more, 2FA off, the flag off or killed, the Labs opt-in withdrawn) ends
that connection exactly like Disconnect. A gate check that cannot run
(KV or D1 down) leaves the row for the next hour. The former admin then
sees the reduced card and can delete the stored client.

A user can hold both connections (unique `(user_id, client_mode)`). Files
carry no client mode, and no schema change was allowed, so the rule is
attribution by mode: only Besidka's client makes copies (the Picker needs
the project of Besidka's client; bring-your-own tools keep references only),
so copies belong to `GOOGLE_COPY_CLIENT_MODES = ['besidka']`.

| Event | Besidka's copies |
|---|---|
| Besidka's connection ends while the bring-your-own one is active | Deleted (pre-check row 4: the grant they came from is gone) |
| The bring-your-own connection ends while Besidka's is active | Kept |
| The bring-your-own connection ends and Besidka's is not active | Deleted (they were orphans already; the hourly sweep would delete them too) |
| A reconnect of Besidka's client during a cleanup | Stops the cleanup, as before |

`deleteGoogleDerivedFiles`, the sweep's user selection and its revoked-row
pass all read `hasActiveCopyConnection`. A later tool that saves copies
under the bring-your-own client must first give them their own
`external_source` value and a rule here.

### 10.7 The card

On the Google tab of API Keys, inside the same bubble as the Google Drive
card, below a divider, only when the status carries `byo`:

- For a user who passes the gate: one paragraph (this is for the instance
  owner; the Google project, its consent screen and its verification status
  are the owner's responsibility), the redirect URI to register with a copy
  button, the client id and secret fields (the secret is a password field,
  never prefilled, `autocomplete="new-password"`, both with the page's
  Paste button), Save client and, once saved, "A client is saved" and
  Delete client behind a confirmation. With a client saved and no active
  connection: the capability checkboxes (three always, Calendar only while
  `google.calendar` is active), unticked, a sentence about what each allows
  and Connect (Reconnect after access ended).
- Connected: the Google account's email, what Google granted, Disconnect
  behind a confirmation, and "Add access" with only the capabilities not
  granted yet.
- A user who no longer passes the gate but still holds a client or a
  connection: one line, Delete client (when a client is saved) and the
  connection with Disconnect; no fields, no Connect.

A save failure shows in an alert with `role="alert"`; changes are announced
in a polite live region; focus returns to the card heading after Delete and
Disconnect. The callback result arrives as `?google-byo=`, a key of its own
so the Drive card never shows a "Google Drive connected" toast for it. The
Google tab also stays visible for a user whose only connection is the
bring-your-own one.

### 10.8 What is not offered

- No public bring-your-own client, no guide page under
  `content/key-guides` (it would be public on `/guides`, in the sitemap and
  in `llms.txt`), no video, no entry in `providerMeta` or any provider list.
- No Gmail, Calendar or full Drive tool in this child; nothing called those
  APIs then (the Gmail and Drive search tools came with section 14).
- No KMS: the client secret and the tokens are encrypted with the Worker
  secret. The pre-check (row 12) expects HSM-grade key management for
  restricted scopes; that stays an open owner item before any public
  restricted-scope path.

### 10.9 Open items

- Nothing has been checked against a real Google project: the consent
  screens of an unverified client, whether Google returns the expanded
  `userinfo.email` scope, the scope list on a partial grant, and the
  `invalid_client` answer after a secret rotation.
- An admin who loses the role (for example turns off 2FA) loses the
  connection within the hour (section 10.6); the stored client stays until
  they delete it from the reduced card or the account is deleted. On
  Cloudflare Previews crons do not run, so there only the next use of the
  token refuses it.
- The breach runbook line for the bring-your-own secret is still to be
  added with the Google legal text (G-10); legal files are owner-owned.
  Wording to add, as a note:

  > **To add (Google, bring-your-own client):** if the owner's own Google
  > OAuth client secret may have leaked, delete the stored client on the
  > Google tab of API Keys (this revokes the bring-your-own grant at Google
  > and clears its tokens), then delete or rotate the client secret in the
  > owner's own Google Cloud project, and check
  > myaccount.google.com/connections. While the client is owner-only, the
  > owner is the only affected Google account.

## 11. MCP and the Besidka tools (status and disconnect, child 11)

Built (2026-11-22, MCP 5.5.0). The user's Google connection is visible and
removable through the `/mcp` server, and Google data stays out of it
(pre-check row 5: a user-authorized MCP app is a third party). The tool
design, the scope choice and the guard rails are in `docs/mcp-server.md`,
"Google connections (5.5.0)".

| Tool | Scope | Destructive | Chat |
|---|---|---|---|
| `list_google_connections` | `connectors:read` | no | Read tier |
| `disconnect_google` | `connectors:write` | yes | Excluded |

- **Status.** One entry per client mode: `clientMode`, `connected`, `status`
  (`active` or `needs_reauth`), `capabilities` (names such as `identity` and
  `drive-picked`, never scope URLs) and `connectedAt`. Never the Google
  account's email or subject, the connection id, a token, the client id or
  secret, a file name or any Google content. Besidka's mode is always listed;
  the owner's own client only for a caller who passes `isGoogleByoAllowed`
  (section 10.3), so no other caller learns that the mode exists. Unlike the
  Google tab, a former admin does not see a leftover connection over MCP.
- **Disconnect.** `{ clientMode, confirm: true }` calls
  `disconnectGoogleConnection`, the function behind the disconnect route
  (section 9.6), so revoke, cleanup and logging are the same. It needs no flag
  and no admin role, so a former admin can still end the owner's connection
  (section 10.6). The description says the copies of Drive files are deleted
  and that the user connects again in the app.
- **What MCP does not do.** It cannot connect Google (OAuth needs the browser
  and a consent screen) and cannot store, replace or delete the owner's
  client secret.
- **Chat.** The status read is a Besidka read in the read tier: no Google
  taint, not a Google read, not in the tools withheld for a Google-derived
  send. `disconnect_google` is excluded from chats: in a chat that holds
  Google data it would delete the copies the chat is using.
- **A `revoked` row.** It lists as not connected, and `disconnect_google` on
  it still runs and finishes the cleanup.
- **Consent wording.** `connectors:write` now also covers a Google
  disconnect for apps that already hold it. The consent label and
  description (`app/components/OAuth/ScopeLabel.vue`) and the scope phrase of
  the security email (`server/utils/account/security-emails.ts`) are updated
  in this change: they say the scope can disconnect Google, which revokes the
  grant and deletes the copies of Google Drive files that Besidka made, and
  that it cannot connect Google.
- **Open owner item.** The Privacy Policy sentence about what a connected app
  can reach still names connectors only. It stays an owner item for the
  Google legal text (legal files are not changed here).

## 12. The Drive Picker (Picker child, G-4)

Built on `feat/google-drive-picker`. A connected user picks files in Google's
own Picker; Besidka copies each into its own storage as a snapshot and
attaches it to the message like an uploaded file. Code:
`server/api/v1/google/drive/`, `server/utils/google/{download,drive,
drive-import,drive-parts,picker-token}.ts`, `shared/utils/google-drive.ts`,
`app/composables/{google-picker,chat-drive-files}.ts`,
`app/components/Chat/DriveFiles.vue`.

### 12.1 The flow

1. The user opens "+", Add, "Google Drive" (shown while `google.drive` is
   active and the model takes files). Nothing from Google has loaded yet.
2. `useChatDriveFiles().attachFromDrive()` asks for send consent, reads the
   file limit of the account and computes how many files still fit.
3. `useGooglePicker().pick()` first asks Besidka's own status route,
   `GET /api/v1/google/connections` (a plain `$fetch` on the click, never a
   cached answer, so a connection ended in another tab is seen at once). Only
   when Besidka's connection is `active` and holds the `drive-picked`
   capability does it load `https://apis.google.com/js/api.js` and
   `gapi.load('picker')` (with `referrerPolicy = 'no-referrer'` on the script
   tag), and only when that worked call the token route, so a token is never
   minted for a page whose script is blocked. The order is therefore
   status, script, token. No connection reads as `not-connected`, a
   `needs_reauth` connection or one without the capability as `reauthorize`
   (both show the connect dialog at once, with no request to Google and no
   token request, so a user who is not connected never sends their IP
   address to Google for a script they cannot use), and a failing status
   request is an error toast with nothing loaded. The token route's 404 and
   409 stay as a backstop. When the status request takes longer than 300 ms
   `isCheckingConnection` turns true (the delayed-indicator rule) and the
   "Google Drive" row shows a small spinner if the menu is open; the menu
   closes on the click, so it is visible on reopen and the Drive tab button
   already shows its own spinner. The picker then opens the classic
   `google.picker.PickerBuilder` with the server's access token, the public
   key and the project number. The file manager's "Pick from Google Drive"
   button uses the same `pick()`, so it gets the same check even when its
   cached status was stale.
4. The picked files go to `POST /api/v1/google/drive/files`, which copies them
   one by one. Each result becomes a chip, or stays beside the chips with its
   reason. While a pick or a copy is in flight the composer's send button is
   disabled with the reason "Google Drive files are still being copied", and
   a send that gets past it (Enter) answers with the same warning.
5. On send, the message holds the usual `file` part for each copy and a
   `data-drive-file` reference after it. A pick or copy still running when the
   message is sent, or when the composer is torn down, is dropped (a
   generation counter in `useChatDriveFiles`): its result never attaches to
   the next message, and the Picker is closed when its component goes away.

Ordinary uploads are not blocked while they upload: `useChatFiles` aborts
them on `chat:submit` instead. A Drive copy cannot be aborted server-side once
the request has started, so a copy that finishes after the send is an
orphan row that counts against the allowance until it expires or the user
deletes it from Files.

### 12.2 Routes

| Method and path | What it does | Gate |
|---|---|---|
| `POST /api/v1/google/drive/picker-token` | Answers `{ accessToken, expiresInSeconds, apiKey, appId }` with `Cache-Control: no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer` | Same-origin write guard, session, `google.drive` active, 30 per minute (`google-picker-rate-limit:<userId>`) |
| `POST /api/v1/google/drive/files` | Body `{ items: [{ id, resourceKey? }] }`, 1 to 5 items, unique ids; answers `{ results }`, one per file | Same gate, 10 per minute (`google-drive-import-rate-limit:<userId>`), body at most 8 KiB, legal consent; 404 or 409 before any read when Google is not connected or needs re-authorization |
| `POST /api/v1/google/drive/files/refresh` | Body `{ ids }`, 1 to 5 unique Besidka file ids; answers `{ results }`, one per copy (section 12.12) | The same gate and the same `import` rate bucket |

Ids match `^[A-Za-z0-9_-]{10,128}$` and resource keys `^[A-Za-z0-9_-]{1,128}$`
(both go into a URL or a header), checked by the route and again before every
Drive call. Both routes keep a flat name for the token (`picker-token.post.ts`)
and a directory for the files route, as the layout rule says.

### 12.3 The picker token, and why only Besidka's client

`createGooglePickerToken` (`server/utils/google/picker-token.ts`) is the one
place a Google token leaves the server. It:

- refuses any client mode but `besidka` in code (403
  `google_picker_client_refused`), so the owner's own client, whose grant can
  carry restricted scopes, never reaches a browser; the route also hard-codes
  `besidka`;
- hands out the access token only, never the refresh token, minted through
  `getGoogleAccessToken` (refresh lock and all), at pick time, with no
  caching on any layer; the client keeps it for the one Picker call and drops
  it when the call ends;
- refuses a stored grant that holds any scope besides identity and
  `drive.file` (409 `google_picker_scope_too_wide`), because an access token
  cannot be narrowed. The scopes are read before the mint and again after
  it, because a refresh can store a different set; the log says which stage
  refused (`stage: before-mint` or `after-mint`);
- answers the specific cases: 404 `google_not_connected`, 409
  `google_reauthorize` (needs re-authorization, or `drive.file` missing), 503
  `google_picker_not_configured` (key or project number empty);
- logs `attributes.googlePicker` (`issued` or the refusal), never the token.

**Lifetime.** The token is the cached one while it has more than two minutes
left, else a fresh one (about an hour, Google's fixed life; a Google access
token cannot be minted shorter). That is the shortest lifetime available
without an extra Google call per pick. The route answers `expiresInSeconds`,
and the client's idle timeout for an open Picker is the smaller of 15 minutes
and that remaining life, so the Picker is never left open on an expired
token.

**Residual risk: the route is a token oracle.** Any script that runs on the
app's origin can call this same-origin POST (30 per minute) and read a token
that can read and write the files the user picked through Besidka so far
(`drive.file` is per-file and per-app: no file the user did not pick with
Besidka, and nothing else in Drive). A CSP `script-src` is the real
mitigation and the app sends none (section 12.8, "Content Security Policy");
what the route does itself is the same-origin guard, the session, the flag,
the rate limit, the Besidka-client-only rule and the scope check, and the
token never reaches a log or a stored value.

### 12.4 Import: export choices, limits and downloads

| Drive file | Stored as | Note |
|---|---|---|
| Google Doc | `<name>.md`, `text/markdown` (export `text/markdown`); on a 400 from Drive, `<name>.txt`, `text/plain` | |
| Google Sheet | `<name> (first sheet).csv`, `text/csv` | Google exports the first sheet only; the name and a toast say so |
| Google Slides | `<name>.txt`, `text/plain` | |
| Other Google-native types (Forms, Drawings, Sites, Maps) and folders | not copied | `unsupported_type` and `folder` |
| PDF, PNG, JPEG, WebP, text, Markdown, CSV, TSV | as is, through `alt=media` | needs `capabilities.canDownload`; images are not transformed |
| Word, Excel, PowerPoint (`.docx`, `.xlsx`, `.pptx`) | as is, through `alt=media` | only while `files.office` is active, and only after the same ZIP and main-part checks as an upload; legacy and macro files are `unsupported_type` |

Decision: Docs, Sheets and Slides go out as text exports, not as Office
binaries. A text export needs no `files.office` and no `DOC_RENDERER`, and a
Sheet export to XLSX would not be the first sheet only. The plan's "Office
binaries link-only" default is therefore not what Office files do here:
Office files that already sit in Drive are copied as bytes (when
`files.office` is on), because the existing upload extraction handles them
without a new dependency.

Limits, each enforced twice (from the metadata when Drive reports a size, and
while the body streams in):

| Limit | Value | Where |
|---|---|---|
| Files per pick | 5 (`GOOGLE_DRIVE_PICK_MAX`), further capped by the message's free file slots | Picker `setMaxItems`, route schema |
| One file | 20 MiB (`GOOGLE_DRIVE_FILE_MAX_BYTES`, the Office upload cap) | `too_large` |
| One export | 10 MiB (`GOOGLE_DRIVE_EXPORT_MAX_BYTES`, Google's own `files.export` cap) | `export_too_large`; Drive's own `exportSizeLimitExceeded` maps to the same code |
| The account's storage | what is left of the allowance, checked before the download and as the stream cap | `storage_full` (a refused write never deletes anything) |
| A download | 60 s (`GOOGLE_DOWNLOAD_TIMEOUT_MS`), covering the body | 504 becomes `failed` |

Files are copied one at a time, each with a fresh `getGoogleAccessToken`, so a
slow import never uses a token past its life and a request holds one Google
connection at a time.

**Redirects.** `googleFetchBytes` (`server/utils/google/download.ts`) uses
`redirect: 'manual'`. A 3xx is followed at most once, only to HTTPS without
credentials or a port, and only to an exact host of `GOOGLE_FETCH_HOSTS` (the
bearer token stays) or a `*.googleusercontent.com` host (the bearer token and
the `X-Goog-Drive-Resource-Keys` header are both dropped: such links carry
their own authorization, and neither credential may reach a content host). A
second redirect, a missing `Location` or any other
host fails the file with 502. Whether Drive answers `alt=media` or
`files.export` with such a redirect at all, and whether the content host
needs the bearer token, is NOT VERIFIED: the Drive download guide could not be
read during this build (the research tool was out of quota). The code covers
both outcomes and fails closed; the owner checklist settles it.

**Names.** A copy's name is cleaned before it is stored
(`sanitizeDriveFileName`): control and invisible direction characters and
path separators become spaces, runs of whitespace collapse, and a name over
255 characters is cut in its base so a short extension survives. Export
names go through the same cleaning before `buildDriveCopyName` adds the
suffix and extension.

**What the user is told.** Drive answers map to plain reasons
(`GOOGLE_DRIVE_FAILURE_REASONS`): `too_large` and `export_too_large` state
the real limit (20 MB, 10 MB); 403 without a known reason is `no_access`
("Besidka has no access to this file. Pick it again in Google Drive to give
access."); 429 or a rate-limit reason is `rate_limited`; a zero-byte file is
`empty`.

**Reuse.** A file already copied by this user, with the same `external_id`
and the same `modifiedTime` (whole seconds, as `files.external_modified_at`
stores it), is returned as `reused` and not downloaded again (the metadata
call still runs, so access is checked) only when all of these hold: the copy
has more than an hour of retention left, its R2 object still exists (a
`head` call; up to three candidates are tried, newest first), and the copy
was made after the second of the edit it carries. The last rule exists
because the stored time has one-second resolution: a copy made in the same
second as an edit could not be told apart from a second edit in that second,
so it is copied again once. Drive's `version` is read but not stored: no
schema change was allowed.

### 12.5 What a copy is in storage

A normal `files` row and R2 object, made by `persistFile` (the upload path:
quota check before and after, `storage-stats` cache, retention, text
extraction for Office files, deletion hooks). `persistFile` takes
`externalSource`, `externalId` and `externalModifiedAt` and writes them in the
same insert, so there is no window where a copy is a plain upload. `source` is
`upload`. A copy expires with the account's retention, like any upload. The
attach-time label no longer names a number ("Saves a copy in your Besidka
files"): the period is the account's own retention setting, and a fixed "30
days" was wrong for an account with another one. Disconnect, `invalid_grant`
and account deletion delete
copies as section 9.6 describes; nothing new was needed.

The Storage page and `get_settings` show one extra category,
`googleDrive` ("Google Drive copies"): `files.source = 'upload'` and
`external_source IS NOT NULL`. `uploads` now excludes those rows, so the
categories still partition `files` and the total is unchanged
(`docs/storage.md`).

### 12.6 In a message

A sent copy is a normal `file` part, so models receive it by the usual
modality and text rules, and a `data-drive-file` reference part:
`{ driveFileId, name, mimeType (the copy's media type), link }`, no content.
The link is built on `https://drive.google.com/open?id=<id>`. The server never
trusts the client's part: both `POST /api/v1/chats/[slug]` and
`PUT /api/v1/chats/new` drop every `data-drive-file` part of the request and
rebuild one after each `file` part whose stored row is the sender's own
Google copy (`resolveDriveFileParts`, one more `getOwnedFilesByStorageKeys`
lookup only when the message has file parts). So a copy attached later from
the library gets its reference too, and a forged id, name or link never
reaches storage. The composer builds the same parts (`withDriveFileParts`) so
the live message shows the link before a reload.

The data rules (section 5.3) are unchanged and tested end to end:
`resolveSendGoogleContent` finds the Google copy at send start and flags the
chat before the guard, so a send on a refused model answers 403 before the
file is converted or any message is stored, and on an allowed model the chat
becomes flagged (`tests/integration/api/chats-google-data-guard.spec.ts`).
When a copy is attached in an existing chat the composer also marks the chat
as holding Google data (`useChatGoogleData`), so the model picker greys the
refused models at once. In a new chat there is no slug yet, so the picker
updates after the first send; the server refuses a refused model with the same
reason either way.

`PUT /api/v1/chats/new` runs the same resolvers as the send route: it calls
`resolveSendGoogleContent` on the new message and inserts the chat with
`google_data_at` already set when the message holds a Google copy, so a chat
created with a Drive file is flagged from its first row (it was not before,
and the flag then waited for a second send). It also refuses a research send
(`research: true`) whose message has file parts, with 400 "Deep research only
supports text-only prompts for now", so a Google copy is never put in a
research job.

### 12.7 Shared chats and the context panel

- A public share shows a Drive file by its name only: `filterPublicParts`
  rewrites the reference to `{ driveFileId: '', name, mimeType: '', link: '' }`,
  so a visitor gets no id and no link, and `Chat/DriveFiles.vue` renders no
  anchor. The Google copy itself is never granted to a share (section 5.3), so
  there is no file download in a share even with the stored Google opt-in; the
  brief that asked for a download with the opt-in contradicts section 5.3 and
  that section was kept.
- The chat context panel lists a Drive file under Inputs as kind
  `drive-file` (the `drive-files` section, `public`): the Drive icon, the name,
  and for the owner a link that opens it in Google Drive. The plain
  "Attached file" row of the same copy is skipped. In a share the item is the
  name only.
- Matching is by id, not by position. A public share drops the copy's `file`
  part (it is never granted) and keeps the reference with an empty id, so the
  part before such a reference is another file. The context builder pairs a
  reference with the `file` part before it only while the reference carries
  its Drive id (the send routes insert it there from the stored row with that
  id); a name-only reference neither borrows the previous file's tokened URL
  nor hides that file's own row (`isPairedDriveReference` in
  `server/utils/chats/context/sections.ts`).

### 12.8 Content Security Policy

The app sends one policy on chat pages, `frame-src` (artifact frames, section
`docs/artifacts/panel.md`), and no `script-src`, `connect-src` or `img-src`.
Adding any of those would restrict every script and request of the app, so
none was added; the Picker's script, its API calls and its images already
work. What blocks the Picker is the existing `frame-src`, so only that
directive grows, and only by a path:

```
frame-src 'self' <artifacts origin> https://challenges.cloudflare.com https://docs.google.com/picker https://docs.google.com/picker/
```

`GOOGLE_PICKER_FRAME_SOURCES` holds the last two. In CSP, a source with a
path and no trailing slash matches that exact path, and one with a trailing
slash matches everything below it; the query is ignored in both. So the
Picker page (`https://docs.google.com/picker?...`) and anything under
`/picker/` load, and the rest of `docs.google.com` (Forms and its
`formResponse`, Docs, Sheets) and `drive.google.com` do not. A page with no
trailing-slash form would not match `picker?foo=bar`, and one with only the
slash form would not match the Picker page itself; both are listed for that
reason, and a matcher spec pins both outcomes (`formResponse` not matched,
`picker?foo=bar` matched).

Who gets it: only a response for `/chats/...` (`applyArtifactFrameSrc` in
`server/plugins/artifacts-frame-src.ts`), only while
`NUXT_PUBLIC_GOOGLE_PICKER_API_KEY` is set, and only for a user whose
`google.drive` flag is active when the render already loaded the user's
feature state (`isGooglePickerFrameAllowed`, which never loads the state
itself, so there is no extra D1 or KV read). The SSR features plugin
normally loads that state through the page's own event context, which
memoizes it on `event.context.features`; that this holds for every render
path of a chat page is NOT VERIFIED. When the render left no state on the
event, the answer falls back to the key alone, which is the earlier
behavior. Shared chats, `/artifacts/<token>` and the admin pages never get
the Google source.

The same sources are added by the meta tag the artifact frame inserts on a
client-side navigation into a chat (`ensureArtifactFramePolicy`, which can
only add restrictions after it is inserted), under the same conditions: the
public key is set, the `google.drive` feature is active for the user, and
the route is a chat route. The server header and the client tag agree
because both read the same `GOOGLE_PICKER_FRAME_SOURCES` and
`isGooglePickerPagePath`. A meta policy that was inserted without the Google
sources stays for the life of the document, so a user who gains access
mid-session needs a reload (the `blocked` message says so).

To verify: open `/chats/new` on a preview with the key set, open DevTools,
Console and Network, press "+", Google Drive. The Picker's frame must load
from `docs.google.com/picker` with no "Refused to frame" message. Whether
the Picker loads its UI from another frame host (for example
`content.googleapis.com`) is NOT VERIFIED; a console message names the
missing host, and the owner checklist below lists it.

A known gap: a document loaded on a shared chat, an artifact link or an admin
page keeps its own `frame-src` after a client-side navigation into a chat (for
example after branching a share), so the Picker frame is blocked there. The
composable listens for `securitypolicyviolation` during a pick and answers a
`blocked` failure, "Reload the page and try again", at once, instead of
waiting 20 seconds and blaming the Google sign-in. A related residue: a meta
policy inserted on a chat page persists after a client-side navigation to
`/shared/...`, where the Google source stays allowed until the next full
load. The source is path-scoped, no Google script runs there, and a
public viewer never has the Picker, so this is accepted.

### 12.9 UI states and the owner's real-account checklist

Menu row and chips: the row is one line, "Google Drive", hint "Saves a copy in
your Besidka files", with a badge while files are being copied.
Not connected or needing re-authorization: one dialog, "Connect Google Drive on
the API Keys page to attach files from it.", with Open API Keys (the Google
tab) and Not now. A file being copied shows a chip with the Drive icon and an
indeterminate progress bar; a failed file stays beside the chips with its
plain reason and a dismiss button (also reported in a toast); a copy shows the
Drive icon and can be detached like any attachment. A sheet adds a toast that
only the first sheet is included. Failures of the Picker itself (script
blocked or timed out, the Picker not opening, which is how a missing Google
sign-in in this browser shows, a Drive refusal, idle for 15 minutes) are
toasts with what to check.

Branding: the text is always "Google Drive" in full. The mark is Google's
official multicolor Drive logo, unmodified (owner decision of 2026-11-22: the
generic `lucide:hard-drive` icon was also Besidka's own Storage icon, and a
colored mark gives the association). It is `logos:google-drive` from the
Iconify `logos` collection (CC0-1.0, `@iconify-json/logos`, a dev-only
dependency), matched against the `drive_2026` product logo that Google's Drive
branding page links to. Google's rules: resize only, no other change, no
tint, a tooltip on an icon button, and Besidka's own logo larger when the two
appear together. The marks live in `shared/utils/google-brand-icons.ts`
(`GOOGLE_DRIVE_ICON`, `GOOGLE_GMAIL_ICON`, `GOOGLE_CALENDAR_ICON`), are listed
in `icon.clientBundle.icons`, never take a `text-*` color, opacity or filter,
and render as a background image, not a mask (see
`docs/nuxt-icon-collections.md`). The Storage page and its search row keep
`lucide:hard-drive`; they are not Google Drive.

NOT VERIFIED without a real Google account, to check on the preview (a test
account with `drive.file` consent, the consent screen "In production"):

1. Connect, press "+", Google Drive: the Picker opens, and no
   "Refused to frame" message appears (section 12.8).
2. Pick a Doc, a Sheet, a PDF, a PNG, a file someone shared with you, a file
   from a shared drive: each becomes a chip; the Sheet says "first sheet".
3. Pick a file you have no access to, or one the owner locked from download:
   a plain per-file reason, the others still attach.
4. Ask about each file; check the Drive link under the message and in the
   context panel.
5. In the Network tab, note whether a download answers with a redirect and to
   which host (section 12.4); a failure shows as a file that "could not be
   copied".
6. iOS Safari and the installed PWA: signed in to Google, signed out, and with
   a second Google account in the browser; does the Picker open, return to the
   chat, and keep the draft? Then Web Inspector, Storage, for cookies the
   Picker leaves (for G-10).
7. Wrong or missing app id: what the Picker shows (question 1).
8. After a revoke at Google and a reconnect, whether an earlier file can still
   be picked and read (question 3).
9. Disconnect: the copies are gone from Files and Storage.
10. The exact frame URL the Picker loads, in DevTools, Network, filter
    "picker": it should be `https://docs.google.com/picker?...` (matched by
    the path-scoped source). If it is another path or host (for example
    `docs.google.com/picker/v2/...` is fine, but `content.googleapis.com` or
    `docs.google.com/static/...` is not covered), add that exact path to
    `GOOGLE_PICKER_FRAME_SOURCES` and nothing broader.
11. The 20 s "the picker did not open" timer: a slow network or a first
    Google sign-in can take longer to show the frame. If real users hit it,
    raise `GOOGLE_PICKER_LOAD_TIMEOUT_MS` in
    `app/composables/google-picker.ts`; the timer stops at the Picker's own
    `loaded` event, so it only covers the time before the frame reports in.
12. Frame hosts, once more with the browser console open on a full pick and
    import: no "Refused to frame" for any host other than the Picker path.
    This is the item that decides whether `frame-src` needs one more entry.

### 12.10 Against the pre-check, the ticket and the plan

Pre-check rows 4, 8, 9 and 15 (`docs/legal/prechecks/google.md`): the
attach-time label keeps the row 4 sentence but no longer the number of days
("Saves a copy in your Besidka files"): the retention is the account's own
setting and the number was wrong for an account with another one, so the
label is now shorter than the row 4 sentence, a point for the owner to
settle with the pre-check (reading the real period client-side is possible
through the file policy route and was not built). Deletion on disconnect or
`invalid_grant` is section 9.6 (copies are also removed with the account).
There is no "keep as an ordinary
file" option. Row 8: the key and project number are public values, the Picker
runs only on Besidka's client, and the owner's client has no Picker. Row 9:
"Google Drive" in full on the row and in every label; the mark is a generic
icon, not the logo (section 12.9), a point for the owner. Row 15 concerns Save
to Drive and is built in section 13.

Where BES-278 differs from what was built, and the brief won:

- The ticket sends a `data-drive-file` part from the client with an id and a
  mode, and re-fetches metadata on send. Here the copy is made before the
  send as a normal `file` part, and the server rebuilds the reference from
  the stored row (section 12.6). There is no live sync, no link-only mode and
  no pasted-link detection. The Drive tools (section 13) refresh a copy on
  read; there is still no link-only mode and no pasted-link detection.
- The ticket sets a 5 MB snapshot cap. This build uses 20 MiB, the Office
  upload cap, because copies are normal files (section 12.4).
- The ticket hides snapshots from the Uploaded list behind a `drive` source.
  Copies stay in the Uploaded list here and have their own storage category;
  the Drive tab (section 12.12) is a filtered view of the same rows and did
  not move them. They stay out of MCP `list_files` and `read_file` as before
  (`fileHoldsNoGoogleContent`).
- The ticket and the plan mention a CSP with script, connect and image
  sources. The app has no such directives, so only `frame-src` grows
  (section 12.8).
- The plan's default "Office binaries link-only" is not followed (section
  12.4), and the brief's "download with the opt-in" for a share is not built
  (section 12.7).
- `version` is read from Drive but not stored (section 12.4).

### 12.11 Not built, and known limits

- No Drive search, no Gmail or Calendar. The file manager has a Google Drive
  tab (section 12.12); the Drive tools for the model and the one-file save to
  Drive are section 13.
- When the Calendar child adds `calendar.events` to Besidka's client, the
  Picker token route will refuse every grant that holds it (section 12.3):
  an access token cannot be narrowed, so that child must give the Picker a
  Drive-only grant (a second client or a separate consent), not widen this
  route.
- A copy is a snapshot: a Drive edit shows up when the file is picked again,
  refreshed from the Drive tab (section 12.12) or read by the model (section
  13 refreshes a changed original and makes a new copy; the older copy stays
  with the messages that used it).
- A resource key is used for the copy but not stored, so a later "Open in
  Google Drive" for a file shared only by link may ask for access, and a
  refresh of such a copy, from the Drive tab or by a Drive tool, may answer
  "no access" until the file is picked again.

Section 12.12 (the Drive tab) follows section 13 in this file, because the two
children were merged in that order.

## 13. Drive tools (tools child, G-5)

Built on `feat/google-drive-tools`. Three tools for the chat model and a
"Save to Google Drive" button. Code: `shared/utils/google-drive-tools.ts`,
`server/utils/google/{drive-tools,drive-picked,drive-save,drive-upload,
tool-output}.ts`, `server/utils/tool-approval/google-send-candidates.ts`,
`server/api/v1/google/drive/saved-files/index.post.ts`,
`app/composables/google-drive-save.ts`,
`app/components/Chat/{SaveToGoogleDrive,Reasoning/GoogleStep}.vue`,
`app/utils/google-step.ts`.

### 13.1 The tools

Every tool is a `google__` tool built by `buildGoogleDriveTools` with
`buildGoogleApprovalEntry` (section 5.2) and wrapped with `withFollowUpTurn`,
so the model can use the answer in the next step. Each description carries
the untrusted-content sentence, and every result that carries Drive text wraps
it in `<untrusted_tool_result connector="google" tool="...">` through the
same `frameUntrustedResult` the connector results use (a copy of the closing
tag inside the text is neutralized). File names reach the model only inside
the frame: each tool has a `toModelOutput` that hands the model the output
without its `references` (the stored part keeps the name and link for the
card). The stored parts are turned into model messages in one place,
`buildResumedAssistantMessages`, for an approval resume and for a `{ continue }`
round alike, and that seam strips every Google reference's title and link
(`withoutReferenceNames`, the same function the stash uses) from every Google
part, whether its body came from the stash, is missing or the part is a plain
stored one, because `toModelOutput` does not run when stored parts are
converted without their tools. The search answer continuation drops tool
history altogether (`withoutToolHistory`), so no Google part reaches it. Tests:
the seam (`google.spec.ts`), a round and an approval resume through the route
(`chats-tool-approval-continuation.spec.ts`) and the search answer
continuation (`search-answer-continuation.spec.ts`). Every input schema is
strict, and an id of the wrong shape answers the "not one of the files the
user picked" sentence instead of a schema error. The model's file id is the
`file_id` of the list or the `fileId` of an earlier page, never a Drive id.

| Tool | Kind | Input | Output | Limits |
|---|---|---|---|---|
| `google__drive_list_picked` | read | none | `references` (for the card), `count`, `files` (one framed line per file: `file_id`, name, type, size, copied at, changed in Drive) | One D1 query, no call to Google; newest copy per Drive file, at most 50, the 64 KiB cap |
| `google__drive_read_file` | read | `fileId` (the `file_id` the list returned, or the `fileId` of the previous page), optional `offset` | `references`, `readable`, `file` (`fileId`, type, size, `totalCharacters`), `content` (framed text), `isTruncated`, `nextOffset`, `truncationNote`, `note` | Text only: `text/*` (Docs as Markdown, Sheets as the first sheet in CSV, Slides as text, plain text, Markdown, CSV), JSON, XML, YAML and `+json` and `+xml` types; 40 KiB of text per call and the whole JSON under 64 KiB (`fitGoogleToolOutput` halves the text budget until the serialized output fits), copy up to 8 MiB |
| `google__drive_save_file` | write | `fileId` (a Besidka file id), optional `name` | `references`, `saved`, `alreadySaved`, `link`, `message` | One file per call, up to 5 MB, Allow once only |

A refusal or a Google failure is a thrown error with a sentence the model can
read, never a result: only real Drive data or a finished save is an
`output-available` part, so a failed call never sets the sticky chat flag
(`holdsStickyGoogleFlagTrigger`, section 5.3), while the send keeps its
transient taint. A binary file (PDF, image, Office) answers `readable: false`
with no call to Google, its name framed.

**Cost and pacing.** Calls of one send run one at a time (a per-send chain), so
a step that batches calls never runs them in parallel. At most 30 Google Drive
tool calls count for one message across its rounds and approvals
(`GOOGLE_DRIVE_CALLS_PER_MESSAGE`; the calls the reply already holds are read
from its stored parts, `priorGoogleCalls`): enough for a list, a dozen files
with a few pages each and a save or two, where the shared per-turn cap
(12 per turn, 10 rounds) would allow up to 120. The call after the limit is a
thrown sentence that tells the model to report what it did. Only the first
page (`offset` 0) of a file may refresh the copy, and the send remembers the
copy it refreshed, so a second first page of the same Drive file does not call
Google again. Every later page reads exactly the copy whose `fileId` the model
passes, with no call to Google, so all pages of one read come from one
version. A refresh never downloads or exports more than the 8 MiB the tool
reads (`maxBytes` of `importDriveFiles`), so a larger file is refused from its
metadata or cut off the stream, never copied just to be refused.

**Reading.** The tool reads only files the user picked: the id must be one of
the user's own `files` rows with `external_source = 'google'`, checked before
any call to Google (and before the token is read). The Drive id always comes
from that row, never from the model. For text, the copy is made current
through `importDriveFiles`, the code the Picker uses: an unchanged original
(same `modifiedTime`) is one metadata call and the stored copy is read; a
changed one is exported again as a new copy. When Google answers busy or is
unreachable, or the user's storage is full, the last copy is read and the
answer says which of the two reasons it was and that the copy may be out of
date. Other failures map to sentences (no longer returned, reconnect Google
Drive, no access, too large, no download right, empty). An offset past the end
explains itself, and an answer that could make no progress (the output budget
reached zero) is an error instead of a loop. Pages are cut on character
boundaries, tested by reassembling every page of a text with 1-, 2-, 3- and
4-byte characters against its source.

**Saving.** `saveFileToGoogleDrive` is the one function behind the tool and
the button. The file must be the user's own and not a copy of a Drive file
(it already lives in Drive: refused). It never overwrites: the request is
`files.create`, always a new file in My Drive, named by the optional `name`
(cleaned) or the Besidka name, with the stored media type. A file with
`files.drive_copy_id` answers `alreadySaved` with that link and makes no call.
The save takes the file with one atomic D1 update of `drive_copy_id` to
`pending:<epoch ms>` (a claim older than two minutes is abandoned and can be
taken over), so two parallel saves cannot both reach Google; the loser gets
"already being saved". The claim is released when Google answered with an
error (nothing was created) and replaced by the Drive id on success. When a
timeout or a throw comes after the upload started, the claim stays until it
expires and the answer says the outcome is unknown (`unconfirmed`), so the
model cannot create a duplicate at once; if a takeover replaced the claim
while the first upload ran, the first saver answers that the file may exist
twice (`not_recorded`), never `saved`. No column was added. When no Besidka
connection is active any more (a disconnect, an `invalid_grant`, a different
Google account replacing the connection), `deleteGoogleDerivedFiles` also
clears `files.drive_copy_id` for the user (`clearSavedDriveCopyIds`), so
"already saved" never returns a link into an account that is no longer
connected. Readers of the column use `readSavedDriveCopyId`.

The upload (`server/utils/google/drive-upload.ts`) is the documented
multipart upload of `files.create` (Google Drive "Manage uploads": "POST
https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", body
`multipart/related` with a JSON metadata part, then the file part; multipart is
for files of 5 MB or less, which is why saves stop at 5 MB). We add
`supportsAllDrives=true` and send only `{"name": ...}`. The host
`www.googleapis.com` was already in `GOOGLE_FETCH_HOSTS`, so no allow-list
change; `googleFetchJson` got one new optional field, `rawBody`, with a 60 s
timeout for the upload. Drive answers `storageQuotaExceeded` as "your Drive
storage is full".

### 13.2 When the tools are offered

`buildGoogleSendToolCandidates` runs only when `planGoogleSendTools` calls it:
tool approvals active and `google.drive` active (so a user without the flag,
and every send with approvals off, costs no query and gets no gateway
safeguards), and on a gateway only when the chat already holds Google data (a
Drive file attached through the Picker flags it; decision D2 of 2026-11-22).
It then reads one `google_connections` row (Besidka's client) and offers the
three tools only when its status is `active` and the granted scopes hold
`drive.file`. No candidate (and so no tool, and no gateway safeguards) for no
connection, `needs_reauth`, `revoked`, a missing `drive.file`, or a
bring-your-own connection. On a direct provider nothing about the gateway
changes. After that `getGoogleSendTools` offers nothing when the send would
register no other function tool (`toolCallingAllowed`, the route's predicate
for memory, Besidka and connector tools: a model without tool calling, a
forced tool choice, exclusive native web search or image generation),
nothing when the chat holds no Google data and the send declares a provider-run tool that stays callable
after a read (direct Anthropic with any provider tool, a Qwen send with
`enable_search`; section 5.3, built option (b)), withholds all of them from a
model that may not receive Google data, and `withGoogleSendTools` removes any
other `google__` tool. The "+" menu says it in one sentence behind an info
button on the Google Drive row (`GOOGLE_DRIVE_TOOLS_HINT`, a click-to-open
note like Web search and Use memory, never an always-visible paragraph): the
model can list and read the Drive files you picked, and save a Besidka file to
Drive, each time you allow it; with Anthropic web search or Run code, with
Qwen search, or in a gateway chat, attach a Drive file first. The wording
follows the code: the save tool saves a Besidka file (it refuses a Drive
copy), and the Anthropic and Qwen block applies only while the chat holds no
Google data yet (`hasUnremovableProviderTool` with `holdsGoogleData`), after
which the send withholds those provider tools instead. The chat route also counts them as
approval-gated tools (`isApprovalGatedToolName`), so a paused Google tool
never starts the answer guarantee continuation that web search uses. Calls
count in the shared built-in cap (`TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN`, 12
per turn) and in the per-message cap of 13.1.

Approvals (section 5.2): the list and the read ask with Allow once or Allow in
this chat; the save asks every time with Allow once only (an Always grant, a
permission mode and a chat grant never run it). "Allow once" is first and the
only primary button. The chat option says what it covers for these two tools
(`GOOGLE_TOOL_CHAT_GRANT_LABELS`, read by `getApprovalButtons`): "Allow
reading any file you picked from Google Drive in this chat", and "Allow
listing the files you picked from Google Drive in this chat", because the
grant covers every Drive copy of the account, every page and every batched
call, not the one file the card names. The approval text names the file:
`Read "Plan.md" from Google Drive`, and for the save the cleaned name with its
size and date so two files with one name differ: `Save "Report.md" (12 KB,
created 2026-11-22) to your Google Drive as "Final.md"` (one lookup at the
pause, `describe`; the summary without a name when the file is gone).

Taint. A read and the list taint the send and record the Google read source
as every Google tool did. The save returns no Google content, so it is
registered with a static property, `returnsGoogleContent: false`
(`GOOGLE_TOOL_PROPERTIES` in `shared/utils/google-tool-approvals.ts`, default
true for every tool that is not listed there, so an unregistered or
undescribed `google__` tool still taints): `buildGoogleApprovalEntry` gives it
no taint and no read source, `hasGoogleToolResult`,
`isGoogleToolResultContent`, `createToolRoundApprovalState` and
`withGoogleDataFlag` read the property, and its part does not re-flag the chat
on the next send or clear a share opt-in. Exception: when the file being saved
carries the derived mark (`files.google_derived_at`, set on a file written in
a Google-derived send), the entry's `taintsRun` lookup (one D1 read, run by
the cleared-call guard before the tool) taints the send like any Google call,
because the answer names that file. The exception reads that one column. A
Drive copy (`external_source = 'google'`) is not part of it: the save refuses
a Drive copy before anything is sent (13.4), so it never reaches the lookup.

**Empty list.** `google__drive_list_picked` is listed in
`GOOGLE_TOOL_PROPERTIES` with `emptyListHoldsNoContent`: a result with no
reference (nothing picked, or a list too long to show, which carries a count
and a note but no name, id or text) is not a Google result.
`googleToolResultHoldsContent` decides it for the part, the stream chunk that
tells the picker the chat holds Google data, the round state and the flag
wrapper, so an empty list does not set `chats.google_data_at`, announce
Google data or make the chat refuse a model. The send itself still carries
the transient taint of the approved call (no web search, connector calls ask),
which is harmless but not nothing: a later tool of the same send (an artifact
or document write, whose output is then marked Google-derived) still flags the
chat, because the send is tainted. Memory writes are locked by the taint. A list output of an
unexpected shape, and every other Google tool, counts as content.

### 13.3 What is stored, and what the user sees after a reload

D1 holds the references only: Drive id, `kind`, name, https link and the date
of the Drive edit, with `bodyRemoved: true` and the note of section 5.2. A
paused turn keeps the framed body 24 hours in KV and gives it back to the
model on the answer, as for every Google tool (the stash round trip is
tested with the real read tool). A stash record written before the name
stripping existed may still hold reference titles until its 24 hour expiry;
the resume seam (13.1) strips them on the way to the model, so no title
reaches it. The tool step shows "Google Drive" in
the title ("Read a file from Google Drive") with the Google Drive logo
(`GOOGLE_DRIVE_ICON`), and after a reload one line per reference: the
file name and "Open in Google Drive" (`Chat/Reasoning/GoogleStep.vue`), never an
empty box. A public share drops every tool part (`filterPublicParts`), so a
Drive tool step never reaches a shared chat.

### 13.4 "Save to Google Drive" as a user action

`POST /api/v1/google/drive/saved-files` with `{ "storageKey": "<key>" }` (one
file, the key the card already holds; a list is a 400). Gate: same-origin
write guard, session, `google.drive`, legal consent, 10 per minute
(`google-drive-save-rate-limit`). It calls `saveFileToGoogleDrive`; no model, no
approval card: the click is the consent. Answers `{ status: saved |
already_saved, fileId, driveFileId, name, link }`, or 404 (not the user's, not
connected), 409 (a Drive copy, needs reauthorization, Drive full, busy), 413
(over 5 MB), 429, 502.

The button (`Chat/SaveToGoogleDrive.vue`) is an icon button on a file card in
the owner's chat (assistant files), the generated image card, and a "Save to
Google Drive" button beside Download on a ready document card. It shows only
while `google.drive` is active and the user holds an active Drive connection
with `drive-picked` (one cached read of the connection status, only when the
flag is active, never once per card), spins while saving, and becomes "Open
in Google Drive" with the link. The link is remembered for the session by
storage key; after a reload the first click on a file saved before answers
`already_saved` at once and shows the link (no preloading: a card holds only
its storage key, and the saved state would need a request per card). The
result is announced in a polite live region, focus moves to the link when the
button that had it turns into one, the connection is read when the flag turns
active even after the card mounted, and the session caches are cleared at
sign-out (`GOOGLE_DRIVE_SAVE_STATE_KEYS`). It is not shown on shared chats or
on a message the user sent.

**Data decision.** Saving a Google-derived file (a marked document or
file) back to the user's own Drive is allowed: it goes to the same Google
account the user connected, not to a third party, and nothing here sends it to
a model. A copy of a Drive file is refused (it is already in Drive). There is
no "save automatically" and no "save all": one file per call or click
(pre-check row 15).

### 13.5 Where the guards did not fit, and open items

Against the ticket (BES-283), the plan and the pre-check, the brief won:

- Not built, from the ticket: converting an upload to a Google Doc, Sheet or
  Slides (`mimeType: application/vnd.google-apps.*`, the owner addendum "Open
  in Google"; the file is saved as the file it is), the resumable upload for
  5 to 10 MB (saves stop at 5 MB), the allowlist "files attached to this
  chat" (the read allowlist is every file the user picked), and injection
  screening of returned text (the frame plus a per-call approval are the
  measures of pre-check row 13). "Save automatically" stays dropped.
- Closed after the first version of this section, by owner decisions of
  2026-11-22: a connected user on a gateway no longer sends the gateway
  safeguards in chats that never use Drive (D2: on a gateway the Drive tools
  are candidates only in a chat that already holds Google data, and the
  safeguards go out exactly then); a Drive save that returns no Google
  content no longer taints the send or flags the chat (D1, 13.2).
- The chat route lists Google tools as approval-gated tools, so a turn that
  ran only Drive tools does not start the answer guarantee continuation; on
  direct Anthropic routes such a turn can end without text.
- The pre-check says "file id, title, modified date" for references; the
  stored reference also keeps the https link and `kind`. The model never sees
  the name outside the frame (13.1).
- The tool does not check that a file to save belongs to "this chat": files
  made with `create_file` carry no origin message, so ownership is the check
  and the approval card names the file.
- A refreshed copy is a new `files` row each time the original changes; the
  older copies expire with retention.
- NOT VERIFIED without a real Google account (owner checklist): the
  multipart request shape and that `drive.file` may create a file this way
  (the `files.create` reference lists `drive.file` among its scopes and
  `supportsAllDrives` among its parameters; the multipart page read does not
  mention either), the `storageQuotaExceeded` and 403 reasons on create,
  that a file picked earlier is still readable and refreshable with a fresh
  token, that a Doc or Sheet export of a refreshed file works without the
  resource key, and the link opening the saved file
  (`drive.google.com/open?id=`).

### 12.12 The Drive tab (tab child, G-6)

Built on `feat/google-drive-tab`. A "Google Drive" tab in the file manager
lists the Drive copies the user already made, picks more, refreshes a copy
whose original changed, attaches copies to the message and removes them.
Code: `app/components/ChatInput/Files/Modal/Select/Drive.client.vue`,
`app/composables/google-drive-library.ts`, `app/utils/{google-drive-tab,
file-manager-dialog,file-manager-sources}.ts`,
`server/api/v1/google/drive/files/refresh.post.ts`, `refreshDriveCopies` in
`server/utils/google/drive-import.ts`, the `google` source in
`server/utils/files/source-filter.ts`. The modal's tab contract is in
`docs/files.md`, "Source Tabs".

**Registration and visibility.** `getFileManagerExtraSourceTabs()` returns one
entry (`id: 'google-drive'`, label "Google Drive", `data-testid`
`files-source-google-drive`, a lazy component). It resolves
`useFeature('google.drive')` when `Select.client.vue` sets up and reads it in
`isEnabled`, so the tab shows only while the flag is active for the user
(enabled and opted in) and appears or goes away live. The tab label has no
icon (the tabs are radio inputs); the Google Drive logo (`GOOGLE_DRIVE_ICON`)
marks the states, the empty state and the pick button, and rows use
the existing MIME icons, never Google's `iconLink`.

**Requests.** A user without `google.drive` sees no tab and no request. For a
user with the flag, nothing is requested when the modal opens: the tab's
component, `GET /api/v1/google/connections` (the cached status, the same as the
API Keys page) and `GET /api/v1/files?source=google` start only when the tab is
selected. Google is never called when the list opens, and the Picker script
loads only when "Pick from Google Drive" is pressed and Besidka's own status
route says the connection is active (section 12.1, step 3).

**States.**

| State | What shows |
|---|---|
| Status loading | The grid skeleton |
| Not connected | "Connect Google Drive on the API Keys page to pick files from it." and "Open API Keys" (closes the dialog, goes to `/profile/keys?tab=google`) |
| Needs re-authorization | "Google no longer accepts the connection. Reconnect Google Drive on the API Keys page." and "Reconnect" |
| Status failed | "The Google Drive connection could not be checked." and "Try again" |
| Connected, no copies | "No Google Drive files yet", "Pick files in Google Drive and Besidka saves a copy here, ready to attach to a message." and "Pick from Google Drive" |
| Connected, copies | The list, a "Pick from Google Drive" button above it, "Load more" below, the footer when something is selected |
| Search with no match | "No files found", "Try a different search term" |

**List source.** The existing `GET /api/v1/files` got one more `source` value,
`google`: `source = 'upload'` and `external_source` in
`GOOGLE_EXTERNAL_SOURCES`, for the signed-in user only, newest first, the same
search, `offset` and `limit` (at most 100), and the connector-image exclusion
every source gets. Decision: copies are filterable, not excluded elsewhere.
They still show in Uploaded, as before, because hiding them would change the
list of a user without the flag and the Picker child left them there; the
Drive tab is a view of the same rows, so deleting a copy in either place
removes it in both (Select reloads its list when the user returns from the
Drive tab after a change). MCP `list_files` keeps its own source list
(`all`, `upload`, `assistant`, `project`) and cannot reach the new value; Drive
copies stay out of MCP by `fileHoldsNoGoogleContent`, out of shares and out of
project knowledge (section 5.3). The tab uses its own `useFileManager()`
instance with `source = 'google'`, so the rows, selection (click, Shift range,
select all), pagination, search, skeletons, `Load more`, rename and the delete
and bulk-delete routes are the Uploaded tab's own code. Touch-swipe range
selection is the same code too: `useFileTouchSelect`
(`app/composables/file-touch-select.ts`), extracted from `Select.client.vue`
and used by both. The `/` shortcut and the search field belong to
`Select.client.vue`, which hands the tab its search text. A row is the existing row: in the list view the
name, type and size, the date it was copied ("Added", from `lg` up) and the
expiry; the grid tile shows the icon or image and the name, with no type, size
or date. That is a deviation from "name, type, size, when copied" on every
width, kept so the tab has exactly the Uploaded tab's rows. Whether the Drive
original changed since the copy is NOT shown: D1 holds only the `modifiedTime`
at the copy, so knowing it would take one Google call per row. The answer comes
from Refresh.

**Pick more and the dialog stacking decision.** The button runs the same
`useGooglePicker().pick()` as the composer (consent first, at most 5 files),
then `POST /api/v1/google/drive/files`, then reloads the first page. It does
not use `useChatDriveFiles`, which attaches to the composer and counts message
slots. The Picker is Google's iframe appended to `body`; the file manager is a
`showModal()` dialog in the top layer, which covers everything outside it, and
no z-index changes that. So the tab suspends the dialog: `Modal.client.vue`
provides `FILE_MANAGER_DIALOG_KEY` (`close`, `suspend`, `resume`), `suspend()`
closes the dialog without resetting the modal state (the open tab, its search
and its pending Picker stay mounted, the same idea as `closeForPreview`), and
`resume()` shows it again on every outcome (picked, canceled, failed, even a
throw) before the copy request starts, so progress shows in the tab ("Opening
Google Drive", then "Copying"). The send consent comes first, while the dialog
is still open: both consent dialogs are `showModal()` dialogs opened later, so
they sit above the file manager. The pick, copy and refresh buttons are
disabled while any of them runs. Failures use the Picker's own messages as
toasts; a Picker `not-connected` or `reauthorize` answer, or a 404 or 409 from
a route, re-reads the connection status so the tab switches to the matching
state. NOT VERIFIED without a browser and a Google account: that the dialog
closing and reopening around the Picker behaves on iOS Safari and in the
installed PWA (focus return, keyboard, scroll position of the list).

**Refresh.** `POST /api/v1/google/drive/files/refresh`, body `{ ids }` with 1
to 5 Besidka file ids, unique. Gate: the same as the import route (same-origin
write guard, session, `google.drive`, the `import` rate bucket of 10 a minute
shared with the import route, body at most 8 KiB through the shared reader,
legal consent, 404 or 409 before any read when Google is not connected or needs
re-authorization). `refreshDriveCopies` first loads the user's own rows with
`external_source = 'google'`; an id that is not one (another user's, missing,
or an ordinary upload) fails as `not_a_copy` with no Google call and no token.
For each remaining copy, one at a time, with a fresh token, it makes one
metadata call and:

| Result | When |
|---|---|
| `up_to_date` | The Drive `modifiedTime` equals the one stored with this copy, to the second. Nothing is downloaded. |
| `updated` | It differs: the file is copied again through the import code (same limits, export choices, Office checks and storage rules). The answer carries the new file. |
| `newer_copy` | It differs, but a copy of the current version already exists (the reuse rule of section 12.4 found one), so nothing is copied and that copy is returned. This is what refreshing an older row again answers. |
| `failed` | With `code` and `reason`: `deleted` (in the trash in Drive), `unknown_version`, `no_access`, `not_downloadable`, `too_large`, `export_too_large`, `storage_full`, `unsupported_type`, `rate_limited`, `reauthorize`, `empty`, `failed`, `not_a_copy` |

The two null cases of the time comparison. Drive gives no `modifiedTime`: the
version is unknown, so nothing is copied (a copy could be a duplicate of up to
20 MiB each time) and the file fails as `unknown_version` ("Google Drive did
not say when this file last changed, so Besidka cannot tell whether your copy
is current. Your copy is unchanged."). The copy has no stored time (made when
Drive gave none): Drive's `version` is not stored (no schema change was
allowed), so there is nothing to compare it with, and the file is copied once;
the new copy carries the time, so refreshing the older row again answers
`newer_copy` and nothing more is downloaded.

Decision: a refresh never rewrites a copy in place. The R2 object, the
extracted Office text, the KV file cache, the storage statistics and a possible
change of name or type on the export fallback all hang off a stored copy, and
messages already sent point at its storage key. So a changed original becomes a
new copy and the selected one stays: old messages keep showing (and sending
to models) the earlier snapshot, as section 12.11 says, and new attachments use
the new copy. The toast says "Copied the new version of <name>" with "The
earlier copy stays in your files for the messages that used it." The list then
shows both copies, newest first.

Each refresh of a changed file adds one more copy; earlier copies stay until
the user deletes them (the trash button on the row, or select them and press
Delete, in the Drive tab or in Uploaded) or retention removes them (the
account's file retention, as for any upload). Copies count against the storage
allowance until then. A change within the same second as the stored time is not
noticed (the stored time has one-second resolution, as in section 12.4).

An attached copy is swapped. When the refreshed (or already newer) copy
replaces one that is currently attached in the composer, the tab emits
`replace`, `Select.client.vue` and `Modal.client.vue` forward it, and
`ChatInput.client.vue` puts the new file in the same position of the attached
files (one assignment, so the chip does not flicker; if the new copy is already
attached, the old chip is dropped; a copy the model cannot read is not
swapped). Copies in earlier, sent messages are never touched. The toast says
"It replaced the copy attached to your message." before the earlier-copy
sentence.

A copy of a file that was shared only by link was made with a resource key that
is not stored (no column, and no schema change was allowed), so refresh asks
Drive without it and Drive may answer "not found" for such a file. A refresh
cannot tell that case from a file whose access was lost, so every metadata 404
is reported as `no_access`: "Besidka has no access to this file. Pick it again
in Google Drive to give access." Picking it again stores a copy with the key
the Picker returns. Whether Drive answers a file whose access was lost under
`drive.file` with 404 or 403 is NOT VERIFIED; both give `no_access`. Requests
from the UI carry at most 5 ids and go one after the other (a larger selection
is split); results are reported per file by name.

**Attach and remove.** "Attach" in the footer attaches the selected copies
through the same `attach` event as the Select tab, so they become ordinary
chips. The tab applies the composer's own model rules (the unsupported-file
reasons and captions of Select, from `canAttachMediaType` and
`resolveDelivery`, which the host now passes to every extra tab) and detaches
copies that are deselected. The modal now keeps `externalSource` and
`externalId` on an attached file, so the composer builds the Drive reference
part live and, in an owned chat, marks it as holding Google data right away
(`ChatInput.client.vue`), which greys the models the data rule refuses. The
send path is unchanged and still flags the chat before the data guard
(section 12.6). Remove uses `DELETE /api/v1/files/[id]` and
`POST /api/v1/files/delete/bulk`, with the file manager's confirmation:
"Delete "<name>" from Besidka? The original in Google Drive is not deleted."
(for a selection: "Delete N files from Besidka? The originals in Google Drive
are not deleted."). Deleting never calls Google, and deleted attachments are
detached through the existing `files:deleted` hook.

**Tests.** Google and the Picker are mocked everywhere: the refresh route
(`tests/integration/api/google-drive-refresh.spec.ts`: gates, ownership, each
result, sequential calls and tokens, the shared rate limit), the list filter
(`files-index-google-source.spec.ts`), the composable
(`google-drive-library.spec.ts`: suspend and resume order on every outcome,
the single pick, chunking), the tab (`Drive.client.spec.ts`), the host
(`Modal.client.spec.ts`, `Select.client.spec.ts`) and the additive row, menu
and footer actions.

NOT VERIFIED without a real Google account or a browser, for the owner:

1. Open the file manager as a user with `google.drive`: the "Google Drive" tab
   is there after Projects; for a user without the flag it is not, and
   DevTools, Network shows no Google or `source=google` request when the modal
   opens.
2. Not connected, then connected with no copies, then after a pick: the states
   above, and the list in grid and list view, search and "Load more".
3. "Pick from Google Drive": the file manager closes, the Picker opens and is
   usable, and after a pick or Cancel the file manager is back on the Drive tab
   with the same search; on a pick, "Copying" shows and the new copies appear.
   Repeat on iOS Safari and in the installed PWA (the Picker must receive
   taps, and the dialog must reopen with the keyboard closed).
4. Edit a picked Doc in Drive, then Refresh the row and a selection: the new
   copy appears above the old one, the old one is still attachable, and an
   older chat message still shows the earlier version. Refresh again: "<name> is
   up to date" (or "A newer copy of <name> is already in your files" on the old
   row). With the old copy attached to the message before refreshing, its chip
   becomes the new copy in the same position.
5. Trash a file in Drive and refresh it; remove a file's sharing and refresh it
   (the "no access" wording either way); refresh a file that was shared only by
   a link (picked with a resource key).
5a. Touch-swipe over several rows in the Drive tab on a phone, in the list and
   the grid view, on iOS Safari and in the installed PWA.
6. Select copies and "Attach": they become chips; the model picker greys the
   models the data rule refuses; send once.
7. Delete one copy and a selection: the confirmation names the Drive original,
   Uploaded no longer lists them and the storage bar updates.
8. Disconnect Google on the API Keys page and reopen the tab: the copies are
   gone and the "not connected" state shows.

## 14. Gmail tools and Drive search (Gmail tools child, G-8)

Built on `feat/google-gmail-tools`. Five `google__` tools for the owner's own
Google client ("BYO", section 10): `google__gmail_search`,
`google__gmail_read_thread`, `google__gmail_create_draft`,
`google__drive_search` and `google__drive_read_found_file`. Mail and shared
files are written by other people, so every byte of them is untrusted input
and other people's personal data; the design below follows from that. Code:
`shared/utils/{google-gmail-tools,google-gmail-draft-view,mail-address}.ts`,
`server/utils/google/{byo-tools,gmail-api,gmail-text,html-entities,gmail-message,chat-references,drive-search,drive-found-read,send-guard}.ts`,
`server/utils/tool-approval/google-send-candidates.ts` (the BYO branch),
`app/components/Chat/Reasoning/{ApprovalStep,GoogleStep}.vue`,
`app/components/Profile/Google/OwnClient.vue`, `app/utils/google-step.ts`.

### 14.1 The tools

Every tool is built by `buildGoogleByoTools` with `buildGoogleApprovalEntry`
(section 5.2), wrapped with `withFollowUpTurn`, serialized through the per-send
guard and cut to `GOOGLE_TOOL_OUTPUT_MAX_BYTES` (`fitGoogleToolOutput`). Each
input schema is strict. Every description carries the untrusted-content
sentence, and every result that carries mail or file text wraps it in
`<untrusted_tool_result connector="google" tool="...">` through
`frameUntrustedResult`. The model receives each result through
`toModelOutput` (`googleToolModelOutput`) without its `references`, so the
thread ids, dates and file names it works with come from the framed text only.

| Tool | Kind | Input | Output | Limits | Approval options |
|---|---|---|---|---|---|
| `google__gmail_search` | read | `query` (Gmail search syntax, 1 to 300 characters), optional `limit` (1 to 10, default 5) | `references`, `count`, `threads` (one framed line per thread: `thread_id`, `message_id`, date header, sender, subject, snippet of the newest message by Gmail's `internalDate`), `note` (no hit, threads left out to fit, threads too long to list) | `users.threads.list` (exactly up to `limit` threads, spam and trash excluded) then one `users.threads.get` with `format=metadata` and a `fields` mask per thread, one at a time, read with a 512 KiB cap (a thread over it is skipped and counted in the note); 24 KiB of text; the 64 KiB cap | Allow once, "Allow searching all your Gmail in this chat" (at most 5 granted calls per message, then it asks again) |
| `google__gmail_read_thread` | read | `threadId`: only a `thread_id` that a `google__gmail_search` result of this chat holds (shape `[A-Za-z0-9_-]{1,64}` and membership checked before any request; any other id is refused without asking, see below) | `references`, `thread` (`threadId`, `messageCount`, `shownMessages`, `omittedMessages`, `skippedMessages`), `content` (framed: for each message the from, to, cc, date and subject headers, an attachment line and the plain text, oldest to newest by `internalDate`), `isTruncated`, `truncationNote` | One `users.threads.get` with `format=full` and `fields=id,messages(id,internalDate,payload)`, read with a 3 MiB cap; over the cap, one `format=minimal` call for the ids and then `users.messages.get` newest first, one at a time, until 36 KiB of text or 20 messages (a message over 3 MiB is skipped and named); the newest 20 messages; 8,000 characters per message; older ones counted and named as left out; a newest message that alone overflows is cut and says so; no paging | Allow once only |
| `google__gmail_create_draft` | write | `to` (1 to 20), `cc`, `bcc` (20 recipients in total, each address once in any letter case), each `{ email, name? }`; `subject` (200 UTF-16 units); `body` (10,000 UTF-16 units, plain text); optional `replyToThreadId` (only a `thread_id` a search of this chat returned) | `references` (the draft id, kind `gmail-draft`, the Drafts link), `created`, `draftId`, `link`, a message that says it was not sent | One `users.drafts.create` (`fields=id,message(id,threadId)`); for a reply one `users.threads.get` with `format=metadata` first, and a reply whose thread holds no valid `Message-ID` is refused instead of drafted unthreaded | Allow once only |
| `google__drive_search` | read | `query` (1 to 200), optional `kind` (`any`, `document`, `spreadsheet`, `presentation`, `pdf`), `modifiedAfter` (`YYYY-MM-DD`), `limit` (1 to 15, default 8) | `references` (file id, name, link, modified time), `count`, `files` (framed lines: `file_id`, name, type, modified), `note` (pass a `file_id` to `google__drive_read_found_file`) | One `files.list` over My Drive and shared drives; 24 KiB of text; the 64 KiB cap | Allow once, "Allow searching any file in your Google Drive in this chat" (at most 5 granted calls per message, then it asks again) |
| `google__drive_read_found_file` | read | `fileId`: only a `file_id` that a `google__drive_search` result of this chat holds (never a picked, read or saved file, which share the `drive-file` kind) | `references` (file id, cleaned name, link, modified time), `readable`, `file` (`fileId`, `type` (only a plain lowercase `type/subtype` of at most 100 characters, parameters dropped, else `application/octet-stream`), `totalCharacters`, `modified`), `content` (framed: the name and the text), `isTruncated`, `truncationNote`, `note` | `files.get` metadata, then `files.export` (Docs as Markdown with a plain-text fallback, Sheets as the first sheet in CSV, Slides as text) or `files.get?alt=media` for a text type only; 8 MB streaming cap; 40 KiB of text from the start; no paging; nothing stored but the reference (section 14.8) | Allow once only |

A refusal or a Google failure is a thrown sentence the model can read, never a
result, and never repeats Google's own message text (it can echo the request,
which holds a search the user wrote): `classifyGmailFailure` maps the status and
reason to a fixed sentence (401 reconnect, `accessNotConfigured` "the Gmail API
is not turned on in your Google Cloud project", 403, 404, 429, too large, 400,
anything else); Drive search has its own wording of the same codes
(`DRIVE_SEARCH_FAILURE_TEXT`, "the Google Drive API is not turned on"). A failed call keeps the send's transient taint but never sets
the sticky chat flag (section 5.3). HTML mail is converted to text by a linear
scanner (`htmlToPlainText`): `script`, `style`, `head`, `title`, `svg` and
comments are dropped with their content, a `blockquote` (a quoted earlier
message, with nesting matched in one pass) becomes one "[quoted text omitted]"
note, block elements become line breaks and table cells are spaced apart, a
link keeps its address after its text (only `http`, `https` and `mailto`),
images and everything else vanish, a `<` that cannot start a tag stays text,
entities are decoded (decimal, hex and the 253 HTML 4 names with their letter
case, `server/utils/google/html-entities.ts`, generated once from the
`entities` package that is only a transitive dependency, so no dependency was
added), and nothing is ever fetched. Text from mail (and from a found Drive
file) is also stripped of control characters, every invisible format
character (zero width, bidi, and the zero width joiners too, so
a closing tag with a U+200D inside it becomes the real closing tag and
`neutralizeFrameTags` defuses it), lone surrogates and line separators, quoted
lines (`>`) become one note per run, and encoded-word headers (RFC 2047) are
decoded. A blank `text/plain` part falls back to the HTML part, and plain text
is cut to the HTML limit (400,000 characters) before it is cleaned.
Attachments are listed by name, type and size only; there is no attachment
download and no function for it.

**Charsets.** Bodies and encoded words are decoded with `TextDecoder` by the
declared charset (an RFC 2231 language tag such as `koi8-r*ru` is dropped). On
workerd 1.20261119.1 (the repo's wrangler 4.166.0, `compatibility_date`
2026-01-28 and the repo's flags), checked on 2026-11-22 with a scratch Worker,
`windows-1251`, `koi8-u`, `koi8-r` and `iso-8859-5` all decode, and all 256
bytes of each match Node's tables, so no own decoder was added. An unknown
label throws a `RangeError` there as in Node (also checked), and such a
charset becomes the visible line `[unsupported text encoding: <label>]` (the
label cut to `[A-Za-z0-9._:-]`), never a silent UTF-8 guess. Base64 that
`atob` would refuse (a stray `=`, an impossible length) leaves the encoded
word as written and a body empty, and never throws.

**Which ids a read accepts.** `google__gmail_read_thread`, a reply draft's
`replyToThreadId` and `google__drive_read_found_file` accept only an id that a
search of this chat returned (`GoogleReferenceIndex`,
`server/utils/google/chat-references.ts`): thread ids only from
`google__gmail_search` results and file ids only from `google__drive_search`
results, collected from the chat's stored parts (one query joined to the chat
and its owner, filtered by tool name, so another user's chat yields nothing),
from the parts of the reply being resumed (`priorParts`, a pause or a
"Continue" round) and from every search of the current send, whose results are
not in D1 yet. An unknown id is refused without asking the user: the entry's
`failsWithoutRunning` clears it, and a latch makes `execute` refuse that call
even if a granted search in the same step adds the id before it runs (tested).
The answer is a fixed sentence that tells the model to search first. Before
this, the model could pass any id of the right shape.

**Why these grant options.** Gmail reads ask, as the pre-check requires (row 14,
and the plan's "no always approvals"). A search returns only short headers and
snippets, so it takes "Allow in this chat" with a label that says what it
covers. A thread read puts whole messages written by other people into the
model's context, so a chat grant would let an instruction inside one email
start the next read with no prompt: it asks every time with Allow once only
(`GOOGLE_ONCE_ONLY_READ_TOOL_NAMES`; rule 11 in `resolveGoogleApproval` ignores
any chat grant for it, a tightening of the policy, tested). The read of a found
Drive file is on the same list, because a shared file is writable by whoever
shared it. The draft is a write: Allow once only, whatever grant, permission
mode or taint. Always allow is never offered for any of the five. The draft
needs both `gmail.compose` and, to reply in a thread, `gmail.readonly`.

**Granted searches are capped.** A search under "Allow in this chat" runs
without asking at most 5 times per message
(`GOOGLE_GMAIL_SEARCH_GRANTED_CALLS_PER_MESSAGE`,
`GOOGLE_DRIVE_SEARCH_GRANTED_CALLS_PER_MESSAGE`, both in
`shared/utils/google-gmail-tools.ts` next to the other limits, as
`GOOGLE_CHAT_GRANT_RUNS_PER_MESSAGE`); each later call of that search in the
message asks again with the usual options. The count lives in
`createSendToolApproval` (`chatGrantRunsMax` on the entry) and starts from the
`data-tool-grant` markers with the `chat` scope that the stored reply already
holds (`countChatGrantRuns`), so a pause or a "Continue" round does not reset
it and no state record changed shape.

**Cost and pacing.** The Drive tools and these tools share one per-send chain
and one count (`createGoogleSendGuard`): calls run one at a time and at most 30
Google tool calls count for one message (`GOOGLE_DRIVE_CALLS_PER_MESSAGE`; the
sentence says "Google tool calls"). The cap counts tool calls (one
`consumeCall` per `execute`), not HTTP requests. They also count in the shared
built-in cap of 12 per turn, which is kept in the approval state across rounds,
so one send invocation runs at most 12 Google tool calls. The HTTP requests per
call are bounded: a search at most 11 (one list and up to 10 thread
listings), a thread read 1 or, over the response cap, at most 22 (the failed
full read, the id listing and 20 messages), a draft 2, a Drive search 1, a
found-file read at most 3 (metadata, export and the Docs fallback export),
plus at most one token refresh. That is under 300 requests per invocation in
the worst case, far below the 10,000 subrequests of Workers Paid
(`docs/connectors.md`, the Workers ceilings), and every request runs one at a
time through the chain, so the 6-connection limit is never approached. No
separate request budget was added.

### 14.2 When the tools are offered

`planGoogleSendTools` plans candidates only when tool approvals are active and
`google.drive` or `google.byo` is active for the user (two more keys in the
send's one feature read; a user without them costs no query), and on a gateway
only when the chat already holds Google data (the gateway safeguards go out
exactly then, unchanged). `buildGoogleSendToolCandidates` then builds the BYO
branch only when: `google.byo` is active; the `byo` connection is `active`
(read first, so a user without one costs that one read);
`checkGoogleByoAccess` allows the user (an admin with 2FA, the flag and its
Labs opt-in; a flag grant to a non-admin never passes; section 10.3), judged on
the send's own memoized feature context (`featureState`, from
`useFeatureContext`), so the gate costs no further read; and its granted
scopes hold what each tool needs. `google.gmail` adds the three Gmail tools;
the two Drive tools need only `google.byo` and `drive.readonly`. A missing
scope removes only the tools that need it. After
that the unchanged rules apply: `getGoogleSendTools` offers nothing for a
model without function tools (`toolCallingAllowed`), for a send that declares a
provider-run tool that stays callable (`hasUnremovableProviderTool`) while the
chat holds no Google data, and withholds all of them from a model that may not
receive Google data. `getGoogleAccessToken({ clientMode: 'byo' })` runs the
admin gate again before every call on fresh state (one user-state read serves
every flag checked), so a tool built before the owner lost the role answers
"not available for this account"; a Gmail tool passes
`requiredFeatureFlags: ['google.gmail']`, so turning Gmail off in Labs in the
middle of a send stops the next Gmail call the same way while the Drive tools
keep working (tested). `google.gmail` is
`available: true` with `adminOnly: true` (Labs lists it only for an admin),
stage `internal`, `optIn: 'required'`, `spend: 'none'`, still a child of
`google.byo`.

### 14.3 What is stored, and what the user sees after a reload

D1 holds references only (`redactGoogleToolPartsForPersistence`), plus the
tool input, which is composed by the user and the model (section 5.2):

| Tool | Stored in `messages.parts` | Why each field, against pre-check row 6 |
|---|---|---|
| `gmail_search`, `gmail_read_thread` | per thread: the Gmail thread id, kind `gmail-thread`, `https://mail.google.com/mail/#all/<id>`, and the date from Gmail's own `internalDate` (not the `Date` header, which is free text from the sender); `bodyRemoved: true` and the fixed note. Never a subject, sender, address, snippet, attachment name or body | The id and link are needed for "Open in Gmail" after a reload; the date lets the user tell threads apart. The subject and sender are third parties' data and the pre-check lists them only as allowed, not required, so they are not kept (stricter than the pre-check) |
| `gmail_create_draft` | the draft id, kind `gmail-draft`, the fixed Drafts link; the input (recipients, subject, body) | The input is what the user approved on the card and is the user's own composition (the recorded decision of section 5.2); it may quote mail the model read earlier, which is why the chat is flagged whenever a read happened (below) |
| `drive_search` | per file: the Drive id, kind `drive-file`, name (cleaned), the Drive link, modified time | The name is needed to tell results apart after a reload; this is the same set the Drive tools keep (section 13.3), and a Drive file name is far less sensitive than mail |
| `drive_read_found_file` | the same single reference (id, kind, cleaned name, link, modified time); `bodyRemoved: true` and the fixed note. Never the text, no `files` row, no R2 object, no `external_source` value | The text lives only in the turn (and the 24 h KV stash of a paused turn, like every Google body) |

A paused turn keeps the framed bodies 24 hours in KV and gives them back on the
answer, exactly as for the Drive tools (section 5.2). The resume seam
(`buildResumedAssistantMessages`, `withoutReferenceNames`) strips every
reference title and link from every Google part on the way to the model, on an
approval resume and a `{ continue }` round alike, so no mail-derived string
reaches the model outside the frame on any path. Tests prove it through the
route (`chats-tool-approval-continuation.spec.ts`: a paused reply, a missing
stash and a round). The approval part persists a summary in D1
(`Search your Gmail for "<query>"`, `Read the email thread from <day> in your
Gmail`, `Create a Gmail draft "<subject>" to <first recipient> and N more`
with `, a reply in the email thread from <day>` for a reply, `Read "<file
name>", found by a Google Drive search, from your Google Drive`); none holds
text from mail (the query and the draft are composed by the user and the
model; the day is Gmail's own timestamp from the stored reference). The thread
read and the reply word their card with `describe` from the reference index
only, so no Gmail call is made to word a card and no subject can reach a
stored summary. The part also carries one `link` (`describeLink`, kept only by
`readApprovalLink`: HTTPS with no credentials or port in exactly one of two
shapes, `https://mail.google.com/mail/` with an optional `?authuser=` and
`#all/<thread id>`, or `https://drive.google.com/open?id=<file id>`, so a path
such as a `docs.google.com` viewer URL is refused; checked on the server and
again in the browser by the same function): the thread link names the connected account with
`?authuser=<email>` (`buildGmailThreadAccountLink`, from the `byo`
connection's stored address; the stored references keep the plain link), so
the owner can look at the thread before approving. Approval parts are private
(shares and branches drop them) and the address is never logged.

Taint and the chat flag: `gmail_search`, `gmail_read_thread`, `drive_search`
and `drive_read_found_file` return Google content (a found-file read flags the
chat through `markChatGoogleData`, and outputs generated after it get the
derived mark, exactly as for the other reads) (taint, read source and sticky flag as in section 5.3);
a search that returns nothing is not a Google result (`emptyListHoldsNoContent`),
so an empty search flags nothing. `gmail_create_draft` is registered with
`returnsGoogleContent: false`: its answer holds a draft id and a link, no mail
content, so it neither taints the send nor flags the chat. This is sound only
because the draft's own text comes from the user and the model: a model that
quotes mail has read it in this send (tainted) or in a chat that is already
flagged (a flagged chat starts every send with Google taint, so the draft asks
anyway and every Besidka write asks after it). The share dialog names an email
thread as "Email thread from <day>" (`listChatGoogleItemNames`), since a stored
thread has no subject to name; one thread is one name however often it was
found, and a second thread of the same day is "Email thread from <day> (2)",
so two threads never collapse into one name and no mail text is needed. A
public share drops every tool part.

The reasoning step reads "Searched Gmail", "Read an email thread in Gmail",
"Created a draft in Gmail", "Searched Google Drive" or "Read a found file from
Google Drive" with Google's official marks from
`shared/utils/google-brand-icons.ts` (`GOOGLE_GMAIL_ICON` for the Gmail tools,
`GOOGLE_DRIVE_ICON` for the Drive tools), unmodified and never tinted, under
the branding rules of section 12.9. After a reload each
reference is one line: "Email thread from 2026-11-21" with "Open in Gmail", or
"Draft saved in Gmail" with "Open drafts in Gmail", or the Drive file name with
"Open in Google Drive" (`describeGoogleStepReference`).

### 14.4 The approval cards and the owner's card

A draft approval shows a dedicated block (`reasoning-approval-step-gmail-draft`)
read from the tool part's input with `readGmailDraftApprovalView`: every
recipient address with its display name (To, Cc and Bcc rows), the subject, the
whole body (a scrolling box, never clipped, as text and never as markup) and
the line "This only saves a draft in your Gmail. Besidka cannot send it." Above
the body the card says how many lines it has, and in the card view only a run
of more than two blank lines (a line of only white space, format characters,
combining marks and the blank letters U+3164, U+2800, U+115F, U+1160 and
U+FFA0) becomes one "[N blank lines]" line (`collapseBlankLinesForCard`), so text cannot hide below a screen
of empty lines; the draft keeps the body exactly as given (tested). The
scrolling body is a keyboard-reachable region (`tabindex="0"`, `role="region"`,
`aria-label="Draft message"`). A reply's card names its thread like a thread
read does (the day in the summary, "Open in Gmail" for the connected account).
The user answers on exactly the input that runs, because the input comes from
the KV pending record and is validated again by the same function before
anything is sent, and the builder refuses instead of repairing (section 14.5),
so the card, which reads the raw input, never shows a recipient, name or
subject that differs from the message. The input schema refuses an unsafe
draft before any approval is asked, so the card never shows a draft that cannot
run. The largest draft (20 maximum-length addresses, a 200-unit subject,
10,000 units of 3-byte text) stays under the 64 KiB approval payload.

Enter on a focused approval card runs "Allow once" for reads, as before, but
never for the two Google writes (the Gmail draft and the Drive save,
`isGoogleWriteToolName`): their card needs the button. No other tool changed.

On the Google tab of API Keys, the owner's card says what each access is for,
shows where the tools work (`getGoogleByoToolsHint`: Gmail is named only while
`google.gmail` is active for the owner, flag and Labs opt-in), says once Gmail
drafts access is granted that Google's `gmail.compose` permission technically
also allows sending and that Besidka only creates drafts and has no code that
sends, and, once connected, lists the tools that are off because their access
was not granted (the Gmail notes only while Gmail is on; Drive search and
reading found files need Google Drive read access). There is no new page, no
"+" menu row and no per-send toggle (see 14.7).

### 14.5 The draft builder

`buildGmailDraftMessage` (`server/utils/google/gmail-message.ts`, pure) and the
address parser (`shared/utils/mail-address.ts`) are the part that gets a
separate security review. Rules:

- Header names are fixed in the function (`MIME-Version`, `To`, `Cc`, `Bcc`,
  `In-Reply-To`, `References`, `Subject`, `Content-Type`,
  `Content-Transfer-Encoding`); no input is ever a header name. No `From`,
  `Date` or `Message-ID` (Gmail adds them).
- An address is a plain ASCII `local@domain` (`parseMailAddress`: dot-atom
  local part up to 64 characters, at least two domain labels, a top-level label
  with a letter, 254 characters in all). No display name inside it, no quoted
  local part, no comment, no address literal, no internationalized form, no
  `=?` or `?=` (an encoded-word look-alike in the local part), and no
  whitespace of any kind: a trailing newline is a refusal, not trimmed.
- A subject or display name that holds a control character (CR, LF, tab, NUL
  included), a line or paragraph separator, a lone surrogate, a letter that
  renders blank (U+3164, U+2800, U+115F, U+1160, U+FFA0) or an invisible format
  character (zero width, bidi controls) other than the two emoji joiners is
  refused, never stripped or repaired. A body is refused for the same set
  except tab, line breaks and the blank letters, and a CR that is not followed
  by LF is refused too (the card would show it as a space, the message as a
  line break). A display name may not hold `@`, `<` or `>` either, so a
  name cannot pose as another address in the mail client
  (`CEO <ceo@corp.example>` with an attacker's address is refused); the owner
  still approves every recipient card.
- Nothing is repaired, so the card (which reads the raw input) always shows
  what is sent: the same address twice (any letter case, across to, cc and
  bcc), a subject or name with a leading or trailing space and an empty or
  blank name are refusals, not silent trims or drops.
- Non-ASCII or long text in a header becomes RFC 2047 encoded words
  (`=?UTF-8?B?...?=`, at most 45 bytes of text each, split between characters
  and never inside one, folded with `CRLF SPACE`); a short plain display name
  becomes a quoted string with `\` and `"` escaped. The body is normalized to
  CRLF and written as base64 in 76-character lines with
  `Content-Type: text/plain; charset="UTF-8"` and
  `Content-Transfer-Encoding: base64`, so no body line can start a header or
  overrun a line limit.
- At least one `to` recipient; 20 recipients in total; subject 1 to 200 and
  body 1 to 10,000 UTF-16 units (an emoji counts as two; the input schema
  advertises and enforces the same maxima in the same unit); the whole message
  at most 100,000 bytes.
- `In-Reply-To` and `References` come from other people's mail, so each value
  must match a strict `<local@domain>` pattern (`parseMessageId`); a value that
  does not is left out, and when no message of the thread has a valid
  `Message-ID` the reply is refused ("no message id Besidka can reply to
  safely") instead of being drafted unthreaded behind a card that said
  "reply". The builder refuses a bad id it is handed directly. At most the last
  10 references are kept; the card never shows references (they come from
  Gmail, not the input), so that cut is no card-versus-message gap.
- The `users.drafts.create` call is the only write in `gmail-api.ts`: there is
  no function for send, modify, trash, delete or an attachment, and
  `gmail-boundary.spec.ts` fails if one appears. `drafts.create` never sends a
  message.

Tests (`gmail-message.spec.ts`): CR, LF, CR LF and a line separator in the
subject; CR LF in a display name and in an address (also a smuggled `Bcc:`);
address forms (display name, quoted, literal, Unicode, comma, spaces); a body
that contains a header-looking line; Unicode, emoji and 4-byte characters in
encoded words (no split character, words at most 75 characters); bidi,
zero-width and format characters; an over-long subject and body line; an empty
recipient list, cc or bcc only, 21 recipients, duplicates refused; padded
subjects and names refused; the blank letters and lone surrogates; a lone CR;
multi-byte text exactly at the subject and body caps; encoded-word look-alike
addresses; reply ids with CR LF and spaces; the last ten references; the
base64url `raw` round trip.

### 14.6 Outbound

`gmail.googleapis.com` joined `GOOGLE_FETCH_HOSTS` (exact host, HTTPS, no port,
no credentials, `redirect: 'manual'`, 15 s timeout, the answer read through a
byte cap). Drive search uses the already allowed `www.googleapis.com`.
`googleFetchJson` got one optional `maxResponseBytes` for the thread read.
Endpoints (documentation read 2026-11-22):

- `GET /gmail/v1/users/me/threads?q=&maxResults=&includeSpamTrash=false&fields=threads(id)`
  (users.threads.list; `gmail.readonly` allowed; returns threads, so a search
  that hits one long thread many times still returns up to `limit` threads,
  which the earlier `messages.list` plus de-duplication did not).
- `GET /gmail/v1/users/me/threads/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&fields=id,messages(id,internalDate,snippet,payload/headers)`
  for each search hit (512 KiB cap).
- `GET /gmail/v1/users/me/threads/{id}?format=full&fields=id,messages(id,internalDate,payload)`
  (3 MiB cap), `?format=minimal&fields=id,messages(id,internalDate)` and
  `GET /gmail/v1/users/me/messages/{id}?format=full&fields=id,internalDate,payload`
  for a thread over the cap, and
  `?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&fields=messages(internalDate,payload/headers)`
  for a reply
  (https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get;
  `format=full` not available with the `gmail.metadata` scope).
- `POST /gmail/v1/users/me/drafts?fields=id,message(id,threadId)` with `{"message":{"raw":"<base64url>","threadId"?}}`
  (https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
  and https://developers.google.com/workspace/gmail/api/guides/drafts: create
  an RFC 2822 message, base64url encode it, send it in `message.raw`;
  `gmail.compose` allowed).
- `GET /drive/v3/files?q=&pageSize=&corpora=allDrives&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,modifiedTime)`
  (https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list;
  `drive.readonly` allowed). The query is `fullText contains '<text>' and
  trashed = false and mimeType != 'application/vnd.google-apps.folder'` plus an
  optional exact type and `modifiedTime > 'YYYY-MM-DDT00:00:00'`; the text
  escapes `\` and `'` as the "Search for files and folders" guide says
  (https://developers.google.com/workspace/drive/api/guides/search-files).
  `fullText` covers the name, the description and the content, so there is one
  search, not a name search and a content search.
- For a found file: `GET /drive/v3/files/{id}?supportsAllDrives=true&fields=`
  (metadata), then `GET /drive/v3/files/{id}/export?mimeType=` for a Google
  Doc, Sheet or Slides file, or `GET /drive/v3/files/{id}?alt=media&supportsAllDrives=true`
  for a text file, through the same `googleFetchBytes` as the Picker import
  (one redirect hop to `*.googleusercontent.com` without the token, a byte cap
  while streaming).
- A request that throws (a timeout, a refused redirect, an answer over its
  cap) maps to a code with `classifyGoogleRequestException`, also for Drive
  search, so an oversized answer says "too large" instead of "failed".

### 14.7 Where the ticket (BES-295) and the brief differ

The brief and the plan override the ticket:

- No "+" menu "Google" section, no per-send toggles or tiles, no
  `chatToolSchema` entries (`google_gmail`, `google_drive_search`), no
  `google_scope_missing` 409: the tools are candidates like the Drive tools
  (14.2), and the owner sees missing access on the API Keys card. Nothing is
  hidden from the "+" menu because the Drive row's hint covers where the tools
  work only for Besidka's own client.
- Approvals: no "always" option anywhere; Allow once for a draft (the ticket
  said "allow once / always in this chat / always"); a thread read is once
  only. Results are references only (the ticket framed and screened them).
- No injection screening (`injection-screening.ts`): the untrusted frame, a
  per-call approval, drafts only and no send tool are the measure for the
  pre-check's row 13.
- Search returns threads (one per thread, at most 10), not messages (20).
  `gmail_read_thread` has no `maxChars` and no paging: it keeps the newest
  messages, drops quoted lines instead of keeping 2,000 characters of them and
  says how many older messages it left out.
- `drive_search` has `kind` and `modifiedAfter`, at most 15 results, and returns
  no owner. Its results are read by a separate once-only tool that stores
  nothing, not through `drive_read_file` and not as copies, see 14.8.
- Drafts can reply in a thread only with `gmail.readonly` as well.
- Telemetry is Axiom counts only (`attributes.googleByoTools`: thread, message
  and recipient counts, flags); there is no Analytics Engine event.
- `drive_search` is offered with `google.byo` alone (as the ticket says), the
  Gmail tools with `google.byo` and `google.gmail` (as the brief says).

### 14.8 Drive search: how a found file is read

Decided: option (b), a read that stores nothing. A BYO copy (option (a)) would
need its own `external_source` value and a cleanup, storage, share and
data-guard rule (section 10.6: copies belong to Besidka's mode, so a BYO copy
would be swept as an orphan or outlive the BYO grant), so it was not built.
`google__drive_read_found_file` (`readFoundDriveFile` in
`server/utils/google/drive-found-read.ts`) instead:

- accepts only a file id that a `google__drive_search` result of this chat
  holds (14.1, "Which ids a read accepts"); `drive_read_file` still refuses a
  found id as "not one of the files the user picked" without a call to Google
  (tested);
- asks every time with Allow once only (`GOOGLE_ONCE_ONLY_READ_TOOL_NAMES`): no
  chat grant and never Always allow, because a shared file is writable by
  whoever shared it;
- applies the rules of `importDriveFiles` without its copy: metadata on all
  drives first, a folder or trashed file refused, Docs exported to Markdown
  (plain text when Markdown is refused), Sheets to the first sheet in CSV,
  Slides to text, any other file only when its type is text
  (`isGoogleDriveTextMediaType`; a PDF, image or Office file answers "not
  readable here" without downloading), a refused download, a byte cap of 8 MB
  enforced while streaming, `redirect: 'manual'` and the exact-host allow-list
  (the shared `googleFetchBytes`); it never calls `importDriveFiles`, which
  writes a `files` row and an R2 object;
- cleans the text like mail (controls, invisible characters, joiners and lone
  surrogates removed; tabs kept for TSV), frames it as untrusted and cuts the
  whole output to `GOOGLE_TOOL_OUTPUT_MAX_BYTES` with 40 KiB of text from the
  start and a truncation note; there is no paging in this version;
- stores only the reference (id, kind, cleaned name, link, modified date),
  which `withoutReferenceNames` and `toModelOutput` strip from what the model
  sees on the first call, a resume and a "Continue" round, like every Google
  reference; the result taints the send and flags the chat, generated outputs
  get the derived mark, and a paused turn keeps the body 24 hours in KV;
- needs `drive.readonly` on the BYO connection and runs the admin gate and the
  scope check again on every call; logs hold counts and failure codes only.

The existing picked-file read (`google__drive_read_file`) reads the stored copy
as it is and does not run the mail cleaning, so a joiner inside a picked text
file reaches the frame unchanged; noted here, not changed in this child.

### 14.9 Not built

Sending mail, labels, deleting or modifying mail, attachment download, thread
paging, paging through a found Drive file, the "+" menu toggles, injection
screening, Calendar (section 15), and any MCP exposure:
`config/mcp-surface.json` is unchanged, the MCP
modules import none of this code, and a chat that used Gmail is withheld from
`get_chat` through the sticky flag (tested through `chatHoldsGoogleData`, not
through an MCP tool call).

Known limits: the refresh of an expired `byo` access token is not exercised
by these tests (they cover a connection that needs re-authorization, a 401, a
missing scope and a lost admin gate); thread reads that need an approval each
are bounded by the 5 approval rounds per message (section 5.2); assistant text
that summarizes mail is not redacted (section 5.2); a draft's input, which may
quote mail, stays in D1 like every Google write input; no Snyk scan was run
on the new code.

### 14.10 Owner checklist, with a real Google project

Nothing here was run against Google; Google is mocked in every test. NOT
VERIFIED, to check once with the owner's own project (a restricted-scope
client that is "In production" or the owner as a test user; "Testing" gives
7-day refresh tokens):

1. Connect with "Your Gmail, read only", "Gmail drafts" and "All your Google
   Drive files, read only" ticked. The card lists all three and shows no
   missing-tools note; untick one on a second connection and see the matching
   note.
2. Ask "what did <name> send me about <topic>". Allow the search. Check the
   threads, the "Email thread from <day>" lines after a reload, and that Open
   in Gmail opens the thread (the `#all/<threadId>` form is NOT VERIFIED).
3. Ask to read one thread: the card allows once only. Check an HTML-only mail,
   an attachment (listed, not downloaded), a long thread (older messages
   named as left out) and a non-ASCII subject (whether Gmail returns headers
   decoded or encoded is NOT VERIFIED; both are handled).
4. Ask for a reply: the card shows every recipient, the subject and the whole
   body, Allow once only. Check the draft in Gmail Drafts: UTF-8 subject and
   display name, the body, Bcc kept, threading with the original thread (the
   `threadId` plus `In-Reply-To` and `References` form, and padded base64url
   `raw`, are NOT VERIFIED), no `From` problem. Deny one and see nothing created.
5. Ask for a Drive search ("find my budget spreadsheet"): My Drive and a shared
   drive file both appear (`corpora=allDrives` with `fullText` and no ordering
   is NOT VERIFIED); an apostrophe in the words works.
6. Turn the Gmail API off in the Google Cloud project and search: the answer
   says the API is not turned on (the `accessNotConfigured` reason is NOT
   VERIFIED).
7. Remove the admin role or 2FA and send again: no Gmail tools are offered.
8. Open a paused draft card on an iPhone (Safari and the installed PWA): the
   long body scrolls inside the card and the buttons stay reachable.
9. On a thread read card and a reply card, press "Open in Gmail": it opens the
   thread in the connected account (the `?authuser=<email>#all/<threadId>`
   form is NOT VERIFIED), also when the browser is signed in to a second
   Google account first.
10. Ask to read a thread id the model invents, or one from another chat: it is
    refused without a card and the model is told to search first.
11. Search Drive, then ask to read a found Google Doc, a Sheet, a text file and
    a PDF: the card asks every time with Allow once only; the Doc reads as
    Markdown, the Sheet as CSV, the PDF says it is not readable; nothing new
    appears in Files (NOT VERIFIED against real Drive exports).
12. Read a mail from a Ukrainian sender in `windows-1251` or `koi8-u`: the text
    is readable, not mojibake (decoding is verified on local workerd, the
    real mail is NOT VERIFIED).
13. Allow Gmail search in a chat and ask for more than five searches in one
    message: the sixth asks again.

## 15. Calendar tools (Calendar tools child, G-9)

Built on `feat/google-calendar-tools`. Three `google__` tools for the owner's
own Google client ("BYO", section 10) and its primary calendar:
`google__calendar_list_events`, `google__calendar_free_busy` and
`google__calendar_create_event`. Calendar runs only on the owner's own client
in this child: Besidka's client never asks for a Calendar scope, so the Drive
Picker token never carries one. Event titles, descriptions, locations and
organizer names are written by other people (an invitation from a stranger
lands on a calendar), so every byte of them is untrusted input and other
people's personal data, as mail is (section 14). Code:
`shared/utils/{google-calendar-event,google-calendar-tools}.ts`,
`server/utils/google/{calendar-api,calendar-tools}.ts`,
`server/utils/tool-approval/google-send-candidates.ts` (the BYO branch),
`app/components/Chat/Reasoning/{ApprovalStep,GoogleStep}.vue`,
`app/components/Profile/Google/OwnClient.vue`, `app/utils/google-step.ts`.

### 15.1 The tools

Every tool is built by `buildGoogleCalendarTools` with
`buildGoogleApprovalEntry` (section 5.2), wrapped with `withFollowUpTurn`,
serialized through the per-send guard that Gmail and Drive share
(`createGoogleSendGuard`: one at a time, 30 Google tool calls per message) and
cut to `GOOGLE_TOOL_OUTPUT_MAX_BYTES` (`fitGoogleToolOutput`). Each input
schema is strict, so an unknown key is refused before anything runs. The model
receives each result through `toModelOutput` (`googleToolModelOutput`) without
its `references`.

| Tool | Kind | Input | Output | Limits | Approval options |
|---|---|---|---|---|---|
| `google__calendar_list_events` | read | `from` and `to`: RFC 3339 date-times with an explicit offset, `to` after `from`, at most 31 days apart | `references`, `count`, `calendarTimeZone` (only when it is a known time zone), `events` (one framed line per event: `start`, `end`, `all_day`, `title`, `location`, a short `description`, `organizer` (`you`, or the name or address of someone else), `guests` (a number), `video_call_links` (a number), `attachments` (a number), `type` and `status` when they are not the plain ones), `note` | `events.list` on the primary calendar only, `singleEvents=true`, `orderBy=startTime`, `maxResults=50`, a `fields` mask; one request; the answer is read with a 1 MiB cap (over it: "use a shorter window"); 24 KiB of text; the 64 KiB cap | Allow once, "Allow reading events on your Google Calendar in this chat" (at most 5 granted calls per message, then it asks again) |
| `google__calendar_free_busy` | read | the same window | `references` (one), `window`, `count`, `busy` (validated start and end times in UTC, at most 100 intervals), `note` | `freeBusy.query` for `primary` only, one request, a `fields` mask, a 256 KiB cap; times only, no event text | Allow once, "Allow checking when you are busy in your Google Calendar in this chat" (at most 5 granted calls per message) |
| `google__calendar_create_event` | write | `title` (1 to 200 characters), `start` and `end` (RFC 3339 with an explicit offset, or two dates for an all-day event), `timeZone` (an IANA name), optional `description` (4,000 characters) and `location` (300) | `references` (the event id, its start day and its link), `created`, `link`, a message that nobody was invited and no email was sent | One `events.insert` on the primary calendar with `sendUpdates=none` | Allow once only |

There are no attendees, no video call, no repeat, no reminders and no
attachments in a created event, and no tool edits, moves or deletes one, reads
another calendar or reads one event by id. A refusal or a Google failure is a
thrown sentence the model can read and never repeats Google's own message
text (`classifyCalendarFailure`: 401 reconnect, `accessNotConfigured` "the
Google Calendar API is not turned on in your Google Cloud project", 403, 404,
429, too large, 400, anything else).

**Why these approvals.** The two reads put text written by other people into
the model's context, but only short fields (the pre-check's row 14 asks for an
approval per read, not for once-only reads), so they take the same "Allow in
this chat" grant as `google__gmail_search`, with the same cap of 5 granted
calls per message (`GOOGLE_CALENDAR_GRANTED_CALLS_PER_MESSAGE`, in the same
`GOOGLE_CHAT_GRANT_RUNS_PER_MESSAGE` map, counted from the stored
`data-tool-grant` markers so a pause or a "Continue" round does not reset it).
The write asks every time with Allow once only, whatever grant, permission
mode or taint (rule 11, `isGoogleWriteToolName`), and Enter on its card never
approves it. Always allow is never offered for any of the three.

**Untrusted text.** Titles, locations, descriptions and organizer names go
through `cleanMailField`, the same cleaning as mail: control characters,
every invisible and bidi format character (the joiners too, so a closing tag
with a U+200D inside it becomes the real closing tag and
`neutralizeFrameTags` defuses it), lone surrogates and line separators are
removed, and every field is collapsed onto one line, so one event is one
framed line and no text can forge another event. An HTML description
(Google Calendar often stores one, and a description with an entity is
treated as HTML) goes through the same linear `htmlToPlainText` as mail
(`script`, `style` and comments dropped with their content, entities
decoded, nothing fetched), then the cleaning. Lengths are capped (title and
location 200, description 500, organizer 100 characters). Everything is
framed by `frameUntrustedResult` as
`<untrusted_tool_result connector="google" tool="calendar_list_events">`. A
time is passed on only when it has exactly the shape of a date or an RFC 3339
date-time (`readCalendarResponseTime`), so no free text rides on a time; an
event whose start or end is not one, whose id is not `[A-Za-z0-9_-]{1,256}`
or that is cancelled is left out and counted in the note.

**Guests.** The attendees of a listed event are other people's addresses. The
`fields` mask asks Google for `attendees(responseStatus)` only, so no address
or name enters the Worker; the model gets the number of guests, whether the
owner is the organizer (`organizer: you`) and the number of video call links
and attachments (the `fields` mask leaves out their addresses too). The tool
description says so. The organizer of an event someone else created is shown
by display name, or address when there is no name, inside the frame.

### 15.2 Scopes

`shared/utils/google-scopes.ts`: `calendar.events` is gone. The `calendar`
capability is `https://www.googleapis.com/auth/calendar.events.owned` and
`https://www.googleapis.com/auth/calendar.events.freebusy`, for the `byo`
client only, and the capability counts as granted only when both are. Each
tool needs only its own (`GOOGLE_CALENDAR_TOOL_SCOPES`): listing and creating
need `.owned`, free and busy needs `.freebusy`, so a grant of one gives the
tools of that one and the card says Calendar access is missing. Checked
against Google's Calendar API reference on 2026-11-22, the "Authorization"
section of each method:

| Method | Documented scopes (the ones relevant here) |
|---|---|
| `events.list` (https://developers.google.com/workspace/calendar/api/v3/reference/events/list) | `calendar.readonly`, `calendar`, `calendar.events.readonly`, `calendar.events`, `calendar.app.created`, `calendar.events.freebusy`, **`calendar.events.owned`**, `calendar.events.owned.readonly`, `calendar.events.public.readonly` |
| `events.insert` (https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) | `calendar`, `calendar.events`, `calendar.app.created`, **`calendar.events.owned`** |
| `freebusy.query` (https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) | `calendar.readonly`, `calendar`, **`calendar.events.freebusy`**, `calendar.freebusy` |

`events.list` also lists `calendar.events.freebusy`; what that scope returns
from `events.list` (free and busy detail only, by its name) is not used here
and not verified: Besidka asks for `.owned` for listing. `sendUpdates` values
are `all`, `externalOnly` and `none` (the same page); Besidka always sends
`none`. An old connection that holds the broad `calendar.events` scope keeps
it at Google until the owner disconnects (the grant is revoked as a whole);
Besidka neither asks for it nor uses it, and the connection lists no Calendar
capability until the two new scopes are granted.

The owner's connect flow requests the two scopes only while `google.calendar`
is active for the owner (the flag and its Labs opt-in): the card does not
offer the Calendar box otherwise, drops `calendar` from the capabilities of a
reconnect, and `POST /api/v1/google/byo/start` answers 403 "Google Calendar
is not turned on" for a body that names `calendar` while the flag is off
(`checkGoogleByoAccess` with `requiredFlags: ['google.calendar']`; the
existing admin gate runs first). The route also leaves the two Calendar
scopes out of the request while the flag is off even when the stored grant
holds them (the start route normally adds the scopes of an active connection,
section 10.4; `excludedScopes` of `startGoogleConnection` removes them), so
"Add access" never re-requests Calendar without the flag, and the connection
then drops them (tested by reading the authorization URL). A connection
without them simply gets no Calendar tools, as with a missing Gmail scope.

### 15.3 When the tools are offered

`google.calendar` is `available: true`, `adminOnly: true`, stage `internal`,
`optIn: 'required'`, `spend: 'none'`, and a child of `google.byo` (the same
level as `google.gmail`). The send reads it with the other Google flags
(`'google.calendar'` in the feature list of the chat route,
`googleCalendarActive` through `planGoogleSendTools`), and
`buildGoogleSendToolCandidates` builds the Calendar tools in the BYO branch
under the unchanged conditions of section 14.2 (an active `byo` connection,
the admin gate, tool calling, no unremovable provider tool in a chat without
Google data, a model that may receive Google data, gateways only in a chat
that already holds Google data) when `google.calendar` is active and the
stored scopes hold what the tool needs. Every call runs the gate again
(`getGoogleAccessToken` with `clientMode: 'byo'` and
`requiredFeatureFlags: ['google.calendar']` in one fresh feature read), so
turning Calendar off in Labs in the middle of a send stops the next Calendar
call while Gmail and Drive keep working (tested), and a lost admin role,
ended connection or missing scope answers with a fixed sentence and no
request to Google.

### 15.4 Creating an event: nothing outward, and the card is the body

`validateCalendarEvent` (`shared/utils/google-calendar-event.ts`, pure, also
used by the input schema, `execute` and the card) refuses instead of
repairing:

- Times: both RFC 3339 date-times with an explicit offset, no fraction of a
  second, real calendar and clock values (a round trip catches `02-30`), or
  both real dates for an all-day event; mixed forms are refused; the end must
  be after the start as an instant (an all-day end date is exclusive, Google's
  meaning: one day on 2026-12-01 is start 2026-12-01 and end 2026-12-02, which
  the tool description and the card both say).
- Time zone: an IANA name the runtime knows in the letter case people write it
  (`Europe/Kyiv`, `America/New_York`, `UTC`); a name the runtime resolves to
  the same name only in another letter case, an unknown name and an offset
  are refused (an alias the runtime resolves to an older name, such as
  `Europe/Kyiv` against `Europe/Kiev`, is accepted when every part starts with
  a capital letter and none is shouted).
- The offset in a date-time must equal the offset the time zone really has at
  that instant (`getTimeZoneOffsetMinutes`, from `Intl.DateTimeFormat`), so a
  stale offset after a daylight saving change is refused, and so is a local
  time that falls in the hour skipped when the clocks go forward; both
  occurrences of a repeated time after the clocks go back are accepted, since
  the offset tells them apart (tested for Europe/Berlin and America/New_York
  around the 2026 changes on Node, and the zone and offset checks were also
  run on local workerd 1.20261119.1 through a scratch Worker with the same
  results).
- Text: the title is 1 to 200 UTF-16 units on one line with no leading or
  trailing space and no control, invisible or bidi character; the location is
  at most 300 on one line with the same rules; the description is at most
  4,000 of plain text with line breaks and tabs allowed (the body rules of the
  Gmail draft: no lone CR, no invisible or bidi character, no lone
  surrogate). An empty description or location is left out of the body.

Only after all of that does it return the request body. `CalendarInsertBody`
has the keys `summary`, `description`, `location`, `start` and `end` and no
other; `buildCalendarInsertPayload` in `calendar-api.ts` copies those fields
one by one (so an object that carried an `attendees` property at runtime
would still lose it), the call always sends `sendUpdates=none`, and no
parameter that turns on video calls or attachments is ever sent.
`calendar-boundary.spec.ts` proves it: the module has no PUT, PATCH or
DELETE, no other calendar, no `/acl`, `/move`, `quickAdd`, `/import` or
`/watch`; two POSTs only (the free and busy query and the insert); the body
type has no attendee key; the payload of a hostile object has only the
whitelisted keys; and no byte of any request body in the tool specs holds an
attendee, conference, recurrence, reminder or attachment.

The approval card (`reasoning-approval-step-calendar-event`) reads the
tool part's input with `readCalendarEventApprovalView`, which is built from
the same `validateCalendarEvent` body that the tool sends, so it cannot show
a title, time or time zone that differs from the request (a spec compares the
view with the parsed request body for timed, all-day and daylight saving
cases). The view skips the two checks that need the runtime's time zone data
(the name is known, the offset is the zone's at that instant; the server ran
them before the approval was asked), so a browser whose time zone data
differs from the Worker's never turns a valid card into raw arguments; every
other check still runs. It shows the title, "Timed event" or "All-day event", the start and
the end exactly as the strings that are sent (for an all-day event "First
day" and "End (not included)" and the last day), the time zone, the location,
the description in the same keyboard-reachable scrolling region as the Gmail
draft with the line count and `collapseBlankLinesForCard` (a run of more than
two blank lines becomes one "[N blank lines]" line on the card only), and the
sentence "Nobody is invited and no email is sent. The event is created only
on your own primary calendar." The text is rendered as text, never as markup.
An input that cannot run never reaches an approval: the schema refuses it
first, and the card shows nothing for it.

### 15.5 What is stored, and what the user sees after a reload

D1 holds references only (`redactGoogleToolPartsForPersistence`), plus the
tool input, which is composed by the user and the model (section 5.2):

| Tool | Stored in `messages.parts` | Why |
|---|---|---|
| `calendar_list_events` | per event: the Google event id, kind `calendar-event`, Google's own link in its exact `eid` shape (else the day view link of the event's start day) and the start day (`YYYY-MM-DD`); `bodyRemoved: true` and the fixed note. Never a title, description, location, organizer, guest count or time | The id and link are for "Open in Google Calendar" after a reload and the day tells events apart; the title is a third party's data and the pre-check lists it as allowed, not required, so it is not kept (stricter than the pre-check, as for Gmail subjects) |
| `calendar_free_busy` | one reference: `free-busy-<first day of the window>`, kind `calendar-free-busy`, the day view link and that day; never an interval | So a reload can say that free and busy time was read, without keeping when the owner was busy |
| `calendar_create_event` | the new event id, kind `calendar-event`, its link and start day; the input (title, times, time zone, description, location) | The input is what the user approved on the card and is the user's own composition (the recorded decision of section 5.2); it may quote events or mail the model read earlier, which is why the chat is flagged whenever a read happened |

`withoutReferenceNames` and `toModelOutput` strip every title and link from
what the model sees, on the first call, on an approval resume and on a
"Continue" round (a stored event link never appears in a prompt; the one link
the model does see is the link of an event just created, in the result of the
write, which is Google's own validated link). A paused turn keeps the framed
bodies 24 hours in KV like every Google result (section 5.2), and the route
specs show the model gets no event text outside the frame, and none at all
when the stash is gone.

Taint and the chat flag: `calendar_list_events` and `calendar_free_busy`
return Google content (the send is tainted and the chat is flagged;
`GOOGLE_TOOL_PROPERTIES`); an empty listing is not a Google result
(`emptyListHoldsNoContent`) and flags nothing; free and busy time has no
`emptyListHoldsNoContent`, because even an answer with no busy time says
something about the calendar, so it always flags. `calendar_create_event` is
registered with `returnsGoogleContent: false`: its answer holds an id and a
link, no calendar content, so it neither taints the send nor flags the chat.
Like the Gmail draft, this is sound only because the event's own text comes
from the user and the model: a model that quotes a calendar read it in this
send (tainted) or in a chat that is already flagged (every send of a flagged
chat starts with Google taint, so the write asks anyway and every Besidka
write asks after it).

The share dialog names a stored event as "Calendar event on <day>" and a free
and busy answer as "Free and busy times from <day>"; two items of the same day
get distinct names ("Calendar event on <day> (2)"), and one item is one name
however often it was found. A public share drops every tool part. A reloaded
step reads "Read Google Calendar", "Checked free and busy time in Google
Calendar" or "Created an event in Google Calendar" with Google's official
Calendar mark (`GOOGLE_CALENDAR_ICON` from
`shared/utils/google-brand-icons.ts`, unmodified, no color class), and each
reference is one line with "Open in Google Calendar". The owner card
(`OwnClient.vue`) lists Calendar access like Gmail, under the label "Your
Google Calendar events", only while `google.calendar` is active, with the same
mark beside the box (no color class, no opacity, square so its aspect ratio
is kept) and one sentence about what the two permissions allow; the connected
card lists Calendar in the tools hint and, when the access was not granted, in
the "some tools are off" note.

### 15.6 Outbound

`www.googleapis.com` is already in `GOOGLE_FETCH_HOSTS`; the Calendar paths
go through the same `googleFetchJson` (exact host, HTTPS, no port, no
credentials, `redirect: 'manual'`, 15 s timeout, streaming response cap), one
request at a time, with a `fields` mask on every request. Endpoints
(Google's reference, read 2026-11-22):

- `GET /calendar/v3/calendars/primary/events?timeMin=&timeMax=&singleEvents=true&orderBy=startTime&maxResults=50&fields=timeZone,nextPageToken,items(id,status,eventType,summary,description,location,start,end,htmlLink,organizer(self,displayName,email),attendees(responseStatus),hangoutLink,conferenceData(entryPoints(entryPointType)),attachments(fileId))`
- `POST /calendar/v3/freeBusy?fields=calendars/*/busy,calendars/*/errors` with
  `{ timeMin, timeMax, items: [{ id: "primary" }] }`; the single entry of the
  answer's `calendars` object is read whatever its key is, and the key is never
  echoed (it can be the account's address).
- `POST /calendar/v3/calendars/primary/events?sendUpdates=none&fields=id,htmlLink,start,end`
  with `{ summary, description?, location?, start, end }`, where a boundary is
  `{ dateTime, timeZone }` or `{ date, timeZone }`.

Logs hold counts and codes only (`attributes.googleByoTools.calendarListEvents`
with the event, skipped and more-pages counts, `calendarFreeBusy` with the
interval counts, `calendarCreateEvent` with three booleans), never titles,
times, addresses or links.

### 15.7 Where the ticket (BES-297) and the pre-check differ

- Scope: the narrow pair of section 15.2 instead of `calendar.events`, and the
  owner's own client only: Besidka's client and the Picker are not widened, so
  the pre-check's "Besidka client ... later `calendar.events`" is not done.
- Branding: the pre-check says Calendar appears as text with no logo until its
  brand page is checked (row 9). The brief for this child asked for Google's
  official Calendar mark on the steps, as Gmail's mark is used for Gmail; the
  Calendar brand guidelines page has not been fetched or read, so the
  placement and the word "Google Calendar" next to the mark are NOT VERIFIED
  against it.
- Persistence: no event title is stored (the pre-check allows one).
- No attendees, conferencing, recurrence, reminders override or attachments in
  a created event; no edit or delete.
- Approvals as in section 14: reads ask (or take the capped chat grant), the
  write asks once, never Always allow.
- MCP is unchanged: no Calendar tool, `config/mcp-surface.json` unchanged, the
  MCP modules import none of this code, and a chat that read Calendar is
  withheld from `get_chat` through the sticky flag.

### 15.8 Not built, and known limits

Attendees and invitations, editing, moving or deleting events, other
calendars than the primary, reading one event by id, paging past 50 events,
recurrence rules, working locations beyond what `events.list` returns,
conference links, Besidka's own client and the Picker for Calendar, a
Calendar tab or toggles in the "+" menu, MCP exposure and any D1 change.
Known limits: a created event gets the calendar's default reminders (the
body sets none); assistant text that summarizes events is not redacted
(section 5.2); an event's input, which may quote events or mail, stays in D1
like every Google write input; no Snyk scan was run on the new code.

### 15.9 Owner checklist, with a real Google project

Nothing here was run against Google; Google is mocked in every test. NOT
VERIFIED, to check once with the owner's own project:

1. In the owner's Google Cloud project enable the Google Calendar API and add
   the two scopes `calendar.events.owned` and `calendar.events.freebusy` under
   Data access (section 6, steps 1 and 3). Turn on Google Calendar in Labs,
   tick "Your Google Calendar events" and connect. If the connection came
   from before this child and holds the old `calendar.events` scope,
   disconnect and connect again so the old grant is revoked.
2. Ask "what is on my calendar next week". Allow once. Check the events, that
   a repeating event is listed once per day, that an all-day event reads
   `all_day: yes`, the guest counts (and that no address appears), and that
   the "Calendar event on <day>" lines after a reload open the event
   (Google's `htmlLink` shape `https://www.google.com/calendar/event?eid=`
   is NOT VERIFIED; otherwise the link is the day view).
3. Ask "when am I free on Thursday". Check the busy intervals in UTC and the
   one stored reference. Whether the key of the `calendars` object is `primary`
   or the address, and the `calendars/*/busy` field mask, are NOT VERIFIED.
4. Ask for an event with a time zone and a time on a daylight saving change
   day: the stale offset or the skipped hour is refused with a sentence, and a
   valid time creates the event at the time on the card. Check the event in
   Google Calendar: the title, the time in its zone, the description and
   location, no guests, no video call, no email sent to anyone, the default
   reminders. Whether Google accepts `date` together with `timeZone` for an
   all-day event, and `sendUpdates=none` on an event without guests, are NOT
   VERIFIED.
5. Press Deny on a create-event card: nothing is created. Press Enter on the
   card: nothing happens; the button creates it.
6. Allow reading events in this chat and ask for more than five reads in one
   message: the sixth asks again.
7. Turn the Google Calendar API off in the project and read events: the
   answer says the API is not turned on (the `accessNotConfigured` reason is
   NOT VERIFIED).
8. Turn Calendar off in Labs and send again: no Calendar tool is offered, and
   the card no longer offers the Calendar box. The consent screen text and
   the tier (sensitive or restricted) of the two scopes in the console are
   NOT VERIFIED.
9. Open a create-event card on an iPhone (Safari and the installed PWA): the
   long description scrolls inside the card and the buttons stay reachable.
