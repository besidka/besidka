import { desc, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  SKILL_MCP_DELETE_BATCH,
  SKILL_MCP_FILE_MAX_CHARS,
  SKILL_MCP_FILES_MAX,
  SKILL_MCP_LIST_LIMIT_MAX,
  SKILL_MCP_WRITES_PER_HOUR,
} from '#shared/utils/skills-policy'
import type { SkillChange } from '#shared/utils/skills/edit'
import * as schema from '~~/server/db/schema'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import {
  evaluateFeature,
  getFeatureEvaluationConfig,
  isFeatureActive,
  loadFeatureRules,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'
import type { FeatureKv } from '~~/server/utils/features/evaluate'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  clampMcpLimit,
  createInvalidMcpCursorError,
} from '~~/server/utils/mcp/private/chats'
import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'
import { readable } from '~~/server/utils/mcp/readable-error'
import { deleteUserSkill } from '~~/server/utils/skills/cleanup'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import {
  createSkillForMcpClient,
  renameSkillForMcpClient,
  stageSkillUpdateForMcpClient,
} from '~~/server/utils/skills/versions/mcp'
import type {
  McpSkillFileInput,
  McpSkillFinding,
} from '~~/server/utils/skills/versions/mcp'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
  readBlobText,
} from '~~/server/utils/skills/versions/read'
import type { SkillRow } from '~~/server/utils/skills/versions/read'
import type { SkillWriteBucket } from '~~/server/utils/skills/versions/write'

type DbClient = ReturnType<typeof useDb>

export const MCP_SKILL_LIST_DEFAULT_LIMIT = 20
export const MCP_SKILL_LIST_MAX_LIMIT = SKILL_MCP_LIST_LIMIT_MAX
export const MCP_SKILL_FILES_MAX = SKILL_MCP_FILES_MAX
export const MCP_SKILL_FILE_MAX_CHARS = SKILL_MCP_FILE_MAX_CHARS
export const MCP_SKILL_DELETE_MAX = SKILL_MCP_DELETE_BATCH
export const MCP_SKILL_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/
export const MCP_SKILLS_UNAVAILABLE_MESSAGE
  = 'Skills are not available for this account.'
export const MCP_SKILL_FINDINGS_SHOWN = 100

const SKILLS_FLAG = 'skills'
const SKILLS_PAGE_PATH = '/chats/skills'
const LIST_CURSOR_PREFIX = 'skills:'
const MAX_LIST_OFFSET = 1000
const WRITE_LIMIT_KEY_PREFIX = 'mcp:rate-limit:skill-writes'
const WRITE_LIMIT_WINDOW_SECONDS = 60 * 60
const WRITE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60

export type McpSkillKind = 'skill' | 'command'

export interface McpSkillContext {
  db: DbClient
  kv: FeatureKv
  bucket: SkillWriteBucket
  userId: number
  clientId: string
  logger: LoggerLike
  siteUrl: string
}

export interface McpSkillListInput {
  cursor?: string
  limit?: number
  kind?: McpSkillKind
}

export interface McpSkillGetInput {
  id: string
  version?: number
  path?: string
}

export interface McpSkillCreateInput {
  files: McpSkillFileInput[]
  slashCommand?: string
  modelInvocable?: boolean
  argumentHint?: string
}

export interface McpSkillUpdateInput {
  id: string
  baseVersion: number
  changes: SkillChange[]
}

export interface McpSkillRenameInput {
  id: string
  name: string
}

export interface McpSkillDeleteInput {
  ids: string[]
}

export interface McpSkillSummary {
  id: string
  name: string
  description: string
  enabled: boolean
  status: string
  licenseClass: string
  sourceKind: string
  sourceUrl: string | null
  sourceRef: string | null
  version: number
  pendingVersion: number | null
  filesCount: number
  bytes: number
  createdVia: string
  modelInvocable: boolean
  slashCommand: boolean
  command: string | null
  argumentHint: string | null
  updatedAt: string | null
}

