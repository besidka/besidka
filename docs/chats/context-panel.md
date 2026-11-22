# Chat context panel

The chat context panel shows what a chat produced and used, like the right
rail in Claude and ChatGPT but without a sticky header: the reading area stays
untouched. It opens in the shared side panel (`docs/ui/side-panel.md`) in
`context` mode, from the contextual fifth slot of the nav pill. Owner
decisions of 2026-11-07 (Linear BES-272, P0-13).

## Nav pill: slot 5 is contextual

The pill keeps five symmetric slots: Home · User menu · New chat · Search ·
slot 5.

| Page | Slot 5 |
| --- | --- |
| Owned chat (`/chats/<slug>`, not `/chats/new`, not the dev-only `/chats/test`) | **Chat** (`lucide:panel-right`), badge = number of outputs, opens the Context panel |
| Shared chat (`/shared/<slug>`, signed in) | **Chat**, read-only Context panel, Branch only when the share allows it |
| Everything else | **⋯ More** (pin sidebar on desktop, cookie settings in the chat layout) |

- `useChatRoute()` (`app/composables/chat-route.ts`) is the one definition of
  "owned chat page" and "shared chat page" for the pill, the ⋯ More menu, the
  User menu and the panel.
- The mobile bottom bar is the same component, so it shows the same five
  slots.
- On chat pages, **Pin sidebar** (desktop, no reduced motion,
  `useSidebarPinToggle()`) and **Cookie settings** are the last rows of the
  User menu (`Sidebar/AuthCta.vue`). This is an owner-directed exception to
  the "User menu holds only Security and API keys" rule, for these two global
  toggles only. On other pages they stay in ⋯ More.
- In an installed PWA (`display-mode: standalone`, or iOS
  `navigator.standalone`; `useStandaloneDisplay()`) an owned chat's panel also
  has a **Copy URL** action (`useCurrentUrlCopy()` copies the full URL of the
  route). An iOS home-screen app has no URL bar, so the chat slug was
  unreachable. A floating URL chip on the nav pill was tried and removed on
  2026-11-20: the owner did not want it, and on phones it covered the
  composer's tools button. Pair the action with `get_debug_info`
  (`docs/besidka-tools.md`, "Debug info").
- Branch, Share and Don't-use-for-memory left ⋯ More; they live in the panel
  header now.

## Panel content

`app/components/Chat/ContextPanel.vue`, rendered by
`Sidebar/ChatContextButton.vue` through `useSidePanel().toggle()` with
`viewKey: 'chat-context'` and `mode: 'context'`.

- **Header** (scrolls with the content, not sticky): chat title, project badge
  (links to `/chats/projects/<id>`), chat total cost (`formatMessageCost`, `~`
  when estimated, the same total the message menu shows), a Shared badge, the
  memory-excluded badge, and the actions Branch, Share (opens `ChatShareModal`),
  Pin / Unpin, the memory exclusion toggle (same composable, copy and
  confirmation as before) and **Copy debug info** (owned chats only). Shared
  pages show Branch only when `allowBranch` is on.
