export const SKILL_MODES = ['off', 'auto', 'ask'] as const

export type SkillMode = typeof SKILL_MODES[number]

export interface SkillModeColumns {
  enabled: boolean
  modelInvocable: boolean
}

export interface SkillModeInput {
  enabled: boolean
  modelInvocable: boolean
}

export const SKILL_MODE_LABELS: Record<SkillMode, string> = {
  off: 'Off',
  auto: 'Auto',
  ask: 'Only when I ask',
}

export const SKILL_MODE_DESCRIPTIONS: Record<SkillMode, string> = {
  off: 'Not available in chats.',
  auto: 'The model uses it when the description matches. You can also '
    + 'attach it yourself.',
  ask: 'Runs only when you attach it from the + menu or type its command.',
}

export function isSkillMode(value: unknown): value is SkillMode {
  return typeof value === 'string'
    && (SKILL_MODES as readonly string[]).includes(value)
}

export function getSkillMode(skill: SkillModeInput): SkillMode {
  if (!skill.enabled) {
    return 'off'
  }

  return skill.modelInvocable ? 'auto' : 'ask'
}

/**
 * The columns a mode sets. Off touches only `enabled`, so `modelInvocable`
 * keeps what the skill had. The mode is independent of the command: neither
 * one reads or writes the other.
 */
export function getSkillModeColumns(
  mode: SkillMode,
): Partial<SkillModeColumns> {
  if (mode === 'off') {
    return { enabled: false }
  }

  return {
    enabled: true,
    modelInvocable: mode === 'auto',
  }
}
