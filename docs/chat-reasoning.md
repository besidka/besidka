# Chat reasoning

Scope:
- chat input reasoning controls,
- assistant reasoning rendering,
- provider mapping,
- persistence and sync behavior.

Main files:
- `shared/utils/reasoning.ts`
- `app/components/ChatInput/ToolsMenu/ReasoningSection.vue`
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
- `off` is part of the same selector as `low|medium|high`, except for
  models that cannot stop reasoning (see
  [Models that cannot disable reasoning](#models-that-cannot-disable-reasoning)).

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
  - if current level is not supported, reasoning is replaced by the
    nearest supported one (see
    [Reasoning scale and the round-up rule](#reasoning-scale-and-the-round-up-rule)):
    `off` for a model with no reasoning, the next stronger level for a
    levels model that lacks the requested one, or
    `getDefaultReasoningLevel()` (the curated default) for `off` on a model
    that cannot disable reasoning,
  - the level the user originally asked for is remembered
    (`reasoningLevelBeforeClamp`), so switching back to a model that
    supports it restores it (e.g. `off`, or `medium` after passing through
    Kimi K3).
- This is implemented in `app/components/ChatInput.client.vue`.

### Reasoning scale and the round-up rule
- The scale is `off|low|medium|high` and stays that way by owner decision.
  Provider efforts above it (`xhigh`, `max`) target coding and agentic
  workloads, not chat, so High is the cap even where a provider offers more.
  A provider's own top tier is mapped to High only when it is the model's
  highest (Qwen3.8 calls its top tier `xhigh`; Besidka High sends it).
- A requested level the model lacks **rounds up** to the next supported
  level, and when nothing above is supported, to the highest one below.
  `roundUpReasoningLevel()` in `shared/utils/reasoning.ts` implements it,
  and `resolveSupportedReasoningLevel()` applies it on the client clamp and
  on the server (`resolveReasoningLevelForModel`).
- Models that cannot disable reasoning never show Off. They preselect the
  user's last-used level (rounded) or the curated `defaultLevel`, else
  `medium` rounded up. Kimi K3 (levels low/high) therefore defaults to High.
- Models that can disable reasoning keep Off in the menu, and a missing
  level is rounded the same way (DeepSeek: Medium becomes High).
- Known SDK limits, no action: the installed `@ai-sdk/xai` and
  `@ai-sdk/google` cap the top-level `reasoning` option at `high`.
  OpenAI and Anthropic could reach `xhigh`/`max` through `providerOptions`,
  but Besidka deliberately does not expose them.

### Models that cannot disable reasoning
- Some providers document that a model always reasons and only its effort
  can change. These are curated as `reasoning.levels` with
  `cannotDisable: true` and, where the provider's default is one of the
  curated levels, a `defaultLevel` (the provider's documented default when
  no effort is sent). Without one, the default is `medium` rounded up to a
  supported level.
- For these models:
  - the effort menu has no `Off` item (`getReasoningDropdownLevels`,
    `ReasoningMenuItems` `canDisable`),
  - `isReasoningLevelSupported('off')` is `false`, so a saved or persisted
    `off` is clamped to the default level on the client, and
    `POST /api/v1/chats/[slug]` and every provider adapter
    (`resolveReasoningLevelForModel`) do the same on the server,
  - `off` semantics are never sent: the request carries the default effort
    explicitly and the message is persisted with that level, which also
    turns on reasoning output (OpenAI summaries, Gemini `includeThoughts`).
- This differs from `always-on` (`reasoningAlwaysOn`), which is for models
  that accept no effort parameter at all (`kimi-k2.7-code`, the Qwen
  thinking-only models, `grok-4.20-0309-reasoning`).
- `tests/unit/providers/reasoning-control-state.spec.ts` lists every
  audited model and its default, and fails if any other catalog model
  drops `off`.

#### Provider audit (October 2026)

xAI, OpenAI, Google, DeepSeek and Moonshot pages were blocked by the
sandbox proxy during the audit. Their rows rely on search-engine excerpts
of the official pages, so re-check them on the live pages when touching
these models. The DeepSeek, Moonshot and Qwen3.8 rows were re-verified
against the primary docs on 2026-10-15.

| Model | Can disable | Curated | Default | Source |
|---|---|---|---|---|
| `grok-4.5`, `grok-4.6`, `grok-4.7` | no | `cannotDisable` | `high` | [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning): "Reasoning cannot be disabled", effort "defaults to `high`" |
| `grok-4.3` | yes (`none`) | unchanged | `low` | [xAI grok-4.3](https://docs.x.ai/developers/models/grok-4.3) |
| `grok-4.20-multi-agent-0309` | not documented | unchanged | — | [xAI multi-agent](https://docs.x.ai/developers/model-capabilities/text/multi-agent): effort sets agent count |
| `gpt-6.1-sol` | no | `cannotDisable` | `medium` | [OpenAI gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): "none and minimal reasoning efforts are not supported" |
| `gpt-5`, `gpt-5-mini`, `gpt-5-nano` | no (lowest `minimal`) | `cannotDisable` | `medium` | [OpenAI gpt-5](https://developers.openai.com/api/docs/models/gpt-5); mini/nano assumed to match gpt-5 |
| `o3`, `o4-mini` | no (`low`..`high`) | `cannotDisable` | `medium` | [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) |
| `gpt-5.1`, `gpt-5.2`, `gpt-5.4*` | yes, `none` is the default | unchanged | `none` | OpenAI model pages |
| `gpt-5.5`, `gpt-5.6-*`, `gpt-6-sol`, `gpt-6-luna` | yes (`none`) | unchanged | `medium` | OpenAI model pages |
| `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash` | no | `cannotDisable` | `medium` | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking): `minimal` "does not guarantee that thinking is off" |
| `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview` | no | `cannotDisable` | `high` | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking): "you cannot disable thinking for Gemini 3.1 Pro" |
| `gemini-2.5-pro` | no (budget >= 128) | `cannotDisable` | dynamic; curated `medium` | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking): "Cannot disable thinking" |
| `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` | no, but default is `minimal` | unchanged | `minimal` | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking). `Off` sends nothing, which is the lowest effort; forcing `low` would raise cost |
| `gemini-3.7-flash` | not documented | unchanged | — | no page found |
| `gemini-2.5-flash`, `gemini-2.5-flash-lite` | yes (budget 0) | unchanged | dynamic / off | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) |
| `claude-opus-5-5` | no | `cannotDisable` | `medium` | [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort): "Adaptive thinking is always on and can't be turned off" |
| other Claude models | yes | unchanged | — | [Anthropic thinking troubleshooting](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting) |
| `deepseek-flash`, `deepseek-v4-pro` | yes (`thinking: disabled`, effort `none`) | levels `low`, `high` + Off | `high` | [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode); `minimal` maps to `low`, `medium`/`xhigh` to `high`, `max` unused |
| `kimi-k2.6` | yes | unchanged (toggle) | on | Kimi K2.6 quickstart; `thinking` enabled/disabled only, no levels |
| `kimi-k3` | no | levels `low`, `high` + `cannotDisable` | `high` (Moonshot's own default is `max`) | Kimi K3 quickstart; `reasoning_effort` `low`/`high`/`max`, docs say not to send `thinking`. models.dev reports the effort options; the earlier on/off curation was a mapping gap, not a source limitation |
| `kimi-k2.7-code`, `kimi-k2.7-code-highspeed` | no, no effort accepted | already `reasoningAlwaysOn` | — | Kimi K2.7 Code quickstart; `thinking.type` only `enabled` |
| `qwen3.8-max`, `qwen3.8-flash`, `qwen3.8-omni-flash` | yes (`none`) | levels `low`, `medium`, `high` + Off | `xhigh` on Alibaba's side (Besidka High) | Alibaba DashScope deep-thinking docs: `reasoning_effort` `low`/`medium`/`xhigh`; `high`/`max` map to `xhigh` |
| hybrid Qwen (`qwen3.7-*`, `qwen3.6-*`, `qwen3.5-*`, `qwen-plus`/`flash`/`turbo`, `qwen3-*`) | yes | unchanged (toggle) | — | only `enable_thinking` plus a raw `thinking_budget`; no discrete levels, and inventing them from a token count would fabricate a scale |
| `grok-4.20-0309-reasoning`, `grok-build-0.1`, `qwq-plus`, `qvq-max`, `qwen3-next-80b-a3b-thinking`, `qwen3-vl-235b-a22b`, `qwen3-vl-30b-a3b` | no, no effort accepted | already `reasoningAlwaysOn` | — | empty effort options in models.dev and the docs |

Known gap, not addressed here: for models that *can* disable reasoning
but reason by default (`gpt-5.5`+, `gpt-6-*`, `grok-4.3`, Claude 5-family
"On" models), `off` still sends no effort, so the provider default
applies and the model may reason. The message menu's reasoning row and the
hidden-reasoning indicator show the billed tokens in that case.

Covered exception: the direct OpenAI image-generation path. When a send
uses the `image_generation` tool and the resolved level is `off` (always the
case for `gpt-image-*`, which has no reasoning capability), `useOpenAI()` in
`server/utils/providers/openai.ts` puts `reasoningEffort: 'none'` in
`providerOptions.openai`, so the `gpt-6-luna`/`gpt-6-sol` controller stops
reasoning silently and billing hidden tokens. Gated by the small
`IMAGE_CONTROLLERS_SUPPORTING_NO_REASONING` set (only those two gpt-6 ids
accept `none`). Text sends and gateway paths are unchanged.

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
- It shows for any requested level, so a model that reasons at `off`
  (an always-on model, or a provider default the app does not turn off)
  is visibly honest.
- The message context menu (`Chat/ContextMenu.client.vue`) follows the
  same rule: its Reasoning row shows whenever `usage.reasoningTokens > 0`,
  whatever the level. At level `off` it reads "Model default" with the
  medium icon.
- One row rule: a message never renders both the indicator and the steps
  panel. When steps exist (for example the past-chat pre-retrieval step on an
  image send) and there is no reasoning text, the indicator is folded into the
  steps header: after the turn it reads `Reasoned · N tokens` (with the same
  tooltip) instead of `Steps`, and at level `off` it uses the medium icon.
  While live it stays `Working`. The standalone row only renders with no steps.
- Usage arrives with the finish metadata, so the indicator appears when the
  turn ends, not during streaming. Duration is not persisted, which is why
  it shows tokens rather than "Thought for Xs".
- History works because `useChat()` hydrates `usage` into
  `metadata.usage`. The shared page does the same with
  `hydrateMessageUsage`, but a share only exposes `usage` when it was
  created with metadata visible.

### Message reasoning panel (`Chat/Reasoning.vue`)
- Rendered only when reasoning parts exist.
- Header icon matches effective effort level for that message. A message
  persisted at `off` that still has reasoning text (an always-on model)
  uses the medium icon instead of the slashed "off" brain.
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
- The default comes from `useUserSetting().defaultReasoningLevel` (server
  backed, with the legacy `settings_reasoning_level` local storage value as a
  fallback), resolved by `resolveInitialReasoningLevel()`.
- Picking a level in the chat input changes only the current chat. It is
  saved as the default only through the menu's "Save as default" toggle or
  the Preferences page (see `docs/chats/chat-input-tools-menu.md`).
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
    persisted message's level, via `getReplayReasoningControlState()`.
    Direct models use the selected model. The gateway catalog is not
    loaded at replay time, so a gateway reply is judged as if the model
    reasons: Cloudflare replays as `always-on`, OpenRouter/Vercel keep the
    level rule. This is safe because the persisted parts come from the same
    UI stream that already applied `sendReasoning` at first delivery, so
    they only hold reasoning text that delivery chose to send. A separate
    persisted flag would duplicate that decision and need a schema change.

### Message persistence
- `messages.reasoning` is stored as text enum, not boolean.
- Legacy normalization still maps:
  - `true -> medium`,
  - `false/null -> off`,
  - `hard/xhigh -> high`.

## Provider mapping behavior

### Capability-first fallback
- Requested level is resolved against model capability
  (`resolveReasoningLevelForModel` -> `resolveSupportedReasoningLevel`).
- If unsupported, resolved level becomes `off`, or the curated
  `defaultLevel` for a model that cannot disable reasoning.

### Provider-agnostic effort (AI SDK v7)
- Effort is set once via the top-level `reasoning` option on `streamText`.
  `toReasoningEffort` maps `off -> undefined` (no effort sent, so the
  provider default applies); `low|medium|high` pass through.
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
    `shouldSendReasoning`, the cannot-disable fallback and the replay
    control state.
- `tests/unit/providers/reasoning-control-state.spec.ts`
  - representative models per provider, plus a guard that iterates the
    whole merged catalog and checks that the picker badge and the input
    control agree, and that exactly the audited models drop `off` and
    resolve it to their default.
- `tests/unit/components/ChatInput/ModelsTrigger/ModelItem.spec.ts`
  - catalog-wide rendered guard: the brain badge renders exactly when the
    input offers a reasoning control.
- `tests/unit/components/ChatInput.spec.ts`,
  `tests/unit/components/ChatInput/ToolbarMore.spec.ts`
  - configurable, always-on (visible, active, disabled, click does not
    change the level) and none, plus the cannot-disable clamp and restore
    on model switch.
- `tests/unit/components/ChatInput/ReasoningMenuItems.spec.ts`
  - no `Off` item for a model that cannot disable reasoning.
- `tests/unit/components/Chat/ContextMenu.client.spec.ts`
  - the Reasoning row at level `off` with and without billed tokens.
- `tests/unit/components/Chat/Reasoning.spec.ts`
  - the hidden-reasoning indicator.
- `tests/unit/composables/user-setting.spec.ts`
  - fallback behavior, lazy load behavior, persistence path.

### Integration
- `tests/integration/api/chats-test-endpoint.spec.ts`
  - effort-based reasoning step counts and `off` behavior.
- `tests/integration/api/chats-duplicate-message.spec.ts`
  - replayed reasoning for always-on direct models and Cloudflare gateway
    replies.
- `tests/integration/api/profile-settings.spec.ts`
  - auth checks, defaults, upsert behavior, validation errors.
