import { z } from 'zod'
import { buildMcpSkillContext } from '~~/server/utils/mcp/private/skill-context'
import {
  MCP_SKILL_DELETE_MAX,
  MCP_SKILL_ID_PATTERN,
  deleteMcpSkills,
} from '~~/server/utils/mcp/private/skills'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  ids: z
    .array(z.string().regex(MCP_SKILL_ID_PATTERN))
    .min(1)
    .max(MCP_SKILL_DELETE_MAX)
    .describe('Skill ids from list_skills, 1 to '
      + `${MCP_SKILL_DELETE_MAX}`),
  confirm: z
    .literal(true)
    .describe('Must be true, confirmed by the user'),
}

type DeleteSkillsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const deleteSkillsBesidkaTool = defineBesidkaTool({
  name: 'delete_skills',
  title: 'Delete skills',
  description: 'Permanently delete skills from your Besidka account with '
    + 'all their versions and files, and the per-chat choices that refer to '
    + 'them. This cannot be undone: ask the user to confirm first and send '
    + 'confirm: true. Reports the ids that were deleted and the ones that '
    + 'were not found among your skills. Requires signing in '
    + '(data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'delete',
  chat: {
    excluded: 'Skill management stays in the Besidka app and on the MCP '
      + 'server.',
  },
  handler: async (input: DeleteSkillsInput, context) => {
    const result = await deleteMcpSkills(
      buildMcpSkillContext(context),
      { ids: input.ids },
    )

    context.log({
      requested_count: input.ids.length,
      deleted_count: result.deleted.length,
    })

    return result
  },
})
