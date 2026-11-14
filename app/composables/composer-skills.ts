import { getSkillMode } from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import type { SkillSummary } from '#shared/types/skills.d'

export const COMPOSER_SKILLS_SEARCH_MIN = 8

export interface ComposerSkillItem {
  id: string
  name: string
  description: string
  version: number
  mode: SkillMode
}

export function toComposerSkillItem(skill: SkillSummary): ComposerSkillItem {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.currentVersion,
    mode: getSkillMode(skill),
  }
}

/**
 * The skills the "+" menu can attach: enabled and not broken, by name. The
 * list is fetched only while the `skills` flag is on, so a user without the
 * flag costs no request. A failed fetch is an empty list, never an error in
 * the composer.
 */
export function useComposerSkills() {
  const skillsFeature = useFeature('skills')
  const { data, execute } = useLazyFetch('/api/v1/skills', {
    key: SKILLS_LIBRARY_KEY,
    immediate: false,
    server: false,
  })

  const items = computed<ComposerSkillItem[]>(() => {
    if (!skillsFeature.value.active) {
      return []
    }

    return (data.value?.skills ?? [])
      .filter((skill) => {
        return skill.enabled && skill.status !== 'broken'
      })
      .map(toComposerSkillItem)
      .sort((left, right) => left.name.localeCompare(right.name))
  })

  const isVisible = computed<boolean>(() => {
    return skillsFeature.value.active && items.value.length > 0
  })

  watch(() => skillsFeature.value.active, async (isActive) => {
    if (isActive && !data.value) {
      await execute()
    }
  }, { immediate: true })

  return { items, isVisible, refresh: execute }
}

/**
 * The skill shown in the read-only preview dialog. The chat layout mounts
 * one dialog, and the composer tile and the step card in an answer only name
 * the skill.
 */
export function useSkillPreview() {
  const skillId = useState<string | null>('skills:preview', () => null)

  function open(id: string) {
    skillId.value = id
  }

  function close() {
    skillId.value = null
  }

  return { skillId, open, close }
}
