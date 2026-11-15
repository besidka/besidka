import { z } from 'zod'
import { SKILL_SAVE_MAX_CHANGES } from '#shared/utils/skills-policy'
import { buildMcpSkillContext } from '~~/server/utils/mcp/private/skill-context'
import {
  MCP_SKILL_FILE_MAX_CHARS,
  MCP_SKILL_ID_PATTERN,
  updateMcpSkill,
} from '~~/server/utils/mcp/private/skills'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const pathSchema = z.string().min(1).max(400)

const changeSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('put'),
    path: pathSchema,
    content: z.string().max(MCP_SKILL_FILE_MAX_CHARS),
  }),
  z.object({
    op: z.literal('delete'),
    path: pathSchema,
  }),
  z.object({
    op: z.literal('rename'),
    from: pathSchema,
    to: pathSchema,
  }),
])

const inputSchema = {
  id: z
    .string()
    .regex(MCP_SKILL_ID_PATTERN)
    .describe('Skill id from list_skills'),
  baseVersion: z
    .number()
    .int()
    .min(1)
    .describe('The current version number you read; a skill that changed '
      + 'since is refused'),
  changes: z
    .array(changeSchema)
    .min(1)
    .max(SKILL_SAVE_MAX_CHANGES)
    .describe('Put (add or replace a file), delete or rename a file, in '
      + `order, at most ${SKILL_SAVE_MAX_CHANGES}, at most 400 KiB of file `
      + 'content in all'),
}

type UpdateSkillInput = z.infer<z.ZodObject<typeof inputSchema>>

export const updateSkillBesidkaTool = defineBesidkaTool({
  name: 'update_skill',
  title: 'Update a skill',
  description: 'Change the files of one of your skills. The changes are '
    + 'saved as a pending version, the current version stays as it is, and '
    + 'the skill is switched off with status needs-review until the user '
    + 'accepts the update in Besidka. A pending update that was already '
    + 'waiting is replaced. SKILL.md cannot be deleted or renamed, LICENSE '
    + 'and NOTICE files are protected, and changing the name is refused: '
    + 'use rename_skill. The skill is saved disabled. The user must review '
    + 'and enable it in Besidka at the reviewUrl in the result, which also '
    + 'lists the findings of the scan and a summary of the changed files. '
    + 'At most 30 skill changes an hour. Requires signing in '
    + '(skills:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Skill management stays in the Besidka app and on the MCP '
      + 'server: a skill is a persistent instruction source, so a chat '
      + 'must not write the skills that steer it.',
  },
  handler: async (input: UpdateSkillInput, context) => {
    const result = await updateMcpSkill(buildMcpSkillContext(context), input)

    context.log({
      skill_id: result.id,
      change_count: input.changes.length,
    })

    return result
  },
})
