import { createAnthropic } from '@ai-sdk/anthropic'
import { uploadSkill } from 'ai'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  SKILL_CONTAINER_MAX_BYTES,
  SKILL_PROVIDER_DISPLAY_TITLE_MAX,
  encodeProviderSkillVersion,
  isProviderCopyCurrent,
  isProviderCopyLive,
  parseProviderSkillVersion,
  renameSkillMarkdown,
  toProviderSkillName,
} from '#shared/utils/skills/scripts'
import * as schema from '~~/server/db/schema'
import { ANTHROPIC_API_VERSION } from '~~/server/utils/code-execution/container-files'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  loadVersionFiles,
  readBlobBytes,
} from '~~/server/utils/skills/versions/read'
import type {
  SkillReadBucket,
  SkillRow,
} from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

export const ANTHROPIC_SKILLS_URL = 'https://api.anthropic.com/v1/skills'
export const ANTHROPIC_SKILLS_BETA = 'skills-2025-10-02'
export const PROVIDER_SKILL_REQUEST_TIMEOUT_MS = 10_000
export const PROVIDER_SKILL_DELETE_MAX_ROUNDS = 5

const SAFE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,200}$/
const NOT_FOUND_STATUS = 404
const SKILL_MD_PATH = 'SKILL.md'
const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

export type ProviderSkillDeleteOutcome = 'deleted' | 'already-gone' | 'failed'

export type SkillUploader = (input: {
  apiKey: string
  files: Array<{ path: string, data: Uint8Array }>
  displayTitle: string
}) => Promise<{
  providerSkillId: string
  latestVersion: string | null
}>

export interface ProviderSkillReference {
  skillId: string
  name: string
  providerSkillId: string
  providerVersion: string
}

export interface UploadableSkill {
  id: string
  name: string
  currentVersion: number
  providerSkillId: string | null
  providerSkillVersion: string | null
  providerUploadedName: string | null
  providerDeletedAt: Date | null
}

export const uploadSkillWithAnthropic: SkillUploader = async (input) => {
  const result = await uploadSkill({
    api: createAnthropic({ apiKey: input.apiKey }).skills(),
    files: input.files,
    displayTitle: input.displayTitle,
  })
  const providerSkillId = result.providerReference.anthropic

  if (!providerSkillId) {
    throw new TypeError('The provider returned no skill id')
  }

  return {
    providerSkillId,
    latestVersion: result.latestVersion ?? null,
  }
}

function buildDeleteHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_API_VERSION,
    'anthropic-beta': ANTHROPIC_SKILLS_BETA,
  }
}

function createProviderSkillError(
  message: string,
  why: string,
  fix: string,
  status = 502,
) {
  return createError({ message, status, why, fix })
}

/**
 * The Anthropic key of one user, decrypted for this call only. Never logged
 * and never stored anywhere else.
 */
export async function loadAnthropicApiKey(
  db: DbClient,
  userId: number,
): Promise<string | null> {
  const key = await db.query.keys.findFirst({
    where: { userId, provider: 'anthropic' },
    columns: { apiKey: true },
  })

  if (!key?.apiKey) {
    return null
  }

  return await useDecryptText(key.apiKey)
}

/**
 * The same key, but a key that cannot be read (a decrypt failure) is `null`
 * and logged without any detail, so a delete that needs it reports a failed
 * provider delete instead of blocking the user.
 */
export async function loadAnthropicApiKeyOrNull(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
): Promise<string | null> {
  try {
    return await loadAnthropicApiKey(db, userId)
  } catch (exception) {
    logger.set({
      attributes: {
        skills: { providerKey: { error: exceptionMessage(exception) } },
      },
    })

    return null
  }
}

async function requestProvider(input: {
  url: string
  method: 'GET' | 'DELETE'
  apiKey: string
  fetcher: typeof fetch
}): Promise<Response> {
  return await input.fetcher(input.url, {
    method: input.method,
    headers: buildDeleteHeaders(input.apiKey),
    redirect: 'manual',
    signal: AbortSignal.timeout(PROVIDER_SKILL_REQUEST_TIMEOUT_MS),
  })
}

async function listProviderVersions(input: {
  providerSkillId: string
  apiKey: string
  fetcher: typeof fetch
}): Promise<string[] | 'already-gone'> {
  const response = await requestProvider({
    url: `${ANTHROPIC_SKILLS_URL}/${input.providerSkillId}/versions?limit=100`,
    method: 'GET',
    apiKey: input.apiKey,
    fetcher: input.fetcher,
  })

  if (response.status === NOT_FOUND_STATUS) {
    await response.body?.cancel()

    return 'already-gone'
  }

  if (!response.ok) {
    await response.body?.cancel()

    throw new TypeError(`Listing versions answered ${response.status}`)
  }

  const body = await response.json() as { data?: unknown }
  const entries = Array.isArray(body.data) ? body.data : []

  return entries.flatMap((entry) => {
    const version = (entry as { version?: unknown } | null)?.version

    return typeof version === 'string' && SAFE_ID_PATTERN.test(version)
      ? [version]
      : []
  })
}

