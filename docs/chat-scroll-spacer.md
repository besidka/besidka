# Chat scroll and spacer behavior

Last updated: February 22, 2026
Scope: `app/composables/chat-scroll.ts` and
`app/components/ChatInput.client.vue`

## Why this exists

The chat UI uses a dynamic bottom spacer to control where the latest user
message and assistant response appear relative to the input area.

Without this spacer logic, long content pushes the latest messages too low.
With incorrect spacer updates, users see flicker, jumpy repositioning,
incorrect "scroll to bottom" button visibility, and wrong final placement.

This document captures the current behavior, known edge cases, and the exact
reasons behind the safeguards that were added.

## Main files and ownership

- `app/composables/chat-scroll.ts`
  - Owns spacer height state (`spacerHeight`)
  - Measures message geometry
  - Computes scroll targets and spacer size
  - Handles hooks: `chat-input:height`, `chat:submit`, `chat:regenerate`,
    `chat:scroll-to-bottom`
- `app/components/ChatInput.client.vue`
  - Detects chat input size using `useElementSize`
  - Emits `chat-input:height`
  - Decides when floating input is "visible on scroll"
  - Shows/hides `<LazyChatScroll>` (scroll-to-bottom button)
  - Triggers `chat:scroll-to-bottom` from keyboard focus/start typing
- `app/pages/chats/[slug].vue`
  - Renders scroll container + messages + end marker + spacer block
  - Provides refs used by `useChatScroll`

## DOM layout model

Current structure in `app/pages/chats/[slug].vue`:

```text
scrollContainerRef (overflow-y-auto)
├─ ChatContainer (data-chat-messages)
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

## Runtime hook contract (event bus)

Defined in `app/types/runtime-hooks.d.ts`.
Relevant events:

- `chat:rendered`
- `chat:submit`
- `chat:regenerate`
- `chat:scroll-to-bottom`
- `chat-input:height`
- `chat-input:visibility-changed`
- `chat-spacer:changed`

Core interaction loop:

1. `ChatInput.client.vue` emits `chat-input:height`
2. `chat-scroll.ts` updates internal `inputHeight`, may schedule spacer logic
3. `chat-scroll.ts` emits `chat-spacer:changed`
4. `ChatInput.client.vue` listens `chat-spacer:changed` and calls `measure()`
   from `useScroll`
5. `arrivedState.bottom` updates, potentially toggling input transform classes
6. Input transform/size changes can trigger additional `useElementSize` updates

## Key state and constants in `chat-scroll.ts`

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
- `DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS = 100`

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

## Scroll-to-bottom behavior split (short pair vs tall pair)

Hook in `chat-scroll.ts`:

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
- `scenario`: `short` | `long` | `reasoning`
- `messages`: integer string (`1`, `2`, `20`, ...)
- `regenerate`: flag param (presence enables auto-regenerate path)

Examples:
- `/chats/test?scenario=short&messages=20`
- `/chats/test?scenario=long&messages=1&regenerate`

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

### E2E automation

Implemented E2E suite:
- `tests/e2e/chat/scroll-spacer.spec.ts`

Run command:
- `pnpm run test:e2e:chromium -- tests/e2e/chat/scroll-spacer.spec.ts`

What it covers:
- all short cases S1-S6
- all long cases L1-L3
- regenerate loader transition checks in all regenerate cases

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

Also verify event order:
- `chat-input:height`
- `chat-spacer:changed`
- `measure()`
- visibility toggle (`isChatInputVisibleOnScroll`)
- any additional `chat-input:height`

## Change safety notes for future edits

If you change any of these, re-verify all manual/E2E scenarios above:
- `ChatInput` transform/visibility classes
- `chat-input:height` emission timing
- spacer constants (`12`, `100`, `+16`, `+4`, initial `500`)
- `spacerComputedByPush` gating
- `shouldResetSpacerOnScrollToBottom()` condition

Most regressions come from event timing, not from one formula line.
Always validate with real mobile viewport emulation and both short/long test
scenarios.
