import { parsePerTokenPrice } from '#shared/utils/gateway-pricing'
import { resolveKnowledgeTokenFamily } from '#shared/utils/project-knowledge-budget'
import {
  parseUsdPrice,
  toPricePerMillion,
} from '#shared/utils/prompt-cache-estimate'
import type { KnowledgeModelContext } from '~/types/knowledge-ui.d'

const TOKENS_PER_MILLION = 1_000_000
const CLOUDFLARE_GATEWAY_ID = 'cloudflare'

function toOptionalPerMillion(
  amount: number | undefined,
  unitTokens: number,
): number | null {
  const parsed = parseUsdPrice(amount)

  return parsed === null ? null : toPricePerMillion(parsed, unitTokens)
}

export function useKnowledgeModelContext() {
  const { selection, gatewayModel, name } = useSelectedModelInfo()

  return computed<KnowledgeModelContext>(() => {
    const current = selection.value

    if (current.source === 'provider') {
      const { model, provider } = getModel(current.modelId)
      const inputAmount = parseUsdPrice(model?.price.input)
      const unitTokens = model?.price.tokens ?? TOKENS_PER_MILLION

      return {
        name: name.value,
        family: resolveKnowledgeTokenFamily({
          providerId: provider?.id ?? '',
          modelId: current.modelId,
        }),
        contextWindow: model?.contextLength ?? null,
        maxOutputTokens: model?.maxOutputTokens ?? null,
        acceptsImages: model?.modalities.input.includes('image') ?? false,
        acceptsPdf: model?.modalities.input.includes('pdf') ?? false,
        inputPrice: inputAmount === null
          ? null
          : toPricePerMillion(inputAmount, unitTokens),
        cacheReadPrice: toOptionalPerMillion(
          model?.price.cacheRead,
          unitTokens,
        ),
        isCachingAvailable: true,
      }
    }

    const pricePerToken = parsePerTokenPrice(gatewayModel.value?.pricing?.input)

    return {
      name: name.value,
      family: resolveKnowledgeTokenFamily({
        providerId: current.gatewayId,
        modelId: current.modelId,
        gateway: true,
      }),
      contextWindow: gatewayModel.value?.contextLength ?? null,
      maxOutputTokens: gatewayModel.value?.maxOutputTokens ?? null,
      acceptsImages: false,
      acceptsPdf: false,
      inputPrice: pricePerToken === null
        ? null
        : pricePerToken * TOKENS_PER_MILLION,
      cacheReadPrice: null,
      isCachingAvailable: current.gatewayId !== CLOUDFLARE_GATEWAY_ID,
    }
  })
}
