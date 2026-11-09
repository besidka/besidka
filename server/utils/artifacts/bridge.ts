import type { RequestEvent } from 'nuxt/server'
import type {
  ArtifactBridgeModel,
  ArtifactBridgeRemaining,
} from '#shared/utils/artifacts'
import {
  ARTIFACT_BRIDGE_DAILY_LIMIT,
  ARTIFACT_BRIDGE_HOURLY_LIMIT,
} from '#shared/utils/artifacts'
import { createError } from 'evlog'
import { providers } from '~~/providers'
import { getModelCostMap } from '~~/server/utils/ai/cost-map'
import {
  DIRECT_MODEL_PROVIDER_ORDER,
  isDirectModelProvider,
} from '~~/server/utils/ai/resolve-cheapest-model'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { isUsableMemoryCatalogModel } from '~~/server/utils/memory/catalog-usability'

const ARTIFACT_BRIDGE_RATE_LIMIT_PREFIX = 'artifact-bridge'

interface BridgeLimitScope {
  viewerUserId: number
  artifactInternalId: number
}

interface BridgeLimit {
  window: number
  max: number
}

function useBridgeLimiter() {
  return createAuthRateLimitStorage(
    useKV(),
    ARTIFACT_BRIDGE_RATE_LIMIT_PREFIX,
  )
}

function dailyKey(scope: BridgeLimitScope): string {
  return `day:${scope.viewerUserId}`
}

function hourlyKey(scope: BridgeLimitScope): string {
  return `hour:${scope.viewerUserId}:${scope.artifactInternalId}`
}

function finitePrice(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Every text model the viewer can call on a direct provider key: the
 * providers in `availableKeys` (already filtered by transfer consent) in
 * `DIRECT_MODEL_PROVIDER_ORDER`, catalog models that produce text and are
 * not retired, research agents or image generators. Gateways never appear.
 */
export function listArtifactBridgeModels(
  availableKeys: ReadonlySet<string>,
): ArtifactBridgeModel[] {
  const costMap = getModelCostMap()
  const models: ArtifactBridgeModel[] = []

  for (const providerId of DIRECT_MODEL_PROVIDER_ORDER) {
    if (!availableKeys.has(providerId)) {
      continue
    }

    const provider = providers.find((candidate) => {
      return candidate.id === providerId
    })

    for (const model of provider?.models ?? []) {
      if (!isUsableMemoryCatalogModel(model)) {
        continue
      }

      const cost = costMap[model.id]

      models.push({
        id: model.id,
        name: model.name,
        providerId,
        providerName: provider?.name ?? providerId,
        inputPricePerMillion: finitePrice(cost?.input),
        outputPricePerMillion: finitePrice(cost?.output),
      })
    }
  }

  return models
}

export function findArtifactBridgeModel(
  availableKeys: ReadonlySet<string>,
  modelId: string,
): ArtifactBridgeModel | null {
  return listArtifactBridgeModels(availableKeys).find((model) => {
    return model.id === modelId && isDirectModelProvider(model.providerId)
  }) ?? null
}

async function readRemaining(
  key: string,
  limit: BridgeLimit,
  now: number,
): Promise<number> {
  const entry = await useBridgeLimiter().get(key)

  if (!entry) {
    return limit.max
  }

  const windowStart = entry.windowStart ?? entry.lastRequest

  if (now - windowStart >= limit.window * 1000) {
    return limit.max
  }

  return Math.max(0, limit.max - entry.count)
}

export async function readArtifactBridgeRemaining(
  scope: BridgeLimitScope,
  now: number = Date.now(),
): Promise<ArtifactBridgeRemaining> {
  const hour = await readRemaining(
    hourlyKey(scope),
    ARTIFACT_BRIDGE_HOURLY_LIMIT,
    now,
  )
  const day = await readRemaining(
    dailyKey(scope),
    ARTIFACT_BRIDGE_DAILY_LIMIT,
    now,
  )

  return { hour, day }
}

function formatRetry(seconds: number): string {
  if (seconds < 120) {
    return `${seconds} seconds`
  }

  return `${Math.ceil(seconds / 60)} minutes`
}

/**
 * Takes one call from both caps: 200 per viewer per day, then 30 per
 * viewer and artifact per hour. The daily cap is checked first so a
 * refused day never uses up an hourly slot.
 */
export async function consumeArtifactBridgeCall(
  event: Pick<RequestEvent, 'res'>,
  scope: BridgeLimitScope,
): Promise<void> {
  const limiter = useBridgeLimiter()
  const checks: Array<[string, BridgeLimit, string]> = [
    [
      dailyKey(scope),
      ARTIFACT_BRIDGE_DAILY_LIMIT,
      'You used all AI requests from artifacts for today',
    ],
    [
      hourlyKey(scope),
      ARTIFACT_BRIDGE_HOURLY_LIMIT,
      'This artifact used all its AI requests for this hour',
    ],
  ]

  for (const [key, limit, reason] of checks) {
    const result = await limiter.consume(key, limit)

    if (result.allowed) {
      continue
    }

    const retryAfter = result.retryAfter ?? limit.window

    event.res.headers.set('Retry-After', String(retryAfter))

    throw createError({
      message: 'Too many AI requests from artifacts',
      status: 429,
      why: `${reason} (${limit.max} allowed). More are possible in `
        + `${formatRetry(retryAfter)}.`,
      fix: 'Wait and try again later.',
      data: { reason: 'bridge-rate-limit', retryAfter },
    })
  }
}
