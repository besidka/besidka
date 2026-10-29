import { z } from 'zod'
import { listMcpMemory } from '~~/server/utils/mcp/private/memory'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe('List the memory of this project instead of your account'),
}

type ListMemoryInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'list_memory',
  title: 'List my memory',
  description: 'List what Besidka remembers about you: account memory, or '
    + 'the memory of one project when projectId is given. Each entry has '
    + 'an id, category, title, description and body. Requires signing in '
    + '(memory:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_memory',
    async (input: ListMemoryInput, context) => {
      const result = await listMcpMemory(context.db, context.userId, input)

      context.log({
        memory_scope: result.scope,
        result_count: result.entries.length,
      })

      return result
    },
  ),
})