/**
 * Deletes one skill at Anthropic with the user's own key: every version
 * first, then the skill itself (the API refuses to delete a skill that still
 * has versions). Sequential, one request at a time. A 404 means it is gone
 * already. Never throws, and logs the outcome only, never the id or the key.
 */
export async function deleteProviderSkill(input: {
  providerSkillId: string
  apiKey: string
  logger: LoggerLike
  fetcher?: typeof fetch
}): Promise<ProviderSkillDeleteOutcome> {
  const fetcher = input.fetcher ?? fetch

  if (!SAFE_ID_PATTERN.test(input.providerSkillId)) {
    return 'failed'
  }

  try {
    for (let round = 0; round < PROVIDER_SKILL_DELETE_MAX_ROUNDS; round += 1) {
      const versions = await listProviderVersions({
        providerSkillId: input.providerSkillId,
        apiKey: input.apiKey,
        fetcher,
      })

      if (versions === 'already-gone') {
        return 'already-gone'
      }

      if (versions.length === 0) {
        break
      }

      for (const version of versions) {
        const response = await requestProvider({
          url: `${ANTHROPIC_SKILLS_URL}/${input.providerSkillId}/versions/${version}`,
          method: 'DELETE',
          apiKey: input.apiKey,
          fetcher,
        })

        await response.body?.cancel()

        if (!response.ok && response.status !== NOT_FOUND_STATUS) {
          return 'failed'
        }
      }
    }

    const response = await requestProvider({
      url: `${ANTHROPIC_SKILLS_URL}/${input.providerSkillId}`,
      method: 'DELETE',
      apiKey: input.apiKey,
      fetcher,
    })

    await response.body?.cancel()

    if (response.status === NOT_FOUND_STATUS) {
      return 'already-gone'
    }

    return response.ok ? 'deleted' : 'failed'
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: {
          providerDelete: { error: exceptionMessage(exception) },
        },
      },
    })

    return 'failed'
  }
}

async function markProviderCopyDeleted(
  db: DbClient,
  userId: number,
  skillId: string,
): Promise<void> {
  await db.update(schema.skills)
    .set({
      providerSkillId: null,
      providerSkillVersion: null,
      providerUploadedName: null,
      providerDeletedAt: new Date(),
    })
    .where(and(
      eq(schema.skills.id, skillId),
      eq(schema.skills.userId, userId),
    ))
}

export interface ProviderCopyRemoval {
  attempted: number
  deleted: number
  failed: number
}

/**
 * Deletes the Anthropic copy of one skill and, only when it is gone, clears
 * the columns and stamps `provider_deleted_at`. A failed delete keeps the id,
 * so the user can retry or remove it in the Anthropic Console.
 */
export async function removeProviderCopy(input: {
  db: DbClient
  userId: number
  skill: Pick<SkillRow,
  'id' | 'providerSkillId' | 'providerSkillVersion'
  | 'providerUploadedName' | 'providerDeletedAt'
  >
  apiKey: string | null
  logger: LoggerLike
  fetcher?: typeof fetch
}): Promise<ProviderSkillDeleteOutcome | 'none'> {
  const { skill } = input

  if (!isProviderCopyLive({
    providerSkillId: skill.providerSkillId,
    providerSkillVersion: skill.providerSkillVersion,
    providerUploadedName: skill.providerUploadedName,
    providerDeletedAt: skill.providerDeletedAt,
  }) || !skill.providerSkillId) {
    return 'none'
  }

  if (!input.apiKey) {
    return 'failed'
  }

  const outcome = await deleteProviderSkill({
    providerSkillId: skill.providerSkillId,
    apiKey: input.apiKey,
    logger: input.logger,
    fetcher: input.fetcher,
  })

  if (outcome !== 'failed') {
    await markProviderCopyDeleted(input.db, input.userId, skill.id)
  }

  return outcome
}

/**
 * Removes the Anthropic copies of every skill of one user, one skill at a
 * time, before the key is purged. Best effort: a missing key or a failed
 * delete is counted, never thrown, so the account deletion goes on.
 */
