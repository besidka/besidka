# Chat scroll and spacer behavior

Last updated: November 25, 2026
Scope: `app/composables/chat-scroll-spacer.ts`,
`app/composables/chat-image-ui.ts`, and `app/components/ChatInput.client.vue`

## Why this exists

The chat UI uses a dynamic bottom spacer to control where the latest user
message and assistant response appear relative to the input area.

Without this spacer logic, long content pushes the latest messages too low.
With incorrect spacer updates, users see flicker, jumpy repositioning,
incorrect "scroll to bottom" button visibility, and wrong final placement.

This document captures the current behavior, known edge cases, and the exact
reasons behind the safeguards that were added.

## Elements that appear, disappear or resize: the rule

Read this before you add a card, note, skeleton, chip or overlay to the chat
message list or to the composer.

### The failure, in order of events

1. The spacer measures the page and sets its height and the scroll target.
2. Later, an element inside or above the last message leaves or shrinks. An
   approval card unmounts when its tool finishes, a reasoning box collapses, a
   skeleton is replaced by a smaller card.
3. The content is now shorter. The page is shorter by the same amount.
4. The browser clamps `scrollTop` by itself, because the old value is past the
   new maximum.
5. The user's message slides down the screen.
6. Nothing fixes it until the next spacer event.

The spacer does not watch the page. It is recomputed only on a fixed list of
events. Anything that changes the layout between two of them is invisible to
it. These are all the events in `app/composables/chat-scroll-spacer.ts` today:

| Event | Function | What it does |
| --- | --- | --- |
| A user message renders (`onMounted`, `onUpdated`) | `captureMessageDimensions()` then `pushUserMessageToTop()` after 150 ms | Pins the user message |
| The assistant message is the last one and the status is `ready` | `captureMessageDimensions()` then `adjustSpacerAfterResponse()` after a 150 ms debounce | The final adjust. Runs once per message id |
| Regenerate (`chat:regenerate`) | `pushUserMessageToTop()` | Pins the user message again |
| Continuation (`chat:continue`) | `pinUserMessageForContinuation()` | Pins and stores the scroll target |
| The messages container resizes, only while a continuation target is stored | `keepContinuationPinned()` (a `ResizeObserver` through `useResizeObserver`) | Grows the spacer and returns to the target |
| Composer height report (`chat-input:height`) | `scheduleFitSpacerToInputHeight()` then `fitSpacerToInputHeight()` | Updates `inputHeight`. Fits the spacer only while no push has run and no user message exists |
| Scroll button, focus or typing in the composer (`chat:scroll-to-bottom`) | the hook handler, `resetSpacer()` for a tall last pair | Scrolls to the end |
| The keyboard inset changes | the `keyboardInset` watcher | Scrolls by the growth and re-fits |
| A research turn or a pending image skeleton starts | `reservePinnedSpace()`, called from `app/pages/chats/[slug].vue` | Reserves the pinned space |

`chat:submit` only resets flags. The `status` and `slug` watchers only clear
the stored continuation target. No other code recomputes the spacer, and the
final adjust runs once, at `ready`.

### The rule

A change of height that happens after a measurement needs a trigger. The
trigger does not come by itself: whoever adds the element must make something
wait for the layout change and then run the spacer. There are two accepted
mechanisms.

1. **An event that fires when the layout really changed. Prefer this.**
   - The `ResizeObserver` on the messages container
     (`messagesContentElement`, `useResizeObserver(..., keepContinuationPinned)`)
     fires after every content resize, whatever caused it. It is right when
     the element lives in the message list. Today it acts only while a
     continuation target is stored; if your element leaves outside a
     continuation, extend what that callback does, do not add a second
     observer.
   - A hook the component emits after its leave transition has ended, or after
     `await nextTick()` when it unmounts without a transition. The hooks that
     exist are `chat-input:height` (the composer, emitted by
     `app/components/ChatInput.client.vue`) and `chat-spacer:changed` (the
     spacer to the composer). Declare a new hook in
     `app/types/runtime-hooks.d.ts` under `RuntimeNuxtHooks`, call it with
     `nuxtApp.callHook(...)` in the component, and register the handler in
     `chat-scroll-spacer.ts` next to `nuxtApp.hook('chat:continue', ...)`.
2. **A timer, only when there is no observable event.** For example a CSS
   transition with no `transitionend` you can rely on (`display: none` swaps,
   an element removed by a library you do not control). The delay must be a
   named constant that the CSS also uses (a shared constant or a CSS variable
   set from it), never a guessed number such as `300`. The doc, the commit
   message or the PR must say why an event was not possible. There is no such
   constant in the code today. The 150 ms `DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS`
   is a debounce for the DOM to settle after a render; it is not tied to any
   CSS duration and must not be reused for this.

Prefer the event. A timer is wrong whenever the duration changes, the device
is slow, the tab is in the background or the user has reduced motion. An event
fires when the layout changed and not before.

### What does not work

- **Calling `scrollTo` from the component that disappears.** The component is
  being unmounted, so the layout it leaves has not happened yet, and it does
  not know the spacer or the pin target.
- **Recomputing in the same tick as the state change.** The DOM has not
  shrunk yet. `await nextTick()` is the minimum, and for a transition the wait
  is until it ends.
- **Relying on the final adjust at `ready`.** It runs once, at the end. The
  user sees the message slide for the whole turn, as in the 343 px case in
  "Approval pauses and continuations" and the July 2026 image case.
- **Widening a test timeout.** The e2e specs poll the layout with
  `expect.poll`, so a longer timeout lets a late recovery pass, such as the
  final adjust at `ready`, and hides a slide the user saw for the whole turn.
  Assert the position during the turn, before the next content arrives.

### Checklist for every new element

Answer these in the PR before you merge a card inside a message, a note above
an answer, or a chip, skeleton or overlay in the composer.

1. Where does it mount, and when does it leave? Write the leave condition
   (state, status, timer, user action).
2. Is its height part of what the spacer measured? Inside the message list,
   after the last user message: yes. In the composer root: yes, through
   `chat-input:height`. In `chat-input-overlays`: no, by design.