function createUnavailableError() {
  return createError({
    message: MCP_SKILLS_UNAVAILABLE_MESSAGE,
    status: 404,
    why: 'feature_unavailable',
  })
}

function createNotFoundError() {
  return createError({
    status: 404,
    message: 'Skill not found. Use list_skills to see your skills and their '
      + 'ids.',
  })
}

function buildReviewUrl(siteUrl: string, skillId: string): string {
  return `${siteUrl}${SKILLS_PAGE_PATH}?skill=${encodeURIComponent(skillId)}`
}

function createTooManyWritesError(retryAfter: number | null) {
  const wait = retryAfter === null ? 'a while' : `${retryAfter} seconds`

  return createError({
    status: 429,
    message: `Too many skill changes through connected apps. At most `
      + `${SKILL_MCP_WRITES_PER_HOUR} an hour. Wait ${wait} and try again.`,
  })
}

/**
 * Checks the caller's `skills` flag without a request, like the app routes.
 * Any failure is the same generic 404 and runs before an id is looked at, so
 * a tool never reveals whether an id exists. The flag is checked here and
 * not with the toolkit's per-tool `enabled` guard, which would hide the
 * tools from anonymous `tools/list`.
 */
export async function assertMcpSkillsAvailable(
  context: Pick<McpSkillContext, 'db' | 'kv' | 'userId' | 'logger'>,
): Promise<void> {
  const [rules, userState] = await Promise.all([
    loadFeatureRules(context.kv, context.db, context.logger),
    loadUserFeatureState(context.db, context.userId),
  ])
  const resolution = await evaluateFeature(SKILLS_FLAG, {
    rules,
    userState,
    config: getFeatureEvaluationConfig(),
  })

  if (!isFeatureActive(SKILLS_FLAG, resolution, userState)) {
    throw createUnavailableError()
  }
}

/**
 * One hourly counter shared by create, update and rename. The KV counter
 * is not atomic, and it fails closed: when KV cannot be read or written the
 * call is refused with a 429 instead of being let through uncounted.
 */
export async function enforceMcpSkillWriteLimit(
  context: Pick<McpSkillContext, 'kv' | 'userId'>,
): Promise<void> {
  let result: { allowed: boolean, retryAfter: number | null }

  try {
    result = await createAuthRateLimitStorage(
      context.kv as never,
      WRITE_LIMIT_KEY_PREFIX,
    ).consume(String(context.userId), {
      window: WRITE_LIMIT_WINDOW_SECONDS,
      max: SKILL_MCP_WRITES_PER_HOUR,
    })
  } catch {
    throw createTooManyWritesError(WRITE_LIMIT_UNAVAILABLE_RETRY_SECONDS)
  }

  if (!result.allowed) {
    throw createTooManyWritesError(result.retryAfter)
  }
}

function encodeListCursor(offset: number): string {
  return btoa(`${LIST_CURSOR_PREFIX}${offset}`)
}

function decodeListCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }

  let decoded: string

  try {
    decoded = atob(cursor)
  } catch {
    throw createInvalidMcpCursorError()
  }

  const offset = decoded.startsWith(LIST_CURSOR_PREFIX)
    ? Number(decoded.slice(LIST_CURSOR_PREFIX.length))
    : Number.NaN

  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_LIST_OFFSET) {
    throw createInvalidMcpCursorError()
  }

  return offset
}

function toSkillSummary(skill: SkillRow): McpSkillSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    status: skill.status,
    licenseClass: skill.licenseClass,
    sourceKind: skill.sourceKind,
    sourceUrl: skill.sourceUrl,
    sourceRef: skill.sourceRef,
    version: skill.currentVersion,
    pendingVersion: skill.pendingVersion,
    filesCount: skill.filesCount,
    bytes: skill.bytes,
    createdVia: skill.createdVia,
    modelInvocable: skill.modelInvocable,
    slashCommand: skill.slashName !== null,
    command: skill.slashName,
    argumentHint: skill.argumentHint,
    updatedAt: toIsoTimestamp(skill.updatedAt),
  }
}

