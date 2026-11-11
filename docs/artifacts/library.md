# Artifacts library

`/chats/artifacts` lists every artifact the signed-in user owns: from live
chats, from chats that were deleted, and from connected apps (MCP). Layer A-11
(Linear BES-291). It is the fourth tab of the history area (Chats, Projects,
Shared, Artifacts) and has no slot in the nav pill.

## Files

| File | Role |
| --- | --- |
| `app/pages/chats/artifacts/index.vue` | The page: filters, states, row handlers, deep link, delete confirmations |
| `app/composables/artifacts-library.ts` | `useArtifactLibraryFilters()` (URL-backed search and kind) and `useArtifactLibrary()` (list, pages, delete, selection, quota) |
| `app/components/History/ArtifactRow.vue` | One row and its actions menu; `mode="picker"` (BES-350) turns it into a pick button for the composer's artifact picker: no actions menu, no checkbox, no origin link, the whole row clickable |
| `app/components/History/PageShell.vue` | The tab bar; the Artifacts tab only renders with the `artifacts` feature |
| `app/components/Search/Modal.client.vue` | Row `search-option-artifacts` in the Chat group, only with the feature |
| `app/components/Chat/ContextPanel.vue` | "All artifacts" link under Outputs when the chat has an artifact output |
| `server/api/v1/artifacts/index.get.ts` | The list route; also returns `usedBytes` |

## Feature gating

- `artifacts` gates the tab, the Search row, the context panel link and the
  page. With the feature off the page redirects to `/chats/history`
  (`navigateTo(..., { replace: true })` in setup, so it also works on SSR).
- `artifacts.share` gates the Share action only. The composer's artifact
  picker (`docs/artifacts/attach.md`) reads the same list route through the
  same `useArtifactLibrary()`, with its own fetch key and in-memory filters.
- The list route answers `404` to a user without `artifacts`
  (`requireFeature(event, 'artifacts', { active: false })`).

## Data

