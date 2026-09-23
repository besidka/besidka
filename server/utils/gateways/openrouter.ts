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
  const isImageGenerationRequested = requestedTools.includes(
    'image_generation',
  )
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
   *
   * `modalities: ['image', 'text']` is OpenRouter's chat-completions request
   * param for image output (verified against OpenRouter's current API
   * reference — `send-chat-completion-request` documents `modalities` as an
   * array of `'text' | 'image' | 'audio'`). It is not a typed field on the
   * installed `@openrouter/ai-sdk-provider@3.0.0`'s `OpenRouterChatSettings`
   * (confirmed absent from the package's `dist/index.d.ts`), so it goes
   * through `extraBody`, which the provider's `getArgs()` spreads onto the
   * outgoing request body verbatim (verified in `dist/index.js`) — the same
   * mechanism that already carries any other raw body field this typed SDK
   * doesn't model. Like `plugins`, this is a request param, not an AI SDK
   * tool: `tools` stays `{}`, no `toolChoice`. The model itself decides
   * whether to actually return an image; a non-image-capable model routed
   * with this flag simply never populates `choice.message.images`, which
   * `@openrouter/ai-sdk-provider` maps to `file` content parts (verified in
   * the installed package's `dist/index.js`) — the same generic UI file-part
   * rendering path this app already uses for attachments and direct-provider
   * generated images.
   */
  function getInstance() {
    return openrouter.chat(model, {
      usage: { include: true },
      ...(isWebSearchRequested ? { plugins: [{ id: 'web' }] } : {}),
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(isImageGenerationRequested
        ? { extraBody: { modalities: ['image', 'text'] } }
        : {}),
    })
  }

  /**
   * Deliberately built without `plugins`, `reasoning` or `extraBody`, even
   * when the chat send requested web search, reasoning or image generation —
   * title generation is a separate, second billable request, and carrying
   * any of those settings there would charge an extra per-search fee, extra
   * reasoning tokens, or an unwanted generated image for a title prompt that
   * never needs any of them.
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