3. Which trigger covers its leave? Name the event from the table above or the
   new one you added. "The final adjust" is not an answer.
4. Is there a unit test in `tests/unit/composables/chat-scroll-spacer.spec.ts`
   that moves the geometry (shrinks `messagesEnd.offsetTop` or the
   container) and fires the trigger?
5. Is there an end-to-end case with a delay between the element leaving and
   the next content arriving? The mock in the earlier bug sent both in one
   burst, which hid it. `tests/e2e/chat/approval-scroll.spec.ts` has the
   `delayed-text` mode (`CONTINUATION_DELAY_MS`) for this.
6. Did you look at it on a deployed preview at phone width (390x844) and
   desktop width (1280x800)?
7. Is every new source file mapped to the spacer suites in
   `scripts/test-affected-check.mjs`? A directory pattern already covers
   `app/components/Chat/` and `app/components/ChatInput/`; check with
   `getAffectedTests([file])`.

### Elements that exist today

"Covered" names the trigger. "NOT covered" means no trigger of its own; the
open items are listed after the table.

| Element | Where | Covered by |
| --- | --- | --- |
| Approval bubble (`Chat/ToolApprovalBubble.vue`) | Sibling after the last message; leaves when the tool settles | The pause: `revealApprovalBubble()` in the final adjust. The leave during a continuation: the pin spacer is sized as if the bubble had left already (`getLeavingApprovalBubbleHeight()`), so nothing is clamped; `keepContinuationPinned()` covers the rest |
| Approval step inside the reasoning box (`Reasoning/ApprovalStep.vue`) | In the message | The final adjust at `ready`. Its user-opened `details` (Arguments, Text to save): NOT covered |
| Reasoning box auto-collapse when the text starts (`Reasoning.vue`, `isMainExpanded`) | Top of the last assistant message, mid-stream | NOT covered by a trigger. The pin was sized from the user message, so it only clamps if the reply falls below that; the final adjust corrects the rest |
| Reasoning box opened or closed by the user after `ready` | Same | NOT covered |
| Pending image skeleton (phantom, then real) | Standalone message or inline | `reservePinnedSpace('instant')` on the rising edge; the swap is height neutral because turns are gated on `isTurnActive` |
| Generic loader (`Chat/Loader.client.vue`) | After the last message | Nothing to cover: it is `h-0` with an absolutely placed bubble and only fades (`opacity-0`), so showing and hiding it never changes the page height |
| Research clarify and pending blocks | Siblings of the message list | `reservePinnedSpace()` from the `[slug].vue` watcher |
| Artifact card (`Chat/Artifact/Card.vue`), document card (`Chat/Document.vue`) | Message parts; streaming, ready and failed states differ in height | The final adjust at `ready`. A state change mid-turn: NOT covered |
| Code run card (`Chat/CodeExecution.vue`), "Show more lines" and the details opened inline by the user (`isExpanded`) | In the message | The final adjust at `ready` for the card itself. A user toggle after `ready`: NOT covered. The detail view in the side panel (`CodeExecution/Detail.vue`) is out of flow |
| Generated image (`Chat/GeneratedImage.vue`) | In the message | By design: the box reserves its height with `aspectRatio` and a same-size skeleton, so the image loading does not resize it |
| Images in Markdown text | In the message | NOT covered. The app has no `ProseImg` override and no reserved size, so a lazy image that loads after the measurement grows the message |
| Error card (`Chat/ErrorCard.vue`) | Replaces the reply text when a turn fails | NOT covered: the turn ends in `error`, and the final adjust runs only at `ready` |
| Files, omitted-context note, connectors notice, URL sources, auto web search chip, tool rounds, reply stopped | In the message, mostly at the end of a turn | The final adjust at `ready` (they appear before or with it) |
| Composer attachments row: file chips, upload skeleton, link skeleton, pasted-text chips, setting tiles (`SettingTile.vue`, 150 ms height transition) | In the composer root, counted on purpose | `chat-input:height` from the `useElementSize` watcher (every change while the textarea is empty, only the first one with a draft typed), from the tiles watcher (tiles appearing or leaving, draft typed), from `chat:attach-file`, with `chat:scroll-to-bottom` on attach. With a draft typed, removing a chip or finishing an upload is NOT reported; it only refreshes at the next report |
| Composer overlays: command picker, approval chip, connector suggestion | `chat-input-overlays`, `absolute bottom-full` | Not measured by design; they never change the reported height. `composer-overlays-spacer.spec.ts` |
| Keyboard | Visual viewport | The `keyboardInset` watcher |
| "+" tools menu, model picker, file manager modal | Popover, sheet or dialog above the page | Out of flow; they do not change message or composer height |

### Open items

Not fixed here. Each needs a trigger and the tests from the checklist.

- The composer attachments row with a draft typed: a removed chip, a finished
  upload or a dismissed note changes the composer height without a
  `chat-input:height` report.
- A reasoning box or an approval step `details` opened or closed by the user
  after `ready`, and the reasoning auto-collapse mid-stream outside a
  continuation: the content changes height with no trigger.
- An artifact or document card whose state changes height in the middle of a
  turn (streaming to failed or unavailable).
- The code run card opened or closed by the user after `ready`.
- Images in Markdown text: no reserved height, so a late load grows the
  message after the measurement.
- A turn that ends in `error`: the error card replaces the text, and the final
  adjust runs only at `ready`, so nothing recomputes the spacer.
- `chat-input:height` does not recompute the spacer after a push, so a
  composer that grows or shrinks after a pin changes only `inputHeight`.

## Main files and ownership

- `app/composables/chat-scroll-spacer.ts`
  - Owns spacer height state (`spacerHeight`)
  - Measures message geometry
  - Computes scroll targets and spacer size
  - Handles hooks: `chat-input:height`, `chat:submit`, `chat:regenerate`,
    `chat:continue`, `chat:scroll-to-bottom`
- `app/components/ChatInput.client.vue`
  - Detects chat input size using `useElementSize`
  - Emits `chat-input:height`
  - Decides when floating input is "visible on scroll"
  - Shows/hides `<LazyChatScroll>` (scroll-to-bottom button)
  - Triggers `chat:scroll-to-bottom` from keyboard focus/start typing