async function loadSkillOrNotFound(
  context: McpSkillContext,
  skillId: string,
): Promise<SkillRow> {
  try {
    return await loadOwnedSkill(context.db, context.userId, skillId)
  } catch (exception) {
    if ((exception as { status?: number }).status === 404) {
      throw createNotFoundError()
    }

    throw exception
  }
}

function limitFindings(findings: McpSkillFinding[]) {
  return {
    findings: findings.slice(0, MCP_SKILL_FINDINGS_SHOWN),
    findingsTotal: findings.length,
  }
}

export async function listMcpSkills(
  context: McpSkillContext,
  input: McpSkillListInput,
) {
  await assertMcpSkillsAvailable(context)

  const limit = clampMcpLimit(
    input.limit,
    MCP_SKILL_LIST_DEFAULT_LIMIT,
    MCP_SKILL_LIST_MAX_LIMIT,
  )
  const offset = decodeListCursor(input.cursor)
  const rows = await context.db.select()
    .from(schema.skills)
    .where(eq(schema.skills.userId, context.userId))
    .orderBy(desc(schema.skills.updatedAt), desc(schema.skills.id))
  const matching = rows.filter((row) => {
    if (input.kind === undefined) {
      return true
    }

    return input.kind === 'command'
      ? row.slashName !== null
      : row.slashName === null
  })
  const page = matching.slice(offset, offset + limit)
  const hasMore = matching.length > offset + limit

  return {
    skills: page.map(toSkillSummary),
    nextCursor: hasMore ? encodeListCursor(offset + limit) : null,
  }
}

export async function getMcpSkill(
  context: McpSkillContext,
  input: McpSkillGetInput,
) {
  await assertMcpSkillsAvailable(context)

  const skill = await loadSkillOrNotFound(context, input.id)
  const version = input.version ?? skill.currentVersion
  const versionRow = await loadVersionRow(
    context.db,
    context.userId,
    skill.id,
    version,
  )

  if (!versionRow) {
    throw createError({
      status: 404,
      message: 'Version not found. It does not exist or was removed with '
        + 'the older versions.',
    })
  }

  const files = await loadVersionFiles(
    context.db,
    context.userId,
    skill.id,
    version,
  )
  const detail = {
    ...toSkillSummary(skill),
    inspectedVersion: version,
    isCurrentVersion: version === skill.currentVersion,
    isPendingVersion: version === skill.pendingVersion,
    files: files.map((file) => {
      return { path: file.path, bytes: file.bytes, kind: file.kind }
    }),
  }

  if (input.path === undefined) {
    return detail
  }

  const file = files.find((candidate) => {
    return candidate.path === input.path
  })

  if (!file) {
    throw createError({
      status: 404,
      message: 'This version has no file at that path. Call get_skill '
        + 'without path to see the file list.',
    })
  }

  const text = await readable(async () => {
    return await readBlobText({
      bucket: context.bucket,
      userId: context.userId,
      skillId: skill.id,
      blobSha256: file.blobSha256,
    })
  })
  const truncated = text.length > MCP_SKILL_FILE_MAX_CHARS

  return {
    ...detail,
    path: file.path,
    text: truncated ? text.slice(0, MCP_SKILL_FILE_MAX_CHARS) : text,
    truncated,
  }
}

export async function createMcpSkill(
  context: McpSkillContext,
  input: McpSkillCreateInput,
) {
  await assertMcpSkillsAvailable(context)
  await enforceMcpSkillWriteLimit(context)

  const created = await readable(async () => {
    return await createSkillForMcpClient({
      db: context.db,
      bucket: context.bucket,
      userId: context.userId,
      clientId: context.clientId,
      files: input.files,
      slashCommand: input.slashCommand,
      modelInvocable: input.modelInvocable,
      argumentHint: input.argumentHint,
      logger: context.logger,
    })
  })
  const reviewUrl = buildReviewUrl(context.siteUrl, created.id)

  return {
    id: created.id,
    name: created.name,
    version: created.version,
    enabled: false,
    status: 'needs-review',
    licenseClass: created.licenseClass,
    filesCount: created.filesCount,
    bytes: created.bytes,
    ...limitFindings(created.findings),
    warnings: created.warnings,
    reviewUrl,
    message: 'The skill is saved switched off. The user must review and '
      + `enable it in Besidka at ${reviewUrl}.`,
  }
}

