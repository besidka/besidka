import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

export const BESIDKA_TOOL_TIERS = ['read', 'write', 'ask-every-time'] as const

export type BesidkaToolPermissionTier = typeof BESIDKA_TOOL_TIERS[number]

export const BESIDKA_TOOL_DEFAULT_MODE: ToolPermissionMode = 'ask'

export const BESIDKA_TOOL_PERMISSION_WRITES_PER_MINUTE = 60

export const BESIDKA_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

export const BESIDKA_TOOL_NAME_PREFIX = 'besidka__'

export const BESIDKA_CHAT_TOOLS_MAX = 24

export function isBesidkaChatToolName(toolName: string): boolean {
  return toolName.startsWith(BESIDKA_TOOL_NAME_PREFIX)
}

export const BESIDKA_TOOL_TIER_LABELS: Record<
  BesidkaToolPermissionTier,
  string
> = {
  'read': 'Read-only',
  'write': 'Write',
  'ask-every-time': 'Always asks',
}

export const BESIDKA_TOOL_TIER_DESCRIPTIONS: Record<
  BesidkaToolPermissionTier,
  string
> = {
  'read': 'Look things up in your Besidka data',
  'write': 'Create or change things in your Besidka data',
  'ask-every-time': 'Delete, share or rewrite instructions. Always asks first.',
}

export const BESIDKA_TOOL_MODE_LABELS: Record<ToolPermissionMode, string> = {
  blocked: 'Blocked',
  ask: 'Needs approval',
  allow: 'Always allow',
}

const ASK_EVERY_TIME_MODES: readonly ToolPermissionMode[] = ['blocked', 'ask']

const ALL_MODES: readonly ToolPermissionMode[] = ['blocked', 'ask', 'allow']

/**
 * The modes a user may pick for a tool tier. A tool in the ask-every-time
 * tier never runs without a fresh answer, so "Always allow" is not offered
 * for it and the server refuses to store it.
 */
export function getAllowedBesidkaToolModes(
  tier: BesidkaToolPermissionTier,
): readonly ToolPermissionMode[] {
  return tier === 'ask-every-time' ? ASK_EVERY_TIME_MODES : ALL_MODES
}

export function isBesidkaToolModeAllowed(
  tier: BesidkaToolPermissionTier,
  mode: ToolPermissionMode,
): boolean {
  return getAllowedBesidkaToolModes(tier).includes(mode)
}