`GET /api/v1/artifacts?limit&offset&query&kind` answers
`{ items, total, usedBytes }`. `items` are `ArtifactSummary` rows, now with
`originChatTitle` (the chat's title, `null` when the chat is gone) next to
`originChatSlug`. `usedBytes` is `getArtifactUsageBytes()` for the user, the
number behind "Using X of 25 MB" (`ARTIFACT_USER_QUOTA_BYTES`). Two details
matter:

- `originChatTitle` is selected with an explicit `origin_chat_title` alias.
  `artifacts.title` and `chats.title` share a column name and D1 returns rows
  as objects keyed by column name, so an unaliased join made the chat title
  overwrite the artifact title on D1 (better-sqlite3, used by the integration
  tests, hides it). Drizzle's D1 `batch()` maps rows by `Object.keys`, so any
  duplicated result name would shift every later field; `queries.spec.ts`
  asserts that the names of `summarySelection` stay unique.
- The first page is `useLazyFetch`, so SSR renders the list. Totals and the
  quota are read from `data` directly, never copied in a watcher: a watcher
  does not run after the server response, which rendered "Using 0 B" on the
  server and mismatched on hydration.

Further pages are appended with `$fetch` at `offset = rows shown`. The offset
counts only rows still shown, because the server's own offsets already shifted
after a delete (counting removed rows skipped artifacts). A delete removes rows
locally (the list keeps its depth) and re-reads the total and the quota with a
`limit=1` request that carries the active filters. A total the server sent
already excludes earlier deletes, so only deletes made after it are subtracted.
A change to the first page (filter change, retry) drops the appended pages and
ignores a page or totals response that was still in flight.

## Rows

- Origin label order: `createdVia === 'mcp'` is "Created by a connected app";
  otherwise a chat link with `originChatTitle`; otherwise "Chat deleted". A
  connected-app artifact has no chat and must never read "Chat deleted".
- Badges are plain daisyUI modifiers: `badge-soft` for the kind, `badge-soft
  badge-success` for "Shared" (an active link), `badge-soft badge-error` for
  "Removed after a report".
- A taken-down artifact keeps Delete. Open and Download are disabled with a
  tooltip, because the owner version route answers `451` (the panel would
  show an error and a toast for one state). Share is hidden.

## Panel, deep link, share, download

- Open: `useArtifactPanel().open({ artifactId, version: currentVersion, kind,
  title, source: 'owner' })`. `UiSidePanel` is mounted in `app/app.vue`, so
  the panel works on the history layout.
- Deep link: `/chats/artifacts?artifact=<id>` (the `url_in_app` that the MCP
  `create_artifact` returns) loads the detail with `notify: false`, opens the
  panel and removes the parameter from the URL. An unknown, foreign or
  malformed id (and a taken-down one, with its own text) shows a dismissible
  `alert-warning alert-soft`, never a crash and never a toast.
- Share: one page-level `LazyChatArtifactShareModal` driven by the chosen
  row. The share and report modals open their dialog from `onMounted` when
  they mount with `open` already `true`: an immediate watcher used to run
  before the template ref existed, so a lazily mounted dialog never opened on
  first use. When the modal closes the row is re-read
  (`GET /api/v1/artifacts/<id>`) so the "Shared" badge is current.
- Download: the current version is fetched with `loadArtifactVersion()` and
  written with `buildArtifactSourceFile()` and `downloadArtifactFile()`, the
  same helpers as the panel's "Download source".

## URL state

`?query=` and `?kind=` are the source of truth. A kind change and the
debounced (300 ms) search each push a history entry, a watcher restores the
search box when Back changes the URL, and a search shorter than
`MIN_SEARCH_LENGTH` is never pushed. Other parameters (`artifact`) are kept.

## States

Loading is six skeleton rows shown only after 300 ms; the first response
before that renders nothing, so a fast load never flashes a skeleton. Empty,
no results (query or kind, with Clear, one history entry), error (`alert-error alert-soft` with
Retry) and the quota line follow the ticket. The kind filter is a button group with
`aria-pressed`, not a radio group: radios need arrow-key navigation, and the
checked radio style overrode `btn-primary` in dark mode. Selection mode and
bulk delete reuse `ActionsToolbar.vue` (delete only). Deleting sends ids in sequential
chunks of `ARTIFACT_BULK_DELETE_MAX` (50), so a selection is not capped. Ids
the server keeps (`heldIds`, a legal hold after a report) stay in the list and
raise a warning toast. Parity with the panel: delete, share and download for
one artifact are all in the panel's actions menu too
(`docs/artifacts/panel.md`). A delete made from the panel reaches an open
list through the `artifacts:deleted` hook, which `useArtifactLibrary()`
listens to; a delete made here marks the artifact deleted for chat cards.

## Tab bar on small screens

With four tabs, inactive tabs hide their label with `@max-md:sr-only` when
the tab bar itself is narrower than 28rem (a container query, so it also
holds when the docked side panel narrows the page; the panel docks from
1128 px and leaves the chat at least 768 px) and keep an `aria-label`; the
active tab shows icon and label. With three tabs (feature off) every label stays visible. Checked at
375 px and 320 px: no horizontal page scroll.

## Tests

`tests/unit/pages/chats/artifacts/index.spec.ts`,
`tests/unit/components/History/ArtifactRow.spec.ts`,
`tests/unit/components/History/PageShell.spec.ts`,
`tests/unit/composables/artifacts-library.spec.ts`, the new rows in
`Search/Modal.spec.ts` and `Chat/ContextPanel.spec.ts`, the `usedBytes` and
`originChatTitle` assertions in `tests/integration/api/artifacts.spec.ts`, and
`tests/e2e/history/artifacts-library.spec.ts`. The e2e spec mocks the artifact
routes with `page.route` and reaches the page through a client-side
navigation: a direct `goto` would have the server fetch the list, which
Playwright cannot intercept.
