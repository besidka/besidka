# iOS Keyboard Overlap Full Plan

## Summary

The likely first fixes are instrumentation, dialog handling, and
keyboard-aware overlay offsets. If those fail and the root document lock is
the cause, the fallback is not to remove the overlay model. The fallback is to
move from a document-locked or fixed-root architecture to a viewport-sized
shell with internal overlay layers, so chat input translucency, peek state,
sidebar hiding, and chat spacer behavior all remain intact.

## Current evidence

- root document is hard-locked:
  - `app/assets/css/main.css`
  - `app/app.vue`
- chat page already uses an internal scroll container with overlays outside it:
  - `app/pages/chats/[slug].vue`
- chat spacer depends on input height and scroll-container geometry:
  - `app/composables/chat-scroll-spacer.ts`
- sidebar is another mobile bottom overlay:
  - `app/components/Sidebar.client.vue`
- keyboard handling was boolean and focus-driven:
  - `app/components/ChatInput.client.vue`

## Stage 0: Document before code

- Create `IOS_KEYBOARD_OVERLAP_INVESTIGATION.md`
- Record repo evidence, platform evidence, test matrix, and one experiment log
  row per stage
- Update this file after every stage before moving on

## Stage 1: Instrument first

- Add:
  - `app/composables/device-keyboard.ts`
  - `app/components/DeviceKeyboardObserver.client.vue`
  - `app/components/DeviceKeyboardDebug.client.vue`
- Track `visualViewport` metrics, active editable rect, and computed
  `keyboardHeight`
- Publish CSS vars:
  - `--visual-viewport-height`
  - `--visual-viewport-offset-top`
  - `--layout-viewport-height`
  - `--keyboard-height`
- Add internal hook `device-keyboard:viewport-changed`
- Debug overlay is enabled by `?keyboard-debug=1`

## Stage 2: Fix edit dialogs first

- Add `app/composables/keyboard-aware-dialog.ts`
- Apply it to:
  - `app/components/History/RenameModal.vue`
  - `app/components/History/ProjectNameModal.vue`
  - `app/components/ChatInput/Files/Modal/Select/RenameModal.vue`
- Small edit dialogs should keep their existing bottom-sheet UX on mobile if
  the helper is sufficient
- `modal-box` should use `--visual-viewport-height` as a mobile max-height and
  remain scrollable
- Focus should happen only after:
  - `showModal()`
  - `nextTick()`
  - viewport settle
- After focus, ensure the editable control is visible inside the visual
  viewport

## Stage 3: Fix fixed bottom overlays without changing the root shell

- Migrate `app/components/ChatInput.client.vue` and
  `app/components/Sidebar.client.vue` to the shared keyboard metrics
- Replace boolean keyboard assumptions with real bottom avoidance based on
  `keyboardHeight`
- Move chat auto-scroll to happen after viewport settle, not immediate focus
- If instrumentation shows clipping inside the large file manager modal, apply
  the same helper there too

## Stage 4: If the root shell is the cause, refactor the layout without losing the overlay UX

- This stage is only entered if Stages 1 to 3 still reproduce on real iPhones
- The goal is not to remove overlays
- The goal is to remove document-level locking and rebuild the app around a
  viewport-sized shell

### Stage 4A: Replace the document lock with a viewport shell

- Remove `html { position: fixed }` from `app/assets/css/main.css`
- Remove `body` height locking that depends on `h-screen` as the root sizing
  mechanism
- Change the app root in `app/app.vue` to a shell with:
  - `position: relative`
  - `display: flex`
  - `flex-direction: column`
  - `min-height: 100svh`
  - `height: var(--visual-viewport-height, 100svh)`
  - `overflow: clip`
- Keep the route area as `flex-1 min-h-0`
- Result: the shell follows the real viewport, but the document itself is no
  longer a fixed viewport trap

### Stage 4B: Convert viewport-fixed overlays into shell overlays

- Do not make the chat input part of normal flow
- On mobile, convert the chat input root from viewport `fixed` to shell
  `absolute` inside the chat page shell
- Keep desktop behavior unchanged unless testing shows the same issue there
- Do the same for the mobile sidebar: anchor it to the app shell, not the
  document viewport
