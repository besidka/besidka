# iOS keyboard and the chat composer

How the chat composer (`app/components/ChatInput.client.vue`) stays above
the on-screen keyboard, why it is done with the visual viewport, and what was
rejected.

## The bug

The composer is `position: fixed; bottom: 0`. Until 2026-11-05 its vertical
position came only from a focus/blur flag (`isKeyboardVisible`) and the iOS
safe area, through a matrix of `translate-y-*` classes. Nothing read the size
of the keyboard.

On iOS this works only by luck. When the textarea gains focus and the keyboard
opens at the same moment, iOS pans the visual viewport so the focused field is
visible, and the composer looks fine. When the keyboard appears after the
textarea already has focus, iOS does not pan, and the keyboard covers the
composer. On a phone that is the cold first keyboard open. Reproduced in the
iOS Simulator in Safari on 2026-11-05.

## Layout viewport and visual viewport

- The layout viewport is what `position: fixed` and `bottom: 0` are measured
  against. On iOS Safari the keyboard does not resize it: `innerHeight` stays
  the same while the keyboard is up.
- The visual viewport (`window.visualViewport`) is the part of the page the
  user actually sees. The keyboard shrinks its `height`, and when iOS pans to
  reveal a focused field, `offsetTop` grows by the pan.
- iOS pans only at focus time. A fixed element at the bottom of the layout
  viewport therefore ends up under the keyboard whenever the pan does not
  happen or is smaller than the keyboard.
- Android Chrome (`resizes-visual` by default since Chrome 108) behaves the
  same way, so the fix applies there too. A browser that resizes the layout
  viewport reports an inset of 0 and nothing changes.

## The fix (Layer 1)

`app/composables/visual-viewport-inset.ts` (`useVisualViewportInset`) measures
how much of the layout viewport the keyboard covers:

```
viewportPan = max(0, visualViewport.offsetTop - max(0, window.scrollY))
bottomInset = max(0, round(innerHeight - visualViewport.height - viewportPan))
```

`offsetTop` counts only the part that is a true visual-viewport pan. When iOS
scrolls the window while the keyboard opens, `offsetTop` equals
`window.scrollY` and fixed elements do not move with that scroll, so it is
subtracted. This app never scrolls the window itself (pages scroll inside
`.overflow-y-auto` containers, so `scrollY` is 0 with the keyboard closed), and
a scrolled window with an `offsetTop` of 0 never adds height. A negative
`scrollY` from rubber-band overscroll counts as 0. The expression lives in
`getCoveredHeight`.

- It is one shared instance (`createSharedComposable`) for every consumer:
  the composer, the scroll spacer, the dialog owner (`useKeyboardInsetRoot`)
  and, for the safe-area padding only, the model picker sheet and the text
  file editor sheet. The public API is `bottomInset`, `viewportHeight`,
  `isKeyboardOpen` and `update`.
- Readings are batched to one per animation frame. Listeners:
  `visualViewport` `resize` and `scroll`, `window` `resize`, and `document`
  `focusin` and `focusout`.
- After every resize or focus change it reads again at 50, 150, 300, 500 and
  800 ms. This catches a keyboard that finishes opening without another event,
  and the WebKit bug below where `offsetTop` is stale inside the handler.
- The inset is forced to 0 unless the active element is a text-entry element
  (a textarea, a text-like input, or contenteditable content, not read-only or
  disabled). This neutralises the iOS 26 drift where the visual viewport
  values stay off after the keyboard has closed.
- The inset is forced to 0 while the page is pinch-zoomed
  (`visualViewport.scale` above 1.01), because zooming in also shrinks the
  visual viewport.
- `isKeyboardOpen` is `bottomInset >= 120`, so a toolbar collapse or rounding
  never moves anything.

The composer applies the inset as an inline `bottom: <inset>px` while
`isKeyboardOpen` is true. It does not use the `translate-y-*` classes for
this: they animate over 500 ms and would lag behind the keyboard (`bottom`
has its own 250 ms transition, see "The send snap" below). While the
keyboard is open:

