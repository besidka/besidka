# Besidka tools: permissions and chat exposure (BES-394 L8, L9)

Besidka's own tools (the registry in `server/utils/besidka-tools/`, see
`docs/mcp-server.md`, "The Besidka tools registry") let a model use the
user's Besidka data in a chat. L8 added what the user controls: a permission
for each tool, a Labs section to manage them and the `besidka-tools` flag. L9
offers the tools to chat models through the approval layer (section "In a
chat" below).

## The flag

`besidka-tools` (`shared/utils/features/registry.ts`): stage `internal`,
`available: true`, `optIn: 'required'`, `spend: 'none'`, no parent, no
variants. It spends nothing on its own: a tool runs only when the user chats,
and every call is paid like any other part of that chat. Labs shows the
opt-in with the line "Let the model use your Besidka data and tools in chats,
with your permission for each tool." (`docs/feature-flags.md`, section 10).
The routes below answer 404 unless the user has the flag and its Labs switch
is on.

## Tiers and modes

Each tool the registry exposes to chats (`chat: { expose: true, tier }`) has a
tier. Excluded tools (admin tools and tools that have a native twin) have no
permission and cannot be set.

| Tier | Group in the UI | Tools |
| --- | --- | --- |
| `read` | Read-only | 14 |
| `write` | Write | 8 |
| `ask-every-time` | Delete and share ("Always asks" before 2026-11-20) | 13 |

A permission is one of three modes (`TOOL_PERMISSION_MODES`):

| Mode | Label | Meaning |
| --- | --- | --- |
| `blocked` | Blocked | The tool is never offered, and a call that arrives is denied |
| `ask` | Needs approval | The default. The policy of `docs/connectors.md` section 7 decides when to ask |
| `allow` | Always allow | The tool runs without asking, where the policy allows it |

Every tier takes all three modes since the owner decision of 2026-11-20
(`docs/connectors.md` section 7.12; before it, the ask-every-time tier took
only Blocked and Needs approval). Those tools delete, share or rewrite text a
model reads later, so they still ask by default, and the panel shows one
warning line on the group: "Always allow lets the model delete, share or
rewrite instructions without asking you." A stored `allow` on them counts.

The default is `ask`, with no row. A row exists once the user changes a tool.
`besidka_tool_permissions` (`server/db/schemas/tool-approvals.ts`) holds
`user_id`, `tool_name` (the registry name, for example `list_files`, never the
chat name `besidka__list_files`) and `mode`, unique per user and tool. It has
no foreign key. `purgeUserToolApprovals` deletes it with the account, and a
whole-database restore resets every `allow` to `ask`
(`docs/d1-restore-reconciliation.md`).

The same table also holds two rows that are not Besidka tools:
`memory_write` and `memory_forget` (BES-470, BES-472), the user's mode for the
native memory write tools. `memory_write` takes Blocked, Needs approval and
Always allow; `memory_forget` takes Blocked and Needs approval only, because a
forget is an irreversible delete with no undo. They never appear in this
registry, in the Labs panel or behind the `besidka-tools` opt-in: the loader,
resolver and panel resolve registry names only, so they read these names as
unknown (Blocked) and never list them, and the routes below still answer 400
for them. They are set on `/profile/memory`, through `GET` and `PUT
/api/v1/memory/tool-permissions` (400 for `memory_forget` set to Always allow),
and the routes and the card are tied to the `tool-approvals` flag. The chat
route reads the stored modes whenever the memory write tools are offered:
Blocked is honored without the flag, and a stored Always allow counts only
while tool approvals are active. Design, policy rule 12 and the open questions
are in `docs/memory-architecture.md`, section 3.21.

## Routes

Both are owner-only (the session user; there is no user id in the request),
flag-gated and answer `private` data only.

| Route | Behavior |
| --- | --- |
| `GET /api/v1/besidka-tools/permissions` | `{ tools: [{ name, title, tier, mode }] }` for every exposed tool, ordered read, write, ask-every-time, then by title |
| `PUT /api/v1/besidka-tools/permissions` | Body `{ tool, mode }` or `{ tier, mode }` (a group set, one batch). Answers with the same list as the GET |

`PUT` runs, in order: the same-origin write guard (`Sec-Fetch-Site` and
`Origin`, the one the connector routes use), a session, the flag, a limit of
60 changes a minute per user (KV counter, fails closed with `Retry-After: 60`,
a flood guard like the other settings writes) and a body of at most 1 KiB.
Validation uses the registry only: an unknown tool, an excluded tool, a name
with the `besidka__` prefix, an unknown tier or mode and extra keys are all
400 (`allow` on the ask-every-time tier was 400 before 2026-11-20). `PUT` logs a `besidkaTools`
attribute (action, scope, target, mode, count) and no user data.

## Resolver

`server/utils/besidka-tools/permissions.ts`:

- `resolveBesidkaPermissionMode(userId, toolName, { cache, db })` resolves
  one tool. It accepts a registry name or the
  `besidka__<name>` chat name, reads the user's rows once per cache (pass one
  `createBesidkaPermissionCache()` for a whole request) and returns the
  effective mode. A tool that is unknown or not exposed to chats is `blocked`.