- **Copy debug info**: one click copies a plain-text report of ids and
  statuses for support (chat slug and URL, newest 10 messages with model,
  status, tool counts and failure refs, connectors, features, build id, the
  generation guard state, the contact line). It never contains message text,
  tool input or output, keys, tokens or connector addresses beyond the host.
  `useChatDebugInfo()` (`app/composables/chat-debug-info.ts`) fetches
  `GET /api/v1/chats/[slug]/support-info` and writes it with
  `navigator.clipboard.write()` and a `ClipboardItem` that holds the fetch
  promise, so iOS Safari still counts the write as part of the tap (a plain
  `writeText` after the await is refused there); without `ClipboardItem` it
  falls back to `writeText` (also tried once when the item write fails). On
  success the button reads "Copied" with a check
  for 2 seconds (like the PWA URL chip, with a screen-reader status); if the
  browser still refuses, an error toast appears and the report is shown in a
  read-only textarea that selects itself on focus, with a Hide button; the
  textarea is also cleared when you move to another chat. Connectors show only
  when the `connectors` feature is active. The same report is the
  `get_debug_info` Besidka and MCP tool (`docs/besidka-tools.md`, "Debug
  info"), which needs Labs flags; this route does not.
- **Pin / Unpin** (BES-362, owned chats only): `useChatPin()`
  (`app/composables/chat-pin.ts`) posts to the existing
  `POST /api/v1/chats/history/pin` with the chat `id` that the context
  response now carries next to `pinnedAt`. The toggle is optimistic: it
  patches the shared `chat-context:owned:<slug>` async-data entry first,
  settles on the server's `pinnedAt` (the endpoint toggles, so the response is
  the truth) and rolls back with an error toast on failure. On success
  `setHistoryChatPinnedBySlug()` moves the chat between History's Pinned and
  chat lists in every loaded cache entry; a chat that is not loaded yet appears
  when History next refreshes on mount. The search modal reloads its Recent
  list on every open; on the first open after sign-in it reserves the space
  with a three-row skeleton (`search-recent-skeleton`, outside the keyboard
  options) so the groups below do not jump, swaps in the rows at the same
  height, and collapses the skeleton over 200 ms when there are no recent
  chats or the request fails. Later opens show the cached rows at once.
  In the other direction, `setHistoryChatPinned()` (the
  search modal's pin toggle) also patches the panel's cached context, so a pin
  made in quick search shows in the panel without a reload. Icons match
  History and quick search: `lucide:pin` to pin, `lucide:pin-off` to unpin.
  MCP already pins through `update_chat` (`pinned`), so no tool was added.
- **Sections**, each hidden when empty: Outputs, Inputs, Used. Rows show an
  icon (a thumbnail for images), the title and one line of detail.
- **Clicks**: a generated image opens `ChatImagePreview`; an artifact pushes
  its detail view on top of Context (`useArtifactPanel().open(..., { push:
  true })`, Back returns to Context; see `docs/artifacts/panel.md`); a web
  source opens the page in a new tab (`noopener noreferrer`); anything else
  scrolls the chat to its message (`[data-message-id]`). On mobile the sheet closes first;
  on desktop the panel stays open.
- **Approvals** (owned chats, `tool-approvals` flag): below the groups,
  `Chat/ContextPanelApprovals.vue` lists the remembered tool approvals that
  apply in this chat, with "Reset approvals in this chat" and a per-tool
  Remove for "Always allow". It reads its own route
  (`GET /api/v1/chats/[slug]/tool-approvals`), not the context aggregate;
  see `docs/connectors.md` section 7.9.
- **States**: `UiSidePanelSkeleton` while loading; an `alert-error` with Retry
  on failure; one sentence when the chat has nothing yet.
- "Not used for memory" shows only as the header badge and in the history
  list. The chat page no longer renders a line above the messages (BES-329);
  shared chats and the new-chat page never had one.

## Data: `GET /api/v1/chats/[slug]/context`

Built from persisted message parts and chat columns. No new tables.

- Owner only, 404 for a foreign or missing chat, 400 for a malformed slug.
- Messages are selected as plain rows, never through a relational `with`,
  so a long chat is not packed into one JSON string (D1 returns
  `SQLITE_TOOBIG` around 6 to 7 MB). Only the newest 1,000 messages are read
  (`CHAT_CONTEXT_MAX_MESSAGES`); beyond that the response has
  `truncated: true` and the panel says so (the cost title too). Each group
  returns the newest 200 items (`CHAT_CONTEXT_MAX_ITEMS_PER_GROUP`, both
  limits in `shared/utils/chat-context.ts`), while `counts` and `kindCounts`
  stay the full totals; the section header shows the total and "Showing the
  latest N" when capped.
- Cost note (accepted): the badge needs `counts`, so the aggregate runs once
  per chat page view and once after each finished send, the same order of
  work as the chat GET itself.
- Response (`shared/types/chat-context.d.ts`): `chat` (slug, title, project,
  `memoryExcluded`, `share` with the relative `/shared/<slug>` URL, cost,
  models), `outputs`, `inputs`, `used` (`ChatContextItem[]`) and `counts`.
- The client (`useChatContext()`, `app/composables/chat-context.ts`) loads it
  lazily on the client with one async-data key shared by the badge and the
  panel. Its `data` stays null until the response belongs to the chat on the
  route (Nuxt seeds a new key with the previous key's data, so chat A would
  otherwise show while chat B loads). It refreshes, canceling any in-flight
  request, when the panel opens, after every finished send
  (`chat:generation-finished`), after a stopped send, a deleted message or a
  finished deep research report (`chat:context-changed`), and after the share
  modal closes.

### Shared chats: `GET /api/v1/shared/[slug]/context`

- Public, keyed by the share slug, 404 when the share is not active.
- Runs only `public` sections, on parts that went through `filterPublicParts`
  (no tool parts at all, so no memory, knowledge, chat search or web-search
  tool counts), then `rewriteShareFileParts` when the share shows files, or
  `hideFileParts` when it does not. Raw `/files/<key>` URLs never leak. The
  builder also drops tool parts itself in public mode, as defense in depth.
- `usage` is not even selected unless the share shows metadata.
- Cost and models only when the share shows metadata.

## Section registry (for later features)

`server/utils/chats/context/sections.ts` holds `CHAT_CONTEXT_SECTIONS`.
`build-chat-context.ts` runs every section over every message in order and
deduplicates items by `id` per group.

`collect(message, accumulator, scope)` gets a third argument,
`ChatContextScope`: data loaded once per request before the build, because
sections are synchronous and must not query per message. Today it carries
`artifacts`, a map from public artifact id to `{ title, kind, version,
latestVersion }`, loaded by `loadChatContextArtifacts()`
(`server/utils/chats/context/artifacts.ts`) and passed to
`buildChatContext(..., { artifacts })`. The builder defaults it to an
empty map, so callers without it (MCP `get_chat`) list no artifacts.

```ts
const artifactsSection: ChatContextSection = {
  id: 'artifacts',
  group: 'outputs',
  visibility: 'public',
  collect(message, accumulator, scope) {
    for (const part of message.parts) {
      if (!isDataArtifactPart(part)) {
        continue
      }

      const artifact = scope.artifacts.get(part.data.artifactId)

      if (!artifact) {
        continue
      }

      accumulator.add('outputs', {
        id: `artifact:${part.data.artifactId}`,
        sectionId: 'artifacts',
        kind: 'artifact',
        title: artifact.title,
        messageId: message.id,
        meta: { artifactId: part.data.artifactId, version: artifact.version },
      })
    }
  },
}
```

Rules for a new section:

1. Add the section to `CHAT_CONTEXT_SECTIONS`, a `kind` to
   `ChatContextItemKind`, and an icon and detail line in
   `Chat/ContextPanelItem.vue`.
2. `visibility: 'public'` only if the data survives `filterPublicParts` and is
   safe for anyone with the share link. Everything derived from tool parts is
   `private`.
3. Never put content bodies in an item: titles, ids, counts and URLs the user
   can already open. Memory items carry the action and the entry title only;
   the persisted parts have no bodies anyway (`redactMemoryToolPartsForPersistence`).
4. `accumulator.increment()` for "used N times" rows (web search per
   provider), `accumulator.add()` for everything else.
5. If the output has a detail view, open it from the panel with
   `useSidePanel().push(...)` so Back returns to Context.
6. Add fixtures to `tests/unit/server/utils/chats/context/build-chat-context.spec.ts`.

Planned: documents (Outputs, D-4), research reports from the new research
flow (R-6), connectors and skills (Used, C-5, S-3).

### Google Drive files (Inputs, G-4)

The `drive-files` section (Inputs, `public`) lists each `data-drive-file`
reference of a user message as kind `drive-file` (the Drive mark, "Google
Drive" as the detail). For the owner the row links to the file in Google Drive
(`href`, a fixed `drive.google.com` link built on the server). The plain
`uploaded-files` row of the same copy is skipped when its file part is
followed by the reference, so a copy is listed once. In a shared chat the part
has already been reduced to its name by `filterPublicParts` (no id, no link),
so the row is the name only. See `docs/google.md`, section 11.7.

### Artifacts (A-4)

The `artifacts` section (Outputs, `public`) lists each artifact a
`data-artifact` part references, once per artifact, with `meta.artifactId`,
`artifactKind`, `version` (the newest version the chat references) and
`latestVersion`. Left out: deleted artifacts, taken-down artifacts and
artifacts not owned by the chat owner (a branched chat that references
someone else's artifact).

- Owner route: only when `artifacts` is active for the user; the title is the
  artifact's current title and `latestVersion` its `currentVersion`.
- Shared route: only when the global `artifacts` rule is on; the title is the
  one on the shared part and `latestVersion` equals `version`, so a shared
  chat never reveals a newer version or a later rename.

### Attached artifacts (BES-350)

The `attached-artifacts` section (Inputs, `private`) lists each artifact a
**user** message attached from the library (`data-artifact-attachment`
part, `docs/artifacts/attach.md`), once per artifact, with the artifact's
current title and the version that was attached (`version`) next to
`latestVersion`. Clicking a row opens the artifact in the side panel like an
Outputs row. The `artifacts` section (Outputs) reads only `data-artifact`
parts, so an attached artifact never shows as an output of the chat.
`collectArtifactReferences` loads both part types in one query. The section is
`private`, so the shared route never runs it, and the shared view drops
attachment parts before the builder sees them. Deleted, taken-down and
foreign artifacts are left out, like Outputs.

Phase 0 sections: `generated-images` and `research-reports` (Outputs);
`uploaded-files` and `project-knowledge` (Inputs; knowledge as item ids and
titles); `memory`, `chat-search` and `web-sources` (Used). The web-search
rows count answers where a search actually ran: a Brave or Exa tool part, or
provider-native `web_search` listed in `messages.tools` together with a cited
source (`messages.tools` alone only says the tool was enabled for that send).

## MCP

`get_chat` (`chats:read`) returns a `context` summary built by the same
builder over the newest 1,000 messages: counts of outputs, inputs, web sources,
images,
research reports and memory actions (artifacts are not counted yet: the MCP
build passes no artifacts scope, a known open item), a `truncated` flag, and up to 20
attached files as `{ id, name }`, where `id` is the `files.id` that
`list_files`, `read_file` and `delete_files` take (resolved by storage key
for the signed-in user; files they no longer own are left out). Added in MCP
2.1.0.

The client renders thumbnails and download links only for same-origin
relative paths (`toSafeLocalUrl`, `app/utils/chat-context.ts`), and section
label lookups use `Object.hasOwn`, so a malformed part can neither inject a
URL scheme nor match an `Object.prototype` key.

## Tests

- `tests/unit/server/utils/chats/context/build-chat-context.spec.ts`
- `tests/unit/server/api/chats-context.spec.ts`,
  `tests/unit/server/api/shared-context.spec.ts`
- `tests/unit/components/Sidebar.spec.ts`,
  `tests/unit/components/Sidebar/Development.spec.ts`,
  `tests/unit/components/Sidebar/AuthCta.spec.ts`,
  `tests/unit/components/Sidebar/ChatContextButton.spec.ts`,
  `tests/unit/components/Chat/ContextPanel.spec.ts`,
  `tests/unit/composables/chat-context.spec.ts`,
  `tests/unit/composables/chat-route.spec.ts`
- Artifacts section and detail view: the specs above plus
  `tests/e2e/chat/artifacts-panel.spec.ts` (see `docs/artifacts/panel.md`)
- `tests/e2e/chat-context-panel.spec.ts`