| State | Keyboard closed (unchanged) | Keyboard open |
| --- | --- | --- |
| Visible, safe area | `max-sm:translate-y-[var(--sab)]` | `max-sm:translate-y-0` + `bottom: <inset>px` |
| Visible, no safe area | `max-sm:translate-y-0` | `max-sm:translate-y-0` + `bottom: <inset>px` |
| Collapsed peek, safe area | `max-sm:translate-y-[calc(100%-var(--spacing)*18-var(--sab))]` | `max-sm:translate-y-[calc(100%-var(--spacing)*20)]` + `bottom` |
| Collapsed peek, no safe area | `max-sm:translate-y-[calc(100%-var(--spacing)*18)]` | same as above |
| Inner padding | `max-sm:pb-[calc(var(--spacing)*20+var(--sab))]` | `pb-0` |

The old keyboard branch pushed the composer down by `spacing * 4 + sab`; it
is gone. The inner padding reserves room for the mobile sidebar bar, which
sits at the bottom of the layout viewport and is behind the keyboard while it
is open, so the padding is dropped too. The peek keeps the 20-unit strip it
had with the keyboard before, without the safe-area term, because a composer
lifted onto the keyboard is no longer in the home-indicator zone.

The `device-keyboard:state-changed` hook still fires from focus and blur
(150 ms blur debounce), and focus still calls `chat:scroll-to-bottom` when the
composer is collapsed, so desktop behaviour and the sidebar
(`app/components/Sidebar.client.vue`) are unchanged.

### Message list

`app/composables/chat-scroll-spacer.ts` renders its spacer as the computed
spacer plus the keyboard inset while the keyboard is open, in every spacer
mode (fitted to the composer, or pinned by a push or `reservePinnedSpace`), so
the last message can scroll above the raised composer. When the inset grows,
the scroll container is scrolled by the growth so the same messages stay above
the composer and the collapse-on-scroll state does not flip. The input
clearance is `height - sab` while closed and `height` while open (the open
composer has no safe-area padding). In the fitted mode an inset change also
refits through the same debounced path as `chat-input:height`, and the
composer reports its height again when `isKeyboardOpen` flips, because the
padding change resizes it even while a draft is typed. With an inset of 0
nothing changes.

Known trade-offs to watch on a device:

- On a chat with nothing sent in this session (fitted mode), dismissing the
  keyboard refits the spacer and scrolls to the bottom, like any other
  composer height change with an empty draft.
- In pinned mode, if `chat:scroll-to-bottom` resets the spacer while the
  keyboard is open and the keyboard then closes, the spacer is up to
  `spacing * 20` short until the next refit.

## Two standalone states

Measured in the iOS 27 Simulator as a home-screen PWA (standalone), the same
page ends up in one of two states when the keyboard opens:

- **Layout viewport kept.** `innerHeight` keeps its full height, as in Safari.
  `visualViewport.height` shrinks, the inset is about 330 to 396 px, and
  everything pinned to the layout viewport must be lifted.
- **Layout viewport shrunk.** After a real tap on a field, iOS shrinks the
  layout viewport itself: `innerHeight` equals `visualViewport.height`. The
  formula gives 0 or less, which the `max(0, ...)` clamp turns into an inset
  of 0. Nothing is lifted, and `position: fixed; inset: 0` already fits the
  space above the keyboard.

The clamped formula handles both states without a mode switch, so everything
built on the inset must be a no-op at 0.

### Measured states

Measured in the iOS 27 Simulator on 2026-11-05. The covered height is the
inset a fixed element at the bottom of the layout viewport needs:

| State | `innerHeight` | `visualViewport.height` | `offsetTop` | `scrollY` | Inset |
| --- | --- | --- | --- | --- | --- |
| Safari, real tap | 714 | 384 | 0 | 0 | 330 |
| Standalone, layout viewport kept | 812 | 416 | 0 | 0 | 396 |
| Standalone, layout viewport shrunk by iOS | 416 | 416 | 396 | 396 | 0 |
| Standalone, soft keyboard toggled on with a hardware keyboard | 620 | 416 | 192 | 192 | 204 |
| Safari, real tap into the search popup input (dialog open) | 627 | 384 | 87 | 87 | 243 |

