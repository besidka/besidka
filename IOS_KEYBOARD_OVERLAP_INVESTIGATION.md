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

## Affected areas

- `app/components/ChatInput.client.vue`
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

## Experiment log

| Stage | Change | Device / Mode | Result | Notes |
| --- | --- | --- | --- | --- |
| 0 | Investigation doc created | Pending | Pending | Initial hypothesis and sources recorded |
| 1 | `visualViewport` observer + debug overlay | Pending | Pending | |
| 2 | Keyboard-aware dialog flow for small edit modals | Pending | Pending | |
| 3 | Chat composer and sidebar use shared keyboard metrics | Pending | Pending | |
| 4 | Root shell refactor if needed | Pending | Pending | |
| 5 | Viewport meta experiments if needed | Pending | Pending | |