- `app/pages/chats/[slug].vue`
  - Renders scroll container + messages + end marker + spacer block
  - Provides refs used by `useChatScroll`
  - Renders the pending image-generation skeleton and wires the two watchers
    that call `reservePinnedSpace()` (see "Image-generation pinning" below)
- `app/composables/chat-image-ui.ts`
  - Owns `shouldRenderPendingImageGeneration` - whether the phantom skeleton
    (no real `generate_image` tool part yet) should render
  - Owns `hasPendingImageDismissingContent` - decides what content is allowed
    to dismiss that skeleton (see "Image-generation pinning" below)

## DOM layout model

Current structure in `app/pages/chats/[slug].vue`:

```text
scrollContainerRef (overflow-y-auto)
├─ ChatContainer (js-chat-messages-container)
│  ├─ message nodes (messagesDomRefs)
│  ├─ loader
│  └─ messagesEndRef
└─ spacer div (height: spacerHeight px)
```

Important nuance:
- `messagesEndRef` is inside `ChatContainer`
- Spacer is after `ChatContainer`
- Therefore `messagesEnd.offsetTop` is content height up to end marker,
  not including spacer height

This is critical when reasoning about formulas.

## Image-generation pinning

Image generation reuses the same user-message-pinning idea as a normal text
turn, but the assistant side of the pair does not exist as a real message
part until the model actually emits a `tool-generate_image` call. Without
extra handling, the pinned user message would sit correctly for a moment,
then visibly move once real content appears and the spacer/scroll math is
recomputed from scratch. Two composables cooperate to prevent that:

- `useChatImageUi()` (`app/composables/chat-image-ui.ts`) decides **whether**
  a phantom skeleton should render before any real tool part exists, and
  what is allowed to replace it.
- `useChatScrollSpacer()`'s `reservePinnedSpace()` decides **how much space**
  to reserve so that phantom skeleton (and everything that follows it) does
  not shift the pinned user message when it mounts.

### `reservePinnedSpace()`

```text
pinSpacer = anchorTop - messagesEnd.offsetTop + containerHeight - 12
spacerHeight = max(pinSpacer, inputHeight + 12, 0)
```

`anchorTop` comes from `getResearchTurnAnchorTop()`, which returns whichever
of these is currently rendered, in order: the deep-research clarify-topic
bubble (`.js-research-turn-anchor`), otherwise the last measured user
message's `offsetTop`. This lets one function serve both the deep-research
turn-pinning case and the image-generation case without duplicating the pin
math.

`app/pages/chats/[slug].vue` calls `reservePinnedSpace('instant')` from a
single watcher:

```ts
watch(shouldRenderPendingImageGeneration, async (isPending) => {
  if (!isPending) return
  await nextTick()
  reservePinnedSpace('instant')
})
```

This is **deliberately rising-edge only**. An earlier version also re-ran
`reservePinnedSpace()` on the falling edge (phantom skeleton unmounting once
a real tool part exists) to correct any leftover geometry drift. That made
things worse: it called `messagesEndRef.scrollIntoView()` while the real
skeleton was still settling into the `v-for`, which could momentarily clamp
`scrollTop` to `0` and visibly un-pin the conversation - a bigger jump than
the drift it was meant to fix. `adjustSpacerAfterResponse()` still corrects
any residual drift once the turn reaches `'ready'`, so the falling edge does
not need its own re-pin.

### `shouldRenderPendingImageGeneration` and what is allowed to dismiss it

```ts
shouldRenderPendingImageGeneration =
  isImageGenerationTurnPending() && isTurnActive()
  && !hasPendingImageDismissingContent && !lastMessageIsAssistant
shouldRenderPendingImageGenerationInline =
  isImageGenerationTurnPending() && isTurnActive()
  && !hasPendingImageDismissingContent && lastMessageIsAssistant
```

`hasPendingImageDismissingContent` only becomes true for content that
**visually replaces** the phantom skeleton: a renderable `generate_image`
tool part (real skeleton, result, or error card), non-empty text (direct
sends only), or a file part. Streamed reasoning does **not** count.

