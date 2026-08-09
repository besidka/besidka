import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { GatewayChatResult } from './index'

export async function useOpenRouterGateway(
  userId: string,
  model: string,
): Promise<GatewayChatResult> {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: 'openrouter',
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

  function getInstance() {
    // `usage.include` turns on OpenRouter's extended usage-accounting
    // response (cost, cached tokens, etc.) — without it, `providerMetadata.
    // openrouter.usage.cost` never appears, silently leaving `totalCost`
    // undefined. See https://openrouter.ai/docs/use-cases/usage-accounting
    return openrouter.chat(model, { usage: { include: true } })
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(getInstance(), message)
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: {},
    providerOptions: {},
  }
}
