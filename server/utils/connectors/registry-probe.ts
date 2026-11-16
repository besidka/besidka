import type { KVNamespace } from '@cloudflare/workers-types'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import {
  REGISTRY_PROBE_MAX_TOOLS,
  REGISTRY_PROBE_MISS_TTL_SECONDS,
  REGISTRY_PROBE_TIMEOUT_MS,
  REGISTRY_PROBE_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import { DIRECTORY_PRESET_ID_PREFIX } from '#shared/utils/connectors-directory'
import type { DirectoryEntry } from '#shared/utils/connectors-directory'
import type {
  ConnectorDirectoryAuthKind,
  ConnectorDirectoryProbe,
  ConnectorDirectoryTool,
} from '#shared/types/connectors.d'
import {
  createConcurrencyLimiter,
  createConnectorClientHandle,
} from '~~/server/utils/connectors/mcp-client'
import {
  fetchProtectedResourceMetadata,
  probeConnectorServer,
} from '~~/server/utils/connectors/oauth-metadata'
import type { BearerChallenge } from '~~/server/utils/connectors/oauth-metadata'
import { hashRegistryName } from '~~/server/utils/connectors/registry-sync'
import { listRemoteDefinitions } from '~~/server/utils/connectors/send-tools'
import type { LoggerLike } from '~~/server/utils/files/logger'

const PROBE_KEY_PREFIX = 'connectors:registry:probe:'
const TOOL_NAME_MAX_CHARS = 128
const TOOL_TITLE_MAX_CHARS = 120
const TOOL_DESCRIPTION_MAX_CHARS = 300
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu

export interface RegistryProbeDependencies {
  probeServer?: (
    url: string,
    logger?: LoggerLike,
  ) => Promise<{ status: number, challenge: BearerChallenge | null }>
  findProtectedResource?: (
    url: string,
    challenge: BearerChallenge | null,
    logger?: LoggerLike,
  ) => Promise<unknown>
  listTools?: (url: string, logger?: LoggerLike) => Promise<unknown[]>
}

class ProbeTimeoutError extends Error {}

function cleanToolText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') {
    return ''
  }

  const cleaned = value.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim()

  return Array.from(cleaned).slice(0, maxChars).join('')
}

/**
 * Tool names, titles and descriptions as short plain text: control and
 * invisible format characters removed, cut by code points, at most 100.
 */
export function toDirectoryTools(
  rawTools: readonly unknown[],
): ConnectorDirectoryTool[] {
  const tools: ConnectorDirectoryTool[] = []

  for (const rawTool of rawTools) {
    if (typeof rawTool !== 'object' || rawTool === null) {
      continue
    }

    const record = rawTool as Record<string, unknown>
    const name = cleanToolText(record.name, TOOL_NAME_MAX_CHARS)

    if (!name) {
      continue
    }

    tools.push({
      name,
      title: cleanToolText(record.title, TOOL_TITLE_MAX_CHARS) || null,
      description: cleanToolText(
        record.description,
        TOOL_DESCRIPTION_MAX_CHARS,
      ),
    })

    if (tools.length >= REGISTRY_PROBE_MAX_TOOLS) {
      break
    }
  }

  return tools
}

async function probeKey(entry: DirectoryEntry): Promise<string> {
  return `${PROBE_KEY_PREFIX}${(await hashRegistryName(entry.name)).slice(0, 32)}`
}

function staticProbe(entry: DirectoryEntry): ConnectorDirectoryProbe | null {
  const checkedAt = new Date().toISOString()

  if (entry.id.startsWith(DIRECTORY_PRESET_ID_PREFIX)) {
    const preset = findConnectorPreset(entry.presetId ?? '')
    const authKind: ConnectorDirectoryAuthKind = preset?.auth.includes('oauth')
      ? 'oauth'
      : 'header'

    return { authKind, state: 'needs-auth', tools: [], checkedAt }
  }

  return entry.headerNames.length > 0
    ? { authKind: 'header', state: 'needs-auth', tools: [], checkedAt }
    : null
}

/**
 * Lists a server's tools without any credential, through the same MCP
 * client and `safeFetch` rules as a connected connector, and closes the
 * connection again.
 */
