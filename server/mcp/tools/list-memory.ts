import { z } from 'zod'
import {
  listMcpMemory,
  mcpMemoryScopes,
} from '~~/server/utils/mcp/private/memory'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  scope: z
    .enum(mcpMemoryScopes)
    .optional()
    .describe('account (default), project (needs projectId) or all, which '
      + 'lists your account memory and the memory of every project'),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe('List the memory of this project instead of your account. '
      + 'Use with the project scope or without a scope'),
}

type ListMemoryInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'list_memory',
  title: 'List my memory',
  description: 'List what Besidka remembers about you: account memory, or '
    + 'the memory of one project when projectId is given, or both with the '
    + 'all scope. Each entry has an id, category, title, description, body '
    + 'and the project it belongs to (null for account memory). Requires '
    + 'signing in (memory:read).',
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