- `pickBesidkaPermissionMode(toolName, modes)` is the same decision over rows
  already loaded, with no I/O.
- `resolveBesidkaPermissionModes(userId, toolNames)` returns the effective mode
  of each named tool from one read. The chat send calls it for every exposed
  tool before it offers any, and the replay seam calls it for the answered
  ones.
- `loadBesidkaToolPermissionModes(userId)` loads the rows. A stored mode that
  is not `blocked`, `ask` or `allow` reads as `blocked`, never as the default.

### The replay seam

A continuation (docs/connectors.md section 7.7) re-checks every approved call
before the SDK sees it. `resolveReplayPermissionMode(family, toolName,
besidkaModes)` in `server/utils/tool-approval/continuation.ts` returns, for a
call of the `besidka` family, the mode the send resolved for that tool name, so
a tool the user set to Blocked after approving is denied on resume ("This tool
is blocked in the user's settings"); a Besidka call with no resolved mode
fails closed as Blocked. The chat send resolves the modes with
`resolveBesidkaPermissionModes` (one read of the user's rows) only when a
pending answer is a Besidka call, and passes them to `decideContinuation`. The
route imports the registry dynamically for that, because the registry pulls in
all 56 tool entries (about 0.5 s of cold import in the chat route specs) and
no send uses it before L9. Connector tools keep `ask`: their Blocked state is
the C-5 tool setting, which hides the tool from the live tool set, so the
replay reads it as missing.

## Labs and the panel

- **Connectors page** (`/chats/connectors`, "Yours"): the main entry point. A
  pinned first row "Besidka" (`ProfileConnectorsBesidkaRow`, Besidka logo, the
  Labs description "Let the model use your Besidka data and tools in chats,
  with your permission for each tool.") shows whenever the user has
  access to the `besidka-tools` flag (`useFeature('besidka-tools').enabled`),
  before or after the opt-in. It is composed in the browser only: it is not a
  row of `connectors`, not in `GET /api/v1/connectors`, `list_connectors`, the
  "N of 20" count, the catalog or the Discover "Added" state. Its switch is the
  Labs opt-in itself: it calls `useFeatureOptIn().setFeatureOptIn`
  (`app/composables/feature-opt-in.ts`), the writer the Labs page uses, which
  posts `{ optedIn }` to `/api/v1/profiles/features/besidka-tools/opt-in` and
  refreshes the client features. When that refresh does not show the new
  state (`refreshFeatures` swallows a failed `GET /api/v1/features`), the page
  shows an error toast and announces nothing. Turning the opt-in off closes the
  open permissions panel. There is no second flag or setting. With the
  opt-in on, the name opens the Tool permissions panel; with it off the name is
  plain text. The row has no delete, no Manual/Auto/Always on mode, no consent
  block and no "Not connected" status. `?panel=besidka-tool-permissions` on
  `/chats/connectors` opens the panel (only while the opt-in is on) and is then
  removed from the URL.
- **Labs** (`/profile/labs`): keeps the `besidka-tools` switch. Once the
  opt-in is on, its "Tool permissions" button goes to
  `/chats/connectors?panel=besidka-tool-permissions`. An account without the
  `connectors` flag has no such page, so there the button still opens the panel
  in place. A link to the old `/profile/labs?panel=besidka-tool-permissions`
  forwards to the Connectors page (or opens the panel in place without the
  `connectors` flag). There is no new page, so no profile tab (CLAUDE.md,
  "Profile pages navigation").
- **Panel**: `app/components/Profile/BesidkaTools/Permissions.vue` in the
  shared `UiSidePanel` (`docs/ui/side-panel.md`; a bottom sheet below `md`).
  It renders the shared `ui/ToolPermissions.vue`, the same component as the
  connector detail panel (`docs/connectors.md` section 7.11): three
  collapsible groups, Read-only, Write and Delete and share (collapsed by
  default above 6 tools, a count badge), each with a select (Blocked, Needs
  approval, Always allow; Custom appears, disabled, when the tools of a
  group differ), and per tool a radio group of three icon buttons (check
  Always allow, hand Needs approval, circle-slash Blocked) with tooltips on
  hover and keyboard focus. Delete and share carries the warning line above;
  the lock and the "always asks" tooltip are gone (2026-11-20). A group choice saves with `{ tier, mode }`, a tool
  with `{ tool, mode }`. Every change saves at once with an optimistic update
  (`app/composables/besidka-tool-permissions.ts`); the server's list
  replaces the local one, and a failure drops the optimistic value and
  shows a toast from `parseError`.
- **Search popup**: with the flag on, Settings gets a "Besidka tool
  permissions" row after Labs. It opens
  `/chats/connectors?panel=besidka-tool-permissions` (or the Labs link when the
  `connectors` flag is off, `getBesidkaToolPermissionsPath`), and the page opens
  the panel, then clears the query.

## MCP

No MCP tool reads or writes these permissions. See `docs/mcp-server.md`,
"What MCP does not do", item 8.

## In a chat (L9)

### Gate

A send offers Besidka tools only when all of these hold:

1. the `besidka-tools` flag is active for the user (Labs opt-in);
2. the `tool-approvals` flag is active. Without approvals the tools are never
   exposed;
3. the model can call tools (`toolCallingAllowed`, so not deep research or
   image generation);
4. the chat's Besidka row is on: `besidka_chat_settings.enabled`, on when the
   chat has no row.

The route loads the adapter, registry and permissions with dynamic imports
only once the gate passed.

### Tools and names

`server/utils/besidka-tools/chat-adapter.ts` builds one AI SDK tool per
selected registry entry, named `besidka__<name>` (`BESIDKA_TOOL_NAME_PREFIX`
and `isBesidkaChatToolName` in `shared/utils/besidka-tool-permissions.ts`, the
one definition the client and the server share), with the entry's
`chatDescription` and input schema. `execute`:

- runs only a call the policy cleared (`consumeClearedCall`, same name and
  input, once); any other call answers "This tool call was not approved, so it
  did not run.";
- refuses `delete_chats`, `move_chats_to_project` and `delete_chat_message`
  when they name the chat the send runs in (slugs compared in one case), with
  a plain tool error. The approval entry marks such a call
  `failsWithoutRunning`, so it is cleared without a prompt and the user is
  never asked for a call that cannot run;
- keeps to 30 calls a minute per user on its own KV prefix
  (`besidka-tools-chat-calls`), failing closed when KV cannot count;
- runs the registry handler as the session user with client id
  `besidka-chat` and **no scopes**, so `list_artifact_shares` and
  `list_shared_chats` leave share URLs out;
- keeps share link tokens out of model context and the stored message:
  `share_artifact` creates the link but its chat result is only the share
  id, expiry and warnings with "Share link created; open it from the
  artifact panel." (`toChatToolResult`; MCP clients still get the URL).
  `get_chat` over MCP and `read_chat` in chats read text parts only, so a
  tool output never reaches them;
- frames the JSON result exactly like a connector result
  (`<untrusted_tool_result connector="besidka" tool="...">`, cut to 64 KiB) and
  raises the untrusted-content guard. A handler's client error (4xx) passes
  its own message on; anything else becomes "The Besidka tool call failed."

The route adds a short system block that explains the `besidka__` tools and
the frame, also when no connector is on, and gives the tool loop
`TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN` (12) extra steps when a Besidka tool
is offered.

### Policy

Each offered tool, and each Blocked tool, gets an approval entry with family
`besidka`. The registry tier decides the descriptor, never the annotations:
read tier is `read`, write tier is `write`, and the ask-every-time tier keeps
its `delete` or `instructions` access (`write` otherwise) and is marked
destructive. The entry carries the user's mode, so:

Owner decisions of 2026-11-15 and 2026-11-20 (`docs/connectors.md`
sections 7.11 and 7.12). A call is judged against the taint the send held
when its model step began, so calls of one step never see each other's
results:

| Mode | Untainted send | After earlier Besidka results only | After web, knowledge, file, skill, connector or shared-branch content |
| --- | --- | --- | --- |
| Blocked | not offered; denied if called or replayed | same | same |
| Needs approval | asks `default` (Allow once, in this chat, always, Deny) | read and write: asks `default` | read: asks `default`; write: asks `untrusted-output` (Allow once, in this chat, always, Deny) |
| Always allow | runs, marked "Ran without asking (Always allowed)" | read and write: run | read and write: run (accepted risk, 2026-11-20) |

The reason line of a Needs approval request says "Asks before each use.
Change it in Tool permissions in Labs."

The ask-every-time tier asks `always-ask` (Allow once, in this chat,
always, Deny) unless the user set it to Always allow or allowed it in the
chat (2026-11-20; before, it asked Allow once or Deny whatever the mode).
Every Besidka result taints the send with `besidka`
and records the `besidka` read source. A Besidka read set to Always allow
(or granted in this chat) runs after any taint: a read cannot carry data
out by itself, and a write set to Needs approval asks after outside content. A Besidka
write does not count `besidka` taint as outside content
(`hasForeignTaint` in `server/utils/tool-approval/policy.ts`), but asks after
any other taint kind or a connector read. A later connector call, read or
write, asks (`untrusted-output`), since its arguments would carry the data
to the connector's server; a read offers every answer. The provider's web
search, grounding and URL context are withheld from later steps (the L5
egress guard; it is not applied on Anthropic routes, as for connectors). The
web searches Besidka runs itself (Brave, Exa, any function tool the send
classifies as a web read) are withheld the same way, and their `execute`
refuses with "Web search is off for the rest of this message because it read
the user's private data." on every route, Anthropic included, once a tool
call of the turn read a connector or Besidka data. A send whose chat already
holds a Besidka result (`hasBesidkaToolResult`) starts with `besidka` taint;
that taint alone no longer makes a Besidka read or write ask, and the
ask-every-time tier asks anyway. Preset taint is the usual reason a fresh
message asked before an Always allow read before 2026-11-15: the skills
catalog with an imported skill (`skill`), past-chat excerpts or project
knowledge (`knowledge`), a requested web search (`web`) or an attachment
(`file`). Memory extraction skips an assistant turn that used a
`besidka__` tool, like a connector turn. A
Besidka call past 12 per user turn is denied with a sentence that names the
limit and tells the model to stop and summarize (`SEND_TOOL_DENIAL_TEXT`,
`docs/connectors.md` section 6.6), on the first request and on replay. A `besidka__` tool name with no entry is Blocked, never a
native write.

The approval summary is the registry's `summarize()` for the call's input
(`summarizeBesidkaToolCall`, parsed with the tool's schema first). For
`delete_chats` and `delete_files` the send looks the titles up with one query
when the pause is recorded ("Delete 2 chats: "Plan", "Draft""). Content
writes (`update_project_instructions`, `add_project_note`,
`update_project_knowledge_item`, `create_file`) carry the text they would
save as the approval's `preview`: the step shows its first 500 characters
collapsed under "Text to save", and View details shows all of it. "Allow in
this chat" stores the tool's registry hash (`hashBesidkaChatTool`: chat name,
description, input schema, access and tier) in
`besidka_chat_settings.alwaysAllowTools`; "Always allow" sets the tool's
permission to Always allow. A tool that changed asks again, and the replay
denies a call whose hash drifted.

### Budget and the tool index (C-15)

Native tools first, then up to 24 Besidka tools up front
(`BESIDKA_CHAT_TOOLS_MAX` in `shared/utils/besidka-tool-permissions.ts`;
Always allow first, then read, write and ask every time, then by name), then
connectors, all within the existing 40 tools and 32 KiB of definitions
(Besidka definitions count against the connector bytes) minus the room kept
for loading (`TOOL_INDEX_RESERVED_TOOLS` 10 plus the load tool,
`TOOL_INDEX_RESERVED_BYTES` 12 KiB, `shared/utils/tool-index.ts`). When an
Always on connector's up-front tools and Besidka's do not fit together, the
connector wins and Besidka's last up-front tools move to the index.

No Besidka tool is cut any more. Every tool that is not Blocked is built with
its approval entry; the ones that do not fit up front (with the default modes,
most of the ask-every-time tier: since `get_chat_cost` and `get_usage_stats`
joined the read tier on 2026-11-20, only `add_project_note` and
`add_project_text` of that tier are up front, and `delete_artifacts`,
`delete_chat_message`, `delete_files` and the rest load on demand) go to the tool
index and reach the model through `tool_index__load`, exactly like an Auto
connector's tools (`docs/connectors.md` section 6.2). A loaded tool keeps its
mode, tier, taint rule, definition hash and chat grant, so a loaded delete
asks exactly like one offered up front. A Blocked tool is never built and never
listed, so a load of it answers "not available". The chat shows no notice,
and the Labs panel no longer warns that only 24 tools are offered.

Owner report (2026-11-15, preview pr-923): "delete kyiv-chestnut-leaf.jpg"
was answered with "no tool to delete files", because `delete_files` was the
25th tool. With the index the model loads it and the user is asked.
Models that do not call the load tool on their own (GPT-5.4 mini) are helped
by a firm rule at the top of the index and by a prefetch from the user's own
message: "Видали файл …" loads `besidka__delete_files` before the first step,
and the call still asks unless the user set it to Always allow
(`docs/connectors.md` section 6.2, item 10).

### Per-chat row

The connector picker in the composer shows a "Besidka" row first, outside the
five-connector limit, whenever the gate's two flags are on; the "+" menu
shows the Connectors row then too, even with no connector. The row toggles
`besidka_chat_settings.enabled` through `GET` and `PUT
/api/v1/chats/[slug]/besidka-tools` (`{ enabled }`, same guards as the
permission routes plus chat ownership). A new chat keeps the choice in state
and its first send carries `besidkaToolsEnabled`, which the send stores.

### Approval step

The step shows the Besidka mark from the reasoning step icon registry
(`app/utils/reasoning-step-icons.ts`, which uses the shared prefix) before
the title, on the approval step and on a finished Besidka step alike. The title is the
server-written summary ("Delete 1 chat: ..."); the reason after a Besidka
read names "your Besidka data", and "Always allow" answers with one click;
its tooltip says "Runs without asking in every chat. Change it in Tool
permissions.". A finished Besidka call is a reasoning
step titled "Besidka: list projects". The buttons are in the approval bubble
under the message, and the step in the chain shows only the title and its
waiting state (`docs/connectors.md`, section 7.8.1).

### Remembered approvals in the chat panel

The chat panel's Approvals section (`listChatToolApprovalGrants`) lists the
Besidka grants too: "Allow in this chat" grants whose registry hash still
matches, and, while the chat's Besidka row is on, every tool set to Always
allow. A Besidka Always allow row links to the permissions panel on the Connectors page (Labs when
the `connectors` flag is off) ("Manage") instead of a Remove button; "Reset approvals in this chat" clears
the Besidka chat grants with the connector ones.

## Debug info (`get_debug_info`)

Owner report (2026-11-20): in the iOS PWA there is no URL bar, so a user cannot
see the chat id, and a bug report has nothing for support or a developer to
start from. `get_debug_info` answers "give me debug info" with one block to
copy.

- **Where it lives**: `server/utils/besidka-tools/tools/get-debug-info.ts` over
  `server/utils/mcp/private/debug-info.ts`, scope `chats:read`, `read` tier, so
  with the default modes it is offered up front (the read tier sorts first,
  which moved the last ask-every-time tool, `delete_chats`, into the tool
  index). Like every Besidka tool it needs the `besidka-tools` and
  `tool-approvals` flags and its default mode is Needs approval, so the user
  approves the first call unless the tool is set to Always allow.
- **Which chat**: in a chat the handler gets `currentChatSlug` on
  `BesidkaToolContext` (set by `chat-adapter.ts`, empty over MCP) and uses it
  when the model passes no `slug`. A given `slug` must belong to the user. Over
  MCP a missing `slug` returns the account-level blocks only.
- **What it returns**: `report` (one plain-text block; the chat description
  tells the model to show it verbatim in one code block) and the same data as
  fields: build id, MCP server version and server time; the chat slug, its app
  URL from the runtime base URL, project id, whether it was branched from a
  shared chat, the newest 10 messages (1 to 20) with id, role, time, status,
  model, provider, token total, reasoning level and tool call counters, and
  the generation guard state (ids of the messages holding a lease in KV, ids
  only; in a chat the reply that is running holds one itself);
  connectors (id, title, host, mode, enabled, status, whether the chat has it
  on or off, last error code; never in a chat, see below); experimental
  features; a contact line.
- **Status is derived**: no finish reason is stored. `status` is `sent` for a
  user message, otherwise `failed` (a text part is one of the fixed failure
  notices of `shared/utils/chat-failure-text.ts`, with its `(ref: ...)` id),
  `awaiting-approval`, `complete` or `empty`.
- **Allow-list, not redaction**: each message is reduced to counters. Message
  text, tool input and output, tool error text, file names, keys, tokens,
  connector addresses beyond the host and the share slug of a branched chat
  never enter the result (`tests/unit/server/utils/mcp/private/debug-info.spec.ts`
  seeds each of them and asserts they are absent).
- **Consent per scope**: over MCP, connectors need `connectors:read` and
  features need `settings:read`, because consent is stored by scope name, and
  connectors also need the `connectors` feature (`isMcpConnectorsAvailable`,
  the same gate as the connector tools). In a chat (no scopes) features are
  included but connectors never are: a chat that can list its own connectors
  would give an injected prompt a path to a new data channel (the
  `excluded` reason of `list_connectors`, `docs/mcp-server.md`), and the model
  prints the report into assistant text. The chat report says "Connectors:
  left out in the chat. Use "Copy debug info" in the chat panel for the full
  report." The chat model also receives only `report`, not the structured
  copy (`CHAT_RESULT_TRANSFORMS`). A chat or MCP 404 is the neutral "Chat not
  found."; only the MCP path adds "Call list_chats to find one.".
- **Contact line**: `public.supportEmail` (env `NUXT_PUBLIC_SUPPORT_EMAIL`,
  default empty in `nuxt.config.ts`, `support@besidka.com` in the
  `wrangler.jsonc` vars next to `NUXT_PUBLIC_PRIVACY_EMAIL` and in
  `.dev.vars.example`). When set the report ends with "Send this block to
  support@besidka.com."; when empty there is no address line at all. It never
  uses `privacyEmail` (the GDPR mailbox) and never points to the public GitHub
  issues, because the block holds chat and message ids. `support@` is a
  `MAIL_ALERT_MAILBOXES` entry, so it can raise a phone push once its routing
  rule points to the mail-alerts Worker (`docs/mail-alerts.md`).
- **Without Labs**: the tool needs the `besidka-tools` and `tool-approvals`
  flags, so a normal user gets the same report from the chat context panel:
  the "Copy debug info" action (owned chats only, header actions of
  `Chat/ContextPanel.vue`, see `docs/chats/context-panel.md`) calls
  `GET /api/v1/chats/[slug]/support-info`
  (`server/api/v1/chats/[slug]/support-info.get.ts`), which is owner only (401,
  400 for a bad slug, 404 for a foreign chat), answers `private, no-store`
  with `{ report }` and runs the same `getDebugInfo` builder and allow-list
  with features and, when the `connectors` feature is active for the user,
  connectors (the owner is the reader, not a model). Tests:
  `tests/unit/server/api/chats-support-info.spec.ts`, and
  `debug-info.spec.ts` runs the builder against an in-memory database with two
  users to prove a foreign slug is a 404.

## Chat cost and usage stats (`get_chat_cost`, `get_usage_stats`)

Added 2026-11-20 with the built-in commands `/cost` and `/stats`
(`docs/skills.md`, section 5.6). Both are `read` tier, scope `chats:read`, in
chats and over MCP (5.4.0), and both return the structured data plus one
plain-text `report` whose rows are at most 40 characters, so the block fits a
390 px phone (`server/utils/usage/report-text.ts`).

- **`get_chat_cost`** (`server/utils/usage/chat-cost.ts`): one chat (the
  current chat in a chat, `slug` over MCP; a foreign or unknown slug is "Chat
  not found. Call list_chats to find one."). Per model: replies, uncached
  input (`inputTokens` already includes cache reads and writes, so both are
  subtracted), output with reasoning, cache read, cache write and the cost.
  A gateway reports one blended `totalCost` with no split, shown as "Cost
  (blended)". Web search units and cost per search provider, the total, the
  message count and the first-to-last message span. The total is the chat
  panel badge's total by construction: the same per-message rules
  (`getPerMessageCost`, `getPerMessageSearchCost` and `getChatTotalCost`,
  exported from `shared/utils/message-metadata.ts`) over the same newest
  1,000 messages; a longer chat says "(newest)". "~" marks a total with a
  search or research estimate, and every report says the provider's bill is
  authoritative. API time, wall time and code changes are not stored, so
  they are not shown.
- **`get_usage_stats`** (`server/utils/usage/usage-stats.ts`): `period` `7d`,
  `30d` (default) or `all`; a period is whole UTC days ending today. One
  grouped statement over the user's messages (`messages JOIN chats` on
  `user_id`, `json_extract` sums of the usage, grouped by UTC day, role and
  model) and one row of counts (chats active in the period, from the index
  alone; projects, artifacts that are not taken down, skills, connectors).
  The grouped statement narrows the chats by `activity_at` through
  `idx_chats_user_activity` (one day before the period, since a reply can be
  stored a while after the send moved `activity_at`) and reads their messages
  through `idx_messages_chat_id`. Measured on a local D1 seeded with 25,000
  messages (20,000 of one user in 400 chats over 400 days, 50 each), from the
  query plan: `7d` reads about 360 rows (7 chats, 350 messages), `30d` about
  1,530 and `all` about 20,400; the counts row reads only index entries.
  Rows read grow with the user's messages in the period, so `all` is the
  expensive one, which is why it is cached for an hour. The favorite model is the one with
  the most replies; tokens by kind; the estimated cost; active days of the
  period, the most active day, the current and the longest streak (UTC days;
  the current one ends today, or yesterday before today's first message).
  Counts chat replies only: background spend such as memory updates is not
  stored with messages. **Branch copies**: `branchChat` copies every message
  with its usage and its `created_at` into a new chat, so a message created
  before its chat is a copy and is left out (`m.created_at >= c.created_at`,
  the same rule memory extraction uses); a copy made within the same second
  as the original would still count twice. Results are cached in KV
  (`usage-stats:<userId>:<period>`, 15 minutes, an hour for `all`, with an
  "As of" line); a cache miss is limited to 20 runs per 10 minutes per user
  (`usage-stats-runs`, failing closed with a 429). Duration, grouped rows and
  D1 `rows_read` are logged under `attributes.usageStats`. No new index or
  table.
- **Counts over MCP**: a connected app sees the count of projects, artifacts,
  skills or connectors only when its token also holds `projects:read`,
  `artifacts:read`, `skills:read` or `connectors:read`; with `chats:read`
  alone they are `null`. Inside Besidka (a chat or a command) the user sees
  all of them.
- **Privacy**: over MCP this extends what an approved app reads under
  `chats:read` from chats and messages to the estimated spend, the models
  used and the activity pattern (active days, streaks). It is the user's own
  data, read by an app the user approved for chats, and no message text is
  read. The Privacy Policy scope list was not changed (owner decision
  pending; agents never edit `content/legal`).

### Built-in commands run the tools without a model

`/cost`, `/stats` and `/debug` call these tools (and `get_debug_info`)
directly from the chat send route, as the signed-in user with client id
`besidka-command`, no scopes and the current chat, before any model, key or
provider is resolved (`server/utils/chats/builtin-commands.ts`). That path
has no approval prompt and no Besidka permission check: the user typed the
command, nothing reaches a model, and the result is the user's own data shown
to that user. The flags `besidka-tools` and `tool-approvals` are not needed
for it; a model that calls the same tools in a chat still goes through the
gate and the approval policy above.
