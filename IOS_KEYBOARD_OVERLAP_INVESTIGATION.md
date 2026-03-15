# iOS Keyboard Overlap Investigation

## Summary

This document tracks the intermittent iOS keyboard overlap issue reported on:

- iPhone 12 Pro Max, iOS 26
- iPhone 14 Pro Max, iOS 26
- Safari iPhone 14 Pro Max simulator, iOS 26

Observed behavior:

- focusing inputs or textareas sometimes opens the keyboard without moving the
  relevant UI above it
- the content becomes visible only after manual scrolling
- the issue affects both the chat composer and teleported modal dialogs
- on real-device video capture, the chat composer can jump upward during
  keyboard animation before settling back down
- during rename modal flow, the global sidebar can move above the keyboard
  while the modal remains below it
- when the keyboard is visible with a bottom-sheet modal, page content can
  remain visibly exposed below the modal, which looks like a transparent gap
- when manually scrolling with keyboard and modal open, the modal can jump
  repeatedly as the page scrolls
- iOS 26 transparent native toolbar behavior appears to be expected platform
  behavior and should not be treated as the primary bug by itself
- chat input on `app/pages/chats/new.vue` still gets overlapped by the keyboard
  even after modal improvements

## Affected areas

- `app/components/ChatInput.client.vue`
- `app/pages/chats/new.vue`
- `app/components/History/RenameModal.vue`
- `app/components/History/ProjectNameModal.vue`
- `app/components/ChatInput/Files/Modal/Select/RenameModal.vue`

## Repo evidence

- root document is hard-locked with `html { position: fixed }`
- `body` also uses `overflow-hidden` and `h-screen`
- app root uses `h-svh overflow-hidden`
- chat composer and mobile sidebar are bottom overlays
- keyboard state was inferred from `focus` and `blur`, not viewport geometry
- affected dialogs use teleported native `<dialog>` nodes with mobile
  `modal-bottom` placement

## Platform evidence

- MDN VisualViewport:
  https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- MDN viewport meta / `interactive-widget`:
  https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport
- WebKit fixed-position keyboard issue:
  https://bugs.webkit.org/show_bug.cgi?id=132537
- WebKit iOS 11 fixed-parent input issue:
  https://bugs.webkit.org/show_bug.cgi?id=176896
- WebKit iOS 26 fixed-position parent regression:
  https://bugs.webkit.org/show_bug.cgi?id=300690
- WebKit duplicate target for iOS 26 report:
  https://bugs.webkit.org/show_bug.cgi?id=300952
- WebKit installed web-app viewport restoration bug:
  https://bugs.webkit.org/show_bug.cgi?id=254861
- WebKit report mentioning overlap in fixed-position layouts:
  https://bugs.webkit.org/show_bug.cgi?id=258828

## Working hypothesis

The issue is likely multi-causal. The strongest current theory is:

1. the root document lock prevents Safari from reliably reflowing or scrolling
   the focused control into the visible viewport
2. teleported dialogs and bottom overlays amplify the issue because they rely
   on browser viewport behavior during keyboard animation
3. missing `visualViewport` instrumentation means the app had no recovery path
   when Safari failed to reposition the focused element

## New real-device findings after first implementation pass

### Chat composer animation regression

Observed on real iPhone recording:

1. initial state is correct
2. tapping the chat textarea causes the composer to jump to the middle area of
   the screen
3. then the composer jumps back down and gets overlapped by the incoming
   keyboard
4. only after that does the final state settle

Impact:

- this degrades UX even when the end state becomes usable
- the transition itself is visibly broken

Most likely cause:

- the composer currently mixes two independent positioning systems
- it still uses keyboard-state `translate-y` classes
- it also now receives a live `bottom: keyboardHeight` offset from
  `visualViewport`
- on iOS keyboard animation, those two systems fight each other frame by frame

Conclusion:

- raw keyboard height should not be applied directly to `bottom` on a fixed
  overlay that is already animated with transforms
- one overlay should have one positioning source of truth

### Rename modal with sidebar above keyboard

Observed on real iPhone:

