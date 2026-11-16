import { z } from 'zod'
import { buildMcpSkillContext } from '~~/server/utils/mcp/private/skill-context'
import {
  MCP_SKILL_LIST_DEFAULT_LIMIT,
  MCP_SKILL_LIST_MAX_LIMIT,
  listMcpSkills,
} from '~~/server/utils/mcp/private/skills'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe('The nextCursor of the previous page'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MCP_SKILL_LIST_MAX_LIMIT)
    .optional()
    .describe(`Page size, 1 to ${MCP_SKILL_LIST_MAX_LIMIT}, default `
      + `${MCP_SKILL_LIST_DEFAULT_LIMIT}`),
  kind: z
    .enum(['skill', 'command'])
    .optional()
    .describe('command lists skills that have a /command, skill lists the '
      + 'others; omit for both'),
}

type ListSkillsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const listSkillsBesidkaTool = defineBesidkaTool({
  name: 'list_skills',
  title: 'List my skills',
  description: 'List the skills and commands saved in your Besidka account, '
    + 'most recently changed first, without their text: id, name, '
    + 'description, whether it is switched on, status (ready, needs-review '
    + 'or broken), license class, source, version, pending update, file '
    + 'count, size, who created it, whether the model may pick it by itself '
    + 'and its /command. Only your own skills. Use nextCursor to get the '
    + 'next page. Requires signing in (skills:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: {
    excluded: 'Skill management stays in the Besidka app and on the MCP '
      + 'server: a skill is a persistent instruction source, so a chat '
      + 'must not read or change the skills that steer it.',
  },
  handler: async (input: ListSkillsInput, context) => {
    const result = await listMcpSkills(buildMcpSkillContext(context), input)

    context.log({ result_count: result.skills.length })

    return result
  },
})
