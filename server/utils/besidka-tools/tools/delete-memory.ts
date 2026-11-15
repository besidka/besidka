import { z } from 'zod'
import { deleteMcpMemory } from '~~/server/utils/mcp/private/memory'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Memory entry id from list_memory'),
}

type DeleteMemoryInput = z.infer<z.ZodObject<typeof inputSchema>>

export const deleteMemoryBesidkaTool = defineBesidkaTool({
  name: 'delete_memory',
  title: 'Forget a memory entry',
  description: 'Permanently delete one of your memory entries. Requires '
    + 'signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'delete',
  chat: {
    excluded: 'The chat has its own memory tools, which enforce the memory '
      + 'compliance gate.',
  },
  handler: async (input: DeleteMemoryInput, context) => {
    const result = await deleteMcpMemory(context.db, context.userId, input)

    context.log({ memory_entry_id: result.id })

    return result
  },
})