1. rename modal is triggered
2. keyboard appears
3. sidebar moves above the keyboard
4. modal content stays below it and is not visible
5. manual scrolling reveals the modal correctly

Impact:

- the modal flow is visually broken
- the global navigation competes with the active modal

Most likely cause:

- sidebar is global and keyboard-aware
- it reacts to keyboard opening even when a `dialog[open]` exists
- the modal helper only corrects input visibility inside `.modal-box`
- it does not yet reserve or control the whole modal container during keyboard
  animation

Conclusion:

- sidebar must be hidden or frozen when any modal dialog is open
- modal handling must include container-level keyboard policy, not only
  post-focus input correction

### Bottom-sheet gap above keyboard

Observed on real iPhone after the previous fixes:

1. the modal and keyboard are both visible
2. the modal is positioned correctly enough to use
3. but the area between the bottom sheet and the keyboard still exposes page
   content underneath
4. because the app background is translucent, this looks like a visual kludge

Impact:

- even when the modal is functionally usable, the bottom-sheet presentation
  looks broken
- the modal does not visually “own” the lower part of the screen while the
  keyboard is open

Most likely cause:

- keyboard inset is currently applied to the `<dialog>` element itself
- there is no dedicated sheet filler or modal-colored extension covering the
  keyboard-adjacent zone
- with `modal-bottom`, this leaves visible content in the exposed area

Conclusion:

- keyboard inset should be applied to a dedicated bottom-sheet wrapper or
  filler zone
- the exposed area should use modal background, not page content
- the goal is not to fight iOS transparent toolbar rendering itself
- the goal is to ensure that, at the bottom-most visual position, the app does
  not expose live page content in the keyboard-adjacent area
- a valid implementation candidate is:
  - negative bottom offset for the sheet container
  - compensating internal bottom padding or filler height
  - modal-colored surface covering the keyboard-adjacent zone

### Modal jump on manual scroll

Observed on real iPhone after the previous fixes:

1. modal is open
2. keyboard is visible
3. user manually scrolls
4. modal visibly repositions again and again while scrolling

Impact:

- very unstable and distracting UX
- gives the impression that the modal is fighting the user gesture

Most likely cause:

- `visualViewport.scroll` is still being listened to globally
- those events keep recomputing keyboard metrics while the modal is open
- modal inset is tied directly to those changing metrics

Conclusion:

- modal inset should be snapshotted after focus and viewport settle
- modal container geometry should not be recomputed on every
  `visualViewport.scroll` while the dialog is open
- geometry fix alone is not enough if inset stays live; the freeze step must
  come with it

### Chat input still overlaps on `/chats/new`

Observed after modal fixes:

1. modal flows improved
2. chat composer still fails on `app/pages/chats/new.vue`
3. keyboard can still overlap the composer there

Impact:

- modal-specific improvements are not enough to fix the chat page experience
- this strongly suggests the chat overlay/layout path has a separate root cause

Most likely cause:

- `/chats/new` renders `ChatInput` over a simpler page structure than
  `/chats/[slug]`
- the page still relies on a fixed overlay inside a root shell that is
  document-locked
- there is no dedicated scroll-shell separation for the new-chat page
- this points more strongly to the chat-shell/root-layout refactor path than to
  more modal-style tweaks

Conclusion:

- modal fixes and chat input fixes should now be treated as two related but
  separate tracks
- next chat-input work should focus on the shared chat-page layout used by both
  `app/pages/chats/new.vue` and `app/pages/chats/[slug].vue`
- `/chats/new` is currently the clearest failing case, but the plan must treat
  both chat pages together because they rely on the same overlay model and app
  shell
- do not optimize only one page variant and assume the other is solved

## Confirmed implementation constraint

During real-device testing, an important iOS behavior was confirmed:

- delaying the initial `focus()` call across an async boundary before the
  keyboard opens can break the trusted user-gesture chain
- the field may appear focused without Safari opening the keyboard
- a second manual tap is then required to summon the keyboard

This means the fix strategy must follow this order:

1. `showModal()`
2. `nextTick()`
3. immediate `focus()`
4. optional `select()`
5. only after that, wait for `visualViewport` changes and correct visibility

