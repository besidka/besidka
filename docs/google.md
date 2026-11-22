# Google: Drive, Calendar and Gmail (Phase 4b)

Status: **partly built** (2026-11-22), on the umbrella branch
`feat/google-connectors`. Built so far: the four `google.*` flags in
`shared/utils/features/registry.ts` (stage `internal`, `optIn: 'required'`;
`google.drive` and `google.byo` are `available: true`),
`shared/utils/google-scopes.ts`,
`shared/utils/google-data-policy.ts`, the schema child's single migration
(section 8), the chat runtime every Google tool registers into (section 5.2:
approvals, taint, the chat flag, references-only results and the approval
panel rows), the data guard of the allow-list (section 5.3), the connection
flow of the connections child (section 9: connect and disconnect Google
Drive, the token store, and deletion when Google access ends), and the
owner-only bring-your-own client (section 10: the stored client, the admin
gate, its own callback). Not built yet: the Picker, the Drive, Calendar and
Gmail tools themselves, and the legal text. This file grows with every
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
| Pick Drive files, read them, save one file back | `google.drive` | Besidka's client | `drive.file` and identity | Connection built (section 9); Picker and tools design |
| Calendar text: list events, find free time, create an event | `google.calendar` | Either client | `calendar.events` (provisional) | Design |
| Connect Google with the owner's own OAuth client | `google.byo` plus the admin role | Owner's own client | Identity plus what the owner ticks: `drive.readonly`, `gmail.readonly`, `gmail.compose`, `calendar.events` | Built (section 10), owner-only; no tool uses it yet |
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
| Who | Every user the flag reaches | Admins only (role checked on the server, never the flag alone), behind `internal` |
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

The Picker also needs the project number as its app id (question 1).

### 4.3 Data access, verification and branding

| Step | Needed for | State |
|---|---|---|
| Add `drive.file`, `openid` and `userinfo.email` under Data access and confirm `drive.file` is non-sensitive (`userinfo.profile` is not requested) | Connections child | Owner, open |
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
| `zero-data-retention` | Sent by Besidka on every gateway call of a flagged chat, and of any send where Google tools could be offered (`shouldSendGatewayGoogleSafeguards`: tool approvals and `google.drive` active): Vercel `providerOptions.gateway.zeroDataRetention: true`, OpenRouter chat setting `provider: { zdr: true }` (the field confirmed in the installed `@openrouter/ai-sdk-provider` types, which the pre-check left to confirm). The condition counts as met only on that path (`gatewaySafeguardsSent`) |
| `payload-logging-disabled` | Sent on the same calls: the header `cf-aig-collect-log-payload: false` on the Cloudflare client |

**Enforcement points.**

| Call site | What is checked | What the user sees |
|---|---|---|
| Send start: Google content in the request (`resolveSendGoogleContent`) | Before the guard, the send looks up the files of every file part (a Google copy, `external_source` in `GOOGLE_EXTERNAL_SOURCES`, or a marked file) and every attached or referenced artifact (marked). Any hit flags the chat (`flagChatGoogleData`, not best effort) and the guard below runs on it; content new in this message also clears the share opt-in | The guard's answer below |
| Chat send, `{ continue }` rounds and approval continuations (`server/api/v1/chats/[slug]/index.post.ts`, every request kind takes the same path) | `assertGoogleDataRecipient` right after the provider or gateway is resolved, before any search, TypeSafe AI call, user message persist or model call; this covers every step of the tool loop and the search answer continuation, which reuse the same model | A 403 shown through the chat error: "This model cannot be used in a chat with Google data.", the reason and the fix (pick an allowed model, or confirm the Gemini paid tier). On a continuation the paused reply keeps the model of its pending record, so the message says the reply cannot continue and the fix is a new message on an allowed model |
| Model switch mid-chat | The same check, on the model of each send | The same error; the picker already marks the model |
| Gateway sends | `useGateway(..., { googleDataSafeguards })`, true in a flagged chat and in any send where Google tools could be offered | Nothing; the gateway applies its own setting. A Vercel 403 or `zdr_not_attested` on such a call becomes a Google-specific chat error (`googleSafeguardGatewayErrorOverride`: Hobby teams cannot request zero data retention, or the upstream key is not ZDR-attested) |
| Google tools (`getGoogleSendTools`) | Nothing unless tool approvals and `google.drive` are active; then `mayReceiveGoogleData` (the guard, and the Gemini key read only for a direct Gemini model), because a Google result would reach the model in the next step of the same send | No Google tool is offered |
| Title (`title.patch.ts`) | A refused direct provider, or any gateway, when `chatHoldsGoogleData` (flag, or a Google result in the loaded first message) | The fallback title built from the first message, with no model call |
| Deep research (`chats/[slug]/research/index.post.ts`) | `chatHoldsGoogleData` over the loaded messages plus the send-start lookup of the new message; the research provider, before the user message is stored | The same 403 |
| Artifact LLM bridge (`artifacts/[id]/complete.post.ts`) | The bridge model, when the artifact carries the derived mark (`artifacts.google_derived_at`), so a deleted origin chat changes nothing | The same 403, before the key and caps are used |
| Derived mark on writes | Every artifact, document and file written in a send whose chat is flagged or whose approval state holds `google` taint gets `google_derived_at`: artifact create and update (native and Besidka tools), `create_document` (the document row, copied to its file at finalize), `create_file`, generated images and code execution files. Connector images are not marked (connector data) | Nothing |
| Reading a marked item later | MCP: `list_files`, `list_artifacts` leave marked items out and `read_file`, `get_artifact` answer 404. Besidka chat tools in a send without Google data or taint: listed items are left out and a direct read answers 403 with "This item holds content from Google and is not available in this chat" (withheld, see Decisions). In a flagged or tainted send the read is allowed, because that send's recipient already passed the guard. Attached at send start: flags the chat first (row 1) | The withheld notice, or not found over MCP |
| Project-level spread | In a flagged or tainted send `add_project_text`, `add_project_note`, `update_project_instructions`, `update_project_knowledge_item` and `share_artifact` are blocked before the send (`withoutGoogleSpreadingTools`) and refused if called after taint appears mid-send | The tools are not offered, or a 403 tool error |
| Artifact public links | A marked artifact cannot get a public link (409, `ARTIFACT_SHARE_GOOGLE_DATA_CODE`), and an existing link to an artifact marked later resolves as not found. `artifact_shares` has no opt-in column, so refusing replaced the chat-share-style opt-in | The share action fails with the reason |
| Web search, Brave, Exa | Every web search tool is removed from the send in a flagged chat (`withoutWebSearchForGoogleData`), whatever the tool approvals setting; the Brave and Exa keys are never read | The search tools are not offered; the reply has no search |
| TypeSafe AI roles on the send path | Auto web search, skill selection, past-chat pre-retrieval and the rerank resolver are skipped in a flagged chat; in the send that first brings Google data, the rerank resolver stops once `google` taint appears (`withGoogleTaintRerankStop`); the share personal-data check skips its TypeSafe AI call | Auto web search keeps the chosen tools (minus search); the share check shows the generic reminder |
| Connectors with tool approvals off | A flagged chat offers no connector unless tool approvals are active (`mayOfferConnectorsWithGoogleData`), because only the Google egress ask (rule 12) keeps Google content from a user-added MCP server, and it needs approvals | Connectors are not offered in that chat |
| Flag write with the reply | The assistant message that brings the first Google result and the flag (with the share opt-in cleared) are one `db.batch` (`buildGoogleContentPersistStatements`); if the batch fails the reply is not persisted | The usual save error |
| Flag repair | A send that finds a Google result in the stored parts while `google_data_at` is null sets the flag | Nothing |
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
- Names-only rendering of Google items in the shared view belongs to the
  Picker child (`data-drive-file` parts); today a Google copy without a
  grant is simply dropped from the share.
