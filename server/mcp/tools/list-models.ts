import { z } from 'zod'
import { providers } from '~~/providers'
import { listCatalog } from '~~/server/utils/mcp/catalog'
import { toJsonToolResult } from '~~/server/utils/mcp/result'
import { withSafeToolErrors } from '~~/server/utils/mcp/safe-tool'

const providerIds = providers.map((provider) => {
  return provider.id
}) as [string, ...string[]]

export default defineMcpTool({
  name: 'list_models',
  title: 'List models',
  description: 'List the models Besidka offers with provider, context window, '
    + 'price per million tokens (price.tokens is the token unit for '
    + 'price.input and price.output), price tier, input and output '
    + 'modalities, tools, tool calling and reasoning support. Deprecated '
    + 'models are hidden unless includeDeprecated is true.',
  inputSchema: {
    provider: z
      .enum(providerIds)
      .optional()
      .describe('Only list models of this provider id'),
    includeDeprecated: z
      .boolean()
      .optional()
      .describe('Also list deprecated models. Defaults to false'),
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withSafeToolErrors(({ provider, includeDeprecated }) => {
    return toJsonToolResult(listCatalog(providers, {
      providerId: provider,
      includeDeprecated,
    }))
  }),
})