Additional implementation rule from the new device test:

- do not feed raw, frame-by-frame `keyboardHeight` directly into `bottom` on
  fixed overlays that already use transform-based motion
- stabilize keyboard data before consuming it, or keep overlay movement on a
  single transform path
- when a bottom-sheet modal is open, freeze modal inset after settle instead of
  consuming live `visualViewport.scroll` updates
- do not treat iOS transparent toolbar glass as the main bug; focus on correct
  bottom-most layout ownership and avoiding live content exposure there

## Test matrix

- iPhone 12 Pro Max, Safari
- iPhone 12 Pro Max, installed PWA
- iPhone 14 Pro Max, Safari
- iPhone 14 Pro Max, installed PWA
- iPhone 14 Pro Max simulator, Safari

Scenarios:

- `/chats/new` composer on fresh load
- `/chats/[slug]` composer when already scrolled
- rename chat modal
- create project modal
- rename project modal
- rename file modal

Each scenario should be repeated 10 times because the bug is intermittent.

## Success criteria

- no focused input requires manual scrolling to become visible
- no modal action buttons are hidden behind the keyboard
- chat messages remain readable behind the translucent composer
- chat peek mode still works
- mobile sidebar still hides when the composer expands
- chat composer does not visibly jump during keyboard animation
- sidebar never renders above a keyboard-driven modal workflow
- bottom-sheet modals fully cover the keyboard-adjacent area with modal
  background
- bottom-sheet modals do not visibly jump while the user scrolls with keyboard
  open
- `/chats/new` chat input must no longer be overlapped by the keyboard

## Experiment log

| Stage | Change | Device / Mode | Result | Notes |
| --- | --- | --- | --- | --- |
| 0 | Investigation doc created | Pending | Pending | Initial hypothesis and sources recorded |
| 1 | `visualViewport` observer + debug overlay | Real device | Partial success | Instrumentation useful for diagnosis |
| 2 | Keyboard-aware dialog flow for small edit modals | Real device | Partial success | Initial delayed focus was wrong on iOS and had to be reverted |
| 3 | Chat composer and sidebar use shared keyboard metrics | Real device | Failed | Caused composer jump and sidebar-over-modal bug |
| 3b | Sidebar suppression + dialog inset | Real device | Partial success | Fixed prior regressions, but revealed bottom-sheet gap and modal jump on scroll |
| 3c | Frozen modal inset + sheet filler geometry | Real device | Failed | Regressed sheet width and keyboard overlap; wrapper-based approach reverted |
| 4 | Root shell refactor if needed | Likely next for chat input | Pending | `/chats/new` still failing points toward shell/layout path |
| 5 | Viewport meta experiments if needed | Pending | Pending | |

## Updated direction

The overall strategy is still correct:

- keep `visualViewport` instrumentation
- keep post-focus correction
- keep the root-shell refactor as a fallback if narrow fixes fail

But the current overlay implementation direction was wrong:

- do not combine transform-based overlay motion with live `bottom:
  keyboardHeight`
- treat modal workflows as top-priority UI; global sidebar should not respond to
  keyboard events while a dialog is open
- modal keyboard handling must include container-level behavior, not only input
  visibility correction
- bottom-sheet modal geometry needs a dedicated filler/background strategy
- modal inset should be frozen after settle, not driven by live viewport scroll
- chat composer overlap on `/chats/new` now points more strongly to the root
  shell/layout path than to modal logic
- the next chat-layout step must explicitly cover both `app/pages/chats/new.vue`
  and `app/pages/chats/[slug].vue`

## Next implementation step

1. modal track:
   stabilize bottom-sheet geometry with a dedicated filler zone or negative
   bottom offset plus compensating filler, together with frozen post-settle
   inset
2. modal track:
   do not recompute modal container geometry on every `visualViewport.scroll`
3. chat track:
   investigate the shared chat-page layout for both `app/pages/chats/new.vue`
   and `app/pages/chats/[slug].vue`
4. chat track:
   prioritize the root-shell or overlay-layer refactor if either chat page
   still overlaps after the current overlay fixes
5. re-test both tracks independently on real device
