import type { KVNamespace } from '@cloudflare/workers-types'
import { detectToolDrift } from 'ai'
import type {
  ConnectorReviewTool,
  ConnectorToolChange,
  ConnectorToolsReview,
} from '#shared/types/connectors.d'
import {
  CONNECTOR_PREPARE_DEADLINE_MS,
  CONNECTOR_TOOLS_PER_REQUEST,
} from '#shared/utils/connectors-policy'
import {
  assertConnectorConsent,
  issuerHostOf,
} from '~~/server/utils/connectors/consent'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import { recordDeclaredConnectorIcons } from '~~/server/utils/connectors/icon'
import {
  createConcurrencyLimiter,
  createConnectorClientHandle,
} from '~~/server/utils/connectors/mcp-client'
import type {
  ConnectorClientDependencies,
} from '~~/server/utils/connectors/mcp-client'
import { isAlwaysGrantActive } from '~~/server/utils/connectors/page'
import {
  listRemoteDefinitions,
  resolveAuth,
  untilDeadline,
} from '~~/server/utils/connectors/send-tools'
import {
  CONNECTOR_BASELINE_MARKER_SETTING,
  deleteConnectorToolSettings,
  readConnectorCredentials,
  readConnectorToolBaseline,
  readConnectorUrl,
  updateConnector,
  upsertConnectorToolSettings,
} from '~~/server/utils/connectors/store'
import type {
  ConnectorRecord,
  ConnectorToolSettingInput,
} from '~~/server/utils/connectors/store'
import {
  connectorToolsCacheKey,
  readCachedToolDefinitions,
  resolveToolsCacheTtlSeconds,
  writeCachedToolDefinitions,
} from '~~/server/utils/connectors/tool-cache'
import {
  canonicalJson,
  connectorSha256Hex,
  hashToolDefinitions,
  isDefinitionReadOnly,
} from '~~/server/utils/connectors/tool-definitions'
import type {
  ConnectorToolDefinition,
} from '~~/server/utils/connectors/tool-definitions'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  connectorDestructiveHint,
  hasAlwaysAskToolName,
} from '~~/server/utils/tool-approval/policy'

type DbClient = ReturnType<typeof useDb>

const SETTINGS_WRITE_CHUNK = 50

export type ConnectorReviewDecision = 'accept' | 'keep-disabled'

export interface ConnectorToolDefinitions {
  definitions: ConnectorToolDefinition[]
  hashes: Map<string, string>
}

interface BaselineSetting {
  toolName: string
  definitionHash: string
  enabled: boolean
  approval: string
  approvedDefinitionHash: string | null
}

export interface ConnectorToolsReviewPlan {
  review: ConnectorToolsReview
  definitions: ConnectorToolDefinition[]
  hashes: Map<string, string>
  settings: BaselineSetting[]
}

/**
 * The tool list of one connector for the Connectors page: from the KV cache
 * the send also uses, else from one connection that is closed again. The
 * sign-up consent is the route's check; the per-connector consent (for the
 * stored issuer of an OAuth connector) is checked here before any request
 * that carries the token. The connect and list share one 8 s deadline. On a
 * cache miss it keeps the icons the server declares, like the send does, so
 * opening the page first does not lose them.
 */
