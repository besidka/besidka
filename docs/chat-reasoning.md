# Chat reasoning

Scope:
- chat input reasoning controls,
- assistant reasoning rendering,
- provider mapping,
- persistence and sync behavior.

Main files:
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

### Message reasoning panel (`Chat/Reasoning.vue`)
- Rendered only when reasoning parts exist.
- Header icon matches effective effort level for that message.
- Header title:
  - `Reasoning process` (steady),
  - `Reasoning` while streaming before full title parse,
  - parsed streaming title when complete markdown title appears.
- Duration label:
  - live seconds during reasoning stream,
  - final duration after stream ends.
- Timeline:
  - one item per parsed reasoning section,
  - streaming step marker uses loader,
  - finished steps use complete marker,
  - each step is collapsible.

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
  - `sendReasoning` is disabled when `reasoning === 'off'`.

### Message persistence
- `messages.reasoning` is stored as text enum, not boolean.
- Legacy normalization still maps:
  - `true -> medium`,
  - `false/null -> off`,
  - `hard/xhigh -> high`.

## Provider mapping behavior

### Capability-first fallback
- Requested level is resolved against model capability.
- If unsupported, resolved level becomes `off`.

### OpenAI
- Canonical mapping:
  - `low -> low`,
  - `medium -> medium`,
  - `high -> high`,
  - `off -> null` (omit reasoning effort).
- Provider options include `reasoningSummary: 'detailed'`.

### Google
- Uses `thinkingConfig`.
- Gemini 2.5 models:
  - use `thinkingBudget` (token budget),
  - budgets:
    - `low: 1024`
    - `medium: 8192`
    - `high: 24576`
- Gemini 3+ models:
  - use `thinkingLevel`.
- Special alignment:
  - for `gemini-3-pro-preview` and `gemini-3.1-pro-preview`,
    requested `medium` maps to provider `high`.

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
  - normalization, capability checks, provider mapping.
- `tests/unit/composables/user-setting.spec.ts`
  - fallback behavior, lazy load behavior, persistence path.

### Integration
- `tests/integration/api/chats-test-endpoint.spec.ts`
  - effort-based reasoning step counts and `off` behavior.
- `tests/integration/api/profile-settings.spec.ts`
  - auth checks, defaults, upsert behavior, validation errors.
