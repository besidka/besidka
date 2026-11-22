# Google: Drive, Calendar and Gmail (Phase 4b)

Status: **partly built** (2026-11-22), on the umbrella branch
`feat/google-connectors`. Built so far: the four `google.*` flags in
`shared/utils/features/registry.ts` (all `available: false`, stage
`internal`, `optIn: 'required'`), `shared/utils/google-scopes.ts`,
`shared/utils/google-data-policy.ts`, the schema child's single migration
(section 8), and the chat runtime every Google tool registers into
(section 5.2: approvals, taint, the chat flag, references-only results and
the approval panel rows), and the data guard of the allow-list (section
5.3). Not built yet: the Google connection routes and OAuth, the Picker,
the Drive, Calendar and Gmail tools themselves, and the legal text. This file grows with every
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

### 5.2 Google tools: approvals, taint and references-only results

Built (child 4, 2026-11-22): the runtime rules every built-in Google tool
registers into. No Google tool exists yet; the rules are proven with fake
tool descriptors in `tests/unit/server/utils/tool-approval/google.spec.ts`
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
The flag is never cleared. `chatHoldsGoogleData` reads the flag, and falls
back to the parts scan for a chat from before the flag; it is the one
function every send, branch and later data guard asks. A send in a flagged
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
(`chatHoldsGoogleData`: the sticky `chats.google_data_at`, or a Google
result in the stored parts of a chat from before the flag), its content
reaches only recipients the pre-check's allow-list accepts, and never leaves
through a side door. No Google tool exists yet; the guard runs on the flag
and is proven with specs that set it.

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
| `zero-data-retention` | Sent by Besidka on every call of a flagged chat: Vercel `providerOptions.gateway.zeroDataRetention: true`, OpenRouter chat setting `provider: { zdr: true }` (the field confirmed in the installed `@openrouter/ai-sdk-provider` types, which the pre-check left to confirm), on the chat instance and the title instance. The condition counts as met only on that path (`gatewaySafeguardsSent`) |
| `payload-logging-disabled` | Sent by Besidka on every call of a flagged chat: the header `cf-aig-collect-log-payload: false` on the Cloudflare client, so it covers the chat and the title instance |

**Enforcement points.**

