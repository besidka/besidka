import { createError } from 'evlog'
import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
import { getModel } from '#shared/utils/model'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  getCachedCloudflareGatewayCatalog,
  getCachedGatewayCatalog,
} from '~~/server/utils/gateways/catalog'
import { getCloudflareGatewayCredentials } from '~~/server/utils/gateways/cloudflare'
import { isUsableMemoryCatalogModel } from '~~/server/utils/memory/catalog-usability'

interface MemoryModelChoiceLogger {
  set: (fields: Record<string, unknown>) => void
}

interface AssertMemoryModelChoiceOptions {
  userId: number
  model: string
  gateway: GatewayId | null
  logger: MemoryModelChoiceLogger
}

function assertDirectModel(model: string): void {
  const catalogModel = getModel(model).model

  if (catalogModel && isUsableMemoryCatalogModel(catalogModel)) {
    return
  }

  throw createError({
    message: 'Unknown or unusable memory model',
    status: 400,
    why: `Model "${model}" is not a text model in the catalog that can `
      + 'run memory extraction.',
    fix: 'Pick a text model from the model list.',
  })
}

async function requireCloudflareCredentials(userId: number) {
  const credentials = await getCloudflareGatewayCredentials(String(userId))

  if (credentials) {
    return credentials
  }

  throw createError({
    message: 'Cloudflare AI Gateway credentials not found',
    status: 400,
    why: 'No Cloudflare AI Gateway API key is set up for this account.',
    fix: 'Add your Cloudflare AI Gateway credentials in the settings.',
  })
}

async function guardCatalogOutage(
  gateway: GatewayId,
  logger: MemoryModelChoiceLogger,
  fetchCatalog: () => Promise<GatewayModel[]>,
): Promise<GatewayModel[]> {
  try {
    return await fetchCatalog()
  } catch (exception) {
    logger.set({
      attributes: {
        memoryModelChoice: {
          gateway,
          catalogError: exceptionMessage(exception),
        },
      },
    })

    throw createError({
      message: 'Could not verify the memory model',
      status: 503,
      why: `The ${gateway} gateway model catalog is unavailable.`,
      fix: 'Retry in a moment.',
    })
  }
}

async function loadGatewayCatalog(
  userId: number,
  gateway: GatewayId,
  logger: MemoryModelChoiceLogger,
): Promise<GatewayModel[]> {
  if (gateway === 'cloudflare') {
    const credentials = await requireCloudflareCredentials(userId)

    return await guardCatalogOutage(gateway, logger, () => {
      return getCachedCloudflareGatewayCatalog(credentials, { logger })
    })
  }

  return await guardCatalogOutage(gateway, logger, () => {
    return getCachedGatewayCatalog(gateway, { logger })
  })
}

function isTextGatewayModel(catalogModel: GatewayModel): boolean {
  const outputModalities = catalogModel.modalities?.output

  if (outputModalities) {
    return outputModalities.includes('text')
  }

  return catalogModel.supportsImageGeneration !== true
}

function assertGatewayModel(
  catalog: GatewayModel[],
  model: string,
  gateway: GatewayId,
): void {
  const catalogModel = catalog.find((candidate) => {
    return candidate.id === model
  })

  if (!catalogModel) {
    throw createError({
      message: 'Unknown or unusable memory model',
      status: 400,
      why: `Model "${model}" is not in the ${gateway} gateway catalog.`,
      fix: 'Pick a model from the gateway model list.',
    })
  }

  if (!isTextGatewayModel(catalogModel)) {
    throw createError({
      message: 'Unknown or unusable memory model',
      status: 400,
      why: `Model "${model}" does not produce text output.`,
      fix: 'Pick a text model from the gateway model list.',
    })
  }
}

/**
 * Rejects a memory model choice that would only fail later at refresh time.
 * A direct provider model is checked against the curated catalog without
 * requiring a key (keys can be added later); a gateway model is checked
 * against the live gateway catalog, and a catalog outage is a 503 rather
 * than a silent accept.
 */
export async function assertMemoryModelChoice(
  options: AssertMemoryModelChoiceOptions,
): Promise<void> {
  const { userId, model, gateway, logger } = options

  if (gateway === null) {
    assertDirectModel(model)

    return
  }

  const catalog = await loadGatewayCatalog(userId, gateway, logger)

  assertGatewayModel(catalog, model, gateway)
}
