import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { ModelTool } from '#shared/types/providers.d'
import type { GatewayChatResult } from './index'
import { keyProviderIdForGateway } from './index'

export async function useOpenRouterGateway(
  userId: string,
  model: string,
  requestedTools: ModelTool[],
): Promise<GatewayChatResult> {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: keyProviderIdForGateway('openrouter'),
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'OpenRouter API key not found. Please set it up in the settings.',
    })
  }

  const openrouter = createOpenRouter({
    apiKey: await useDecryptText(data.apiKey),
    compatibility: 'strict',
  })
  const isWebSearchRequested = requestedTools.includes('web_search')

  /**
   * `usage.include` turns on OpenRouter's extended usage-accounting response
   * (cost, cached tokens, etc.) — without it, `providerMetadata.openrouter.
   * usage.cost` never appears, silently leaving `totalCost` undefined. See
   * https://openrouter.ai/docs/use-cases/usage-accounting
   *
   * `plugins: [{ id: 'web' }]` is OpenRouter's universal web-search plugin —
   * it works on any routed model, not just ones with native search, and is a
   * request-body/model-setting change rather than an AI SDK tool: `tools`
   * stays `{}` on the returned `GatewayChatResult`, no `toolChoice`. No
   * explicit `engine` override is set, so the plugin uses its own
   * native-or-Exa default per
   * https://openrouter.ai/docs/features/web-search.
   */
  function getInstance() {
    return openrouter.chat(model, {
      usage: { include: true },
      ...(isWebSearchRequested ? { plugins: [{ id: 'web' }] } : {}),
    })
  }

  /**
   * Deliberately built without `plugins`, even when the chat send requested
   * web search — title generation is a separate, second billable request,
   * and carrying the plugin there would charge an extra per-search fee and
   * inject search results into a title prompt that never needs them.
   */
  function getTitleInstance() {
    return openrouter.chat(model, { usage: { include: true } })
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(getTitleInstance(), message)
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: {},
    providerOptions: {},
  }
}
