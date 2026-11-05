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
bottomInset = max(0, round(innerHeight - visualViewport.height - visualViewport.offsetTop))
```

- It is one shared instance (`createSharedComposable`) for every consumer:
  the composer, the scroll spacer, the model picker sheet and the text file
  editor sheet. The public API is `bottomInset`, `viewportHeight`,
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
this: they animate over 500 ms (`transition-transform duration-500`) and
would lag behind the keyboard. While the keyboard is open:

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

- **`interactive-widget=resizes-content`** in the viewport meta. Not supported
  in stable iOS Safari as of Safari 27.2 (MDN browser-compat-data 8.1.8 lists
  `safari_ios: false`), so it would not fix the bug. It is also global: it
  would change how Android Chrome and Firefox resize every page while the
  keyboard is open.
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

The unit specs (`tests/unit/composables/visual-viewport-inset.spec.ts`,
`tests/unit/components/ChatInput.spec.ts`,
`tests/unit/composables/chat-scroll-spacer.spec.ts`) cover the arithmetic,
the settle schedule, the focus gate and the class matrix, but happy-dom has no
keyboard, so only the simulator or a device shows the real behaviour.