async function listToolsAnonymously(
  url: string,
  logger?: LoggerLike,
): Promise<unknown[]> {
  const handle = createConnectorClientHandle({
    connectorId: 'registry-probe',
    slug: 'probe',
    url,
    transport: 'streamable-http',
    resolveAuth: async () => ({ headers: {}, secrets: [] }),
    limiter: createConcurrencyLimiter(1),
    logger,
  })

  try {
    const client = await handle.getClient()
    const { definitions } = await listRemoteDefinitions(
      client,
      AbortSignal.timeout(REGISTRY_PROBE_TIMEOUT_MS),
    )

    return definitions
  } finally {
    await handle.close()
  }
}

async function runProbe(
  entry: DirectoryEntry,
  dependencies: Required<RegistryProbeDependencies>,
  logger?: LoggerLike,
): Promise<ConnectorDirectoryProbe> {
  const checkedAt = new Date().toISOString()
  const probe = await dependencies.probeServer(entry.remoteUrl, logger)

  if (probe.status === 401 || probe.status === 403) {
    const metadata = await dependencies.findProtectedResource(
      entry.remoteUrl,
      probe.challenge,
      logger,
    )

    return {
      authKind: metadata ? 'oauth' : 'header',
      state: 'needs-auth',
      tools: [],
      checkedAt,
    }
  }

  if (probe.status < 200 || probe.status >= 300) {
    return { authKind: 'unknown', state: 'unavailable', tools: [], checkedAt }
  }

  const tools = toDirectoryTools(
    await dependencies.listTools(entry.remoteUrl, logger),
  )

  return { authKind: 'none', state: 'listed', tools, checkedAt }
}

function withDeadline<Result>(task: Promise<Result>): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    task,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new ProbeTimeoutError('probe timeout'))
      }, REGISTRY_PROBE_TIMEOUT_MS)
    }),
  ]).finally(() => {
    clearTimeout(timer)
  })
}

function parseProbe(raw: string | null): ConnectorDirectoryProbe | null {
  if (!raw) {
    return null
  }

  try {
    const probe = JSON.parse(raw) as ConnectorDirectoryProbe

    return Array.isArray(probe.tools) && typeof probe.state === 'string'
      ? probe
      : null
  } catch {
    return null
  }
}

/**
 * What is already known about an entry without contacting it: a preset or
 * an entry that declares header names needs a key or a sign-in, otherwise
 * the cached probe, if any.
 */
export async function readCachedRegistryProbe(
  kv: KVNamespace,
  entry: DirectoryEntry,
): Promise<ConnectorDirectoryProbe | null> {
  const known = staticProbe(entry)

  if (known) {
    return known
  }

  try {
    return parseProbe(await kv.get(await probeKey(entry)))
  } catch {
    return null
  }
}

/**
 * The auth kind and, for a server that answers without credentials, its
 * tools, for the directory detail view (docs/connectors.md section 10.3).
 * One unauthenticated MCP `initialize` (no token, no user data); a 401 or
 * 403 checks for OAuth protected-resource metadata; a 2xx lists the tools
 * anonymously. The address comes from the directory row, never from the
 * request. The whole probe has an 8 s deadline, and the result is kept in
 * KV for a day (a failure for an hour), shared by every user.
 */
export async function probeRegistryEntry(
  kv: KVNamespace,
  entry: DirectoryEntry,
  options: {
    logger?: LoggerLike
    dependencies?: RegistryProbeDependencies
  } = {},
): Promise<ConnectorDirectoryProbe> {
  const cached = await readCachedRegistryProbe(kv, entry)

  if (cached) {
    return cached
  }

  const dependencies: Required<RegistryProbeDependencies> = {
    probeServer: options.dependencies?.probeServer ?? probeConnectorServer,
    findProtectedResource: options.dependencies?.findProtectedResource
      ?? fetchProtectedResourceMetadata,
    listTools: options.dependencies?.listTools ?? listToolsAnonymously,
  }
  let probe: ConnectorDirectoryProbe

  try {
    probe = await withDeadline(runProbe(entry, dependencies, options.logger))
  } catch {
    probe = {
      authKind: 'unknown',
      state: 'unavailable',
      tools: [],
      checkedAt: new Date().toISOString(),
    }
  }

  try {
    await kv.put(await probeKey(entry), JSON.stringify(probe), {
      expirationTtl: probe.state === 'unavailable'
        ? REGISTRY_PROBE_MISS_TTL_SECONDS
        : REGISTRY_PROBE_TTL_SECONDS,
    })
  } catch {
    return probe
  }

  return probe
}
