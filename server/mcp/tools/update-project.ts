import { z } from 'zod'
import { knowledgeModes } from '#shared/utils/project-knowledge-policy'
import {
  MCP_PROJECT_NAME_MAX_CHARS,
  updateMcpProject,
} from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_PROJECT_NAME_MAX_CHARS)
    .optional()
    .describe('New project name, 1 to 100 characters'),
  pinned: z
    .boolean()
    .optional()
    .describe('true pins the project, false unpins it'),
  archived: z
    .boolean()
    .optional()
    .describe('true archives the project, false restores it'),
  knowledgeMode: z
    .enum(knowledgeModes)
    .optional()
    .describe('How chats use the knowledge: auto, full or search'),
  memoryEnabled: z
    .boolean()
    .optional()
    .describe('true turns project memory on (refused while it is off and '
      + 'automatic updates are on for the project, which can only be '
      + 'resumed in the Besidka app), false turns it off'),
  useAccountMemory: z
    .boolean()
    .optional()
    .describe('Whether chats in the project also use your account memory'),
  memoryAutoUpdate: z
    .enum(['inherit', 'off'])
    .optional()
    .describe('inherit follows your account setting for automatic memory '
      + 'updates (refused while the project is set to off, which can only '
      + 'be changed in the Besidka app), off stops automatic updates for '
      + 'this project. on is not available here: it makes Besidka spend '
      + 'your own API key in the background, so it can only be turned on '
      + 'in the Besidka app'),
}

type UpdateProjectInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'update_project',
  title: 'Update a project',
  description: 'Change settings of one of your Besidka projects: rename it, '
    + 'pin or archive it, set the knowledge mode, turn project memory on or '
    + 'off, choose whether it also uses account memory, or set automatic '
    + 'memory updates to inherit (follow your account setting, not allowed '
    + 'while they are off for the project) or off. Automatic updates '
    + 'cannot be turned on, or back from off, here, only in the app, and '
    + 'project memory cannot be turned back on here while its automatic '
    + 'updates are on. Each '
    + 'field is set to the value you send, never toggled. Turning memory on '
    + 'again '
    + 'restores its state and covers messages written from now on; it does '
    + 'not read earlier chats or call a model (use Refresh in the app to '
    + 'include earlier chats). If a call fails partway, the fields before '
    + 'the failing one are already applied, in the order name, pinned, '
    + 'archived, knowledgeMode, useAccountMemory, memoryAutoUpdate, '
    + 'memoryEnabled. Send at '
    + 'least one field besides projectId. Requires signing in '
    + '(projects:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'update_project',
    async (input: UpdateProjectInput, context) => {
      const result = await updateMcpProject(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        project_id: result.id,
        changed_fields: Object.keys(input)
          .filter((field) => {
            return field !== 'projectId'
          })
          .length,
      })

      return result
    },
  ),
})
