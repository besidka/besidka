import { z } from 'zod'
import { MEMORY_LIMITS, memoryCategories } from '#shared/utils/memory-policy'
import { addMcpMemory } from '~~/server/utils/mcp/private/memory'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  category: z
    .enum(memoryCategories)
    .describe('profile, preferences, areas, topics or people'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MEMORY_LIMITS.maxTitleChars)
    .describe('Short one-line title'),
  description: z
    .string()
    .trim()
    .min(1)
    .max(MEMORY_LIMITS.maxDescriptionChars)
    .describe('One-line summary used as the memory index'),
  body: z
    .string()
    .min(1)
    .max(MEMORY_LIMITS.maxBodyBytes)
    .describe('The fact to remember, up to 4096 bytes'),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe('Save to this project memory instead of your account'),
}

type AddMemoryInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'add_memory',
  title: 'Remember something',
  description: 'Save a memory entry Besidka uses in future chats. Besidka '
    + 'refuses sensitive topics (health, religion, politics and similar) '
    + 'and never stores ids, card numbers, passwords or keys. Requires '
    + 'signing in (memory:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'add_memory',
    async (input: AddMemoryInput, context) => {
      const entry = await addMcpMemory(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        memory_entry_id: entry.id,
        memory_category: entry.category,
        memory_scope: entry.projectId ? 'project' : 'account',
      })

      return entry
    },
  ),
})
