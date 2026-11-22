import { z } from 'zod'
import { createError } from 'evlog'
import {
  DEBUG_INFO_DEFAULT_MESSAGES,
  DEBUG_INFO_MAX_MESSAGES,
  formatDebugReport,
  getDebugInfo,
  resolveDebugRuntime,
} from '~~/server/utils/mcp/private/debug-info'
import {
  isMcpConnectorsAvailable,
} from '~~/server/utils/mcp/private/connectors'
import { buildMcpConnectorContext } from '~~/server/utils/mcp/private/connector-context'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const CHAT_CONNECTORS_NOTE = 'Connectors: left out in the chat. Use "Copy '
  + 'debug info" in the chat panel for the full report.'

const inputSchema = {
  slug: z
    .ulid()
    .optional()
    .describe('Chat slug from list_chats. Inside a Besidka chat it '
      + 'defaults to the current chat. Leave it out for account-level '
      + 'information only'),
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(DEBUG_INFO_MAX_MESSAGES)
    .optional()
    .describe(`Newest messages to include, 1 to ${DEBUG_INFO_MAX_MESSAGES}. `
      + `Defaults to ${DEBUG_INFO_DEFAULT_MESSAGES}`),
}

type GetDebugInfoInput = z.infer<z.ZodObject<typeof inputSchema>>

export const getDebugInfoBesidkaTool = defineBesidkaTool({
  name: 'get_debug_info',
  title: 'Get debug info',
  description: 'Collect what support or a developer needs to follow one '
    + 'chat: its slug and link, the newest messages as ids, role, time, '
    + 'model, provider, status, tool call counts and any stored failure '
    + 'notice with its reference, the connectors with host and mode (over '
    + 'MCP only, never in a chat), your experimental features, the app '
    + 'build and the server time. Returns the structured data and one '
    + 'plain-text report to copy. Never returns message text, tool input or output, keys, tokens, connector '
    + 'addresses beyond the host or share links. The connectors need the '
    + 'connectors:read scope and the features the settings:read scope. '
    + 'Requires signing in (chats:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'Debug info for support or a developer: ids, models, '
    + 'statuses and failure notices of this chat and your features, plus '
    + 'a ready report. Show the report text to the user '
    + 'verbatim in one code block.',
  handler: async (input: GetDebugInfoInput, context) => {
    const slug = input.slug ?? context.currentChatSlug ?? null
    const isChat = context.currentChatSlug !== undefined

    if (!slug && isChat) {
      throw createError({
        status: 400,
        message: 'There is no current chat to read.',
      })
    }

    const includeConnectors = !isChat
      && context.scopes.includes('connectors:read')
      && await isMcpConnectorsAvailable(buildMcpConnectorContext(context))
    let info: Awaited<ReturnType<typeof getDebugInfo>>

    try {
      info = await getDebugInfo(
        context.db,
        useKV(),
        context.userId,
        {
          slug,
          maxMessages: input.maxMessages ?? DEBUG_INFO_DEFAULT_MESSAGES,
          ...resolveDebugRuntime(),
          includeConnectors,
          connectorsNote: isChat ? CHAT_CONNECTORS_NOTE : null,
          includeFeatures: isChat || context.scopes.includes('settings:read'),
        },
        context.logger,
      )
    } catch (exception) {
      if (!isChat && (exception as { status?: number }).status === 404) {
        throw createError({
          status: 404,
          message: 'Chat not found. Call list_chats to find one.',
        })
      }

      throw exception
    }

    context.log({
      chat_slug: slug ?? 'none',
      result_count: info.chat?.messages.length ?? 0,
    })

    return { report: formatDebugReport(info), ...info }
  },
})