export async function removeAllProviderCopies(input: {
  db: DbClient
  userId: number
  logger: LoggerLike
  fetcher?: typeof fetch
}): Promise<ProviderCopyRemoval> {
  const result: ProviderCopyRemoval = { attempted: 0, deleted: 0, failed: 0 }
  const rows = await input.db.select({
    id: schema.skills.id,
    providerSkillId: schema.skills.providerSkillId,
    providerSkillVersion: schema.skills.providerSkillVersion,
    providerUploadedName: schema.skills.providerUploadedName,
    providerDeletedAt: schema.skills.providerDeletedAt,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, input.userId),
      isNotNull(schema.skills.providerSkillId),
      isNull(schema.skills.providerDeletedAt),
    ))

  if (rows.length === 0) {
    return result
  }

  let apiKey: string | null = null

  try {
    apiKey = await loadAnthropicApiKey(input.db, input.userId)
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: { providerPurge: { keyError: exceptionMessage(exception) } },
      },
    })
  }

  for (const row of rows) {
    result.attempted += 1

    const outcome = await removeProviderCopy({
      db: input.db,
      userId: input.userId,
      skill: row,
      apiKey,
      logger: input.logger,
      fetcher: input.fetcher,
    })

    if (outcome === 'failed') {
      result.failed += 1
    } else {
      result.deleted += 1
    }
  }

  input.logger.set({ attributes: { skills: { providerPurge: result } } })

  return result
}

export interface LiveProviderCopy {
  skillId: string
  name: string
}

/**
 * The skills that still have a copy in the user's Anthropic workspace, for
 * the warning shown before the Anthropic key is removed.
 */
export async function listLiveProviderCopies(
  db: DbClient,
  userId: number,
): Promise<LiveProviderCopy[]> {
  return await db.select({
    skillId: schema.skills.id,
    name: schema.skills.name,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, userId),
      isNotNull(schema.skills.providerSkillId),
      isNull(schema.skills.providerDeletedAt),
    ))
}

async function buildUploadFiles(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skill: UploadableSkill
  providerName: string
  isRenamed: boolean
}): Promise<Array<{ path: string, data: Uint8Array }>> {
  const { skill } = input
  const rows = await loadVersionFiles(
    input.db,
    input.userId,
    skill.id,
    skill.currentVersion,
  )
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)

  if (totalBytes > SKILL_CONTAINER_MAX_BYTES) {
    throw createProviderSkillError(
      'This skill is too large to upload',
      'Anthropic accepts at most 30 MB for one skill.',
      'Remove large files from the skill, or turn scripts off for it.',
      413,
    )
  }

  const files: Array<{ path: string, data: Uint8Array }> = []

  for (const row of rows) {
    const bytes = await readBlobBytes({
      bucket: input.bucket,
      userId: input.userId,
      skillId: skill.id,
      blobSha256: row.blobSha256,
    })
    let data = bytes

    if (row.path === SKILL_MD_PATH && input.isRenamed) {
      const renamed = renameSkillMarkdown(
        textDecoder.decode(bytes),
        skill.name,
        input.providerName,
      )

      if (renamed === null) {
        throw createProviderSkillError(
          'This skill cannot be renamed for the upload',
          'Its SKILL.md has no name line in the frontmatter.',
          'Add a name to the SKILL.md frontmatter.',
          400,
        )
      }

      data = textEncoder.encode(renamed)
    }

    files.push({ path: `${input.providerName}/${row.path}`, data })
  }

  if (!files.some(file => file.path.endsWith(`/${SKILL_MD_PATH}`))) {
    throw createProviderSkillError(
      'This skill cannot be uploaded',
      'It has no SKILL.md.',
      'Restore an earlier version, or delete the skill.',
      400,
    )
  }

  return files
}

async function readConcurrentCopy(input: {
  db: DbClient
  userId: number
  skill: UploadableSkill
  fallbackName: string
}): Promise<ProviderSkillReference> {
  const [latest] = await input.db.select({
    providerSkillId: schema.skills.providerSkillId,
    providerSkillVersion: schema.skills.providerSkillVersion,
    providerUploadedName: schema.skills.providerUploadedName,
    providerDeletedAt: schema.skills.providerDeletedAt,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.id, input.skill.id),
      eq(schema.skills.userId, input.userId),
    ))
    .limit(1)
  const pinned = parseProviderSkillVersion(latest?.providerSkillVersion)

  if (
    latest?.providerSkillId
    && pinned
    && isProviderCopyCurrent(latest, input.skill.currentVersion)
  ) {
    return {
      skillId: input.skill.id,
      name: latest.providerUploadedName ?? input.fallbackName,
      providerSkillId: latest.providerSkillId,
      providerVersion: pinned.providerVersion,
    }
  }

  throw createProviderSkillError(
    'The skill could not be stored after the upload',
    'Another request changed the copy of this skill at the same time.',
    'Try again.',
    409,
  )
}

