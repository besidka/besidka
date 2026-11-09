# Side panel (`UiSidePanel`)

One shared surface for every "view a result" screen: the chat context panel
(P0-13), artifacts (A-4, `docs/artifacts/panel.md`), and later document
previews, research reports, connector approvals, MCP Apps and the browser
agent. Build new detail views on it
instead of adding another drawer. Owner decisions: right side on desktop, the
nav pill docks on the seam, the pill keeps its 5 slots.

## Files

| File | Role |
| --- | --- |
| `app/composables/side-panel.ts` | `useSidePanel()` state (view stack, full width, width), `useSidePanelLayout()`, width helpers and constants |
| `app/components/ui/SidePanel.client.vue` | The panel, mounted once in `app/app.vue` before `<Sidebar>` |
| `app/components/ui/SidePanel/Header.vue` | Title row: Back, title, view actions, width preset, Expand/Collapse, Close |
| `app/components/ui/SidePanelSkeleton.vue` | Loading lines for views (`skeleton skeleton--default`) |
| `app/components/ui/SidePanelDemoCard.vue` | Demo card behind the `ui.side-panel-demo` hook point |
| `app/utils/scroll-anchor.ts` | Keeps the reader's place when the chat column changes width |

## Opening a view

```ts
const { open, push, back, close, toggle } = useSidePanel()

open({
  viewKey: 'artifact:abc',
  title: 'Landing page',
  mode: 'detail',
  component: ArtifactView,
  toolbar: ArtifactVersionSwitcher,
  headerActions: ArtifactActions,
  props: { artifactId: 'abc' },
})
```

- `open()` replaces the stack, `push()` adds a view on top (Context, then a
  detail view; the header shows Back), `back()` pops (and closes on the last
  view), `toggle()` closes when the same `viewKey` is already shown.
- `component`, `toolbar` and `headerActions` all receive `props`. Components
  are stored with `markRaw`.
- The panel closes on route path change, except the `/chats/new` to
  `/chats/<slug>` hand-off on first send. Opening is always explicit (a
  click), except the first artifact of a streaming generation: it opens once
  per chat and tab, docked layout only (`useArtifactAutoOpen()`, see
  `docs/artifacts/panel.md`).
- The artifact detail view (`Chat/Artifact/Detail.client.vue`) opens with
  `open()` from a message card and with `push()` from a Context row, so Back
  returns to Context. Its target lives in `useState`
  (`useArtifactPanel()`), not in the view props, so a streamed artifact that
  becomes a stored version keeps the same view and iframe.
- During the slide-out the panel keeps rendering the last view (a snapshot
  cleared on `after-leave`), so the title and body do not blank mid-animation.
- Open views only from client code (clicks, hooks). `useState` holds the
  components, which must never be serialized into the SSR payload.
- Views own their states: show `UiSidePanelSkeleton` while loading, and an
  inline `alert alert-error alert-soft` with a Retry button on failure (the
  page-banner `UiAlert` is not meant for panel content). Empty states are one
  short sentence.

## Layouts

`useSidePanelLayout()` picks the layout from two media queries. Crossing a
breakpoint keeps the panel open in the new layout.

| Width | Layout | Behaviour |
| --- | --- | --- |
| ≥ 1128px | `docked` | Fixed `aside` on the right, full height. The chat column narrows, the composer re-centres, the nav pill docks on the seam. Not modal |
| 48rem to 1128px | `overlay` | Over the chat with a `bg-black/40` scrim; scrim click or Esc closes; focus trapped; above the pill (`z-[60]`). Width `70vw` below lg (64rem); from lg up the saved panel width, at most `70vw`. `--side-panel-width` stays `0px`, so the chat is not narrowed under the scrim |
| < 48rem | `sheet` | `<dialog class="modal modal-bottom">`, full screen (`100dvh`, safe areas), tools-sheet chrome (grab handle, title, close) |

