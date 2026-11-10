# Artifact cards and side panel

How an artifact that a model creates or edits (`create_artifact`,
`update_artifact`) shows up in a chat: a card in the message, a detail view
in the shared side panel (`docs/ui/side-panel.md`) and a row in the chat
context panel (`docs/chats/context-panel.md`). Layer A-4 (Linear BES-259).
The sandboxed runtime that renders the artifact is a separate Worker, see
`docs/artifacts-runtime.md`.

## Files

| File | Role |
| --- | --- |
| `app/components/Chat/Artifact/Card.vue` | The card in the assistant message, for owner and shared chats |
| `app/components/Chat/Artifact/Detail.client.vue` | The side panel view: Preview and Code tabs, version select, actions, runtime errors, shared banner |
| `app/components/Chat/Artifact/Frame.client.vue` | The runtime iframe and the host end of `@besidka/artifacts-protocol` |
| `app/composables/artifact-host-actions.ts` | `useArtifactHostActions()`: the Frame's Copy, diagram viewer and display mode hooks (A-14) |
| `app/components/Chat/Artifact/ReportButton.client.vue` | Report form on shared chats |
| `app/composables/artifacts.ts` | `useArtifactPanel()`, `useArtifactAutoOpen()`, `useSharedArtifactVersions()`, the loaders |
| `app/utils/artifact-parts.ts` | Reads `data-artifact` and artifact tool parts into one card model |
| `app/utils/artifact-export.ts` | Copy and download files, AI-generated marks |
| `app/utils/artifact-frame-policy.ts`, `shared/utils/artifact-frame-policy.ts` | The `frame-src` policy, meta tag and shared directive |
| `server/plugins/artifacts-frame-src.ts` | The `frame-src` response header on `/chats/**` and `/shared/**` |
| `server/utils/artifacts/shared-chat.ts` | The shared-chat read rule |
| `server/api/v1/shared/[slug]/artifacts/[artifactId]/versions/[version].get.ts` | Shared-chat version read |
| `server/api/v1/shared/[slug]/artifacts/[artifactId]/report.post.ts` | Report from a shared chat |
| `server/utils/artifacts/report-rate-limit.ts` | KV limiter for reports |
| `server/utils/chats/context/artifacts.ts` | Loads the artifacts the context section may list |

Artifact tool parts (`tool-create_artifact`, `tool-update_artifact`) are not
reasoning steps: they are in `EXCLUDED_TOOL_STEP_NAMES`
(`app/utils/reasoning.ts`), like `generate_image`, so the card is the only
progress shown.

## Card states

`getArtifactPartModel()` turns a part into `{ state, operation, kind, title,
artifactId, version, content, toolCallId, errorText }`.

| State | Shows | Click |
| --- | --- | --- |
| `streaming` | "Writing artifact…" or "Updating artifact…" until the title streams in, the line count, an indeterminate progress bar | Opens the panel on the live stream (create), or on the artifact being updated |
| `ready` | Title, kind, `vN` badge | Opens that version |
| `failed` | `alert-error` with "Couldn't save …" and the tool error text | Not clickable |
| unavailable | "Artifact unavailable" (a ready card whose version answered 403, 404 or 410) | Not clickable |

The card is `aria-live="polite"` and marks itself active while its view is
open on its version. Persisted cards of one artifact share the view key
`artifact:<id>`, so a card compares its version with the open one too:
clicking the v1 card while v2 is open switches the open view to v1
(`selectVersion`) instead of doing nothing. A card keyed by the tool call id
keeps the same panel view (and the same iframe) when the streamed artifact
becomes a stored version: the view reads its target from `useState`, not
from panel props.

A message that holds only an artifact tool part (`tool-create_artifact` or
`tool-update_artifact`, streaming or finished) is visible content
(`hasVisibleAssistantContent`), even though those tools are not reasoning
steps (`EXCLUDED_TOOL_STEP_NAMES`). Without it the bubble, and the card,
stayed hidden until text arrived.

Every stream delta clones the message parts, so the card sees a new part
object many times a second. Nothing downstream may react to identity alone:
`updateTarget` is a no-op when no field changed, the detail view watches
primitives (`artifactId`, `source`, selected version, streaming flag), and
the Frame skips `tool-result` when id, version, kind, title and content are
the same as the last one it sent. A refetch here used to reset the
artifact's React state and drop a pending copy.