**Invariant: one assistant container per pending image turn.** The
standalone `<ChatMessage>` card only covers the window before the SDK pushes
the turn's assistant message; from then on the card renders inline at the
end of that message (forced visible, `chat-message--fit-content`), where the
real `tool-generate_image` skeleton later appears, for direct and gateway
sends alike. Until #531 only gateway sends merged (#362), so direct sends
relied on nothing visible reaching the message before the tool part. #531's
past-chat pre-retrieval chip (`tool-search_chats`, written at stream start)
broke that and showed two bubbles ("Working" plus "Preparing image
generation..."). Do not fix such cases by hiding the early part; covered by
`tests/e2e/chat/image-generation-single-message.spec.ts`.

### Root cause: the July 2026 reasoning-before-tool-call jump

Before this round, the skeleton was gated on the generic loading indicator
(`shouldShowGenericLoadingIndicator()`, `isLoading` in the composable's
options) instead of turn status. That indicator hides the instant *any*
visible assistant content exists, including streamed reasoning - and models
that reason before calling the image tool stream that reasoning text before
`tool-generate_image` exists at all. The skeleton unmounted into a genuinely
empty window: nothing had replaced it yet, so the turn's rendered height
shrank by the skeleton's height, the browser clamped `scrollTop` down to fit
the smaller `scrollHeight`, and the pinned user message visibly jumped down.
It only snapped back once `adjustSpacerAfterResponse()` ran at `'ready'`, so
for a reasoning-first turn the jump lasted the whole turn, not ~200ms.

Frame-by-frame measurement (rAF sampler in Playwright, `imageReasoningFirst`
scenario) before the fix:

```text
t=1068  reasoning renders  phantom:false real:false  scrollHeight 898→846  scrollTop 52→0  userTop 12→64  ← jump
t=1663  real tool part     real:true                                       scrollTop still 0  userTop still 64  ← not corrected
t=4718  adjustSpacerAfterResponse                                           scrollTop 52        userTop 12  ← only fixed at 'ready'
```

The plain (non-reasoning) `scenario=image` flow never showed this: its
phantom-to-real skeleton swap is pixel-neutral (`userTop` constant `12`
throughout), which is why the bug only reproduced for reasoning-first models
and was easy to miss in the non-reasoning case.

**Fix**: `shouldRenderPendingImageGeneration` is now gated on turn status
(`isTurnActive`, `chatSdk.status` is `submitted` or `streaming`) plus
`hasPendingImageDismissingContent`, so reasoning alone no longer dismisses
the skeleton. The skeleton now lives, unbroken, from submit until the real
tool part (or text, or a file) actually replaces it in the same patch - so
the swap stays geometry-neutral inside the space `reservePinnedSpace()`
already reserved, in both the plain and reasoning-first cases. No
falling-edge re-pin was added; the previously-fixed un-pin regression above
cannot reappear because nothing new calls `reservePinnedSpace()` on that
edge.

Post-fix, the same rAF sampler shows `userTop` constant `12` / `scrollTop`
constant `52` through the entire turn in both scenarios. Regression coverage
lives in `tests/e2e/chat/scroll-spacer.spec.ts` ("Image generation spacer and
scroll behavior", Case #1 plain and Case #2 reasoning-first) and
`tests/unit/composables/chat-image-ui.spec.ts` (skeleton stays up while only
reasoning streams; dismisses on text, a tool part, or an error; stays up
across an `output-error` tool part specifically, since a failed attempt
still visually replaces the skeleton with the error card).

## Composer overlays stay out of the measured height

`chat-input:height` reports the height of the composer root
(`data-testid="chat-input"`), and the spacer clears exactly that much. Anything
that appears above the input box, such as the connector suggestion chip
("Linear is off in this chat. Turn it on?"), the "N actions waiting for
approval" pill and the `/` command picker, therefore must not take space in
that root. They live in one wrapper (`data-testid="chat-input-overlays"`,
`absolute bottom-full`) so they grow upward over the messages, follow the
composer when the keyboard lifts it, and never change the reported height.
Before this, the chip and the pill sat in the root's flow and added 50 to 60
px to the height, which inflated `inputHeight` for the spacer formulas.
The wrapper is hidden with the composer (`!visible` and selection mode),
because it no longer travels with the root's `translate-y-full`. Parts of the
box itself (attachment tiles, pasted text chips, the textarea) stay in flow and
are counted on purpose. Covered by
`tests/e2e/chat/composer-overlays-spacer.spec.ts`.

## Approval pauses and continuations

A reply that needs a tool approval ends the request ("approval ends the
send", `docs/connectors.md` section 7.2) and continues in the same
assistant message after the answer. Until 2026-11-20 the spacer treated
both halves wrong (reported from production on the iPhone PWA):

- **The pause.** `adjustSpacerAfterResponse()` pinned the user message at
  the top like any finished turn, so on a tall reply the approval bubble
  under the message (`Chat/ToolApprovalBubble.vue`) sat below the fold and
  only the "1 action waiting for approval" pill showed, over the reply's
  text. A second pause in the same message (after a continuation) did not
  even run the adjust, because the assistant message id was already in
  `capturedAssistantMessages`.
- **The continuation.** It has no new user message, so `chat:submit` and
  the push never ran, and the message was already captured, so no adjust
  ran when it finished: the view stayed wherever it was and the new text
  grew under the composer.

Now:

- `useChat` calls the `chat:continue` hook from `prepareSendMessagesRequest`
  for every request whose last message is the assistant's (answered
  approvals, a resend of those answers, an automatic tool round). A normal
  send and a regenerate end with a user message and never call it.
- `pinUserMessageForContinuation()` handles the hook: it removes the
  assistant message id from `capturedAssistantMessages`, measures the last
  user message again (after a reload it was never captured, since only the
  last message is measured), and places it like `pushUserMessageToTop()`:
  scroll target `userTop - 12` (plus the tall-message offset), spacer
  `max(target - messagesEnd.offsetTop + containerHeight, inputHeight + 12)`,
  smooth scroll. When the continuation finishes, the regular capture runs
  `adjustSpacerAfterResponse()`, so the final layout equals a plain send.
- `adjustSpacerAfterResponse()` ends with `revealApprovalBubble()`: when the
  container holds `.js-tool-approval-bubble`, it scrolls by the amount the
  bubble's bottom sits below the composer's top (container bottom minus
  `inputHeight`, the keyboard inset and 12px), never moving the bubble's
  top above the container's top.
- The pill hides while the bubble is on screen (`useToolApprovalBubbleInView`,
  set by the bubble from scroll, resize and its own size), so it never
  covers the reply; it shows only when the bubble is scrolled away, as a
  way back to it.

The pin is kept while the continuation runs (BES-462). The pin sizes the
spacer from the layout at the moment the request starts, when the approval
bubble is still under the reply in its `sending` state. The bubble leaves as
soon as the tool part settles, which can be seconds before any text arrives,
because the server runs the tool first. `messagesEnd.offsetTop` then drops by
the bubble's height, `scrollHeight` shrinks, the browser clamps `scrollTop`,
and the pinned user message slid down by that height (343px on a 390x844
viewport with a short reply, measured with a per-frame sampler) until
`adjustSpacerAfterResponse()` placed the finished reply. Nothing recomputed
the spacer in between: it ran only on submit, continue, regenerate, input
height changes and once per reply at `ready`.

Sizing the spacer for a layout that is about to change beats correcting it
after the fact. `getLeavingApprovalBubbleHeight()` measures the approval
bubble message that is still on the page (`.js-tool-approval-message`, the
root of `Chat/ToolApprovalBubble.vue`, not the per-message wrapper in
`[slug].vue` that also holds the reply above it: its distance to
`messagesEnd` plus its top margin) and `getSpacerHeightForScrollTarget()`
sizes the pin spacer as if it had left already. When the tool settles, the
page keeps its height, `scrollTop` is never clamped and the pinned user
message does not move, not even for the one layout that sits between the
removal and the first resize notification (a per-frame sampler that reads
before the next layout saw that layout, 350px away on a 390x844 viewport,
even with `keepContinuationPinned()` in place). The extra blank space under
the reply, whatever the reply grows by while the tool settles, is the same
kind of slack a plain send has and is replaced when the reply finishes.

A reader who had scrolled away from the pin before the click (the card in
view with the user message partly above the container's top, or scrolled
up) is moved to the pin in one instant frame while a leaving bubble is
present and the view is more than 2px from the target
(`CONTINUATION_PIN_MOVE_THRESHOLD`); otherwise the pin scroll is smooth. A
smooth scroll would be cut short by the next layout when the bubble leaves,
which is a visible jump of its own.

The pin leaves a view that is already at the pin alone. The formula the pause
scrolls to is not what the reader sees (the default spacer clamps it 12px
lower), and the pin's own formula (`userTop + tallOffset - 12`) sits about 12px
away from the real position for a tall user message. So when `scrollTop` is
within `CONTINUATION_PIN_SETTLED_DISTANCE` (24px) of the formula, the pin keeps
the current `scrollTop` as its target and the click moves the view by 0px.
Farther away (the reader scrolled, or the pause revealed the bubble), the pin
moves to the formula.

The reply is placed where the pin put it. `adjustSpacerAfterResponse()` takes
the pin's scroll target (`finalContinuationScrollTarget`, kept after the
status watcher clears the live one) when the user did not take over the
scroll, recomputes only the spacer height so the target stays reachable, and
scrolls to that target instead of the one a plain send would compute for the
finished reply. The two can differ when the finished reply is taller than the
paused one: a plain send then ends 12px lower, and for a user message about
as tall as the viewport (22 sentences at 430x932) the plain send's own final
adjust jumps the pinned message from -536 to +12, because its spacer lacks the
room for the tall-message offset. A continuation keeps what the reader already
sees. This is the one documented difference from a plain send, and it only
shows for a long user message. The pin is dropped by a takeover,
`pushUserMessageToTop()`, `reservePinnedSpace()`, `chat:submit`,
`chat:scroll-to-bottom`, an `error` status and a slug change.

`keepContinuationPinned()` closes the rest. `pinUserMessageForContinuation()`
stores its scroll target; a `ResizeObserver` on the messages container
(`messagesEnd`'s parent) then recomputes the spacer the pin needs after every
content resize. When it needs more than the current spacer, it grows the
spacer, waits a tick and scrolls instantly back to the stored target. Content
growth never shrinks the spacer.

What counts as a user takeover (the spacer still grows, but the view is left
where the user put it; the flag is reset by every new pin):

- a `wheel` event on the scroll container, except one whose `timeStamp` is
  within 250 ms of the moment the pin was set
  (`CONTINUATION_WHEEL_MOMENTUM_MS`, compared with `performance.now()` at the
  pin, no timer): that is the tail of a trackpad scroll that started before
  the pin, which keeps sending events for a while;
- a `touchmove` on the scroll container;
- a `keydown` of PageUp, PageDown, Home, End, ArrowUp, ArrowDown or Space
  (listened on `window`) unless its target is an input, textarea, select or
  `contenteditable` element, so typing in the composer never releases the pin
  (focusing the composer already releases it through `chat:scroll-to-bottom`);
- a `pointerdown` whose target is the scroll container itself, which is how a
  scrollbar drag arrives (a press on a message or any other child is not one).

The stored target is cleared by `adjustSpacerAfterResponse()`,
`pushUserMessageToTop()`, `reservePinnedSpace()`, `chat:submit`,
`chat:scroll-to-bottom` (the scroll
button, or focusing or typing in the composer: the user asked for the bottom,
so the pin must not pull the view back), the chat status becoming `ready` or
`error` (through the status watcher, so a continuation that ends without a
measured reply, such as a stopped one, cannot leave a stale target behind) and
a change of the `slug` route param (the composable instance can outlive the
chat it pinned), so a settled layout is never touched. Anything that
shrinks the page for another reason (a reasoning box that collapses) still
shows one frame at the displaced position, because the resize notification
arrives after the layout that clamped. Do not replace this with a falling-edge
`scrollIntoView()` (see the image-generation section for why). This is the
first case of a general rule, written down in
[Elements that appear, disappear or resize: the rule](#elements-that-appear-disappear-or-resize-the-rule)
near the top: an element that leaves after a
measurement needs a trigger of its own, and `keepContinuationPinned()` is
the one that exists for continuations, together with the pre-sized spacer
for the leaving bubble.

Covered by `tests/unit/composables/chat-scroll-spacer.spec.ts`
("continuations and approval pauses") and
`tests/e2e/chat/approval-scroll.spec.ts` (mobile 390x844 and desktop
1280x800: the bubble is fully visible and the pill hidden after the pause,
the pill appears when scrolled away and leads back, the continuation pins
the user message, and the final layout matches a plain send of the same
reply within 2px). A short reply, with only a reasoning row and the bubble
above the composer, is checked with a per-frame sampler that reads before
each layout, at 390x844, 430x932 and 1280x800, for a short user message, a
long one (22 sentences) with and without a second approval, and with the view
scrolled 60px away from the pin first. From just before the click until 2 s
after the reply finished, no frame moves the user message top or `scrollTop`
by more than 2px, except one instant frame where the view is moved to the pin;
the final layout equals a plain send, except for the long user message
described above. The spec reuses
`tests/e2e/helpers/composer-metrics.ts` with `composer-overlays-spacer.spec.ts`.

### Why a long message is not compared with a plain send

The frame-by-frame e2e cases in `tests/e2e/chat/approval-scroll.spec.ts` end
with a comparison against a plain send of the same stream, except for a long
user message. The user text renders through the async `MDCCached` component,
and the user message is measured once, a fixed 150 ms after it rendered. On a
slow runner a long message is still one short row at that moment, so the
plain page's own final placement differs from the continuation's, which
measures the message live at the click: in CI the difference was 12 to 212 px
and the test failed on its first attempt in several runs (retries hid it until
one run failed all three). A continuation keeps what the reader already sees,
so for a long message the plain-send comparison is not an oracle and the
scenario keeps only the per-frame checks. The fixed measurement delay is a
known race, tracked separately.

## Runtime hook contract (event bus)

Defined in `app/types/runtime-hooks.d.ts`.
Relevant events:

- `chat:rendered`
- `chat:submit`
- `chat:regenerate`
- `chat:continue`
- `chat:scroll-to-bottom`
- `chat-input:height`
- `chat-input:visibility-changed`
- `chat-spacer:changed`

Core interaction loop:

1. `ChatInput.client.vue` emits `chat-input:height`
2. `chat-scroll-spacer.ts` updates internal `inputHeight`, may schedule spacer logic
3. `chat-scroll-spacer.ts` emits `chat-spacer:changed`
4. `ChatInput.client.vue` listens `chat-spacer:changed` and calls `measure()`
   from `useScroll`
5. `arrivedState.bottom` updates, potentially toggling input transform classes
6. Input transform/size changes can trigger additional `useElementSize` updates

## Key state and constants in `chat-scroll-spacer.ts`

- `spacerHeight` (starts at `INITIAL_SPACER_HEIGHT = 500`)
- `inputHeight` (chat input height minus safe-area bottom)
- `userMessageData` and `assistantMessageData`:
  - `{ id, height, offsetTop }`
- `capturedUserMessages` and `capturedAssistantMessages`
  - prevent duplicate dimension capture per message ID
- `assistantDebounceTimer`
- `inputHeightTimer`
  - debounces repeated `chat-input:height` emissions
- `spacerComputedByPush`
  - blocks repeated spacer recomputation after stable push is done

Constants:
- `INITIAL_SPACER_HEIGHT = 500`
- `INITIAL_SPACER_PADDING = 12`
- `MESSAGES_GRID_CONTAINER_GAP_BETWEEN_MESSAGES = 12`
- `MESSAGE_3_LINES_HEIGHT = 100`
- `DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS = 150`

## Geometry and formulas

### `pushUserMessageToTop(behavior)`

Used to anchor the latest user message near top with optional 3-line truncation
behavior for tall user messages.

Formula:

```text
resultSpacer = userMessageOffsetTop - messagesEndOffsetTop + containerHeight - 12
if (messageHeight > 100) {
  resultSpacer += messageHeight + 16 - 100
}
```

Then:
- `spacerComputedByPush = true`
- `spacerHeight = resultSpacer`
- emit `chat-spacer:changed`
- `messagesEndRef.scrollIntoView({ behavior })`

Behavior choice:
- Initial page-load path uses `instant`
- New user-message path stays `smooth`

### `adjustSpacerAfterResponse()`

Used after assistant content becomes ready and both last user + assistant
message dimensions are captured.

Inputs:
- `containerHeight`
- `scrollableSpace = containerHeight - inputHeight`
- `conversationPairHeight = userHeight + assistantHeight + 12`

Base spacer:

```text
resultSpacer = userOffsetTop - safeAreaTop + containerHeight - messagesEndOffsetTop - 12
```

Tall-user add-on:

```text
extraSpacerForTallUserMessage = max(userHeight - 100 + 4, 0)
```

Special branch when pair exceeds scrollable space but user message alone still
fits:

```text
resultSpacer = inputHeight + extraSpacerForTallUserMessage
extraSpaceForScroll = 12
```

Then scroll instantly to:

```text
top = userOffsetTop + extraSpacerForTallUserMessage - extraSpaceForScroll
```

## Chat input height behavior and why it double-fires

`ChatInput.client.vue` uses:

```ts
const { height: chatInputHeight } = useElementSize(chatInputRef)
watch(chatInputHeight, (newHeight) => {
  if (input.value) return
  nuxtApp.callHook('chat-input:height', newHeight)
}, { flush: 'post' })
```

Observed sequence in mobile layout can be:
- `12 -> 228 -> 253` (or close variants)

Why:
- The input is `position: fixed` and animated with transform classes
- ResizeObserver (inside `useElementSize`) reports intermediate and final sizes
  during class/visibility transitions
- `chat-spacer:changed -> measure() -> arrivedState.bottom` can toggle
  visibility state and trigger more transform changes

## Root cause of previous flicker/jumps

On page reload with existing chat:
- `chat-input:height` could emit multiple values quickly
- Old logic updated spacer immediately for each emission
- delayed push then set a larger value
- next emission could reset to small again

Visible result:
- rapid spacer jumps like `12 -> 228 -> 812 -> 253 -> 812`

## Stabilization rules now in place

1. Debounce repeated input-height emissions
- `inputHeightTimer` is cleared before scheduling a new run
- only latest stabilized emission is applied

2. Stop recursive recompute loops after stable push
- once `pushUserMessageToTop` succeeds, `spacerComputedByPush = true`
- `chat-input:height` handler exits early while this flag is true
- flag resets on `chat:submit` so new messages recompute normally

3. Initial load should not animate through whole history
- initial/non-submitting user-message path calls
  `pushUserMessageToTop('instant')`

4. New message should remain smooth
- submitting/streaming path still calls `pushUserMessageToTop()`
  (default smooth behavior)

5. Scroll to the bottom only after the spacer has re-rendered
- the `chat-input:height` debounce callback (`fitSpacerToInputHeight()`)
  sets `spacerHeight = inputHeight`, then `await nextTick()`, and only then
  reads `scrollHeight` and scrolls, like `pushUserMessageToTop()` and
  `adjustSpacerAfterResponse()` already did
- without the `nextTick()` it scrolled to the stale, pre-growth
  `scrollHeight`; the spacer then grew, the container sat that many pixels
  above the bottom, and the rebroadcast `measure()` read
  `arrivedState.bottom = false`, so the input slid into the desktop
  half-collapsed state
- trigger (October 2026): with a pill setting tile in the attachments row,
  attaching a file turns every tile square (40px to 64px), the input grows
  by 24px, and a user who had scrolled to the very bottom got collapsed.
  It was timing-dependent: when a later `chat-input:height` emission ran the
  callback again, that run saw the already-grown spacer, scrolled to the
  real bottom and masked the bug
- covered by `tests/e2e/chat/chat-input-collapse-on-attach.spec.ts`
  (desktop, 1280x800) and `tests/unit/composables/chat-scroll-spacer.spec.ts`

## Scroll-to-bottom behavior split (short pair vs tall pair)

Hook in `chat-scroll-spacer.ts`:

- `chat:scroll-to-bottom` previously always called `resetSpacer()`
- This broke short-pair scenario because reducing spacer when not needed
  changed final placement incorrectly

Current logic:
- call `resetSpacer()` only if last pair is taller than scrollable area
- otherwise only smooth-scroll to end marker

Gate:

```text
shouldResetSpacerOnScrollToBottom() =
  (userHeight + assistantHeight + 12) > (containerHeight - inputHeight)
```

Fallback behavior:
- If container/user/assistant dimensions are unavailable, it returns `true`
  (safe fallback for unknown state)

## Why button visibility can look wrong in short case (historically)

`isChatInputVisibleOnScroll` in `ChatInput.client.vue`:
- returns true early for some conditions (`/chats/new`, non-ready status,
  <=1 message, content shorter than viewport)
- otherwise depends on `arrivedState.bottom`

When spacer is large, `arrivedState.bottom` can be false even if real content is
short, so the floating scroll button appears.

Manual scroll to bottom can hide it because `arrivedState.bottom` updates to
true. The old unconditional `resetSpacer()` then distorted placement when button
was clicked. The conditional reset fixes this split behavior.

## Manual scroll and empty space in tall-content case

Current expected behavior:
- Tall-content scenario may show large blank spacer area when manually scrolled
  to absolute bottom
- This is a side effect of preserving the "show last 3 lines of user message"
  anchor behavior

Could we auto-reduce spacer on manual scroll?
- Yes technically, but high risk for UX regressions:
  - changing spacer while user drags/has momentum scroll can cause jumps
  - scroll position can shift mid-gesture
  - button visibility can flicker from repeated state toggles
  - mobile inertia scroll feels unstable if `scrollHeight` changes during motion

Recommendation:
- Keep spacer reduction on explicit action (`chat:scroll-to-bottom`) for the
  tall-case only
- Do not mutate spacer continuously during user manual scroll unless a robust
  state machine is implemented (user intent detection + hysteresis + transition
  freeze windows)

## Validation playbook (manual + E2E)

### Test endpoint availability

Test data for these scenarios comes from:
- `server/api/v1/chats/test/index.get.ts`
- `server/api/v1/chats/test/index.post.ts`

These routes are intentionally enabled only when:
- `import.meta.dev` is true (local dev), or
- `process.env.CI === 'true'` (CI/E2E environment)

Outside those environments, they return 404 by design.

### URL params reference

Supported params for `/chats/test`:
- `scenario`: `short` | `long` | `reasoning` | `image`
- `messages`: integer string (`1`, `2`, `20`, ...)
- `regenerate`: flag param (presence enables auto-regenerate path)
- `imageReasoningFirst`: `true` | `false` (only affects `scenario=image`;
  streams reasoning before the `generate_image` tool call)
- `error`: a `ChatTestErrorId` (see `shared/utils/chat-test-errors.ts`); when
  set, streams partial output then a structured error chunk instead of
  completing normally

Examples:
- `/chats/test?scenario=short&messages=20`
- `/chats/test?scenario=long&messages=1&regenerate`
- `/chats/test?scenario=image&messages=0`
- `/chats/test?scenario=image&messages=0&imageReasoningFirst=true`

### Manual setup

1. Start app in dev mode: `pnpm run dev`
2. Open browser at `http://localhost:3000`
3. Use mobile viewport emulation (recommended: iPhone 14 Pro Max)
4. For regenerate cases, wait for stream completion before final assertions
5. For regenerate cases, verify loader timing:
  - loader becomes visible immediately after regenerate submit
  - loader becomes hidden after assistant text starts rendering

### Short scenarios

#### Case S1: one short user message

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=1`

Steps:
1. Open URL
2. Wait for initial layout settle

Expected:
- one user message visible
- user message anchored near top
- no unnecessary full-history scroll animation

#### Case S2: one short user + one short assistant

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=2`

Steps:
1. Open URL
2. Wait for initial layout settle

Expected:
- one user and one assistant message visible
- pair is near top
- assistant appears below user

#### Case S3: many short messages

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=20`

Steps:
1. Open URL
2. Wait for initial layout settle

Expected:
- conversation ends above chat input
- visual gap near expected ~12px
- no large empty-space artifact between last assistant bubble and input

#### Case S4: one short user + regenerate

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=1&regenerate`

Steps:
1. Open URL
2. Observe regenerate stream

Expected:
- loader visible immediately on regenerate submit
- loader hidden when assistant starts rendering
- final user+assistant pair is near top

#### Case S5: many short messages + regenerate from trailing user

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=21&regenerate`

Steps:
1. Open URL
2. Wait for regenerate completion

Expected:
- loader visible -> hidden transition as in S4
- last user + assistant pair is visible
- pair is not clipped into bottom input area
- last assistant remains below last user in the pair

#### Case S6: from S5, manual scroll + button return

URL:
- `http://localhost:3000/chats/test?scenario=short&messages=21&regenerate`

Steps:
1. Complete S5
2. Manually scroll conversation to top
3. Verify `Scroll to bottom` button is visible
4. Verify chat input is in half-hidden floating state
5. Click `Scroll to bottom`

Expected:
- scroll returns down to latest pair area
- alignment returns to expected S5-like state
- no broken offset caused by unconditional spacer reset

### Long scenarios

#### Case L1: one long user message

URL:
- `http://localhost:3000/chats/test?scenario=long&messages=1`

Steps:
1. Open URL
2. Wait for spacer calculation to settle

Expected:
- only lower part of long user message is visible
- behavior targets \"last ~3 lines visible\" intent

#### Case L2: long user + long assistant

URL:
- `http://localhost:3000/chats/test?scenario=long&messages=2`

Steps:
1. Open URL
2. Wait for initial layout settle

Expected:
- assistant bubble is positioned right above chat input area
- expected gap/padding between assistant bubble and input

#### Case L3: one long user + regenerate

URL:
- `http://localhost:3000/chats/test?scenario=long&messages=1&regenerate`

Steps:
1. Open URL
2. Observe regenerate start and finish
3. After completion, manually scroll to absolute bottom
4. Confirm big spacer/empty visual area is present (expected in this mode)
5. Scroll up until `Scroll to bottom` button is visible
6. Click `Scroll to bottom`

Expected:
- loader visible immediately on regenerate submit
- loader hidden when assistant text starts rendering
- after stream finish, user top-anchor behavior is preserved
- manual absolute-bottom view can include large empty spacer (expected)
- button click re-aligns like L2 (assistant near input, no giant empty space)

### Image generation scenarios

#### Case I1: pending skeleton appears without a jump through the whole turn

URL:
- `http://localhost:3000/chats/test?scenario=image&messages=0`

Steps:
1. Open URL, submit the seeded image prompt
2. Sample the pinned user message's `offsetTop` (or `getBoundingClientRect().top`)
   at short intervals from submit through `tool-output-available` (ready)

Expected:
- phantom skeleton appears immediately on submit, in the space
  `reservePinnedSpace()` already reserved
- user message `offsetTop` stays constant across the phantom-to-real
  skeleton swap and through generating/saving/ready - no jump at any point
- see "Image-generation pinning" above for why this case was historically
  jump-free even when Case I2 was not

#### Case I2: reasoning before the tool call keeps the pin stable

URL:
- `http://localhost:3000/chats/test?scenario=image&messages=0&imageReasoningFirst=true`

Steps:
1. Open URL, submit the seeded image prompt
2. Sample the same geometry as Case I1, specifically across the moment
   reasoning text starts rendering (before the tool call exists) and the
   moment the real tool part appears

Expected:
- phantom skeleton stays mounted while reasoning streams - reasoning text
  must not dismiss it
- user message `offsetTop` and `scrollTop` stay constant through the whole
  turn, including the reasoning window
- this is the regression case: before the July 2026 fix, `offsetTop` jumped
  by roughly the skeleton's height the instant reasoning rendered, and only
  recovered once the turn reached `'ready'`

### E2E automation

Implemented E2E suites:
- `tests/e2e/chat/scroll-spacer.spec.ts`
- `tests/e2e/chat/chat-input-collapse-on-attach.spec.ts` (desktop: attaching
  a file next to a pill tile must not collapse a bottom-scrolled input; see
  stabilization rule 5)

Run command:
- `pnpm run test:e2e:chromium -- tests/e2e/chat/scroll-spacer.spec.ts`

What it covers:
- all short cases S1-S6
- all long cases L1-L3
- regenerate loader transition checks in all regenerate cases
- image cases I1-I2, via a shared `expectStableImageTurnPin()` helper that
  samples the pinned user message's position on every animation frame from
  submit through `'ready'` and asserts the deviation never exceeds a small
  pixel tolerance - this is what actually caught the July 2026 reasoning-jump
  regression (`maxDeviation: 52` with the bug present, passing with the fix)

### Case S6 E2E false-negative notes (Feb 2026)

Observed in Playwright mobile emulation:
- UI can be correct while Case S6 still fails from assertion brittleness
- `Scroll to bottom` button can be attached but temporarily hidden depending on
  how scroll state settles in headless runs
- chat input transform class can vary across valid states (`*_18`, `*_20`,
  desktop/mobile variants), so exact class-substring assertions are fragile
- programmatic "jump to absolute top" is not equivalent to real user behavior
  in this case (small upward manual scroll from loaded position)

Test-shape updates applied:
- removed assertions tied to one specific transform class token
- removed strict post-click geometry path checks requiring exact scroll deltas
- kept behavior-oriented checks that are stable across emulation timing:
  - message ordering remains valid (assistant below user)
  - no severe overlap/regression near input area

Guideline for future S6 edits:
- prefer user-visible end-state invariants over intermediate animation/
  transition internals
- if a check depends on timing-sensitive visibility, treat it as optional signal
  unless product behavior explicitly requires it to be deterministic

Loader selector used by tests:
- `app/components/Chat/Loader.client.vue` has `data-testid="chat-loader"`
- helper `expectRegenerateLoaderTransition()` in
  `tests/e2e/chat/scroll-spacer.spec.ts`

## Practical debugging checklist

When behavior looks wrong, log these in one trace:
- `chatSdk.status`
- `chatInputHeight` emissions (with timestamp)
- `inputHeight`
- `spacerHeight`
- `userMessageData` and `assistantMessageData`
- `arrivedState.bottom`
- whether `spacerComputedByPush` is true
- for image turns: `shouldRenderPendingImageGeneration`,
  `hasPendingImageDismissingContent`, `hasActiveImageGenerationToolPart`, and
  the container's live `scrollTop`/`scrollHeight` (a jump in this class of bug
  shows up as `scrollTop` snapping down when `scrollHeight` shrinks, not as a
  spacer-height miscalculation)

Also verify event order:
- `chat-input:height`
- `chat-spacer:changed`
- `measure()`
- visibility toggle (`isChatInputVisibleOnScroll`)
- any additional `chat-input:height`
- for image turns: rising edge of `shouldRenderPendingImageGeneration` ->
  `reservePinnedSpace('instant')` -> real tool part mounts in the same patch
  (no second `reservePinnedSpace()` call should fire here) -> `'ready'` ->
  `adjustSpacerAfterResponse()`

## Change safety notes for future edits

If you change any of these, re-verify all manual/E2E scenarios above:
- `ChatInput` transform/visibility classes
- `chat-input:height` emission timing
- spacer constants (`12`, `100`, `+16`, `+4`, initial `500`)
- `spacerComputedByPush` gating
- `shouldResetSpacerOnScrollToBottom()` condition
- `hasPendingImageDismissingContent`'s definition of "dismissing content" -
  loosening it back to "any visible content" (including reasoning) will
  reintroduce the July 2026 jump
- the rising-edge-only guard on the `shouldRenderPendingImageGeneration`
  watcher in `[slug].vue` - adding a falling-edge `reservePinnedSpace()` call
  will reintroduce the un-pin regression described in "Image-generation
  pinning" above

Most regressions come from event timing, not from one formula line.
Always validate with real mobile viewport emulation and both short/long test
scenarios.