In every row with `offsetTop` above 0 it equals `scrollY`. The old formula
(`offsetTop` subtracted whole) gave 156 for the last row and 12 for the fourth,
so the search sheet sat under Safari's URL pill and the composer was not
lifted. All five rows are table-driven cases in
`tests/unit/composables/visual-viewport-inset.spec.ts`, next to a scrolled
window with an `offsetTop` of 0 (unchanged), a negative `scrollY` (unchanged)
and a true pan with no scroll.

## Keyboard-aware dialogs

Every `<dialog class="modal">` opened with `showModal()` is `position: fixed;
inset: 0` over the full layout viewport, so `modal-middle` centred its box
behind the keyboard and `modal-bottom` docked it under the keyboard. One
global rule fixes all of them instead of each component lifting itself.

- **Owner:** `useKeyboardInsetRoot()` in
  `app/composables/keyboard-inset-root.ts`, called once from the `<script
  setup>` of `app/app.vue`, so it lives as long as the app and no dialog has
  to know about the keyboard. A `watchEffect` mirrors `useVisualViewportInset()`
  onto `<html>`: `--keyboard-inset` (always set, `0px` while the keyboard is
  closed), `--visible-height` (`viewportHeight` in px, set only while
  `isKeyboardOpen`) and a `data-keyboard-open` attribute (only while open).
  It does nothing on the server. It is not a client plugin on purpose: the
  Nuxt test environment boots plugins, and one would hold the shared
  composable open for the whole test file, which broke the
  `visual-viewport-inset` spec's expectation of a fresh instance per scope
  (14 failures). It is not a component because a template-less component
  fails `vue/valid-template-root`.
- **Rules:** four unlayered rules in `app/assets/css/main.css`, next to the
  `--sat` and `--sab` variables.

  ```css
  .modal {
    padding-bottom: var(--keyboard-inset, 0px);
    transition:
      overlay 0.3s allow-discrete,
      visibility 0.3s allow-discrete,
      background-color 0.3s ease-out,
      opacity 0.1s ease-out,
      padding-bottom 0.25s ease-out;
  }

  .modal:is([open], .modal-open) {
    transition:
      visibility 0s allow-discrete,
      background-color 0.3s ease-out,
      opacity 0.1s ease-out,
      padding-bottom 0.25s ease-out;
  }

  html[data-keyboard-open] .modal:is([open], .modal-open) .modal-box {
    max-height: calc(var(--visible-height) - var(--sat) - 0.5rem);
  }

  html[data-keyboard-open] .modal-bottom > .modal-box {
    --modal-bl: var(--radius-box);
    --modal-br: var(--radius-box);
  }
  ```

- **Why `padding-bottom` and not `height` or `bottom`:** daisyUI 5.7.50 sets
  `.modal` to `position: fixed; inset: 0; height: 100%; max-height: none;
  padding: 0; display: grid` with `place-items: center` (`modal-middle`) or
  `end` (`modal-bottom`). With `top: 0` and `height: 100%` both set, a
  `bottom` value is over-constrained and ignored. A shorter `height` works for
  the layout but not for the dim: daisyUI paints the dim on the dialog itself
  (`.modal::backdrop` is `display: none`, and `main.css` puts `bg-black/70` on
  `.modal`), so a shortened dialog left the strip behind the keyboard, the
  Safari URL pill and the accessory bar undimmed. The dialog therefore keeps
  its full height and the inset is taken from its grid content area with
  `padding-bottom`: `place-items` docks or centres the box in what remains
  while the dim still covers everything.
- **Why unlayered:** per-component utilities such as `max-h-[85dvh]`,
  `max-h-[80vh]`, `max-h-[90dvh]` and `h-[85dvh]` are layered Tailwind
  utilities that resolve against the layout viewport, and an unlayered rule
  beats any layered one, so no `!important` is needed. The box cap is the only
  rule that must not apply while the keyboard is closed (a fallback would
  still beat `max-h-[85dvh]`), so it is keyed on `data-keyboard-open`. The
  padding is set on the base `.modal` rule, not only on the open state: when
  `[open]` is removed on close the padding must not drop to 0 at once while the
  box slides out, so it keeps the inset and animates back with the keyboard.
  It is an exact no-op at `0px`.