export async function loadConnectorToolDefinitions(input: {
  db: DbClient
  kv: KVNamespace
  userId: number
  connector: ConnectorRecord
  logger: LoggerLike
  dependencies?: ConnectorClientDependencies & { deadlineMs?: number }
}): Promise<ConnectorToolDefinitions> {
  const { db, kv, userId, connector, logger } = input
  const credentials = await readConnectorCredentials(db, userId, connector.id)

  if (connector.authType === 'oauth' && credentials?.issuer) {
    assertConnectorConsent(connector, issuerHostOf(credentials.issuer))
  } else {
    assertConnectorConsent(connector)
  }

  const cacheKey = connectorToolsCacheKey(
    connector.id,
    credentials ? String(credentials.updatedAt.getTime()) : 'none',
  )
  const cached = await readCachedToolDefinitions(kv, cacheKey)

  if (cached) {
    return { definitions: cached, hashes: await hashToolDefinitions(cached) }
  }

  const resolver = resolveAuth({
    connector,
    credentials,
    secrets: new Set<string>(),
    db,
    kv,
    userId,
    logger,
    inFlight: new Map(),
  })

  if (!resolver) {
    throw createConnectorError('CONNECTOR_REAUTH_REQUIRED')
  }

  const url = await readConnectorUrl(db, userId, connector.id)

  if (!url) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  const handle = createConnectorClientHandle({
    connectorId: connector.id,
    slug: connector.slug,
    url,
    transport: connector.transport,
    resolveAuth: resolver,
    limiter: createConcurrencyLimiter(1),
    logger,
    dependencies: input.dependencies,
  })
  const deadline = new AbortController()
  const timer = setTimeout(() => {
    deadline.abort()
  }, input.dependencies?.deadlineMs ?? CONNECTOR_PREPARE_DEADLINE_MS)

  try {
    const client = await untilDeadline(handle.getClient(), deadline.signal)
    const listed = await untilDeadline(
      listRemoteDefinitions(client, deadline.signal),
      deadline.signal,
    )

    await recordDeclaredConnectorIcons(kv, connector.id, client.serverInfo)
    await writeCachedToolDefinitions(
      kv,
      cacheKey,
      listed.definitions,
      resolveToolsCacheTtlSeconds(listed.ttlMs),
    )

    return {
      definitions: listed.definitions,
      hashes: await hashToolDefinitions(listed.definitions),
    }
  } finally {
    clearTimeout(timer)
    await handle.close()
  }
}

function toReviewTool(
  definition: ConnectorToolDefinition,
  change: ConnectorToolChange,
  setting: BaselineSetting | undefined,
): ConnectorReviewTool {
  const destructive = connectorDestructiveHint(definition.annotations)

  return {
    name: definition.name,
    title: definition.title ?? null,
    description: definition.description,
    readOnly: isDefinitionReadOnly(definition) && !destructive,
    destructive,
    openWorld: definition.annotations.openWorldHint ?? null,
    alwaysAsk: destructive
      || hasAlwaysAskToolName(definition.name, definition.title),
    change,
    enabled: change === 'none' || change === 'changed'
      ? setting?.enabled ?? false
      : false,
    alwaysAllowed: change === 'none' && !!setting
      && isAlwaysGrantActive(setting),
  }
}

/**
 * A digest of what the review shows as pending (new, added and changed
 * tools with their definition hashes, and removed names), so an accept is
 * bound to exactly the definitions the user saw without sending a hash to
 * the browser.
 */
async function reviewTokenOf(input: {
  isBaselined: boolean
  pending: Array<[string, string]>
  removed: string[]
}): Promise<string> {
  return await connectorSha256Hex(canonicalJson({
    isBaselined: input.isBaselined,
    pending: [...input.pending].sort(([left], [right]) => {
      return left.localeCompare(right)
    }),
    removed: [...input.removed].sort(),
  }))
}

/**
 * Compares the current tool list with the reviewed baseline: before the
 * first review every tool is `new`; after it, a tool is `added` or
 * `changed` (hidden from chats until reviewed), or `none`. Removed tools are
 * listed by name. Changed tools show only their current description and
 * annotations: the baseline keeps hashes, not the old text.
 */
