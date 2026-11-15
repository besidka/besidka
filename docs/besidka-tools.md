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
| `read` | Read-only | 11 |
| `write` | Write | 8 |
| `ask-every-time` | Ask every time | 13 |

A permission is one of three modes (`TOOL_PERMISSION_MODES`):

| Mode | Label | Meaning |
| --- | --- | --- |
| `blocked` | Blocked | The tool is never offered, and a call that arrives is denied |
| `ask` | Needs approval | The default. The policy of `docs/connectors.md` section 7 decides when to ask |
| `allow` | Always allow | The tool runs without asking, where the policy allows it |

The **ask-every-time tier takes only Blocked and Needs approval**. Those tools
delete, share or rewrite text a model reads later, so they never run without a
fresh answer (the always-ask tier offers only Allow once and Deny,
`docs/connectors.md` section 7.1). The UI does not offer Always allow there and the server
answers 400. A stored `allow` for such a tool (a row from before a tool changed
tier, or one brought back by a restore) is read as `ask`.

The default is `ask`, with no row. A row exists once the user changes a tool.
`besidka_tool_permissions` (`server/db/schemas/tool-approvals.ts`) holds
`user_id`, `tool_name` (the registry name, for example `list_files`, never the
chat name `besidka__list_files`) and `mode`, unique per user and tool. It has
no foreign key. `purgeUserToolApprovals` deletes it with the account, and a
whole-database restore resets every `allow` to `ask`
(`docs/d1-restore-reconciliation.md`).

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
with the `besidka__` prefix, an unknown tier or mode, extra keys, and `allow`
on the ask-every-time tier are all 400. `PUT` logs a `besidkaTools`
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
all 50 tool entries (about 0.5 s of cold import in the chat route specs) and
no send uses it before L9. Connector tools keep `ask`: their Blocked state is
the C-5 tool setting, which hides the tool from the live tool set, so the
replay reads it as missing.

## Labs and the panel

- **Labs** (`/profile/labs`): under the `besidka-tools` row, once the opt-in
  is on, a "Tool permissions" button opens the panel. There is no new page,
  so no profile tab (CLAUDE.md, "Profile pages navigation").
- **Panel**: `app/components/Profile/BesidkaTools/Permissions.vue` in the
  shared `UiSidePanel` (`docs/ui/side-panel.md`; a bottom sheet below `md`).
  Three groups: Read-only, Write, Ask every time. Each group has a select
  (Blocked, Needs approval, Always allow; Custom appears, disabled, when the
  tools of a group differ; no Always allow for Ask every time) and each tool
  its own select with a plain-language title. Every change saves at once with
  an optimistic update (`app/composables/besidka-tool-permissions.ts`); the
  server's list replaces the local one, and a failure drops the optimistic
  value and shows a toast from `parseError`.
- **Search popup**: with the flag on, Settings gets a "Besidka tool
  permissions" row after Labs. It opens `/profile/labs?panel=besidka-tool-permissions`,
  and Labs opens the panel, then clears the query.

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

| Mode | Untainted send | After earlier Besidka results only | After web, knowledge, file, skill, connector or shared-branch content |
| --- | --- | --- | --- |
| Blocked | not offered; denied if called or replayed | same | same |
| Needs approval | asks `default` (Allow once, in this chat, always, Deny) | read: asks `default`; write: asks `untrusted-output` (Allow once, Deny) | asks `untrusted-output` |
| Always allow | runs, marked "Ran without asking (Always allowed)" | read: runs; write: asks `untrusted-output` | asks `untrusted-output` |

The ask-every-time tier always asks `always-ask` with Allow once and Deny
only, whatever the mode. Every Besidka result taints the send with `besidka`
and records the `besidka` read source. A Besidka read does not count that
taint (`isTaintedForBesidka` in `server/utils/tool-approval/policy.ts`, rule
4): the user's own data feeding another read of it carries nothing out, so
an Always allow or "in this chat" read keeps running. A Besidka write, and
every Besidka call after any other taint kind, asks. A later connector call
asks `cross-source`, and the provider's web
search, grounding and URL context are withheld from later steps (the L5
egress guard; it is not applied on Anthropic routes, as for connectors). The
web searches Besidka runs itself (Brave, Exa, any function tool the send
classifies as a web read) are withheld the same way, and their `execute`
refuses with "Web search is off for the rest of this message because it read
the user's private data." on every route, Anthropic included, once a tool
call of the turn read a connector or Besidka data. A send whose chat already
holds a Besidka result (`hasBesidkaToolResult`) starts with `besidka` taint,
so Besidka writes and the ask-every-time tier ask while reads keep their
relaxed rule. Memory extraction skips an assistant turn that used a
`besidka__` tool, like a connector turn. A
Besidka call past 12 per user turn is denied `over-cap`, on the first request
and on replay. A `besidka__` tool name with no entry is Blocked, never a
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

### Budget

Native tools first, then up to 24 Besidka tools (`BESIDKA_CHAT_TOOLS_MAX` in
`shared/utils/besidka-tool-permissions.ts`; Always allow first, then read,
write and ask every time, then by name), then connectors in what is left of
the existing 40 tools and 32 KiB of definitions (Besidka definitions count
against the connector bytes). With the default modes the 24 reach the
ask-every-time tier. A Besidka tool that did not fit is only logged, never
named in the chat; the Labs "Tool permissions" panel shows "Only 24 Besidka
tools are offered per message; block the ones you don't need" while more
than 24 tools are not Blocked. Connector notices are unchanged.

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
read names "your Besidka data", and "Always allow" confirms with "Always
allow Besidka to list projects? ...". A finished Besidka call is a reasoning
step titled "Besidka: list projects".

### Remembered approvals in the chat panel

The chat panel's Approvals section (`listChatToolApprovalGrants`) lists the
Besidka grants too: "Allow in this chat" grants whose registry hash still
matches, and, while the chat's Besidka row is on, every tool set to Always
allow. A Besidka Always allow row links to the Labs permissions panel
("Manage") instead of a Remove button; "Reset approvals in this chat" clears
the Besidka chat grants with the connector ones.
