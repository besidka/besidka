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
open. A card keyed by the tool call id keeps the same panel view (and the
same iframe) when the streamed artifact becomes a stored version: the view
reads its target from `useState`, not from panel props.

## Panel and Frame

`useArtifactPanel().open(target)` opens `LazyChatArtifactDetail` in
`detail` mode. From the Context panel the row pushes the view
(`open(target, { push: true })`), so Back returns to Context.

The detail view:

- Preview tab: the Frame. During a stream only `html`, `svg` and `markdown`
  get partial previews; `react` and `mermaid` wait for the stored version.
- Code tab: `ProsePreStream` with `source-only` (a mermaid fence stays code,
  no diagram) and `always-expanded` (no 3-line collapse).
- Version select: the owner sees every stored version
  (`GET /api/v1/artifacts/<id>`); a shared viewer sees only versions the
  shared chat references.
- Actions menu: Copy code, Download source, Download as HTML (Markdown only),
  Full width.
- Runtime errors: the last of up to 5 `notifications/message` errors from the
  runtime, with the stack under Details. The owner gets **Ask to fix**, which
  closes the panel outside the docked layout and fires
  `chat-input:prefill` with `Fix the error in "<title>": <message>`.

`Frame.client.vue` is the host:

- Creates the iframe itself (`sandbox="allow-scripts"`,
  `referrerpolicy="no-referrer"`, empty `allow`) pointing at
  `<artifactsOrigin>/v1/index.html`, after `ensureArtifactFramePolicy()`.
- `createHostConnection()` answers the handshake with `HostContext`: theme
  from the colour mode, `displayMode` `fullscreen` in the sheet or docked
  full width and `panel` otherwise, the browser locale, and
  `capabilities: { storage: 'memory', complete: false }`.
  The Frame passes no storage or completion handler, so `besidka/storage/*`
  and `besidka/complete` answer `-32601`: the runtime keeps storage in its
  own memory for the life of the frame and `complete()` is unavailable
  (persistent storage and completions come in later layers, see
  `docs/artifacts-runtime.md`).
- Sends `ui/notifications/tool-input-partial` at most every 250ms while
  streaming and `ui/notifications/tool-result` for a stored version, on the
  same iframe (no reload per version). Theme and display mode changes go out
  as `ui/notifications/host-context-changed`.
- `ui/open-link`: a `useConfirm` dialog, then `window.open` with
  `noopener,noreferrer`.
- A second load of the frame (the artifact navigated itself) removes the
  frame, shows "The preview was stopped" and logs
  `attributes.artifacts.runtimeNavigation` with ids only.
- No `initialized` within 10 seconds: "The preview did not load" with Retry,
  which mounts a fresh frame.

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
| Runtime storage | In-memory only | In-memory only |

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

## Report

`POST /api/v1/shared/<shareSlug>/artifacts/<artifactId>/report` with
`{ reason, details, reporterName?, reporterEmail? }` (name and email are
required unless the reason is `csam`). It stores an `artifact_reports` row
with `priority: 'urgent'` for the urgent reasons. Limit: 5 reports per hour
per signed-in user, otherwise per client IP (IPv6 by /64), in KV; 429 with
`Retry-After`. Without a user or an IP the limiter fails open and notes it on
the logger.

## Auto-open marker

The first artifact of a streaming generation opens next to the chat once per
chat and tab (`useArtifactAutoOpen`): owner chat, `artifacts` active, docked
layout (`min-width: 64rem`), nothing else open in the panel. The marker is
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
  loaded at `/chats/**` and `/shared/**` (an existing policy is extended).
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

## Known open items

- The report route stores `shareId: null`; the chat share the report came
  from is only in the log (`attributes.artifacts.chatShareId`).
- MCP `get_chat` builds its context summary without the artifacts map, so its
  outputs count omits artifacts.

## Tests

- `tests/unit/components/Chat/Artifact/*.spec.ts`
- `tests/unit/composables/artifacts.spec.ts`
- `tests/unit/utils/artifact-export.spec.ts`,
  `tests/unit/utils/artifact-parts.spec.ts`,
  `tests/unit/utils/artifact-frame-policy.spec.ts`
- `tests/integration/api/shared-artifacts.spec.ts`,
  `tests/integration/server/artifacts-frame-src-plugin.spec.ts`
- `tests/e2e/chat/artifacts-panel.spec.ts` (runs the artifacts runtime on
  port 8788 next to the app, see `playwright.config.ts`)