export async function buildConnectorToolsReview(input: {
  definitions: readonly ConnectorToolDefinition[]
  hashes: ReadonlyMap<string, string>
  isBaselined: boolean
  settings: readonly BaselineSetting[]
}): Promise<ConnectorToolsReview> {
  const settingsByName = new Map(input.settings.map((setting) => {
    return [setting.toolName, setting]
  }))
  const drift = input.isBaselined
    ? detectToolDrift(
      Object.fromEntries(input.hashes),
      Object.fromEntries(input.settings.map((setting) => {
        return [setting.toolName, setting.definitionHash]
      })),
    )
    : { added: [], changed: [], removed: [] }
  const added = new Set(drift.added)
  const changed = new Set(drift.changed)
  const tools = input.definitions.map((definition) => {
    const change: ConnectorToolChange = !input.isBaselined
      ? 'new'
      : added.has(definition.name)
        ? 'added'
        : changed.has(definition.name) ? 'changed' : 'none'

    return toReviewTool(definition, change, settingsByName.get(definition.name))
  })
  const pending = tools
    .filter(tool => tool.change !== 'none')
    .map((tool): [string, string] => {
      return [tool.name, input.hashes.get(tool.name)!]
    })
  const removed = input.isBaselined ? drift.removed : []

  return {
    state: 'ok',
    isBaselined: input.isBaselined,
    reviewToken: await reviewTokenOf({
      isBaselined: input.isBaselined,
      pending,
      removed,
    }),
    tools,
    removed,
    counts: {
      total: tools.length,
      enabled: tools.filter((tool) => {
        return tool.change === 'none' && tool.enabled
      }).length,
      pending: pending.length,
      perMessageLimit: CONNECTOR_TOOLS_PER_REQUEST,
    },
  }
}

export async function planConnectorToolsReview(input: {
  db: DbClient
  kv: KVNamespace
  userId: number
  connector: ConnectorRecord
  logger: LoggerLike
  dependencies?: ConnectorClientDependencies & { deadlineMs?: number }
}): Promise<ConnectorToolsReviewPlan> {
  const { definitions, hashes } = await loadConnectorToolDefinitions(input)
  const { isBaselined, settings } = await readConnectorToolBaseline(
    input.db,
    input.userId,
    input.connector.id,
  )
  const review = await buildConnectorToolsReview({
    definitions,
    hashes,
    isBaselined,
    settings,
  })

  return { review, definitions, hashes, settings }
}

function settingFor(
  definition: ConnectorToolDefinition,
  hash: string,
  enabled: boolean,
): ConnectorToolSettingInput {
  return {
    toolName: definition.name,
    definitionHash: hash,
    serverReadOnly: isDefinitionReadOnly(definition),
    enabled,
    approval: 'ask',
    approvedDefinitionHash: null,
  }
}

/**
 * Stores the reviewed tool list as the new baseline. `accept` turns new and
 * added tools on and keeps a changed tool's previous switch; `keep-disabled`
 * stores them off, so they stay out of chats until the user turns one on.
 * Either way a new or changed tool starts at "Ask every time" (an "Always
 * allow" was given for the old definition and never carries over), removed
 * tools lose their rows, and a first review also writes the baseline
 * marker. A connector that was `drifted` is `ready` again.
 */
export async function applyConnectorToolsReview(input: {
  db: DbClient
  userId: number
  connector: ConnectorRecord
  plan: ConnectorToolsReviewPlan
  decision: ConnectorReviewDecision
}): Promise<void> {
  const { db, userId, connector, plan, decision } = input
  const isAccepted = decision === 'accept'
  const definitionsByName = new Map(plan.definitions.map((definition) => {
    return [definition.name, definition]
  }))
  const rows: ConnectorToolSettingInput[] = plan.review.isBaselined
    ? []
    : [CONNECTOR_BASELINE_MARKER_SETTING]

  for (const tool of plan.review.tools) {
    if (tool.change === 'none') {
      continue
    }

    const definition = definitionsByName.get(tool.name)!
    const enabled = tool.change === 'changed'
      ? isAccepted && tool.enabled
      : isAccepted

    rows.push(settingFor(definition, plan.hashes.get(tool.name)!, enabled))
  }

  for (let start = 0; start < rows.length; start += SETTINGS_WRITE_CHUNK) {
    await upsertConnectorToolSettings(
      db,
      userId,
      connector.id,
      rows.slice(start, start + SETTINGS_WRITE_CHUNK),
    )
  }

  await deleteConnectorToolSettings(
    db,
    userId,
    connector.id,
    plan.review.removed,
  )

  if (connector.status === 'drifted') {
    await updateConnector(db, userId, connector.id, {
      status: 'ready',
      lastError: null,
    })
  }
}