## Panel and Frame

`useArtifactPanel().open(target)` opens `LazyChatArtifactDetail` in
`detail` mode. From the Context panel the row pushes the view
(`open(target, { push: true })`), so Back returns to Context.

The detail view:

- Preview tab: the Frame. During a stream only `html`, `svg` and `markdown`
  get partial previews; `react` and `mermaid` wait for the stored version.
- Code tab: `ChatArtifactCodeView` (`useChunkedCodeHighlight`). The source
  is split into blocks of 50 lines, each a `display: block` span with
  `content-visibility: auto` and `contain-intrinsic-size: auto <longest
  line>ch auto <lines>lh`, so off-screen blocks skip style, layout and paint
  (Safari 18+; older browsers just render everything) while keeping their
  real height and width, and the horizontal scrollbar does not change as
  you scroll. The plain text paints in the click's
  frame, one text node per block. Colours follow from the chat's lazy Shiki
  highlighter (`loadCodeHighlighter`, docs/code-highlighting.md): each
  animation frame tokenizes blocks for up to 8 ms with the grammar state
  carried over and swaps at most 6 coloured blocks in; `v-memo` keeps a
  finished block's DOM untouched; a tokenize error resets the view to plain
  text. Finished colours are cached (16 entries and at most 40,000 lines in
  total) per artifact version (`<artifactId>:<version>`, or the code itself),
  language and theme, and reused only when the cached code equals the
  current code; reopening a version replays them 6 blocks per frame without
  tokenizing. Every block but the last ends with its `\n`, so `textContent`
  and a selection copy equal the source; `innerText` adds a blank line at
  each block boundary, so never read the code from it (Copy uses the source).
  While a version is still streaming the tab uses `ProseCodeStream` instead.
  The panel stays mounted (`v-show`) after the first open and the Preview
  iframe is never unmounted, so switching tabs only toggles `display`.
  Measured on a production build (headless Chromium, 3,000-line HTML): text
  in the click's frame, all colours in about 0.5 s instead of 2.8 s, no long
  task over 115 ms (the first one is the grammar compiling), Preview to Code
  about 32 ms instead of 168 ms, reopening a version with no long task.
  Numbers and the method are in PR #778.
- Mermaid artifacts on the Code tab get the chat's Fullscreen (zoom and pan
  viewer), Download (SVG, PNG, .drawio) and Copy (code, Markdown, SVG,
  draw.io) next to the tabs, rendered by the parent's own Mermaid. On the
  Preview tab the same actions are in the diagram's own toolbar inside the
  frame (see "Mermaid exports" in docs/artifacts-runtime.md).
- Version select: the owner sees every stored version
  (`GET /api/v1/artifacts/<id>`); a shared viewer sees only versions the
  shared chat references.
- New versions written in the chat (BES-342): every owner card that reaches
  `ready` reports its `artifactId` and version to
  `useArtifactPanel().noteVersion()` (no polling; the stream's tool result is
  the signal), which keeps the highest version per artifact in
  `latestVersions`. An open view of that artifact refreshes its version list
  and switches to the new version, unless the user picked an older one
  (`isVersionPinned`: set when the view opens on, or the select or a card
  chooses, a version below the latest known). A pinned view shows a
  "vN is available, show" button instead. The cause of the old bug: the new
  card has its own tool-call view key, so it never counted as the open view
  and nothing reloaded the version list. A different artifact written in the
  same chat never steals the panel. The pure rule is
  `resolveArtifactVersionRefresh()`.
- Actions menu: Copy code, Download source, Download as HTML (Markdown only),
  Full width. It closes on a press outside, on `window` blur when focus moves
  into the artifact iframe (VueUse `onClickOutside` with `detectIframe`; a
  click inside the sandboxed frame never reaches the host document), on Esc
  (focus returns to the trigger), on choosing an item and on switching tab or
  version. The version select is a native `<select>`, which the browser
  closes itself.
- Runtime errors: the last of up to 5 `notifications/message` errors from the
  runtime, with the stack under Details. The owner gets **Ask to fix**, which
  closes the panel outside the docked layout and fires
  `chat-input:prefill` with `Fix the error in "<title>": <message>`. The
  composer appends that text after a blank line when it already holds a
  draft, and never sends it.