- **Transition coupling:** `transition` is a shorthand, so the two rules
  restate daisyUI's lists and add `padding-bottom`: the base list
  (`overlay`, `visibility`, `background-color`, `opacity`) on `.modal` and the
  `[open]` list (`visibility`, `background-color`, `opacity`) on the open
  state. If a daisyUI upgrade changes that list, update this
  one. A dialog that opens while the keyboard is already up has no previous
  padding, so it does not slide in from under the keyboard.
- **Per-component leftovers:** the model picker sheet and the text file sheet
  no longer set `height`, `maxHeight` or `marginBottom`. They keep one inline
  `--models-sheet-bottom-padding` or `--text-file-sheet-bottom-padding` while
  the keyboard is open, because their `max(..., env(safe-area-inset-bottom))`
  padding cannot be zeroed from a global rule and would leave a dead strip
  above the keyboard. The text file textarea drops from `min-h-64` to
  `min-h-24` while the keyboard is open so the capped box does not need to
  scroll.
- **Phone bottom sheets with a text field:** the chat rename, project name,
  file rename and search dialogs are `modal modal-bottom sm:modal-middle`
  like the rest of the app (they were `modal-middle`, which centred the box
  in the visible area and looked detached on a phone). Their box carries the
  `sheet-safe-padding` utility from `main.css`: below `sm` it pads the bottom
  by `max(1rem + --sab, env(safe-area-inset-bottom))`, and by `0.375rem`
  while `html[data-keyboard-open]`, the same two values the text file and
  model picker sheets set from JS. It is CSS-only because it only needs the
  attribute the owner already writes.
- **Rounded bottom corners while the keyboard is open:** daisyUI 5.7.50 sets
  `--modal-bl: 0` and `--modal-br: 0` on `.modal-bottom > .modal-box`, so a
  bottom sheet has square bottom corners because it is docked to the screen
  edge. While `data-keyboard-open` is set the sheet floats above the keyboard,
  Safari's address pill and the accessory bar, and square corners there look
  like a bug. A fourth unlayered rule in `main.css`,
  `html[data-keyboard-open] .modal-bottom > .modal-box`, sets both variables to
  `var(--radius-box)`. The corners are square again as soon as the keyboard
  closes and the attribute is removed. From `sm` up `sm:modal-middle` already
  rounds all four corners, and desktop never gets the attribute.
- **E2E coverage:** `tests/e2e/search/keyboard-inset.spec.ts` replaces
  `window.visualViewport` with a fake before the app boots (an `EventTarget`
  whose `height` is `innerHeight` minus a keyboard height set through
  `window.__setKeyboardHeight`, which also dispatches `resize`). At 390 by 844
  it checks that the search sheet bottom sits at `844 - 300` with rounded
  bottom corners equal to the top ones and goes back to the screen edge with
  square bottom corners, that a resize without a focused text field does not
  open the keyboard state, and that the chat composer lifts above the
  keyboard. At 1280 by 800 it checks that the centred dialog keeps four
  rounded corners and no `padding-bottom`. The fake covers the CSS and the
  wiring from the viewport reading to the `<html>` attribute, variables and
  lifted composer. It cannot cover real iOS quirks such as `offsetTop`
  equalling `scrollY`, which the unit tests in
  `tests/unit/composables/visual-viewport-inset.spec.ts` cover, nor real
  keyboard timing, which needs a device or the simulator (see the
  verification steps below).
- **ToolsMenu:** `ChatInput/ToolsMenu.client.vue` is a `modal modal-bottom`
  dialog below `md` (a popover from `md` up), so it receives the global rules,
  but it has no text field, so the inset never applies to it.

## The send snap

The composer root had `transition-transform duration-500 ease-in-out`. On
send the textarea blurs, `isKeyboardOpen` drops and the inline `bottom`
vanished at once while iOS was still animating the keyboard away (about
250 ms), so the composer snapped down behind the keyboard. The root now sets
an inline transition that keeps the slide at 500 ms ease-in-out and adds
`bottom` at 250 ms ease-out. Tailwind's `transition-transform` expands to
`transform, translate, scale, rotate`, and the `translate-y-*` classes write
`translate`, so the inline list restates all four plus `bottom`. The closed
state is the `bottom-0` class, which gives the transition its `0px` end.

## External keyboard case (fixed)

