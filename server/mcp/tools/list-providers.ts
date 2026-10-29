import { queryCollection } from '@nuxt/content/server'
import { providerMeta } from '#shared/utils/provider-meta'
import { listProviders } from '~~/server/utils/mcp/key-guides'
import { toJsonToolResult } from '~~/server/utils/mcp/result'
import { resolveSiteOrigin } from '~~/server/utils/mcp/site-origin'

export default defineMcpTool({
  name: 'list_providers',
  title: 'List providers',
  description: 'List the LLM providers, gateways and web search services '
    + 'Besidka supports with your own API key (BYOK). Each entry has the '
    + 'API key dashboard URL and the public key guide when one exists. Use '
    + 'get_key_guide to read a guide.',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  cache: '1h',
  handler: async () => {
    const event = useEvent()
    const guides = await queryCollection(event, 'keyGuides')
      .select('path', 'provider', 'title')
      .all()

    return toJsonToolResult(
      listProviders(providerMeta, guides, resolveSiteOrigin(event)),
    )
  },
})