- A failed generation (`stream.status === 'failed'`) shows
  `alert alert-error alert-soft` with the tool error text over both tabs
  instead of a skeleton or a partial preview.
- Ids and versions are checked before any URL is built: the id must match
  the store's public id shape (Hashids, `[A-Za-z0-9]{16,32}`) and the version
  must be a positive safe integer. Anything else is treated as unavailable
  without a request.

`Frame.client.vue` is the host:

- Creates the iframe itself (`sandbox="allow-scripts"`,
  `referrerpolicy="no-referrer"`, empty `allow`) pointing at
  `<artifactsOrigin>/v1/index.html`, after `ensureArtifactFramePolicy()`.
- `createHostConnection()` answers the handshake with `HostContext`: theme
  from the colour mode, `displayMode` `fullscreen` in the sheet or docked
  full width and `panel` otherwise, the browser locale, and
  `capabilities`. `storage` is `persistent` for a signed-in owner with the
  `artifacts.storage` flag and a saved artifact, else `memory`, in which case
  no storage handler is passed and the runtime keeps values in its own memory
  (`docs/artifacts/viewer-storage.md`). `complete` is `false` and
  `complete` is `true` with the LLM bridge (`docs/artifacts/llm-bridge.md`),
  else no handler is passed and `besidka/complete` answers `-32601`.
- Sends `ui/notifications/tool-input-partial` at most every 250ms while
  streaming and `ui/notifications/tool-result` for a stored version, on the
  same iframe (no reload per version). Theme and display mode changes go out
  as `ui/notifications/host-context-changed`.
- `ui/open-link`: a `useConfirm` dialog, then `window.open` with
  `noopener,noreferrer`.
