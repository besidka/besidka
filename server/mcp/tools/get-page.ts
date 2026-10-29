import { z } from 'zod'
import { createError } from 'evlog'
import { getPublicPageRecord } from '~~/server/utils/mcp/cached-content'
import {
  createPageComponentRenderers,
  formatPublicPage,
  publicPageSlugs,
} from '~~/server/utils/mcp/pages'
import { toJsonToolResult } from '~~/server/utils/mcp/result'
import { withSafeToolErrors } from '~~/server/utils/mcp/safe-tool'
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
  handler: withSafeToolErrors(async ({ page: slug }) => {
    const event = useEvent()
    const page = await getPublicPageRecord(event, slug)

    if (!page) {
      throw createError({
        status: 404,
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
  }),
})
