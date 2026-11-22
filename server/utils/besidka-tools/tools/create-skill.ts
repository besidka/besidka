import { z } from 'zod'
import { SKILL_ARGUMENT_HINT_MAX } from '#shared/utils/skills-policy'
import { buildMcpSkillContext } from '~~/server/utils/mcp/private/skill-context'
import {
  MCP_SKILL_FILE_MAX_CHARS,
  MCP_SKILL_FILES_MAX,
  createMcpSkill,
} from '~~/server/utils/mcp/private/skills'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  files: z
    .array(z.object({
      path: z
        .string()
        .min(1)
        .max(400)
        .describe('A relative path such as SKILL.md or references/guide.md'),
      content: z
        .string()
        .max(MCP_SKILL_FILE_MAX_CHARS)
        .describe('The file as text'),
    }))
    .min(1)
    .max(MCP_SKILL_FILES_MAX)
    .describe(`1 to ${MCP_SKILL_FILES_MAX} text files, at most 400 KiB in `
      + 'all. Must include SKILL.md with a name and a description in its '
      + 'frontmatter'),
  argumentHint: z
    .string()
    .max(SKILL_ARGUMENT_HINT_MAX)
    .optional()
    .describe('A short hint for the arguments, such as [file]'),
}

type CreateSkillInput = z.infer<z.ZodObject<typeof inputSchema>>

export const createSkillBesidkaTool = defineBesidkaTool({
  name: 'create_skill',
  title: 'Add a skill',
  description: 'Add a skill (an Agent Skills folder as text files) to your '
    + 'Besidka account. The files go through the same checks as an import: '
    + 'paths, text only, license and content scan. A skill with a '
    + 'restricted license is refused. The skill is saved disabled with '
    + 'status needs-review and has no command and no mode: this tool cannot '
    + 'switch it on, set it to Auto, give it a command or give it '
    + 'permissions, the user does that in Besidka. The skill is saved '
    + 'disabled. The user must '
    + 'review and enable it in Besidka at the reviewUrl in the result, '
    + 'which also lists the findings of the scan. At most 30 skill changes '
    + 'an hour. Requires signing in (skills:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Skill management stays in the Besidka app and on the MCP '
      + 'server: a skill is a persistent instruction source, so a chat '
      + 'must not write the skills that steer it.',
  },
  handler: async (input: CreateSkillInput, context) => {
    const result = await createMcpSkill(buildMcpSkillContext(context), input)

    context.log({ skill_id: result.id, file_count: result.filesCount })

    return result
  },
})
