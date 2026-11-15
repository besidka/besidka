import type { KVNamespace } from '@cloudflare/workers-types'
import { z } from 'zod'
import {
  CONNECTOR_TOOLS_CACHE_TTL_MAX_SECONDS,
  CONNECTOR_TOOLS_CACHE_TTL_MIN_SECONDS,
  CONNECTOR_TOOLS_CACHE_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import type { ConnectorToolDefinition } from '~~/server/utils/connectors/tool-definitions'

const KEY_PREFIX = 'connectors:tools:'
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
