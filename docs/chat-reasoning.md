# Chat reasoning

Scope:
- chat input reasoning controls,
- assistant reasoning rendering,
- provider mapping,
- persistence and sync behavior.

Main files:
- `shared/utils/reasoning.ts`
- `app/components/ChatInput/ReasoningTrigger.vue`
- `app/components/ChatInput.client.vue`
- `app/components/Chat/Reasoning.vue`
- `app/composables/chat.ts`
- `app/composables/user-setting.ts`
- `server/utils/providers/reasoning.ts`
- `server/utils/providers/openai.ts`
- `server/utils/providers/google.ts`
- `server/api/v1/chats/test/index.get.ts`
- `server/api/v1/chats/test/index.post.ts`

## UX decisions and rationale

### 1) Reasoning has two separate user decisions
- Decision A: model effort (`off|low|medium|high`).
- Decision B: display behavior (expand reasoning steps or keep collapsed).

Why:
- Users may want high-quality reasoning generation but compact UI.
- Users may want detailed UI expansion only sometimes.
- This avoids coupling model cost/latency choices with rendering preference.

### 2) `off` is a first-class level
- `off` is part of the same selector as `low|medium|high`.

Why:
- Clear mental model: one control defines effort end-to-end.
- No extra toggle button state mismatch.
- Easier fallback when model capabilities change.

### 3) Preserve context without clutter
- Main reasoning section auto-collapses once assistant text starts.
- During reasoning-only streaming, users can auto-follow steps.
- If there is exactly one step and main is expanded, step auto-expands too.

Why:
- Keeps final answer readable.
- Still gives live visibility while reasoning is in progress.
- One-step flows should not require a second click.

## Current user-facing behavior

### Chat input dropdown (`ReasoningTrigger`)
- Uses one dropdown for both:
  - reasoning steps visibility switch (`Hidden` / `Visible`),
  - reasoning effort levels (`off|low|medium|high`).
- Trigger button behavior:
  - shows current effort icon,
  - shows text label only when effort is not `off`,
  - active styling on hover or when effort is enabled.

### Model capability handling
- Supported levels come from model metadata (`reasoning.mode/levels`).
- On model switch:
  - if current level is not supported, reasoning is forced to `off`.
- This is implemented in `app/components/ChatInput.client.vue`.

### Reasoning control states
- One shared helper decides a model's reasoning state:
  `getReasoningControlState()` in `shared/utils/reasoning.ts`, or
  `getGatewayReasoningControlState()` for gateway models.
- The model picker's brain badge, the chat input control and the server's
  reasoning-output rule all read this helper, so they cannot disagree.
  The sync rule is in `docs/models-data-fetching.md`.
- `configurable` (curated `reasoning` levels or toggle): the input shows
  the `ReasoningTrigger` effort dropdown.
- `always-on` (curated `reasoningAlwaysOn`, or a Cloudflare gateway model
  whose catalog reports reasoning):
  - The input shows the reasoning button pressed (`btn-active`) and
    disabled (`aria-disabled`, `pointer-events-none`, no click handler).
    Its title is "Reasoning is always on for this model".
  - This is the same pattern as the forced-on "Create image" button for
    image-only models.
  - In the mobile overflow menu, the effort list is replaced by one
    "Reasoning" row with a checked, disabled toggle. This mirrors the
    image-only "Create image" row.
  - The picker labels the badge "Always reasons".
  - The requested level stays `off`, because no effort is sent.
- Cloudflare's `always-on` is inferred from its catalog `reasoning`
  property, which marks capability. A hybrid model that defaults to
  non-thinking would be mislabeled. This has not been checked against the
  live Cloudflare catalog.
- `none`: no badge and no control.
- Image generation and deep research hide the always-on button just as they
  hide the effort dropdown.

### Hidden reasoning indicator
- Some models reason but return no readable reasoning text. Examples are
  xAI `grok-4.20-0309-reasoning` and `grok-4.5`; see
  `docs/providers/xai.md`.
- When an assistant message has no reasoning text,
  `Chat/Reasoning.vue` shows a compact, non-expandable row: `Reasoned ·
  N tokens`.
  - `N` is `metadata.usage.reasoningTokens`, and the row only appears when
    `N` is above zero.
  - The row's title says the reasoning text is not available for this
    response, and that reasoning tokens are billed as output.
- It never shows when reasoning text exists (DeepSeek, Anthropic, Google,
  OpenAI summaries). Empty-text reasoning parts, which the SDK emits for
  encrypted reasoning, count as "no text".
- It shows for any requested level, so `Off` on a model that cannot
  disable reasoning (e.g. `grok-4.5`) is visibly honest.
- Usage arrives with the finish metadata, so the indicator appears when the
  turn ends, not during streaming. Duration is not persisted, which is why
  it shows tokens rather than "Thought for Xs".
- History works because `useChat()` hydrates `usage` into
  `metadata.usage`. The shared page does the same with
  `hydrateMessageUsage`, but a share only exposes `usage` when it was
  created with metadata visible.

### Message reasoning panel (`Chat/Reasoning.vue`)
- Rendered only when reasoning parts exist.
- Header icon matches effective effort level for that message.
- Header title:
  - `Reasoning process` (steady),
  - `Reasoning` while streaming before full title parse,
  - parsed streaming title when complete markdown title appears,
  - plain-text fallback when markdown titles are missing:
    - use first sentence as title,
    - if sentence is long, cut by first comma,
    - supports `.` `!` `?` and `。` `！` `？` sentence endings.
- Duration label:
  - live seconds during reasoning stream,
  - final duration after stream ends.
