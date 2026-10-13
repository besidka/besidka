import type { GatewayId } from '#shared/types/gateways.d'
import type { Model } from '#shared/types/providers.d'
import type {
  ReasoningLevel,
  ReasoningEnabledLevel,
  ReasoningCapability,
  ReasoningControlState,
} from '#shared/types/reasoning.d'
import { isGatewayReasoningSupported } from '#shared/utils/gateway-capabilities'

export const reasoningEnabledLevels: ReasoningEnabledLevel[] = [
  'low',
  'medium',
  'high',
]

export function normalizeReasoningLevel(
  value: unknown,
): ReasoningLevel {
  if (value === true) {
    return 'medium'
  }

  if (value === false || value == null) {
    return 'off'
  }

  if (value === 'hard' || value === 'xhigh') {
    return 'high'
  }

  if (value === 'off' || value === 'low'
    || value === 'medium' || value === 'high') {
    return value
  }

  return 'off'
}

export function getReasoningCapability(
  model: Pick<Model, 'reasoning'> | null | undefined,
): ReasoningCapability | null {
  if (!model?.reasoning) {
    return null
  }

  if (model.reasoning.mode === 'toggle') {
    return model.reasoning
  }

  const levels = reasoningEnabledLevels.filter((level) => {
    return model.reasoning?.mode === 'levels'
      && model.reasoning.levels.includes(level)
  })

  if (levels.length === 0) {
    return null
  }

  if (!model.reasoning.cannotDisable) {
    return {
      mode: 'levels',
      levels,
    }
  }

  const curatedDefault = model.reasoning.defaultLevel

  return {
    mode: 'levels',
    levels,
    cannotDisable: true,
    defaultLevel: curatedDefault && levels.includes(curatedDefault)
      ? curatedDefault
      : levels[levels.length - 1],
  }
}

export function canDisableReasoning(
  capability: ReasoningCapability | null,
): boolean {
  return !(capability?.mode === 'levels' && capability.cannotDisable)
}

/**
 * The level an unsupported request falls back to: `off` when the model can
 * stop reasoning, otherwise the provider's own default effort, so a model
 * that cannot stop reasoning never receives `off`.
 */
export function getDefaultReasoningLevel(
  capability: ReasoningCapability | null,
): ReasoningLevel {
  if (capability?.mode === 'levels' && capability.cannotDisable) {
    return capability.defaultLevel
      ?? capability.levels[capability.levels.length - 1]
      ?? 'off'
  }

  return 'off'
}

export function resolveSupportedReasoningLevel(
  level: ReasoningLevel,
  capability: ReasoningCapability | null,
): ReasoningLevel {
  if (isReasoningLevelSupported(level, capability)) {
    return level
  }

  return getDefaultReasoningLevel(capability)
}

/**
 * The one reasoning signal the model picker badge, the chat-input control,
 * and the server's reasoning-output decision all read, so they cannot drift
 * apart again. `configurable` means effort levels (or an on/off toggle) can
 * be chosen; `always-on` means the model always reasons and no effort can be
 * sent; `none` means the model does not reason.
 */
export function getReasoningControlState(
  model: Pick<Model, 'reasoning' | 'reasoningAlwaysOn'> | null | undefined,
): ReasoningControlState {
  if (getReasoningCapability(model)) {
    return 'configurable'
  }

  if (model?.reasoningAlwaysOn) {
    return 'always-on'
  }

  return 'none'
}

/**
 * Gateway counterpart of `getReasoningControlState`: a model whose catalog
 * reports reasoning is `configurable` only on a gateway that can forward an
 * effort request, and `always-on` on one that cannot (Cloudflare), because
 * the routed model still reasons at its own default.
 */
export function getGatewayReasoningControlState(
  gatewayId: GatewayId,
  supportsReasoning: boolean | undefined,
): ReasoningControlState {
  if (supportsReasoning !== true) {
    return 'none'
  }

  return isGatewayReasoningSupported(gatewayId) ? 'configurable' : 'always-on'
}

/**
 * Control state used when replaying a persisted reply. The gateway catalog
 * is not loaded at replay time, so a gateway reply is judged as if the
 * model reasons: persisted parts only carry reasoning text the first
 * delivery already decided to send, Cloudflare (no effort forwarding) then
 * replays it as `always-on`, and OpenRouter/Vercel keep the level rule.
 */
export function getReplayReasoningControlState(
  gatewayId: GatewayId | undefined,
  model: Pick<Model, 'reasoning' | 'reasoningAlwaysOn'> | null | undefined,
): ReasoningControlState {
  if (gatewayId) {
    return getGatewayReasoningControlState(gatewayId, true)
  }

  return getReasoningControlState(model)
}

export const REASONING_ALWAYS_ON_TITLE
  = 'Reasoning is always on for this model'

export function hasReasoningBadge(state: ReasoningControlState): boolean {
  return state !== 'none'
}

export function getReasoningBadgeLabel(
  state: ReasoningControlState,
): string {
  return state === 'always-on' ? 'Always reasons' : 'Reasoning'
}

/**
 * Whether reasoning text the provider returns is forwarded to the client and
 * persisted. An always-on model reasons even though its requested level is
 * `off`, so its trace must not be stripped.
 */
export function shouldSendReasoning(
  level: ReasoningLevel,
  state: ReasoningControlState,
): boolean {
  return level !== 'off' || state === 'always-on'
}

export function isReasoningEnabled(
  level: ReasoningLevel,
): boolean {
  return level !== 'off'
}

export function isReasoningLevelSupported(
  level: ReasoningLevel,
  capability: ReasoningCapability | null,
): boolean {
  if (level === 'off') {
    return canDisableReasoning(capability)
  }

  if (!capability) {
    return false
  }

  if (capability.mode === 'toggle') {
    return true
  }

  return capability.levels.includes(level)
}

export function getReasoningMenuLevels(
  capability: ReasoningCapability | null,
): ReasoningEnabledLevel[] {
  if (!capability) {
    return []
  }

  if (capability.mode === 'toggle') {
    return ['medium']
  }

  return capability.levels
}

export function getReasoningDropdownLevels(
  capability: ReasoningCapability | null,
): ReasoningLevel[] {
  const levels = getReasoningMenuLevels(capability)

  return canDisableReasoning(capability) ? ['off', ...levels] : levels
}
