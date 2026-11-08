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
- Branch, Share and Don't-use-for-memory left ⋯ More; they live in the panel
  header now.

## Panel content

`app/components/Chat/ContextPanel.vue`, rendered by
`Sidebar/ChatContextButton.vue` through `useSidePanel().toggle()` with
`viewKey: 'chat-context'` and `mode: 'context'`.

- **Header** (scrolls with the content, not sticky): chat title, project badge
  (links to `/chats/projects/<id>`), chat total cost (`formatMessageCost`, `~`
  when estimated, the same total the message menu shows), a Shared badge, the
  memory-excluded badge, and the actions Branch, Share (opens `ChatShareModal`)
  and the memory exclusion toggle (same composable, copy and confirmation as
  before). Shared pages show Branch only when `allowBranch` is on.
- **Sections**, each hidden when empty: Outputs, Inputs, Used. Rows show an
  icon (a thumbnail for images), the title and one line of detail.
- **Clicks**: a generated image opens `ChatImagePreview`; a web source opens
  the page in a new tab (`noopener noreferrer`); anything else scrolls the
  chat to its message (`[data-message-id]`). On mobile the sheet closes first;
  on desktop the panel stays open.
- **States**: `UiSidePanelSkeleton` while loading; an `alert-error` with Retry
  on failure; one sentence when the chat has nothing yet.
- The inline "Not used for memory" line in the chat stays as a reading cue.

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
  otherwise show while chat B loads). It refreshes, cancelling any in-flight
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
  builder also drops tool parts itself in public mode, as defence in depth.
- `usage` is not even selected unless the share shows metadata.
- Cost and models only when the share shows metadata.

## Section registry (for later features)

`server/utils/chats/context/sections.ts` holds `CHAT_CONTEXT_SECTIONS`.
`build-chat-context.ts` runs every section over every message in order and
deduplicates items by `id` per group.

```ts
const artifactsSection: ChatContextSection = {
  id: 'artifacts',
  group: 'outputs',
  visibility: 'public',
  collect(message, accumulator) {
    for (const part of message.parts) {
      // read your persisted part, then:
      accumulator.add('outputs', {
        id: `artifact:${artifactId}`,
        sectionId: 'artifacts',
        kind: 'artifact',
        title,
        messageId: message.id,
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

Planned: artifacts and documents (Outputs, A-4, D-4), research reports from
the new research flow (R-6), Drive files (Inputs, G-4), connectors and skills
(Used, C-5, S-3).

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
research reports and memory actions, a `truncated` flag, and up to 20
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
- `tests/e2e/chat-context-panel.spec.ts`