- This preserves the visual model:
  - messages still scroll behind translucent UI
  - input can still peek at 1/3 height
  - sidebar can still hide when the input is expanded

### Stage 4C: Introduce an explicit overlay layer instead of relying on document fixed positioning

- Add a dedicated chat-page shell component:
  - `app/components/Chat/PageShell.vue`
- Structure:
  - `chat-shell`: relative, flex-1, min-h-0
  - `chat-scroll-layer`: overflow-y-auto, fills shell
  - `chat-overlay-layer`: absolute inset-x-0 bottom-0 pointer-events-none
  - chat input inside overlay layer with `pointer-events-auto`
- `app/pages/chats/new.vue` and `app/pages/chats/[slug].vue` should render
  through this shell

### Stage 4D: Preserve translucent overlap by using explicit clearance, not normal-flow stacking

- The scroll layer must keep bottom padding based on visible overlay clearance,
  not total input height
- Add internal hook `chat-input:metrics-changed` with payload:
  - `fullHeight`
  - `visibleHeight`
  - `peekHeight`
  - `isPeekMode`
- `visibleHeight` is what the user can actually see when the input is
  partially hidden
- The chat scroll container bottom padding becomes:
  - `max(chat input visible height, sidebar visible height) + safe area`
- This preserves the effect where messages are visible under the translucent
  input while keeping the actually readable content out from under visible
  controls

### Stage 4E: Update chat spacer to use visible overlay metrics

- Refactor `app/composables/chat-scroll-spacer.ts` to consume `visibleHeight`,
  not just raw input height
- Keep current behavior goals:
  - newest user message pushed up for readability
  - assistant reply not hidden by the composer
  - long conversations still get correct bottom anchoring
- Treat peek mode as a smaller obstruction than fully expanded mode
- Keyboard height and overlay visible height must not reserve the same pixels
  twice

### Stage 4F: Preserve the current chat-input and sidebar interactions

- Keep `chat-input:visibility-changed` so the sidebar still hides when the
  composer is expanded
- Keep the current transition model, but apply it inside the shell overlay
  layer
- Do not tie peek mode to document scroll position
- Peek mode remains tied to the internal chat scroll container state

### Stage 4G: Rollout rule for the shell refactor

- Land Stage 4 in this order:
  1. add shell component and overlay metrics
  2. migrate `/chats/new`
  3. migrate `/chats/[slug]`
  4. migrate mobile sidebar anchoring
  5. remove now-obsolete root locking CSS
- Test after each sub-step on a real iPhone before moving to the next one

## Stage 5: Separate meta viewport experiment

- Only after the above, test `viewport-fit=cover` and optionally
  `interactive-widget=resizes-content` in `nuxt.config.ts` as isolated
  experiments
- Keep them only if the investigation doc shows measurable improvement on
  target iOS devices

## Internal interface changes

- New shared keyboard state in `app/composables/device-keyboard.ts`
- New hook `device-keyboard:viewport-changed`
- New hook `chat-input:metrics-changed`
- New shell component `app/components/Chat/PageShell.vue`
- No public API or server contract changes

## Test matrix and acceptance

- Devices:
  - iPhone 12 Pro Max Safari and installed PWA
  - iPhone 14 Pro Max Safari and installed PWA
  - iPhone 14 Pro Max simulator Safari
- Scenarios:
  - `/chats/new` composer
  - `/chats/[slug]` composer when scrolled and when at bottom
  - history rename
  - project create and rename
  - file rename
- Repeat each scenario 10 times
- Accept only if:
  - no manual scroll is needed to reveal the focused field
  - messages remain visible behind the translucent input
  - peek mode still works
  - sidebar still hides and shows with the composer as today
  - spacer behavior still keeps the last readable content visible
  - every stage result is recorded in `IOS_KEYBOARD_OVERLAP_INVESTIGATION.md`

## Assumptions and defaults

- If the root shell is the cause, preserve the overlay architecture and move it
  from document-fixed to shell-anchored overlays
- Chat spacer will be adapted, not removed
- The composer’s translucent overlap and 1/3 peek behavior are product
  requirements and must survive the refactor
