import type { KnowledgeTokenFamily } from '#shared/types/project-knowledge.d'
import {
  SKILL_ACTIVATE_MAX_BYTES,
  SKILL_ACTIVATE_MAX_TOKENS,
} from '#shared/utils/skills-policy'
import { SKILL_READ_FILE_TOOL_NAME } from '#shared/utils/skills/runtime'
import type { LoadedSkillContent } from '~~/server/utils/skills/runtime/load'
import {
  SKILL_CONTENT_TAG,
  SKILL_RESOURCES_TAG,
  applySkillArguments,
  neutralizeSkillDelimiters,
  toSkillAttributeValue,
  toSkillSingleLine,
  truncateToByteBudget,
  truncateToTokenBudget,
} from '~~/server/utils/skills/runtime/text'

const RESOURCE_LIST_MAX_ENTRIES = 50
const SCRIPT_NOTE = 'text only, not executable here'

export interface FormattedSkillContent {
  text: string
  isTruncated: boolean
}

function buildTruncationNotice(): string {
  return `[The rest of this skill was cut. Read it with ${
    SKILL_READ_FILE_TOOL_NAME
  } using the path SKILL.md.]`
}

export function buildSkillResourceList(
  files: LoadedSkillContent['files'],
): string {
  const resources = files.filter(file => file.path !== 'SKILL.md')

  if (resources.length === 0) {
    return ''
  }

  const shown = resources.slice(0, RESOURCE_LIST_MAX_ENTRIES)
  const lines = shown.map((file) => {
    const note = file.kind === 'script' ? `, ${SCRIPT_NOTE}` : ''

    return `${toSkillSingleLine(file.path)} (${file.bytes} bytes, ${
      file.kind
    }${note})`
  })

  if (resources.length > shown.length) {
    lines.push(`(+${resources.length - shown.length} more files)`)
  }

  return `<${SKILL_RESOURCES_TAG}>\n${lines.join('\n')}\n</${
    SKILL_RESOURCES_TAG
  }>`
}

/**
 * The text of one skill as the model reads it: the body without its
 * frontmatter, cut at 40 KiB and at `SKILL_ACTIVATE_MAX_TOKENS` for the model
 * family (whichever comes first), with its delimiters neutralised, inside
 * `<skill_content name source version>` and followed by the resource list.
 * `invokedBy` marks a skill the user attached, and `argumentsText` fills
 * `$ARGUMENTS`.
 */
export function formatSkillContent(input: {
  skill: LoadedSkillContent
  family: KnowledgeTokenFamily
  invokedBy?: 'user'
  argumentsText?: string
}): FormattedSkillContent {
  const { skill, family } = input
  const withArguments = input.argumentsText === undefined
    ? skill.body
    : applySkillArguments(skill.body, input.argumentsText)
  const byBytes = truncateToByteBudget(withArguments, SKILL_ACTIVATE_MAX_BYTES)
  const byTokens = truncateToTokenBudget(
    byBytes.text,
    SKILL_ACTIVATE_MAX_TOKENS,
    family,
  )
  const isTruncated = byBytes.isTruncated || byTokens.isTruncated
  const attributes = [
    `name="${toSkillAttributeValue(skill.name)}"`,
    `source="${toSkillAttributeValue(skill.sourceKind)}"`,
    `version="${skill.currentVersion}"`,
    ...(input.invokedBy ? [`invoked="${input.invokedBy}"`] : []),
  ]
  const resources = buildSkillResourceList(skill.files)
  const text = [
    `<${SKILL_CONTENT_TAG} ${attributes.join(' ')}>`,
    neutralizeSkillDelimiters(byTokens.text),
    ...(isTruncated ? [buildTruncationNotice()] : []),
    `</${SKILL_CONTENT_TAG}>`,
    ...(resources ? [resources] : []),
  ].join('\n')

  return { text, isTruncated }
}
