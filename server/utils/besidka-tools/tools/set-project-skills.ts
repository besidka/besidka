import { z } from 'zod'
import { buildMcpSkillContext } from '~~/server/utils/mcp/private/skill-context'
import {
  MCP_PROJECT_SKILLS_MAX,
  mcpProjectSkillEntrySchema,
  setMcpProjectSkills,
} from '~~/server/utils/mcp/private/project-skills'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  skills: z
    .array(mcpProjectSkillEntrySchema)
    .max(MCP_PROJECT_SKILLS_MAX)
    .describe('The whole list, in order. It replaces the skills pinned to '
      + `the project now; an empty list removes them all. At most ${
        MCP_PROJECT_SKILLS_MAX
      } skills and 3 at the always level`),
}

type SetProjectSkillsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const setProjectSkillsBesidkaTool = defineBesidkaTool({
  name: 'set_project_skills',
  title: 'Set the skills of a project',
  description: 'Replace the skills pinned to one of your projects. A skill '
    + 'at the always level goes into every message of the project\'s chats; '
    + 'a skill at the prefer level stays in the skills list and is listed '
    + 'first for the model. Only your own existing skills can be pinned, '
    + 'at most 3 at the always level, and the always-level skills must fit '
    + 'a token limit. The tool never changes a skill: a skill that is Off, '
    + 'waiting for review or broken can be pinned but does not load until '
    + 'the user turns it on in Besidka. The result lists the pins, their '
    + 'state and the tokens the always-level skills add to each message. '
    + 'At most 30 skill changes an hour. Requires signing in (skills:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Skill management stays in the Besidka app and on the MCP '
      + 'server: a skill is a persistent instruction source, so a chat '
      + 'must not pin the skills that steer a project.',
  },
  handler: async (input: SetProjectSkillsInput, context) => {
    const result = await setMcpProjectSkills(
      buildMcpSkillContext(context),
      input,
    )

    context.log({
      project_id: input.projectId,
      result_count: result.skills.length,
    })

    return result
  },
})
