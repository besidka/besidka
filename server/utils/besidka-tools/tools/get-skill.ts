import { z } from 'zod'
import { buildMcpSkillContext } from '~~/server/utils/mcp/private/skill-context'
import {
  MCP_SKILL_FILE_MAX_CHARS,
  MCP_SKILL_ID_PATTERN,
  getMcpSkill,
} from '~~/server/utils/mcp/private/skills'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  id: z
    .string()
    .regex(MCP_SKILL_ID_PATTERN)
    .describe('Skill id from list_skills'),
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('A version number to inspect, such as the pendingVersion of '
      + 'a skill; default the current version'),
  path: z
    .string()
    .min(1)
    .max(400)
    .optional()
    .describe('A file path from the file list, such as SKILL.md. Returns '
      + 'that file as text instead of only the list'),
}

type GetSkillInput = z.infer<z.ZodObject<typeof inputSchema>>

export const getSkillBesidkaTool = defineBesidkaTool({
  name: 'get_skill',
  title: 'Read a skill',
  description: 'Read one of your skills: its details and file list, or with '
    + `path the text of one file (at most ${MCP_SKILL_FILE_MAX_CHARS} `
    + 'characters, with truncated set when it was cut). Pass version to '
    + 'inspect an older version or a pending update. Only your own skills. '
    + 'Requires signing in (skills:read).',
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
  handler: async (input: GetSkillInput, context) => {
    const result = await getMcpSkill(buildMcpSkillContext(context), input)

    context.log({ skill_id: result.id })

    return result
  },
})
