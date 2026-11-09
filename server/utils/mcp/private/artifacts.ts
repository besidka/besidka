import type { KVNamespace } from '@cloudflare/workers-types'
import type { ArtifactKind } from '#shared/utils/artifacts'
import type { BlobStore } from '~~/server/utils/platform/types'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createError } from 'evlog'
import { ARTIFACT_KINDS } from '#shared/utils/artifacts'
import { MCP_ARTIFACT_SHARE_DAILY_LIMIT } from '~~/config/mcp-server'
import { applyArtifactEdits } from '~~/server/utils/ai/artifact-tools'
import type { ArtifactEdit } from '~~/server/utils/ai/artifact-tools'
import {
  getArtifactDetail,
  listArtifacts,
} from '~~/server/utils/artifacts/queries'
import {
  assertArtifactShareable,
  buildArtifactShareUrl,
  createArtifactShare,
  listArtifactShares,
  revokeArtifactShares,
} from '~~/server/utils/artifacts/shares'
import {
  appendArtifactVersion,
  createArtifact,
  createArtifactNotFoundError,
  decodeArtifactId,
  deleteArtifacts,
  findOwnedArtifact,
  readArtifactVersion,
} from '~~/server/utils/artifacts/store'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { detectSharePii } from '~~/server/utils/chats/share-pii-check'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isFeatureActive,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import { clampMcpLimit } from '~~/server/utils/mcp/private/chats'
import { isClientError } from '~~/server/utils/mcp/safe-tool'

type DbClient = ReturnType<typeof useDb>

type ArtifactKv = Pick<KVNamespace, 'get' | 'put' | 'delete'>

export const MCP_ARTIFACT_CONTENT_MAX_CHARS = 200_000
export const MCP_ARTIFACT_LIST_DEFAULT_LIMIT = 20
export const MCP_ARTIFACT_LIST_MAX_LIMIT = 50
export const MCP_ARTIFACT_QUERY_MAX_CHARS = 200
export const MCP_ARTIFACT_EDITS_MAX = 20
export const MCP_ARTIFACT_REVOKE_MAX_IDS = 50
export const MCP_ARTIFACT_DELETE_MAX_IDS = 20
export const MCP_ARTIFACT_SHARE_MAX_DAYS = 30
export const MCP_ARTIFACT_ID_MAX_CHARS = 64
export const MCP_ARTIFACT_SHARE_ID_MAX_CHARS = 80
export const MCP_ARTIFACT_UNAVAILABLE_MESSAGE
  = 'Artifacts are not available for your account'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const ARTIFACT_SHARE_LIMIT_KEY_PREFIX = 'mcp:rate-limit:artifact-share'
const SHARE_BUSY_RETRY_AFTER_SECONDS = 1
const LIST_CURSOR_PREFIX = 'artifacts:'
const MAX_LIST_OFFSET = 100_000

export interface McpArtifactContext {
  db: DbClient
  storage: BlobStore
  kv: ArtifactKv
  userId: number
  clientId: string
  logger: LoggerLike
  siteUrl: string
}

interface FeatureCheck {
  active: boolean
  flags: readonly string[]
}

function createUnavailableError() {
  return createError({
    message: MCP_ARTIFACT_UNAVAILABLE_MESSAGE,
    status: 404,
    why: 'feature_unavailable',
  })
}

function createInvalidInputError(message: string) {
  return createError({ status: 400, message })
}

function toSentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`
}

/**
 * The store's errors carry the useful part in `why` and `fix`, which an MCP
 * client never shows because it only prints `message`. Folds them into the
 * message, like the in-chat artifact tools do.
 */
function withReadableDetails(exception: unknown): unknown {
  if (!isClientError(exception)) {
    return exception
  }

  const error = exception as {
    message: string
    status: number
    code?: string
    why?: string
    fix?: string
  }
  const hasWhy = Boolean(error.why) && error.why !== error.message
  const hasFix = Boolean(error.fix)

  if (!hasWhy && !hasFix) {
    return exception
  }

  const parts = [
    toSentence(error.message),
    hasWhy ? toSentence(error.why!) : '',
    hasFix ? toSentence(error.fix!) : '',
  ].filter(Boolean)

  return createError({
    message: parts.join(' '),
    status: error.status,
    code: error.code,
  })
}

async function readable<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation()
  } catch (exception) {
    throw withReadableDetails(exception)
  }
}

/**
 * Checks the caller's artifact flags without a request: `artifacts` and
 * `artifacts.mcp` always, plus the extra flags a tool needs. `active: true`
 * also needs the user's Labs toggle on, like the routes that create
 * something; `active: false` is for the ways out (revoke and delete), which
 * stay open for a user who switched artifacts off. Any failure is the same
 * generic 404, raised before an id is looked at, so a tool never reveals
 * whether an id exists.
 */
export async function assertMcpArtifactsAvailable(
  context: Pick<McpArtifactContext, 'db' | 'kv' | 'userId' | 'logger'>,
  check: FeatureCheck,
): Promise<void> {
  const [rules, userState] = await Promise.all([
    loadFeatureRules(context.kv, context.db, context.logger),
    loadUserFeatureState(context.db, context.userId),
  ])
  const evaluation = {
    rules,
    userState,
    config: getFeatureEvaluationConfig(),
  }
  const flags = ['artifacts', 'artifacts.mcp', ...check.flags]

  for (const flag of flags) {
    const resolution = await evaluateFeature(flag, evaluation)
    const isAllowed = check.active
      ? isFeatureActive(flag, resolution, userState)
      : resolution.value

    if (!isAllowed) {
      throw createUnavailableError()
    }
  }
}

function encodeListCursor(offset: number): string {
  return btoa(`${LIST_CURSOR_PREFIX}${offset}`)
}

function readBase64(value: string): string {
  try {
    return atob(value)
  } catch {
    throw createInvalidInputError('The cursor is not valid. Start again.')
  }
}

function decodeListCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }

  const decoded = readBase64(cursor)
  const offset = decoded.startsWith(LIST_CURSOR_PREFIX)
    ? Number(decoded.slice(LIST_CURSOR_PREFIX.length))
    : Number.NaN

  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_LIST_OFFSET) {
    throw createInvalidInputError('The cursor is not valid. Start again.')
  }

  return offset
}

export async function listMcpArtifacts(
  context: McpArtifactContext,
  input: {
    query?: string
    kind?: ArtifactKind
    limit?: number
    cursor?: string
  },
) {
  await assertMcpArtifactsAvailable(context, { active: true, flags: [] })

  const offset = decodeListCursor(input.cursor)
  const limit = clampMcpLimit(
    input.limit,
    MCP_ARTIFACT_LIST_DEFAULT_LIMIT,
    MCP_ARTIFACT_LIST_MAX_LIMIT,
  )
  const { items, total } = await listArtifacts({
    db: context.db,
    userId: context.userId,
    offset,
    limit,
    query: input.query,
    kind: input.kind,
  })
  const nextOffset = offset + items.length

  return {
    items: items.map((item) => {
      return {
        id: item.id,
        title: item.title,
        kind: item.kind,
        version: item.currentVersion,
        updatedAt: item.updatedAt,
        originChatSlug: item.originChatSlug,
        activeShares: item.activeShareCount,
        takenDown: item.takenDown,
      }
    }),
    nextCursor: nextOffset < total ? encodeListCursor(nextOffset) : null,
  }
}

export async function getMcpArtifact(
  context: McpArtifactContext,
  input: { id: string, version?: number },
) {
  await assertMcpArtifactsAvailable(context, { active: true, flags: [] })

  const version = await readable(() => {
    return readArtifactVersion({
      db: context.db,
      storage: context.storage,
      userId: context.userId,
      artifactId: input.id,
      version: input.version,
    })
  })
  const detail = await getArtifactDetail({
    db: context.db,
    userId: context.userId,
    artifactId: input.id,
  })

  return {
    id: input.id,
    title: detail.title,
    kind: version.kind,
    version: version.version,
    versions: detail.versions.map((entry) => {
      return entry.version
    }),
    content: version.content,
  }
}

export async function listMcpArtifactShares(
  context: McpArtifactContext,
  input: { id: string },
  options: { includeUrls: boolean },
) {
  await assertMcpArtifactsAvailable(context, { active: true, flags: [] })

  const shares = await listArtifactShares({
    db: context.db,
    userId: context.userId,
    artifactId: input.id,
    includeEnded: false,
    baseUrl: context.siteUrl,
  })

  return shares.map((share) => {
    return {
      shareId: share.shareId,
      status: share.status,
      url: options.includeUrls ? share.url : null,
      createdVia: share.createdVia,
      createdByApp: share.clientName,
      pinnedVersion: share.pinnedVersion,
      expiresAt: share.expiresAt,
      storageAllowed: share.storageAllowed,
      bridgeAllowed: share.bridgeAllowed,
    }
  })
}

function assertContentWithinCap(content: string): void {
  if (content.length > MCP_ARTIFACT_CONTENT_MAX_CHARS) {
    throw createInvalidInputError(
      'The content is longer than '
      + `${MCP_ARTIFACT_CONTENT_MAX_CHARS} characters.`,
    )
  }
}

export async function createMcpArtifact(
  context: McpArtifactContext,
  input: { kind: ArtifactKind, title: string, content: string },
) {
  if (!(ARTIFACT_KINDS as readonly string[]).includes(input.kind)) {
    throw createInvalidInputError('Unknown artifact kind.')
  }

  await assertMcpArtifactsAvailable(context, {
    active: true,
    flags: input.kind === 'react' ? ['artifacts.react'] : [],
  })

  assertContentWithinCap(input.content)

  const created = await readable(() => {
    return createArtifact({
      db: context.db,
      storage: context.storage,
      userId: context.userId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      originChatId: null,
      originMessageId: null,
      createdVia: 'mcp',
      createdBy: 'mcp',
      logger: context.logger,
    })
  })

  return {
    id: created.artifactId,
    version: created.version,
    url_in_app: `${context.siteUrl}/chats/artifacts?artifact=${created.artifactId}`,
  }
}

async function requireOwnedArtifact(
  context: McpArtifactContext,
  artifactId: string,
) {
  const internalId = decodeArtifactId(artifactId)

  if (internalId === null) {
    throw createArtifactNotFoundError()
  }

  const artifact = await findOwnedArtifact(
    context.db,
    context.userId,
    internalId,
  )

  if (!artifact) {
    throw createArtifactNotFoundError()
  }

  return artifact
}

export async function updateMcpArtifact(
  context: McpArtifactContext,
  input: {
    id: string
    title?: string
    content?: string
    edits?: ArtifactEdit[]
  },
) {
  await assertMcpArtifactsAvailable(context, { active: true, flags: [] })

  if ((input.content === undefined) === (input.edits === undefined)) {
    throw createInvalidInputError('Send exactly one of `edits` or `content`.')
  }

  const artifact = await requireOwnedArtifact(context, input.id)

  if (artifact.kind === 'react') {
    await assertMcpArtifactsAvailable(context, {
      active: true,
      flags: ['artifacts.react'],
    })
  }

  let nextContent = input.content ?? ''
  let expectedVersion: number | undefined

  if (input.edits) {
    const current = await readable(() => {
      return readArtifactVersion({
        db: context.db,
        storage: context.storage,
        userId: context.userId,
        artifactId: input.id,
      })
    })

    nextContent = applyArtifactEdits(current.content, input.edits)
    expectedVersion = current.version
  }

  assertContentWithinCap(nextContent)

  const written = await readable(() => {
    return appendArtifactVersion({
      db: context.db,
      storage: context.storage,
      userId: context.userId,
      artifactId: input.id,
      content: nextContent,
      title: input.title,
      expectedVersion,
      createdBy: 'mcp',
      logger: context.logger,
    })
  })

  return { id: written.artifactId, version: written.version }
}

export async function revokeMcpArtifactShares(
  context: McpArtifactContext,
  input: { shareIds?: string[], artifactIds?: string[] },
) {
  await assertMcpArtifactsAvailable(context, { active: false, flags: [] })

  const hasShareIds = input.shareIds !== undefined
  const hasArtifactIds = input.artifactIds !== undefined

  if (hasShareIds === hasArtifactIds) {
    throw createInvalidInputError(
      'Send exactly one of `shareIds` or `artifactIds`.',
    )
  }

  return await revokeArtifactShares({
    db: context.db,
    userId: context.userId,
    shareIds: input.shareIds,
    artifactIds: input.artifactIds,
  })
}

function formatShareRetryWait(retryAfter: number | null): string {
  if (retryAfter === null) {
    return 'a few hours'
  }

  if (retryAfter < 60) {
    return `${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}`
  }

  if (retryAfter < 3600) {
    return `${Math.ceil(retryAfter / 60)} minutes`
  }

  return `${Math.ceil(retryAfter / 3600)} hours`
}

function createShareLimitError(retryAfter: number | null) {
  return createError({
    status: 429,
    message: 'Connected apps can create at most '
      + `${MCP_ARTIFACT_SHARE_DAILY_LIMIT.max} public artifact links a day. `
      + `Try again in about ${formatShareRetryWait(retryAfter)}, or create `
      + 'the link in Besidka.',
  })
}

function createShareTooFastError() {
  return createError({
    status: 429,
    message: 'Share requests came too close together. Try again in '
      + `${formatShareRetryWait(SHARE_BUSY_RETRY_AFTER_SECONDS)}.`,
    data: { retryAfter: SHARE_BUSY_RETRY_AFTER_SECONDS },
  })
}

async function consumeDailyShareAllowance(
  context: McpArtifactContext,
): Promise<void> {
  const limiter = createAuthRateLimitStorage(
    context.kv as KVNamespace,
    ARTIFACT_SHARE_LIMIT_KEY_PREFIX,
  )
  let result: Awaited<ReturnType<typeof limiter.consume>>

  try {
    result = await limiter.consume(
      String(context.userId),
      MCP_ARTIFACT_SHARE_DAILY_LIMIT,
    )
  } catch {
    throw createShareTooFastError()
  }

  if (!result.allowed) {
    throw createShareLimitError(result.retryAfter)
  }
}

/**
 * Publishes an artifact for at most 30 days. The link never allows viewer
 * storage or the model bridge, is recorded as created by this OAuth client
 * and is limited to 10 a day per user. The deterministic personal-data
 * detectors run on the shared version and their kinds come back as
 * `warnings`; the model-based check is skipped because it would spend the
 * user's key.
 */
export async function shareMcpArtifact(
  context: McpArtifactContext,
  input: { id: string, expiresInDays: number, pinnedVersion?: number },
) {
  await assertMcpArtifactsAvailable(context, {
    active: true,
    flags: ['artifacts.share'],
  })

  if (
    !Number.isInteger(input.expiresInDays)
    || input.expiresInDays < 1
    || input.expiresInDays > MCP_ARTIFACT_SHARE_MAX_DAYS
  ) {
    throw createInvalidInputError(
      'expiresInDays must be a whole number from 1 to '
      + `${MCP_ARTIFACT_SHARE_MAX_DAYS}.`,
    )
  }

  await readable(() => {
    return assertArtifactShareable({
      db: context.db,
      userId: context.userId,
      artifactId: input.id,
      pinnedVersion: input.pinnedVersion ?? null,
    })
  })

  const shared = await readable(() => {
    return readArtifactVersion({
      db: context.db,
      storage: context.storage,
      userId: context.userId,
      artifactId: input.id,
      version: input.pinnedVersion,
    })
  })
  const { kinds } = detectSharePii([`Title: ${shared.title}`, shared.content])

  await consumeDailyShareAllowance(context)

  const created = await readable(() => {
    return createArtifactShare({
      db: context.db,
      userId: context.userId,
      artifactId: input.id,
      expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MILLISECONDS),
      pinnedVersion: input.pinnedVersion ?? null,
      storageAllowed: false,
      bridgeAllowed: false,
      createdVia: 'mcp',
      clientId: context.clientId,
      baseUrl: context.siteUrl,
    })
  })

  return {
    shareId: created.share.shareId,
    url: buildArtifactShareUrl(created.token, context.siteUrl),
    expiresAt: created.share.expiresAt,
    warnings: kinds,
  }
}

/**
 * Deletes owned artifacts through the store: versions, links and viewer
 * storage go, `artifact_reports` rows never do, and an artifact under a
 * legal hold is skipped and reported in `held`.
 */
export async function deleteMcpArtifacts(
  context: McpArtifactContext,
  input: { ids: string[], confirm: boolean },
) {
  await assertMcpArtifactsAvailable(context, { active: false, flags: [] })

  if (input.confirm !== true) {
    throw createInvalidInputError(
      'Set confirm to true to delete artifacts permanently.',
    )
  }

  const ids = [...new Set(input.ids)]
  const result = await deleteArtifacts({
    db: context.db,
    storage: context.storage,
    userId: context.userId,
    artifactIds: ids,
    logger: context.logger,
  })
  const handled = new Set([...result.deletedIds, ...result.heldIds])

  return {
    deleted: result.deletedIds,
    held: result.heldIds,
    notFound: ids.filter((id) => {
      return !handled.has(id)
    }),
  }
}
