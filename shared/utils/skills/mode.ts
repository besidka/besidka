import { isReservedSkillSlashName } from '#shared/utils/skills-policy'

export const SKILL_MODES = ['off', 'auto', 'ask'] as const

export type SkillMode = typeof SKILL_MODES[number]

export interface SkillModeColumns {
  enabled: boolean
  modelInvocable: boolean
  slashCommand: boolean
}

export interface SkillModeInput {
  enabled: boolean
  modelInvocable: boolean
  slashCommand: boolean
}

export const SKILL_MODE_LABELS: Record<SkillMode, string> = {
  off: 'Off',
  auto: 'Auto',
  ask: 'Only when I ask',
}

export const SKILL_MODE_DESCRIPTIONS: Record<SkillMode, string> = {
  off: 'Not available in chats.',
  auto: 'The model uses it when the description matches. You can also run '
    + 'it with /name.',
  ask: 'Runs only when you attach it or type /name.',
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
 * The columns a mode sets. Off touches only `enabled`, so the other two keep
 * what the skill had. Auto and Only when I ask enable the skill and make it a
 * `/name` command unless the name is reserved by Besidka, in which case the
 * skill still works but `slashCommand` stays off.
 */
export function getSkillModeColumns(
  mode: SkillMode,
  name: string,
): Partial<SkillModeColumns> {
  if (mode === 'off') {
    return { enabled: false }
  }

  return {
    enabled: true,
    modelInvocable: mode === 'auto',
    slashCommand: !isReservedSkillSlashName(name),
  }
}

export function isSkillSlashBlocked(
  skill: SkillModeInput & { name: string },
): boolean {
  return skill.enabled
    && !skill.slashCommand
    && isReservedSkillSlashName(skill.name)
}

export function isSkillCommandKind(
  skill: Pick<SkillModeInput, 'modelInvocable' | 'slashCommand'>,
): boolean {
  return skill.slashCommand && !skill.modelInvocable
}

export function isSkillSkillKind(
  skill: Pick<SkillModeInput, 'modelInvocable' | 'slashCommand'>,
): boolean {
  return skill.modelInvocable || !skill.slashCommand
}
