import { providerMeta } from '#shared/utils/provider-meta'
import { getKeyGuideIndex } from '~~/server/utils/mcp/cached-content'
import { listProviders } from '~~/server/utils/mcp/key-guides'
import { toJsonToolResult } from '~~/server/utils/mcp/result'
import { withSafeToolErrors } from '~~/server/utils/mcp/safe-tool'
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
  handler: withSafeToolErrors(async () => {
    const event = useEvent()
    const guides = await getKeyGuideIndex(event)

    return toJsonToolResult(
      listProviders(providerMeta, guides, resolveSiteOrigin(event)),
    )
  }, 'list_providers'),
})