export async function updateMcpSkill(
  context: McpSkillContext,
  input: McpSkillUpdateInput,
) {
  await assertMcpSkillsAvailable(context)
  await loadSkillOrNotFound(context, input.id)
  await enforceMcpSkillWriteLimit(context)

  const staged = await readable(async () => {
    return await stageSkillUpdateForMcpClient({
      db: context.db,
      bucket: context.bucket,
      userId: context.userId,
      clientId: context.clientId,
      skillId: input.id,
      baseVersion: input.baseVersion,
      changes: input.changes,
      logger: context.logger,
    })
  })

  if (staged.unchanged) {
    return {
      id: staged.id,
      name: staged.name,
      unchanged: true,
      version: staged.version,
      message: 'These changes leave the skill as it is, so nothing was '
        + 'saved and the skill stays as it was.',
    }
  }

  const reviewUrl = buildReviewUrl(context.siteUrl, staged.id)

  return {
    id: staged.id,
    name: staged.name,
    unchanged: false,
    enabled: false,
    status: 'needs-review',
    baseVersion: staged.baseVersion,
    pendingVersion: staged.pendingVersion,
    replacedPendingVersion: staged.replacedPendingVersion,
    sha256: staged.sha256,
    licenseClass: staged.licenseClass,
    filesCount: staged.filesCount,
    bytes: staged.bytes,
    diffSummary: staged.diffSummary,
    ...limitFindings(staged.findings),
    warnings: staged.warnings,
    reviewUrl,
    message: 'The update is saved as a pending version and the skill is '
      + 'switched off. The user must review and accept it in Besidka at '
      + `${reviewUrl}.`,
  }
}

export async function renameMcpSkill(
  context: McpSkillContext,
  input: McpSkillRenameInput,
) {
  await assertMcpSkillsAvailable(context)
  await loadSkillOrNotFound(context, input.id)
  await enforceMcpSkillWriteLimit(context)

  const renamed = await readable(async () => {
    return await renameSkillForMcpClient({
      db: context.db,
      bucket: context.bucket,
      userId: context.userId,
      clientId: context.clientId,
      skillId: input.id,
      name: input.name,
      logger: context.logger,
    })
  })

  if (renamed.unchanged) {
    return {
      id: renamed.id,
      name: renamed.name,
      unchanged: true,
      version: renamed.version,
    }
  }

  const reviewUrl = buildReviewUrl(context.siteUrl, renamed.id)

  return {
    id: renamed.id,
    name: renamed.name,
    previousName: renamed.previousName,
    unchanged: false,
    version: renamed.version,
    enabled: false,
    status: 'needs-review',
    warnings: renamed.warnings,
    reviewUrl,
    message: 'The skill is renamed and switched off. The user must review '
      + `and enable it in Besidka at ${reviewUrl}.`,
  }
}

/**
 * Deletes the caller's skills one at a time (each is a batch of rows plus an
 * R2 prefix delete). An id that is malformed, unknown or another user's is
 * reported as not found, the same way, and nothing else is revealed.
 */
export async function deleteMcpSkills(
  context: McpSkillContext,
  input: McpSkillDeleteInput,
) {
  await assertMcpSkillsAvailable(context)

  const deleted: string[] = []
  const notFound: string[] = []

  for (const skillId of new Set(input.ids)) {
    if (!isDecodableSkillPublicId(skillId)) {
      notFound.push(skillId)

      continue
    }

    const result = await readable(async () => {
      return await deleteUserSkill(
        context.db,
        {
          userId: context.userId,
          skillId,
          logger: context.logger,
        },
        context.bucket,
      )
    })

    if (result.skillDeleted) {
      deleted.push(skillId)
    } else {
      notFound.push(skillId)
    }
  }

  return { deleted, notFound }
}