The docking threshold is `SIDE_PANEL_DOCK_MIN_VIEWPORT` = the minimum panel
width (360px) plus the minimum chat width (`SIDE_PANEL_MIN_CHAT_WIDTH`, 768px,
md, where the chat chrome switches to its desktop layout: tools popover
instead of the sheet, model picker dropdown). It is the same rule as "dock
only when the viewport minus the clamped panel width is at least 768px":
`getSidePanelMaxWidth()` never goes below 360px, so below 1128px the chat
would be narrower than 768px whatever width is saved, and from 1128px the
clamp always leaves 768px. A unit test checks the equivalence over a grid of
viewports and saved widths. The first artifact of a streaming generation
(`useArtifactAutoOpen()`, docked only) therefore opens panels from 1128px.

### Docked: the width contract

While docked and open, the panel writes `--side-panel-width: <px>` on
`<html>` (`0px` otherwise). Everything that must follow the chat column reads
it, so with the panel closed every value resolves to what it was before:

- `.side-panel-inset` on the app shell (`app/app.vue`, the outer
  `flex flex-col h-svh` div) sets `margin-right`. It is not on
  `.js-page-content`, because the chat route renders that wrapper as
  `display: contents`, which has no box to give a margin.
- `max-w-chat-column` (a `@utility` in `main.css`) is
  `calc(100vw - var(--side-panel-width, 0px))`. Chat rows use
  `w-screen sm:w-4xl sm:max-w-chat-column`; `sm:max-w-screen` would overflow
  the narrowed column.
- The composer (`ChatInput.client.vue`) centres at
  `left: calc((100vw - var(--side-panel-width, 0px)) / 2)` with
  `max-w-chat-column`. Its inline transition list adds `left` and
  `max-width` only while the panel is open (and 600ms after it closes),
  so a plain window resize does not lag.
- Toasts (`ui/Messages.vue`) sit at
  `right: calc(var(--side-panel-width, 0px) + 2rem)` on `z-[70]`, so panel
  actions can report success or failure above the panel and the scrim.
- The nav pill (`Sidebar.client.vue`) moves to
  `right: calc(var(--side-panel-width) - <half its measured width>)`, gets a
  `ring-base-300` ring and drops `sidebar-hoverable`, so the divider never
  hides itself.
- `.side-panel-follow` marks fixed elements that track the seam. During a
  drag `<html>` has `side-panel-resizing`, which turns their transitions off.

Width: default 480px, clamped to 360px … `min(60% of the viewport, viewport −
768px)` so the chat column keeps at least 768px (the maximum is 672px at 1440
and 512px at 1280). The one clamp serves the seam drag, the keyboard
Home/End keys and the header width button. The clamp is applied when the
width is rendered and when a visible width is chosen; the stored preference
is bounded only by 360px and 2400px, so a width chosen on a wide screen
survives a visit on a narrow one. A key press or preset click that changes
nothing visible does not write storage. The panel body and header get
`pl-10` while docked, because the pill covers about 28px of the seam.

Full width (Expand): the panel covers the viewport from the left edge to the
pill gutter (`left-0 pr-20`), the pill returns to its normal place, focus is
trapped. `--side-panel-width` keeps the docked value, so the chat behind does
not reflow.

### Why not container queries

Chat, `ChatInput` and the prose components use about 96 `sm:`/`md:`/`lg:`
variants that follow the viewport, not the column. Letting them follow the
column with `container-type: inline-size` was rejected (BES-330) for two
reasons:

- Inline-size containment applies layout containment, which makes the
  container the containing block for `position: fixed` descendants. The fixed
  composer and other fixed elements in the column would move.
- Chat, `ChatInput` and the prose components are reused on `/shared/<id>`
  and the landing. Every reuse site would need a container ancestor, or its
  responsive styles would silently stop working.

Revisit only with a narrowly scoped container query on the message list,
never wrapping the fixed composer, and measure first. Until then the overlay
threshold above is the fix: the chat never renders its desktop layout in a
mobile-width column.

### No scroll jump

