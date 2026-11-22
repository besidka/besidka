import { codeReviewChecklistTemplate } from '#shared/utils/skills/templates/code-review-checklist'
import { meetingNotesTemplate } from '#shared/utils/skills/templates/meeting-notes'
import type { SkillTemplate } from '#shared/utils/skills/templates/types'
import { translateWithGlossaryTemplate } from '#shared/utils/skills/templates/translate-with-glossary'
import { writingStyleTemplate } from '#shared/utils/skills/templates/writing-style'

export type {
  SkillTemplate,
  SkillTemplateFile,
} from '#shared/utils/skills/templates/types'

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  writingStyleTemplate,
  codeReviewChecklistTemplate,
  meetingNotesTemplate,
  translateWithGlossaryTemplate,
]

export const SKILL_TEMPLATE_IDS = SKILL_TEMPLATES.map((template) => {
  return template.id
}) as [string, ...string[]]

export function getSkillTemplate(id: string): SkillTemplate | null {
  return SKILL_TEMPLATES.find((template) => {
    return template.id === id
  }) ?? null
}
