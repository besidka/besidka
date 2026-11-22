import type { KVNamespace } from '@cloudflare/workers-types'
import { z } from 'zod'
import {
  CONNECTOR_CATALOG_SNAPSHOT_TTL_SECONDS,
  CONNECTOR_CATALOG_WARMUP_BACKOFF_SECONDS,
  CONNECTOR_TOOLS_CACHE_TTL_MAX_SECONDS,
  CONNECTOR_TOOLS_CACHE_TTL_MIN_SECONDS,
  CONNECTOR_TOOLS_CACHE_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import type { ConnectorToolDefinition } from '~~/server/utils/connectors/tool-definitions'

const KEY_PREFIX = 'connectors:tools:'
const SNAPSHOT_KEY_PREFIX = 'connectors:catalog:'
const WARMUP_KEY_PREFIX = 'connectors:catalog-warmup:'
const MILLISECONDS_PER_SECOND = 1000

const cachedDefinitionsSchema = z.object({
  definitions: z.array(z.object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    annotations: z.object({
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
    }),
  })),
})

export function connectorToolsCacheKey(
  connectorId: string,
  generation: string,
): string {
  return `${KEY_PREFIX}${connectorId}:${generation}`
}

/**
 * The cache lifetime a server asks for with `ttlMs` on `tools/list`, clamped
 * to 60 s up to one hour, and ten minutes when it asks for nothing usable.
 */
export function resolveToolsCacheTtlSeconds(ttlMs: unknown): number {
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return CONNECTOR_TOOLS_CACHE_TTL_SECONDS
  }

  return Math.min(
    CONNECTOR_TOOLS_CACHE_TTL_MAX_SECONDS,
    Math.max(
      CONNECTOR_TOOLS_CACHE_TTL_MIN_SECONDS,
      Math.ceil(ttlMs / MILLISECONDS_PER_SECOND),
    ),
  )
}

export async function readCachedToolDefinitions(
  kv: KVNamespace,
  key: string,
): Promise<ConnectorToolDefinition[] | null> {
  try {
    const raw = await kv.get(key)

    if (!raw) {
      return null
    }

    const parsed = cachedDefinitionsSchema.safeParse(JSON.parse(raw))

    return parsed.success ? parsed.data.definitions : null
  } catch {
    return null
  }
}

export async function writeCachedToolDefinitions(
  kv: KVNamespace,
  key: string,
  definitions: readonly ConnectorToolDefinition[],
  ttlSeconds: number,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify({ definitions }), {
      expirationTtl: ttlSeconds,
    })
  } catch {
    return
  }
}

export function connectorCatalogSnapshotKey(connectorId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${connectorId}`
}

export function connectorCatalogWarmupKey(connectorId: string): string {
  return `${WARMUP_KEY_PREFIX}${connectorId}`
}

/**
 * The last tool list a live `tools/list` returned for a connector, kept for
 * 30 days so an Auto connector can offer its tools at send start without a
 * connection (docs/connectors.md section 6.3). Only a live listing writes
 * it; the send still compares it with the reviewed baseline and checks it
 * again against a live listing before the first call.
 */
export async function readCatalogSnapshot(
  kv: KVNamespace,
  connectorId: string,
): Promise<ConnectorToolDefinition[] | null> {
  return await readCachedToolDefinitions(
    kv,
    connectorCatalogSnapshotKey(connectorId),
  )
}

export async function writeCatalogSnapshot(
  kv: KVNamespace,
  connectorId: string,
  definitions: readonly ConnectorToolDefinition[],
): Promise<void> {
  await writeCachedToolDefinitions(
    kv,
    connectorCatalogSnapshotKey(connectorId),
    definitions,
    CONNECTOR_CATALOG_SNAPSHOT_TTL_SECONDS,
  )
}

/**
 * Whether a send may list an Auto connector that has no snapshot yet. A
 * failed or skipped warm-up is not retried for 15 minutes, so a server that
 * is down is not contacted on every send.
 */
export async function claimCatalogWarmup(
  kv: KVNamespace,
  connectorId: string,
): Promise<boolean> {
  const key = connectorCatalogWarmupKey(connectorId)

  try {
    if (await kv.get(key)) {
      return false
    }

    await kv.put(key, '1', {
      expirationTtl: CONNECTOR_CATALOG_WARMUP_BACKOFF_SECONDS,
    })

    return true
  } catch {
    return false
  }
}

export async function deleteCatalogSnapshot(
  kv: KVNamespace,
  connectorId: string,
): Promise<void> {
  try {
    await kv.delete(connectorCatalogSnapshotKey(connectorId))
    await kv.delete(connectorCatalogWarmupKey(connectorId))
  } catch {
    return
  }
}