| Call site | What is checked | What the user sees |
|---|---|---|
| Chat send, `{ continue }` rounds and approval continuations (`server/api/v1/chats/[slug]/index.post.ts`, every request kind takes the same path) | `assertGoogleDataRecipient` right after the provider or gateway is resolved, before any search, TypeSafe AI call, user message persist or model call; this covers every step of the tool loop and the search answer continuation, which reuse the same model | A 403 shown through the chat error: "This model cannot be used in a chat with Google data.", the reason ("This provider may train on your Google data." or the paid-tier sentence) and the fix (pick an allowed model, or confirm the Gemini paid tier) |
| Model switch mid-chat | The same check, on the model of each send | The same error; the picker already marks the model |
| Gateway sends | `useGateway(..., { googleDataSafeguards: true })` in a flagged chat | Nothing; the gateway applies its own setting, and a gateway error surfaces as a chat error |
| Google tools (`getGoogleSendTools`) | `mayReceiveGoogleData`, evaluated only once approvals allow Google tools, because a Google result would reach the model in the next step of the same send. A gateway counts its safeguard only in a chat already flagged, so a gateway model gets Google tools only after the chat holds Google data | No Google tool is offered |
| Title (`title.patch.ts`) | A refused direct provider, or any gateway, in a flagged chat | The fallback title built from the first message, with no model call |
| Deep research (`chats/[slug]/research/index.post.ts`) | The research provider, before the user message is stored | The same 403 |
| Artifact LLM bridge (`artifacts/[id]/complete.post.ts`) | The bridge model, when the artifact's origin chat holds Google data | The same 403, before the key and caps are used |
| Web search, Brave, Exa | Every web search tool is removed from the send in a flagged chat (`withoutWebSearchForGoogleData`), whatever the tool approvals setting; the Brave and Exa keys are never read | The search tools are not offered; the reply has no search |
| TypeSafe AI roles on the send path | Auto web search, skill selection, past-chat pre-retrieval and the rerank resolver are skipped in a flagged chat; the share personal-data check skips its TypeSafe AI call | Auto web search keeps the chosen tools (minus search); the share check shows the generic reminder |
| Memory | Flagged chats leave the extraction sweep, the backfill queue, project memory refresh and settle, the extract-now path (checked before and after the model call), the guarded entry insert, and the `search_chats` and `read_chat` tools of other chats; `memory_write` and `memory_forget` are not offered inside a flagged chat | Memory stays as it was; the chat is never cited |
| Shares | `POST /share` needs `includeGoogleContent: true` for a flagged chat (409 otherwise), recorded in the wide event as `googleDataGuard.shareOptIn`; a share is visible only when `chat_shares.updated_at` is later than `chats.google_data_at` (`resolveActiveShareBySlug`), so a link made before the flag pauses until the owner shares again; Google copies get no `chat_share_files` grant, so the public view drops them | The share dialog asks "Share the Google content in this chat", says when a link is paused, and the Generate button waits for the box |
| MCP and Besidka tools | `get_chat` replaces every message text of a flagged chat with a fixed notice; `list_chats` content search keeps the match but drops the snippet; `list_files`, `read_file` and the `get_chat` context files never include a Google copy (`fileIsNotGoogleCopy`). The Besidka chat tools call the same functions | The withheld notice in place of the text; Google copies are not found |
| Project knowledge | Linking a file whose `external_source` is Google answers 400 | "A copy of a Google Drive file cannot be added to project knowledge" |
| Model picker | The same allow-list on the client (`useGoogleDataRecipientReason`), with the Gemini paid-tier state from the keys summary | "Not for Google data" on each refused model, the reason as its tooltip and screen-reader text, and the row cannot be picked |
| Chat context panel | The chat page records the flag (`useChatGoogleData`) | One line on what a Google chat restricts |

**Decisions.**

- Native web search in a flagged chat is withheld too, not only Brave and
  Exa: a query the model writes can carry Google content to a search
  engine, and Vercel's gateway search is Perplexity, a third party outside
  the table. This also closes the gap of section 5.2 where a chat flagged
  earlier kept web search with approvals off.
- Every TypeSafe AI role is skipped in a flagged chat, including the ones
  that read only knowledge or search results, as the pre-check says ("TypeSafe
  AI checks ... are skipped in flagged chats").
- Chat search and the FTS index keep flagged chats: the pre-check says
  nothing about them, and the search runs inside Besidka for the owner. The
  model-facing tools that copy another chat into a send exclude them.
- `get_chat` withholds the whole transcript rather than cutting at the flag
  time, because the flag is chat-wide and a branch copies it.
- The share opt-in is not stored: it is derived from the share's
  `updated_at`, which only a create or re-share changes. A legacy chat
  flagged only by a parts scan (no `google_data_at`) is treated as not
  flagged by shares.
- Names-only rendering of Google items in the shared view belongs to the
  Picker child (`data-drive-file` parts); today a Google copy without a
  grant is simply dropped from the share.
- The Gemini paid-tier confirmation is cleared when the Gemini key is
  replaced, because a new key can sit on another project.

**Open after this child.** A Vercel 403 or `zdr_not_attested` reaches the
user as the gateway's own error, not a Google-specific sentence. Artifact
and document content written in a flagged chat still leaves through
`get_artifact`, artifact public links and document downloads, and project
knowledge text extracted on the client from a Google copy cannot be told
apart from other text. Approved Besidka writes (`add_project_text`,
`add_project_note`) still copy content after one approval (rule 13).

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
timestamp of its own; `status` and `updated_at` carry it. How the access-ended
sweep reads them is the connections child's design: with two modes per user,
a lingering `needs_reauth` row of one mode must not make it delete the files
of the other, still active, mode.

Rotating `NUXT_ENCRYPTION_KEY` without re-encrypting breaks every stored
Google token; users reconnect.