Changing the chat column width reflows the text. Before the variable changes,
`captureScrollAnchor()` records the first `[data-message-id]` element visible
at the top of the chat scroller (or the first child of `.js-page-content` on
other pages) and its offset. `holdScrollAnchor()` then restores that offset on
every animation frame for the 300ms width transition, so the reader's line
stays put. With reduced motion, and during a drag, it restores once on the
next frame.

## Resizing (WCAG 2.2)

- Drag: the 12px seam (`role="separator"`, `aria-orientation="vertical"`,
  `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-controls`) uses
  pointer capture; moves are coalesced to one width update per animation
  frame. The width is saved on `pointerup` only if it changed, and a drag
  ends cleanly on `pointercancel`, `lostpointercapture`, window blur or a
  breakpoint change.
- Keyboard: focus the seam, then ←/→ change the width by 24px, Home/End jump
  to the minimum/maximum.
- Single pointer without dragging (SC 2.5.7): the header width button
  (`lucide:move-horizontal`) cycles 360 → 480 → 640px, clamped to the
  viewport (360 → 480 → 512 at 1280). Keyboard arrows alone would not satisfy 2.5.7.

The width is stored with `usePreferenceStorage()` under
`besidka:side-panel-width`, a **Preferences** key: it is registered in the
cookie consent module (`nuxt.config.ts`), listed in the Cookie Policy, and
dropped when Preferences are denied (the panel then uses the default width for
the session). Saving a width calls `requestPersistence()`, like the file
manager view toggle.

## Focus and Esc

| State | Focus on open | Trap | Esc |
| --- | --- | --- | --- |
| Docked | Panel (`tabindex="-1"`) | No | Closes, only while focus is inside the panel (Esc in the composer or a picker popover belongs to them) |
| Docked full width | Panel | Yes | First Esc collapses, second closes |
| Overlay (below 1128px) | Panel | Yes | Closes |
| Sheet | `modal-box`, explicitly after `showModal()` (iOS ignores `autofocus`, and focusing a field would open the keyboard) | Native dialog | Native `cancel`, handled as close |

Esc is ignored while another `<dialog>` is open (for example the share modal
opened from a panel view) and during IME composition. While the focus is
trapped, the app shell (`.side-panel-inset`) is `inert`, so screen-reader
browse mode cannot leave the panel either. The trap skips hidden elements
(`checkVisibility()`). On close, focus returns to the element that had it
when the panel opened, but only if focus was inside the panel or lost; focus
the user moved elsewhere stays there. Leaving the docked layout while
expanded resets full width. The sheet `<dialog>` also listens to `close`, so a
native close (Android back) clears the state.

## Mobile sheet

- Swipe down from the grab handle or the header to close: 80px, or a fast
  flick (≥ 0.5 px/ms). Only the handle/header start a swipe, so scrolling the
  body never closes the sheet. Buttons inside the header do not start a swipe.
- The sheet is in the top layer, so the mobile bottom bar is covered while it
  is open.
- The on-screen keyboard follows the global modal rules in `main.css`
  (`--keyboard-inset`, `--visible-height`; see `docs/chats/ios-keyboard.md`);
  the body uses `sheet-safe-padding`.
- Body edges fade with `useScrollEdgeFade`.

## Demo card and flag

`UiSidePanelDemoCard` renders at the top of `app/pages/chats/[slug].vue` when
`isSidePanelDemoEnabled(route.query)` is true. Until P0-4's `useFeature()`
lands this is a typed hook point: local dev or e2e builds only, and only with
`?side-panel-demo` in the URL. After P0-4 it becomes
`useFeature('ui.side-panel-demo').enabled` (stage `internal`). The card stays
as a regression fixture.

## Tests

- `tests/unit/composables/side-panel.spec.ts`
- `tests/unit/components/ui/SidePanel.spec.ts`
- `tests/unit/components/Sidebar.spec.ts` (pill docking)
- `tests/e2e/side-panel.spec.ts`

All are in the `sidePanelTests` group in `scripts/test-affected-check.mjs`.
