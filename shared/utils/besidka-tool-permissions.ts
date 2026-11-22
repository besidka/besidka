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
  'ask-every-time': 'Delete and share',
}

export const BESIDKA_TOOL_TIER_DESCRIPTIONS: Record<
  BesidkaToolPermissionTier,
  string
> = {
  'read': 'Look things up in your Besidka data',
  'write': 'Create or change things in your Besidka data',
  'ask-every-time': 'Delete, share or rewrite instructions. Asks first '
    + 'unless you choose Always allow.',
}

export const BESIDKA_TOOL_MODE_LABELS: Record<ToolPermissionMode, string> = {
  blocked: 'Blocked',
  ask: 'Needs approval',
  allow: 'Always allow',
}

const ALL_MODES: readonly ToolPermissionMode[] = ['blocked', 'ask', 'allow']

/**
 * The modes a user may pick for a tool tier. Every tier takes all three
 * since the owner decision of 2026-11-20: the ask-every-time tier asks by
 * default, but the user may set it to Always allow, as on Claude's
 * connector settings.
 */
export function getAllowedBesidkaToolModes(
  tier: BesidkaToolPermissionTier,
): readonly ToolPermissionMode[] {
  return BESIDKA_TOOL_TIERS.includes(tier) ? ALL_MODES : []
}

export function isBesidkaToolModeAllowed(
  tier: BesidkaToolPermissionTier,
  mode: ToolPermissionMode,
): boolean {
  return getAllowedBesidkaToolModes(tier).includes(mode)
}