- Code and diagram buttons inside the artifact (A-14, see "Code and Mermaid
  blocks" in `docs/artifacts-runtime.md`) reach the host through three hooks
  from `useArtifactHostActions()`. `createHostConnection` has already checked
  the params, the rate limits and the gesture before a hook runs: the
  frame's claim, plus the Frame's `hasUserActivation`, which is `true` only
  when the parent's `navigator.userActivation.isActive` is `true` and
  `document.activeElement` is the artifact iframe. Activation from typing
  in the composer therefore does not count, so an artifact cannot write to
  the clipboard while the user types elsewhere (pastejacking); such a
  request ends as `gesture-required` with no fallback alert. An unknown
  activation fails closed.
  - `ui/clipboard-write`: `writeClipboardText()` in the parent. When the
    browser refuses for lack of a gesture (`gesture-required`, the realistic
    case is Safari), the request stays open and a small `alert` appears at
    the top of the Preview body (absolutely positioned over the frame, not a
    header): "Copy from the artifact?", the first line of the text
    (at most 80 characters) and its length ("123 characters"), so the user
    sees what will be copied, with a Copy button and a dismiss button. The
    Copy button takes focus only when focus was already in the artifact
    frame, never away from the composer or anything else. For 500 ms after
    the alert appears a keyboard activation of Copy (`click` with
    `detail === 0`) is ignored, so an Enter meant for the artifact cannot
    confirm a copy the user has not read. A click on Copy is a real gesture
    in the parent, so it writes the text and answers the frame with that
    outcome; dismiss, Escape (handled in the capture phase so the panel does
    not also close), a new version, Retry, unmount or 5 minutes (the
    runtime's own timeout for this request) answer
    `{ copied: false, reason: 'denied' }`. A second refused copy replaces
    the first, which is answered `denied`. Nothing is copied without a click.
  - `besidka/open-diagram-viewer`: opens the chat's `LazyProseMermaidViewer`
    with the received source, so zoom, pan, Esc, download and copy as image
    are the chat's. The viewer is teleported to `body` and opened with
    `showModal()`, so it sits in the top layer above the docked or overlay
    panel and above the bottom sheet (itself a modal dialog opened earlier);
    the panel ignores Escape while another dialog is open, so Esc closes
    only the viewer.
  - `ui/request-display-mode`: in the docked layout `fullscreen` switches the
    panel to full width and `panel` back (`useSidePanel().toggleFullWidth()`);
    the overlay and the sheet stay as they are. It answers the resulting
    `displayMode`, and the change goes out as `host-context-changed` like
    any other. The runtime kit does not send this request yet.
- A second load of the frame (the artifact navigated itself) removes the
  frame, shows "The preview was stopped" and logs
  `attributes.artifacts.runtimeNavigation` with ids only.
- No `initialized` within 10 seconds: "The preview did not load" with Retry,
  which mounts a fresh frame. The Frame owns this one timer from the moment
  it inserts the iframe, so it also covers an iframe that never fires `load`.
  It passes no `onConnectTimeout`; the protocol package still arms its own
  connect timer after `load`, but with no handler it does nothing.

## Capabilities per viewer (v1)

| | Owner chat | Shared chat (signed in or anonymous) |
| --- | --- | --- |
| Card, detail view, Preview, Code | Yes | Yes |
| Versions | All stored versions | Only versions referenced by the shared chat |
| Copy, download | Yes | Yes |
| Ask to fix | Yes | No |
| Report | No | Yes (no session needed) |
| Banner | None | "AI-generated by a Besidka user, not reviewed by Besidka. Never enter passwords or payment details here." plus `<meta name="ai-generated">` |
| Auto-open | First streamed artifact, docked layout only | Never |
| Runtime storage | Persistent with `artifacts.storage` (A-5), else in memory | In memory until share links (A-7) |

## Shared-chat read rule

`GET /api/v1/shared/<shareSlug>/artifacts/<artifactId>/versions/<version>`
and the report route share `resolveSharedChatArtifact()`:

1. The global `artifacts` rule must be on (`requireGlobalFeature`, evaluated
   as an anonymous caller so no grant or opt-in can switch it on). This is
   the kill switch for every shared-chat artifact surface.
2. The share must be active (`resolveActiveShareBySlug`).
3. One query (`findSharedChatArtifact`) checks membership with `json_each`
   over `messages.parts`: a persisted message of the shared chat carries a
   `data-artifact` part for this artifact (and this version, for reads), the
   artifact still exists, and its owner is the chat owner. A branched chat
   that references someone else's artifact exposes nothing.

Every failure is a 404. A taken-down artifact answers 410
`artifact_taken_down`, a missing R2 object 410 `artifact_content_missing`.
The response carries `Cache-Control: private, no-store`.

The title in a shared version read is the one the referenced `data-artifact`
part carries for that version (`json_extract(value, '$.data.title')` in the
same query), never `artifacts.title`, so a rename after sharing stays
private.

## Report

`POST /api/v1/shared/<shareSlug>/artifacts/<artifactId>/report` runs the
shared report helper of A-7 (`submitArtifactReport`, body and emails in
`docs/artifacts/shares.md`: details of 20 to 2,000 characters, `goodFaith`,
Turnstile for signed-out reporters, copyright notice elements; name and email
are required unless the reason is `csam`). It stores an `artifact_reports` row
with the chat share id (`chat_share_id`) and `priority: 'urgent'` for the
urgent reasons. Limit: 5 reports per hour
per signed-in user, otherwise per client IP (IPv6 by /64), in KV; 429 with
`Retry-After`. Without a user or an IP the limiter fails open and notes it on
the logger (`attributes.artifacts.reportRateLimit.skipped`).

## Auto-open marker

The first artifact of a streaming generation opens next to the chat once per
chat and tab (`useArtifactAutoOpen`): owner chat, `artifacts` active, docked
layout (`min-width: 1128px`, `SIDE_PANEL_DOCK_MIN_VIEWPORT`),
nothing else open in the panel. The marker is
`sessionStorage` key `artifacts:auto-opened:<chat id>` with the value `1`. It
is strictly necessary (it only stops the panel from opening by itself again),
holds no artifact data and matches the row in the Cookie Policy
(`content/legal/cookie-policy.md`). If sessionStorage throws, the panel does
not auto-open.

## Content Security Policy: header and meta

The artifact frame must only ever load the artifacts origin, so a
self-navigating artifact cannot leak its URL before the tripwire removes it.
Two pieces carry the same directive, built by `buildArtifactFrameSrc()`:

```text
frame-src 'self' <artifactsOrigin> https://challenges.cloudflare.com
```

- **Header**: `server/plugins/artifacts-frame-src.ts` adds it on documents
  loaded at `/chats/**` and `/shared/**`. An existing policy is extended:
  when it already has `frame-src`, the sources are merged into that
  directive (browsers ignore a second `frame-src`, and `'none'` is dropped
  because it cannot be combined with sources); with only `default-src` or
  no frame directive, `frame-src` is appended.
- **Meta**: a document first loaded on another route (`/`, `/profile/*`) has
  no header when the user navigates client-side into a chat.
  `ensureArtifactFramePolicy()` inserts
  `<meta http-equiv="Content-Security-Policy" class="js-artifact-frame-policy">`
  into `document.head` before the first artifact iframe, once per document.
  Script-inserted meta CSP is enforced by Chromium and WebKit, adds to (never
  relaxes) any header policy and lasts for the document.

`'self'` is in both (Nuxt DevTools and any same-origin frame), and Turnstile
is allowed because the policy stays with the document across client-side
navigation (shared chat → Sign in). Any other third-party iframe on that
document is blocked until the next full load. The origin is normalised with
`new URL().origin` and must be http or https; otherwise neither is sent.

Verified on 2026-11-08 with Playwright Chromium and WebKit on a route-mocked
page: after the script inserted the meta, a frame to a non-allowed host fired
a `frame-src` violation and sent no request, while the allowed host loaded.
Not verified in Safari itself.

## Standalone export

Exports reference no third-party host and include no runtime library:

- HTML: Download source is the HTML itself, with
  `<meta name="ai-generated" content="true">` and an "AI-generated by
  Besidka" comment (AI Act Art. 50(2)).
- Markdown: Download source (`.md` with a comment line) and Download as HTML
  (escaped, readable source in a self-contained page).
- SVG: source with a comment line.
- React (`.jsx`) and Mermaid (`.mmd`): source only, unmarked (source code).
  Running them would need React, Babel or Mermaid from a CDN, which the
  export must not load.

Every exported HTML document (Download source for HTML, Download as HTML)
gets a policy meta right after `<head>` (a `<head>` is created when the
document has none):

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data: blob:
```

so an exported file opened from disk cannot load or send anything to any
host. File names drop `\p{Cf}` format characters (bidi overrides such as
U+202E, zero-width characters) as well as control characters and the
characters that are unsafe on common file systems.

## Diagram SVG sanitising

Mermaid diagrams render through `MermaidDiagram.vue` and
`MermaidViewer.client.vue` with `v-html`. Their source can come from a model,
an artifact (`openDiagramViewer`) or a shared chat, so the rendered SVG goes
through `sanitizeDiagramSvg()` (`app/utils/sanitize-diagram-svg.ts`, DOMPurify
pinned at 3.4.17) first: SVG and SVG filter profiles, `foreignObject` and
`script` forbidden, `role` kept. Pele renders labels as SVG `<text>` and no
`<style>`, so nothing visible is removed. Checked on 2026-11-08 in Playwright
Chromium on real Pele output (flowchart, sequence, pie): same elements, same
attributes and same text before and after. The unit tests mock DOMPurify,
because happy-dom parses `<svg>` in the HTML namespace and DOMPurify then
drops the root element, which no browser does.

## Known open items

- The report rate limiter reads the KV counter and then writes it, so
  concurrent reports from one client can pass the limit by a few before KV
  catches up (no atomic increment in KV).
- MCP `get_chat` builds its context summary without the artifacts map, so its
  outputs count omits artifacts.

## Tests

- `tests/unit/components/Chat/Artifact/*.spec.ts`
- `tests/unit/composables/artifacts.spec.ts`
- `tests/unit/utils/artifact-export.spec.ts`,
  `tests/unit/utils/artifact-parts.spec.ts`,
  `tests/unit/utils/artifact-frame-policy.spec.ts`,
  `tests/unit/utils/sanitize-diagram-svg.spec.ts`
- `tests/integration/api/shared-artifacts.spec.ts`,
  `tests/integration/server/artifacts-frame-src-plugin.spec.ts`
- `tests/e2e/chat/artifacts-panel.spec.ts` (runs the artifacts runtime on
  port 8788 next to the app, see `playwright.config.ts`); one case renders an
  HTML artifact with a TS block and a Mermaid block in the real runtime and
  opens the diagram in the chat viewer