/**
 * Makes sure the Anthropic copy of one skill matches its `current_version`
 * and returns the pinned reference. A copy made from the same version is
 * reused with no request. A stale copy is deleted first and a new one is
 * uploaded (the SDK only creates skills, so a new version is a new skill).
 * The returned version is the one Anthropic assigned; a response without it
 * fails closed, because an omitted version would mean "latest". The id, the
 * encoded version and the uploaded name are written to D1 only after the
 * upload succeeded.
 */
export async function ensureProviderSkill(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skill: UploadableSkill
  apiKey: string
  logger: LoggerLike
  uploader?: SkillUploader
  fetcher?: typeof fetch
}): Promise<ProviderSkillReference> {
  const { db, skill } = input
  const naming = toProviderSkillName(skill.name)

  if (!naming.ok) {
    throw createProviderSkillError(
      'This skill name cannot be uploaded',
      'The name does not fit the provider rules.',
      'Rename the skill and try again.',
      400,
    )
  }

  const copy = {
    providerSkillId: skill.providerSkillId,
    providerSkillVersion: skill.providerSkillVersion,
    providerUploadedName: skill.providerUploadedName,
    providerDeletedAt: skill.providerDeletedAt,
  }

  if (isProviderCopyCurrent(copy, skill.currentVersion)) {
    const pinned = parseProviderSkillVersion(skill.providerSkillVersion)

    if (skill.providerSkillId && pinned) {
      return {
        skillId: skill.id,
        name: skill.providerUploadedName ?? naming.providerName,
        providerSkillId: skill.providerSkillId,
        providerVersion: pinned.providerVersion,
      }
    }
  }

  if (isProviderCopyLive(copy)) {
    const outcome = await removeProviderCopy({
      db,
      userId: input.userId,
      skill: { id: skill.id, ...copy },
      apiKey: input.apiKey,
      logger: input.logger,
      fetcher: input.fetcher,
    })

    if (outcome === 'failed') {
      throw createProviderSkillError(
        'The earlier upload could not be replaced',
        'Anthropic did not delete the older copy of this skill.',
        'Try again, or delete it in the Anthropic Console.',
      )
    }
  }

  const files = await buildUploadFiles({
    db,
    bucket: input.bucket,
    userId: input.userId,
    skill,
    providerName: naming.providerName,
    isRenamed: naming.isRenamed,
  })
  const uploader = input.uploader ?? uploadSkillWithAnthropic
  let uploaded: Awaited<ReturnType<SkillUploader>>

  try {
    uploaded = await uploader({
      apiKey: input.apiKey,
      files,
      displayTitle: skill.name.slice(0, SKILL_PROVIDER_DISPLAY_TITLE_MAX),
    })
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: { providerUpload: { error: exceptionMessage(exception) } },
      },
    })

    throw createProviderSkillError(
      'The skill could not be uploaded to Anthropic',
      'Anthropic refused the upload or could not be reached.',
      'Check your Anthropic key and try again.',
    )
  }

  const pinnedVersion = uploaded.latestVersion

  if (!pinnedVersion || !SAFE_ID_PATTERN.test(pinnedVersion)) {
    await deleteProviderSkill({
      providerSkillId: uploaded.providerSkillId,
      apiKey: input.apiKey,
      logger: input.logger,
      fetcher: input.fetcher,
    })

    throw createProviderSkillError(
      'The skill could not be pinned to a version',
      'Anthropic returned no version for the upload.',
      'Try again later.',
    )
  }

  let isCopyStored = false

  try {
    const stored = await db.update(schema.skills)
      .set({
        providerSkillId: uploaded.providerSkillId,
        providerSkillVersion: encodeProviderSkillVersion({
          besidkaVersion: skill.currentVersion,
          providerVersion: pinnedVersion,
        }),
        providerUploadedName: naming.providerName,
        providerDeletedAt: null,
      })
      .where(and(
        eq(schema.skills.id, skill.id),
        eq(schema.skills.userId, input.userId),
        isNull(schema.skills.providerSkillId),
      ))
      .returning({ id: schema.skills.id })

    isCopyStored = stored.length > 0
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: { providerUpload: { storeError: exceptionMessage(exception) } },
      },
    })
  }

  if (!isCopyStored) {
    await deleteProviderSkill({
      providerSkillId: uploaded.providerSkillId,
      apiKey: input.apiKey,
      logger: input.logger,
      fetcher: input.fetcher,
    })

    return await readConcurrentCopy({
      db,
      userId: input.userId,
      skill,
      fallbackName: naming.providerName,
    })
  }

  input.logger.set({
    attributes: {
      skills: {
        providerUpload: {
          renamed: naming.isRenamed,
          files: files.length,
          replaced: isProviderCopyLive(copy),
        },
      },
    },
  })

  return {
    skillId: skill.id,
    name: naming.providerName,
    providerSkillId: uploaded.providerSkillId,
    providerVersion: pinnedVersion,
  }
}
