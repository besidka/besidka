import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { ModelTool } from '#shared/types/providers.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { toReasoningEffort } from '~~/server/utils/providers/reasoning'
import type { GatewayChatResult } from './index'
import { keyProviderIdForGateway } from './index'

export async function useOpenRouterGateway(
  userId: string,
  model: string,
  requestedTools: ModelTool[],
  requestedReasoning: ReasoningLevel,
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
  const reasoningEffort = toReasoningEffort(requestedReasoning)

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
   *
   * `reasoning: { effort }` is the installed `@openrouter/ai-sdk-provider`'s
   * own model-setting for reasoning depth — verified in the package's
   * `dist/index.d.ts` (`OpenRouterProviderOptions.reasoning`). This is
   * deliberately NOT the top-level `streamText({ reasoning })` call option:
   * the provider's `getArgs()` never reads that standardized field at all
   * (verified in `dist/index.js`), so setting only the top-level option would
   * silently do nothing for OpenRouter. The `reasoning` returned below feeds
   * that top-level option anyway, for symmetry with every direct-provider
   * builder, but it is inert here — this settings-level field is what
   * actually reaches OpenRouter's API.
   */
  function getInstance() {
    return openrouter.chat(model, {
      usage: { include: true },
      ...(isWebSearchRequested ? { plugins: [{ id: 'web' }] } : {}),
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    })
  }

  /**
   * Deliberately built without `plugins` or `reasoning`, even when the chat
   * send requested web search or reasoning — title generation is a separate,
   * second billable request, and carrying either setting there would charge
   * an extra per-search fee or extra reasoning tokens for a title prompt that
   * never needs them.
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
    reasoning: reasoningEffort,
  }
}