With a hardware keyboard the form accessory bar can show alone. In
standalone it is counted in the visual viewport (about 68 px), below the
120 px threshold, so nothing is lifted, which is right because the bar is not
the keyboard. Toggling the software keyboard on from that state left
`innerHeight` at 620 and `offsetTop` equal to `scrollY` at 192. The old
formula subtracted that `offsetTop` and returned 12, so nothing was lifted.
Because iOS scrolled the window and fixed elements do not move with that
scroll, the `scrollY` correction in the formula gives the real 204 and the
lift works. This was once recorded as a deliberately unhandled edge case on the
grounds that a `scrollY` correction would break scrolled pages. It does not:
only the part of `offsetTop` beyond `scrollY` is treated as a pan, and a
scrolled window with an `offsetTop` of 0 adds nothing.

## WebKit bugs

- [237851](https://bugs.webkit.org/show_bug.cgi?id=237851): in standalone web
  apps (home-screen PWA) `visualViewport.offsetTop` can read 0 inside the
  `resize` handler while `height` is already correct. The settle re-reads
  correct it.
- [297779](https://bugs.webkit.org/show_bug.cgi?id=297779): iOS 26 drift, the
  visual viewport values stay off after the keyboard closes. The text-entry
  focus gate handles it.
- [191204](https://bugs.webkit.org/show_bug.cgi?id=191204): cited in the
  2026-11-05 research on fixed elements and the keyboard. Read it before
  changing this approach.

## Rejected options

- **`interactive-widget=resizes-content`** in the viewport meta. WebKit
  implemented `interactive-widget` behind a flag that was enabled on
  2026-08-13 (WebKit bugs
  [259770](https://bugs.webkit.org/show_bug.cgi?id=259770) and
  [321543](https://bugs.webkit.org/show_bug.cgi?id=321543)), but
  `resizes-content` is reported broken and no shipping Safari is named, so it
  would not fix the bug. MDN browser-compat-data 8.1.8 still listed
  `safari_ios: false` as of Safari 27.2. It is also global: it would change
  how Android Chrome and Firefox resize every page while the keyboard is
  open. Still not used.
- **VirtualKeyboard API** (`navigator.virtualKeyboard`,
  `env(keyboard-inset-height)`): Chromium-only, no iOS support.
- **Focus-pan suppression** (the Discourse approach: stop iOS from panning on
  focus, for example by moving the field off-screen during focus and back, so
  the layout is always driven by the measured inset). Deferred as a possible
  Layer 2 if the measured lift alone still jumps on real devices.

## Verification in the iOS Simulator

Test on a deployed preview, in Safari and as a home-screen PWA (the 237851
case only shows in the PWA):

1. Open a chat on the preview in Safari on an iPhone simulator.
2. Tap the composer textarea. The composer should sit right on top of the
   keyboard, with no gap and nothing covered.
3. Reproduce the late keyboard: with the hardware keyboard connected, focus
   the textarea (no on-screen keyboard), then show the software keyboard
   (`set_keyboard show` in the simulator tool, or I/O > Keyboard > Toggle
   Software Keyboard). Before the fix the keyboard covered the composer; now
   the composer rises with it.
4. Dismiss the keyboard. The composer returns to the closed layout above the
   home indicator, with no gap left behind (the iOS 26 drift).
5. Scroll the messages up while the keyboard is open: the collapsed peek shows
   a strip above the keyboard. Scroll to the end: the last message clears the
   composer.
6. Repeat 2 to 5 from the home-screen PWA.

7. Open a dialog with a text field (rename a chat, the search popup, the file
   or note editors, the models sheet) and tap the field. The dialog must end
   above the keyboard: a bottom sheet docked on the keyboard, a middle dialog
   centred in the visible part, nothing taller than the visible height.
8. Dismiss the keyboard with the dialog open: it grows back with the keyboard
   instead of snapping.
9. Send a message with the keyboard up: the composer follows the keyboard down
   instead of dropping behind it first.

The unit specs (`tests/unit/composables/visual-viewport-inset.spec.ts`,
`tests/unit/composables/keyboard-inset-root.spec.ts`,
`tests/unit/components/ChatInput.spec.ts`,
`tests/unit/composables/chat-scroll-spacer.spec.ts`) cover the arithmetic,
the settle schedule, the focus gate and the class matrix, but happy-dom has no
keyboard, so only the simulator or a device shows the real behaviour.
