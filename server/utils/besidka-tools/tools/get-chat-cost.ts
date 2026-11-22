import { z } from 'zod'
import { createError } from 'evlog'
import {
  formatChatCostReport,
  getChatCost,
} from '~~/server/utils/usage/chat-cost'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  slug: z
    .ulid()
    .optional()
    .describe('Chat slug from list_chats. Inside a Besidka chat it '
      + 'defaults to the current chat'),
}

type GetChatCostInput = z.infer<z.ZodObject<typeof inputSchema>>

export const getChatCostBesidkaTool = defineBesidkaTool({
  name: 'get_chat_cost',
  title: 'Get chat cost',
  description: 'What one chat cost on your own provider keys, estimated '
    + 'from public prices: per model the replies, uncached input, output, '
    + 'cache read and cache write tokens and the cost (a gateway reports one '
    + 'blended cost), the web search cost per search provider, the total '
    + 'and the time from the first to the last message. The same total as '
    + 'the chat panel. Returns the structured data and one plain-text '
    + 'report to show. The provider\'s bill is authoritative. Requires '
    + 'signing in (chats:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'The estimated cost of this chat by model, with token '
    + 'counts and search cost, plus a ready report. Show the report text to '
    + 'the user verbatim in one code block.',
  handler: async (input: GetChatCostInput, context) => {
    const slug = input.slug ?? context.currentChatSlug ?? null

    if (!slug) {
      throw createError({
        status: 400,
        message: 'Give the chat slug. Call list_chats to find one.',
      })
    }

    const cost = await getChatCost(context.db, context.userId, slug)

    context.log({
      chat_slug: slug,
      result_count: cost.models.length,
    })

    return { report: formatChatCostReport(cost), ...cost }
  },
})
