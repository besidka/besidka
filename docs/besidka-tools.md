# Besidka tools: per-tool permissions (BES-394 L8)

Besidka's own tools (the registry in `server/utils/besidka-tools/`, see
`docs/mcp-server.md`, "The Besidka tools registry") will let a model use the
user's Besidka data in a chat (BES-394 L9). This layer adds what the user
controls first: a permission for each tool, a Labs section to manage them and
the `besidka-tools` flag. **Nothing in a chat uses any of it yet**: no tool is
offered to a model, and the chat send does not read the permissions except in
the continuation replay (below).

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

- `resolveBesidkaPermissionMode(userId, toolName, { cache, db })` is the
  function L9 will call for each tool. It accepts a registry name or the
  `besidka__<name>` chat name, reads the user's rows once per cache (pass one
  `createBesidkaPermissionCache()` for a whole request) and returns the
  effective mode. A tool that is unknown or not exposed to chats is `blocked`.
- `pickBesidkaPermissionMode(toolName, modes)` is the same decision over rows
  already loaded, with no I/O.
- `resolveBesidkaPermissionModes(userId, toolNames)` returns the effective mode
  of each named tool from one read (used by the replay seam).
- `loadBesidkaToolPermissionModes(userId)` loads the rows.

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

## Not built yet

L9 (chat exposure): building the tools from the registry for a send, the
chat-name prefix, the per-chat Besidka row, the budget and the current-chat
guard. L5 and L6 already pause and resume an approval; they have no Besidka
tool to pause yet.