- The Gemini paid-tier confirmation is cleared when the Gemini key is
  replaced, because a new key can sit on another project.

**Open after this child.**

- Qwen's `enable_search` is a request body flag set at send start. A send
  that starts without Google data and with web search on keeps it for every
  step, also after a Google result arrives mid-send; only the next send
  drops it. The same holds for native web search tools of other providers in
  that first send.
- Deep research runs the provider's own agent, which searches the web with
  queries it writes from the conversation. The guard checks the research
  provider, but those searches leave the allow-list's scope.
- The user can still download a marked artifact or document, copy its
  text, or paste Google content into another chat: the mark follows stored
  items, not what the user retypes.
- Project knowledge text extracted on the client from a Google copy before
  this child cannot be told apart from other text.
- Rows written before the migration carry no mark.
- In a send that already holds Google data, a Besidka read of a marked item
  from another chat is allowed but does not clear the share opt-in or add the
  item to the names the share dialog lists: only a Google tool result does.
  An existing opt-in then covers content the owner did not see named.
- With tool approvals and `google.drive` on, every gateway send carries the
  safeguards, also in chats without Google data and while no Google tool
  exists yet: OpenRouter `zdr: true` narrows the endpoints, and a Vercel Hobby
  team gets 403 on such sends.

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
   `.../auth/gmail.compose`, `.../auth/calendar.events`. The Gmail and full
   Drive scopes are restricted; that is why this client stays yours and
   never serves other users.
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
| `files.drive_copy_id` | text | the id of the copy saved to Drive, so a second "Open in Google" or "Save to Google Drive" opens the same copy (BES-283 owner addendum); kept apart from `external_*`, which describe files imported from Google |
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
(`oauth2.googleapis.com` today; `accounts.google.com` is opened by the
browser only), `redirect: 'manual'` with any 3xx refused and its body
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
| `drive-read` | `drive.readonly` (restricted) | None yet (Drive search arrives with the Gmail child) |
| `gmail-read` | `gmail.readonly` (restricted) | None yet (Gmail child) |
| `gmail-compose` | `gmail.compose` (restricted; Google's scope for managing drafts and sending mail) | None yet; Besidka has no send tool and its Gmail child creates drafts only, a limit of the product, not of the permission |
| `calendar` | `calendar.events` (provisional) | None yet (Calendar child) |

Scope minimization (pre-check row 10, "smallest set of scopes"): no
bring-your-own tool exists yet, so offering only capabilities whose tools
exist would offer nothing and leave the owner nothing to test. The card
offers all four unticked and says that what is ticked is requested now for
tools that arrive later.

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
  connection: the four capability checkboxes, unticked, the "tools arrive
  later" note and Connect (Reconnect after access ended).
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
- No Gmail, Calendar or full Drive tool in this child; nothing calls those
  APIs yet.
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
