import { readSkillFrontmatterData } from '#shared/utils/skills/frontmatter'
import { splitAllowedTools } from '#shared/utils/skills/frontmatter-findings'

export const SKILL_CHANGED_SETTING_KEYS = [
  'allowed-tools',
  'hooks',
  'description',
] as const

export type SkillChangedSettingKey
  = typeof SKILL_CHANGED_SETTING_KEYS[number]

export interface SkillChangedSetting {
  key: SkillChangedSettingKey
  before: string | null
  after: string | null
}

const SETTING_VALUE_MAX_CHARACTERS = 300

function toSettingText(
  key: SkillChangedSettingKey,
  value: unknown,
): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const text = key === 'allowed-tools'
    ? splitAllowedTools(value).join(' ')
    : typeof value === 'string' ? value.trim() : JSON.stringify(value)

  return text === '' ? null : text.slice(0, SETTING_VALUE_MAX_CHARACTERS)
}

function readSettings(
  skillMd: string | undefined,
): Record<SkillChangedSettingKey, string | null> {
  const data = skillMd === undefined
    ? null
    : readSkillFrontmatterData(skillMd)?.data ?? null

  return {
    'allowed-tools': toSettingText('allowed-tools', data?.['allowed-tools']),
    'hooks': toSettingText('hooks', data?.hooks),
    'description': toSettingText('description', data?.description),
  }
}

/**
 * The frontmatter settings a reviewer should re-read when SKILL.md changes:
 * the tools it requests, the hooks it registers and its description, which
 * reaches every message while the skill is on Auto. A setting that reads the
 * same on both sides is left out.
 */
export function diffSkillSettings(
  beforeSkillMd: string | undefined,
  afterSkillMd: string | undefined,
): SkillChangedSetting[] {
  const before = readSettings(beforeSkillMd)
  const after = readSettings(afterSkillMd)

  return SKILL_CHANGED_SETTING_KEYS
    .filter((key) => {
      return before[key] !== after[key]
    })
    .map((key) => {
      return { key, before: before[key], after: after[key] }
    })
}
