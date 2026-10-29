import { z } from 'zod'
import { createError } from 'h3'
import { queryCollection } from '@nuxt/content/server'
import {
  createPageComponentRenderers,
  formatPublicPage,
  publicPages,
  publicPageSlugs,
} from '~~/server/utils/mcp/pages'
import { toJsonToolResult } from '~~/server/utils/mcp/result'
import { resolveSiteOrigin } from '~~/server/utils/mcp/site-origin'

export default defineMcpTool({
  name: 'get_page',
  title: 'Get public page',
  description: 'Get a public Besidka page as markdown: byok (why bring '
    + 'your own key), memory (how memory works), privacy-policy, '
    + 'terms-of-use or cookie-policy.',
  inputSchema: {
    page: z.enum(publicPageSlugs).describe('Page to read'),
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async ({ page: slug }) => {
    const event = useEvent()
    const { collection, contentPath } = publicPages[slug]
    const page = collection === 'legal'
      ? await queryCollection(event, 'legal').path(contentPath).first()
      : await queryCollection(event, 'guides').path(contentPath).first()

    if (!page) {
      throw createError({
        statusCode: 404,
        message: `Page "${slug}" is not published.`,
      })
    }

    const { privacyEmail } = useRuntimeConfig(event).public

    return toJsonToolResult(formatPublicPage(
      slug,
      page,
      resolveSiteOrigin(event),
      createPageComponentRenderers(String(privacyEmail ?? '')),
    ))
  },
})