- Timeline:
  - one item per parsed reasoning section,
  - streaming step marker uses loader,
  - finished steps use complete marker,
  - each step is collapsible.

Note:
- Current fallback title length threshold is static (`80` chars).
- Future option: make this threshold configurable per model or effort level.

### Auto-expand/follow logic
- Global preference: `reasoningExpanded`.
- If enabled and reasoning is streaming:
  - main section auto-opens,
  - latest step auto-opens (follow mode).
- If disabled:
  - user can manually open during streaming,
  - temporary per-message follow mode is enabled.
- Follow mode resets when:
  - assistant text starts,
  - reasoning stream ends,
  - user collapses manually.

### Collapse when answer text starts
- As soon as any assistant `text` part appears:
  - main reasoning section collapses,
  - expanded step collapses,
  - temporary follow override resets.

## Persistence and sync

### Reasoning effort (chat-level preference)
- Key: `settings_reasoning_level` (local storage).
- Saved in `useChat`.
- Sent with each user message and persisted in `messages.reasoning`.

### Reasoning expanded (UI preference)
- Fallback key: `settings_reasoning_expanded` (local storage).
- Synced setting for signed-in users:
  - DB table: `user_settings.reasoning_expanded`,
  - API:
    - `GET /api/v1/profiles/settings`
    - `PATCH /api/v1/profiles/settings`.
- Client sync flow (`useUserSetting`):
  - loaded lazily on session fetch (client),
  - cached in Nuxt state,
  - local storage used as fallback.

## Data and API contracts

### Canonical reasoning levels
- Shared type:
  - `ReasoningLevel = 'off' | 'low' | 'medium' | 'high'`.

### Chat endpoints
- `POST /api/v1/chats/[slug]` and `PUT /api/v1/chats/new` accept:
  - `reasoning: z.enum(['off', 'low', 'medium', 'high'])`.
- Streaming behavior:
  - `sendReasoning` comes from `shouldSendReasoning(level, state)`. It is
    disabled when `reasoning === 'off'`, unless the model is `always-on`.
    An always-on model's level is always `off`, and its reasoning text
    used to be stripped before reaching the client and the database.
  - The disconnect-retry replay (issue #263) applies the same rule to the
    persisted message's level and the selected direct model. Gateway
    replays fall back to the level alone, because the gateway catalog is
    not loaded at that point.

### Message persistence
- `messages.reasoning` is stored as text enum, not boolean.
- Legacy normalization still maps:
  - `true -> medium`,
  - `false/null -> off`,
  - `hard/xhigh -> high`.

## Provider mapping behavior

### Capability-first fallback
- Requested level is resolved against model capability
  (`resolveReasoningLevelForModel`).
- If unsupported, resolved level becomes `off`.

### Provider-agnostic effort (AI SDK v7)
- Effort is set once via the top-level `reasoning` option on `streamText`.
  `toReasoningEffort` maps `off -> none`; `low|medium|high` pass through.
- The SDK maps that effort to each provider natively:
  - OpenAI -> `reasoningEffort`,
  - Gemini 3 -> `thinkingLevel`,
  - Gemini 2.5 -> a computed `thinkingBudget`.
- `providerOptions` carries only the reasoning *output* flags, which the SDK
  never enables on its own:
  - OpenAI: `reasoningSummary: 'detailed'`,
  - Google: `thinkingConfig.includeThoughts: true`.

### Behavior change from the v6 implementation
The hand-rolled provider mapping was removed in the v7 upgrade:
- fixed Gemini 2.5 budgets (`low: 1024`, `medium: 8192`, `high: 24576`) are no
  longer set — the SDK computes the budget per model;
- the `gemini-3-pro-preview` / `gemini-3.1-pro-preview` `medium -> high`
  upgrade quirk was dropped (requested `medium` now maps to provider `medium`).

## `/chats/test` behavior

### Query parameters
- `scenario=short|long|reasoning`
- `messages=<number>`
- `effort=off|low|medium|high`

### Important semantics
- `scenario=reasoning&effort=off` is treated as effective `short`.
- In dev test chat, changing effort in UI syncs `effort` query param.

### Synthetic reasoning steps
- `off -> 0`
- `low -> 2`
- `medium -> 4`
- `high -> 6`

## Test coverage

### Unit
- `tests/unit/utils/reasoning.spec.ts`
  - reasoning markdown parsing and title extraction.
- `tests/unit/utils/reasoning-levels.spec.ts`
  - normalization, capability checks, provider mapping, control states,
    `shouldSendReasoning`.
- `tests/unit/providers/reasoning-control-state.spec.ts`
  - representative models per provider, plus a guard that iterates the
    whole merged catalog and checks that the picker badge and the input
    control agree.
- `tests/unit/components/ChatInput/ModelsTrigger/ModelItem.spec.ts`
  - catalog-wide rendered guard: the brain badge renders exactly when the
    input offers a reasoning control.
- `tests/unit/components/ChatInput.spec.ts`,
  `tests/unit/components/ChatInput/ToolbarMore.spec.ts`
  - configurable, always-on (visible, active, disabled, click does not
    change the level) and none.
- `tests/unit/components/Chat/Reasoning.spec.ts`
  - the hidden-reasoning indicator.
- `tests/unit/composables/user-setting.spec.ts`
  - fallback behavior, lazy load behavior, persistence path.

### Integration
- `tests/integration/api/chats-test-endpoint.spec.ts`
  - effort-based reasoning step counts and `off` behavior.
- `tests/integration/api/profile-settings.spec.ts`
  - auth checks, defaults, upsert behavior, validation errors.
