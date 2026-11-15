import type { GatewayId } from '#shared/types/gateways.d'
import {
  findGatewayCatalogModel,
  getCachedGatewayCatalog,
} from '~~/server/utils/gateways/catalog'
import {
  createUnsupportedImageInputError,
  hasImageFilePart,
} from '~~/server/utils/chats/input-file-support'
import { resolveFileDelivery } from '#shared/utils/file-delivery'

interface AssertGatewayImageInputSupportedInput {
  gatewayId: GatewayId
  modelId: string
  parts: readonly { type: string, mediaType?: string, filename?: string }[]
  logger: { set: (fields: Record<string, unknown>) => void }
}

/**
 * Rejects an image attachment only on positive evidence: the gateway catalog
 * lists the model with a non-empty input modality list that omits `image`.
 * Catalog misses, outages and missing modalities fail open, and Cloudflare is
 * skipped because its catalog needs per-user credentials and carries no
 * reliable input modalities. PDFs are never gated here: catalogs use a
 * different vocabulary and OpenRouter parses PDFs for any routed model.
 */
export async function assertGatewayImageInputSupported(
  input: AssertGatewayImageInputSupportedInput,
): Promise<void> {
  const { gatewayId, modelId, parts, logger } = input

  if (
    (gatewayId !== 'vercel' && gatewayId !== 'openrouter')
    || !hasImageFilePart(parts)
  ) {
    return
  }

  const catalogModel = await findGatewayCatalogModel(
    () => getCachedGatewayCatalog(gatewayId, { logger }),
    modelId,
    logger,
  )
  const inputModalities = catalogModel?.modalities?.input

  if (
    !Array.isArray(inputModalities)
    || inputModalities.length === 0
    || inputModalities.includes('image')
  ) {
    return
  }

  const unsupportedPart = parts.find((part) => {
    return part.type === 'file'
      && typeof part.mediaType === 'string'
      && resolveFileDelivery({
        route: gatewayId,
        modalities: inputModalities,
        mediaType: part.mediaType,
      }).reason === 'model-no-image'
  })

  throw createUnsupportedImageInputError(
    catalogModel?.name || modelId,
    unsupportedPart?.filename,
  )
}
