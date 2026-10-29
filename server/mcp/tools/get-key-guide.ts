import { z } from 'zod'
import { createError } from 'evlog'
import { queryCollection } from '@nuxt/content/server'
import { getKeyGuideIndex } from '~~/server/utils/mcp/cached-content'
import {
  findGuideEntry,
  formatKeyGuide,
} from '~~/server/utils/mcp/key-guides'
import { toJsonToolResult } from '~~/server/utils/mcp/result'
import { withSafeToolErrors } from '~~/server/utils/mcp/safe-tool'
import { resolveSiteOrigin } from '~~/server/utils/mcp/site-origin'

export default defineMcpTool({
  name: 'get_key_guide',
  title: 'Get API key guide',
  description: 'Get the step-by-step guide for creating an API key at a '
    + 'provider and adding it to Besidka: requirements (card, minimum '
    + 'top-up, free tier), numbered steps as markdown, FAQ and source '
    + 'links. Pass a provider id from list_providers (for example openai) '
    + 'or a guide slug (for example openai-api-key).',
  inputSchema: {
    provider: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('Provider id or key guide slug'),
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withSafeToolErrors(async ({ provider }) => {
    const event = useEvent()
    const guides = await getKeyGuideIndex(event)
    const entry = findGuideEntry(guides, provider)

    if (!entry) {
      throw createError({
        status: 404,
        message: `No key guide for "${provider}". Call list_providers `
          + 'to see the providers that have one.',
      })
    }

    const guide = await queryCollection(event, 'keyGuides')
      .path(entry.path)
      .first()

    if (!guide) {
      throw createError({
        status: 404,
        message: `Key guide "${entry.path}" is not published.`,
      })
    }

    return toJsonToolResult(formatKeyGuide(guide, resolveSiteOrigin(event)))
  }, 'get_key_guide'),
})
