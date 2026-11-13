import { stringify } from 'yaml'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'

export const BLANK_SKILL_DESCRIPTION
  = 'Describe what this skill does and when the model should use it'

export const BLANK_COMMAND_ARGUMENT_HINT = 'What to apply this to'

export interface BlankSkillFile {
  path: string
  content: string
}

export function buildSkillFrontmatter(input: {
  name: string
  description: string
}): string {
  const yamlText = stringify(
    { name: input.name, description: input.description },
    { lineWidth: 0 },
  )

  return `---\n${yamlText}---\n`
}

/**
 * The `SKILL.md` of a skill or command written from nothing. The command body
 * uses `$ARGUMENTS`, which the invocation replaces with the text the user
 * types after the command (docs/skills.md section 5.5).
 */
export function buildBlankSkillFiles(input: {
  name: string
  description: string
  kind: 'skill' | 'command'
}): BlankSkillFile[] {
  const body = input.kind === 'command'
    ? '\n# Task\n\nApply the instructions below to this input.\n\n'
    + '$ARGUMENTS\n\n# Steps\n\n1. Read the input.\n2. Do the task.\n'
    + '3. Answer in the format the user asked for.\n'
    : '\n# When to use this skill\n\nDescribe the situations that call for it.'
      + '\n\n# Steps\n\n1. Read the request.\n2. Do the task my way.\n'
      + '3. Check the result before answering.\n'

  return [{
    path: SKILL_MD_FILE_NAME,
    content: `${buildSkillFrontmatter(input)}${body}`,
  }]
}
