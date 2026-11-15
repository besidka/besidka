import { z } from 'zod'
import { MEMORY_LIMITS, memoryCategories } from '#shared/utils/memory-policy'
import { updateMcpMemory } from '~~/server/utils/mcp/private/memory'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Memory entry id from list_memory'),
  category: z.enum(memoryCategories).optional(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MEMORY_LIMITS.maxTitleChars)
    .optional(),
  description: z
    .string()
    .trim()
    .min(1)
    .max(MEMORY_LIMITS.maxDescriptionChars)
    .optional(),
  body: z
    .string()
    .min(1)
    .max(MEMORY_LIMITS.maxBodyBytes)
    .optional(),
}

type UpdateMemoryInput = z.infer<z.ZodObject<typeof inputSchema>>

export const updateMemoryBesidkaTool = defineBesidkaTool({
  name: 'update_memory',
  title: 'Edit a memory entry',
  description: 'Change the category, title, description or body of one of '
    + 'your memory entries. The same sensitive-topic and never-store rules '
    + 'as add_memory apply. Requires signing in (memory:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'The chat has its own memory tools, which enforce the memory '
      + 'compliance gate.',
  },
  handler: async (input: UpdateMemoryInput, context) => {
    const entry = await updateMcpMemory(
      context.db,
      context.userId,
      input,
      context.logger,
    )

    context.log({ memory_entry_id: entry.id })

    return entry
  },
})
