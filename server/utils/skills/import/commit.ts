import type { BatchItem } from 'drizzle-orm/batch'
import { and, desc, eq, getTableColumns, lte, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import { hashSkillFileSet } from '#shared/utils/skills/analyse'
import { renameSkillMarkdown } from '#shared/utils/skills/frontmatter'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import {
  SKILLS_MAX_USER_BYTES,
  SKILLS_PER_USER,
  isReservedSkillSlashName,
  isSkillNameValid,
} from '#shared/utils/skills-policy'
import * as schema from '~~/server/db/schema'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import { createSkillImportError } from '~~/server/utils/skills/import/errors'
import {
  createStageNotFoundError,
  deleteSkillStage,
  readSkillStage,
  readStagedFile,
  skillStageKey,
} from '~~/server/utils/skills/import/stage'
import type {
  SkillStageBucket,
  SkillStageKv,
  SkillStageManifest,
} from '~~/server/utils/skills/import/stage'
import {
  deleteSkillPrefix,
  putSkillBlob,
  skillPrefix,
} from '~~/server/utils/skills/storage'
import {
  countUserSkills,
  getUserSkillsUsageBytes,
} from '~~/server/utils/skills/usage'

type DbClient = ReturnType<typeof useDb>

const MAX_ERROR_CAUSE_DEPTH = 5
const ABANDONED_PLACEHOLDER_GRACE_MS = 10 * 60 * 1000
const textEncoder = new TextEncoder()
const bomPreservingDecoder = new TextDecoder('utf-8', { ignoreBOM: true })

export interface CommitSkillImportInput {
  db: DbClient
  bucket: SkillStageBucket
  kv: SkillStageKv
  userId: number
  stageId: string
  licenceAcknowledged?: boolean
  name?: string
  asUpdateOf?: string
  logger: LoggerLike
  now?: number
}

export type CommitSkillImportResult
  = | {
    kind: 'created'
    id: string
    name: string
    version: number
    enabled: false
    status: 'ready'
    licenceClass: SkillStageManifest['licence']['class']
    filesCount: number
  }
  | {
    kind: 'pending'
    id: string
    name: string
    version: number
    pendingVersion: number
    sha256: string
    licenceClass: SkillStageManifest['licence']['class']
    filesCount: number
  }

function isUniqueViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      return false
    }

    if (current.message.includes('UNIQUE constraint failed')) {
      return true
    }

    current = current.cause
  }

  return false
}

function createNameTakenError(
  name: string,
  stageId: string,
  existingSkillId: string,
) {
  return createError({
    message: `A skill named ${name} exists`,
    status: 409,
    code: 'name-taken',
    why: 'Skill names are unique, because they are the names of /commands too',
    fix: 'Replace the existing skill with this one as an update, or rename '
      + 'the incoming skill',
    data: { stageId, asUpdateOf: existingSkillId, name },
  })
}

function assertAcknowledgements(
  manifest: SkillStageManifest,
  licenceAcknowledged: boolean | undefined,
): void {
  if (manifest.licence.class === 'restricted') {
    throw createSkillImportError(
      'licence-restricted',
      'Its licence limits use to a named service, or forbids copying',
    )
  }

  const needsLicenceTick = manifest.licence.class === 'none'
    || manifest.licence.class === 'custom'

  if (needsLicenceTick && licenceAcknowledged !== true) {
    throw createError({
      message: 'Confirm that you may use this skill',
      status: 400,
      code: 'licence-acknowledgement-required',
      why: manifest.licence.class === 'none'
        ? 'The skill states no licence, so the author keeps all rights'
        : 'The skill carries a custom licence',
      fix: 'Tick the licence box in the review step',
    })
  }
}

function assertLimits(input: {
  skillsCount: number
  usageBytes: number
  incomingBytes: number
  isNewSkill: boolean
}): void {
  if (input.isNewSkill && input.skillsCount >= SKILLS_PER_USER) {
    throw createError({
      message: 'Skill limit reached',
      status: 403,
      code: 'skills-limit',
      why: `An account can hold ${SKILLS_PER_USER} skills`,
      fix: 'Delete a skill you no longer use',
    })
  }

  if (input.usageBytes + input.incomingBytes > SKILLS_MAX_USER_BYTES) {
    throw createError({
      message: 'Skill storage is full',
      status: 413,
      code: 'skills-storage-limit',
      why: 'Your skills would use more than 50 MiB of storage',
      fix: 'Delete a skill or an older version you no longer use',
    })
  }
}

interface PreparedImport {
  manifest: SkillStageManifest
  contentOverrides: Map<string, Uint8Array>
}

/**
 * A skill renamed at import carries its new name in SKILL.md too, because
 * the name is content (docs/skills.md section 8.7). Only the `name:` line
 * changes; the rewritten file gets its own hash, and the staged original is
 * left untouched so a retry with another name starts from it again.
 */
async function prepareRenamedImport(input: {
  bucket: SkillStageBucket
  manifest: SkillStageManifest
  name: string
}): Promise<PreparedImport> {
  const { bucket, manifest, name } = input
  const unchanged: PreparedImport = {
    manifest,
    contentOverrides: new Map(),
  }

  if (name === manifest.skill.name) {
    return unchanged
  }

  const skillMdEntry = manifest.files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })
  const original = skillMdEntry
    ? await readStagedFile({ bucket, manifest, sha256: skillMdEntry.sha256 })
    : null
  const renamed = original
    ? renameSkillMarkdown(bomPreservingDecoder.decode(original), name)
    : null

  if (!skillMdEntry || renamed === null) {
    return {
      manifest: { ...manifest, skill: { ...manifest.skill, name } },
      contentOverrides: unchanged.contentOverrides,
    }
  }

  const renamedBytes = textEncoder.encode(renamed)
  const sha256 = await sha256Hex(renamedBytes)
  const files = manifest.files.map((file) => {
    return file === skillMdEntry
      ? { ...file, bytes: renamedBytes.byteLength, sha256 }
      : file
  })

  return {
    manifest: {
      ...manifest,
      skill: { ...manifest.skill, name },
      files,
      totalBytes: files.reduce((total, file) => {
        return total + file.bytes
      }, 0),
      contentSha256: await hashSkillFileSet(files),
    },
    contentOverrides: new Map([[sha256, renamedBytes]]),
  }
}

async function copyStagedBlobs(input: {
  bucket: SkillStageBucket
  manifest: SkillStageManifest
  contentOverrides: Map<string, Uint8Array>
  skillId: string
}): Promise<void> {
  const copied = new Set<string>()

  for (const file of input.manifest.files) {
    if (copied.has(file.sha256)) {
      continue
    }

    copied.add(file.sha256)

    const bytes = input.contentOverrides.get(file.sha256)
      ?? await readStagedFile({
        bucket: input.bucket,
        manifest: input.manifest,
        sha256: file.sha256,
      })

    if (!bytes) {
      throw createError({
        message: 'This import has expired',
        status: 404,
        code: 'stage-not-found',
        why: 'A staged file is missing',
        fix: 'Upload the skill again',
      })
    }

    const stored = await putSkillBlob({
      bucket: input.bucket,
      userId: input.manifest.userId,
      skillId: input.skillId,
      content: bytes,
    })

    if (stored.sha256 !== file.sha256) {
      throw createError({
        message: 'The staged file changed',
        status: 500,
        why: `Staged content hashes to ${stored.sha256}, expected ${file.sha256}`,
        fix: 'Upload the skill again',
      })
    }
  }
}

function buildVersionStatements(input: {
  db: DbClient
  manifest: SkillStageManifest
  skillId: string
  version: number
}) {
  const { db, manifest, skillId, version } = input

  return [
    db.insert(schema.skillVersions).values({
      skillId,
      userId: manifest.userId,
      version,
      origin: 'import',
      sourceKind: manifest.source,
      sourceUrl: null,
      sourceRef: null,
      sourcePath: null,
      sourceVersion: manifest.sourceVersion,
      sha256: manifest.contentSha256,
      filesCount: manifest.files.length,
      bytes: manifest.totalBytes,
      licenseClass: manifest.licence.class,
      licenseFileSha256: manifest.licence.sha256,
      findings: manifest.findingCounts,
    }),
    ...manifest.files.map((file) => {
      return db.insert(schema.skillFiles).values({
        skillId,
        userId: manifest.userId,
        version,
        path: file.path,
        blobSha256: file.sha256,
        bytes: file.bytes,
        kind: file.kind,
      })
    }),
  ]
}

type SkillRow = Omit<typeof schema.skills.$inferInsert, 'id'>

const SKILL_INSERT_COLUMNS = Object.entries(getTableColumns(schema.skills))
  .filter(([key]) => {
    return key !== 'id'
  })

/**
 * Inserts the skill row only while the user is under both caps, in one
 * statement, so two concurrent commits cannot both pass a count that was
 * read earlier. Returns the new public id, or null when a cap blocked it.
 * Column names and value encoding come from the Drizzle table, so a new
 * column cannot be forgotten here without the type of `SkillRow` failing.
 */
async function insertSkillWithinLimits(
  db: DbClient,
  row: SkillRow,
): Promise<string | null> {
  const values = row as Record<string, unknown>
  const columnList = sql.join(
    SKILL_INSERT_COLUMNS.map(([, column]) => {
      return sql.identifier(column.name)
    }),
    sql`, `,
  )
  const valueList = sql.join(
    SKILL_INSERT_COLUMNS.map(([key, column]) => {
      const value = values[key]

      return sql`${value === null || value === undefined
        ? null
        : column.mapToDriverValue(value)}`
    }),
    sql`, `,
  )
  const rows = await db.all<{ id: number }>(sql`
    insert into ${schema.skills} (${columnList})
    select ${valueList}
    where (
      select count(*) from ${schema.skills}
      where ${schema.skills.userId} = ${row.userId}
    ) < ${SKILLS_PER_USER}
    and (
      select coalesce(sum(${schema.skills.bytes}), 0) from ${schema.skills}
      where ${schema.skills.userId} = ${row.userId}
    ) + ${row.bytes} <= ${SKILLS_MAX_USER_BYTES}
    returning id
  `)
  const inserted = rows[0]

  return inserted ? encodePublicId(Number(inserted.id)) : null
}

async function createSkillFromStage(input: {
  db: DbClient
  bucket: SkillStageBucket
  prepared: PreparedImport
  name: string
}): Promise<CommitSkillImportResult> {
  const { db, bucket, name } = input
  const { manifest, contentOverrides } = input.prepared
  let skillId: string

  try {
    const now = new Date()
    const insertedId = await insertSkillWithinLimits(db, {
      createdAt: now,
      updatedAt: now,
      userId: manifest.userId,
      name,
      description: manifest.skill.description,
      licenseField: manifest.skill.license,
      licenseClass: manifest.licence.class,
      licenseFileSha256: manifest.licence.sha256,
      licenseClassifierVersion: manifest.licence.classifierVersion,
      compatibility: manifest.skill.compatibility,
      metadata: manifest.skill.metadata,
      allowedTools: manifest.skill.allowedTools,
      sourceKind: manifest.source,
      sourceUrl: null,
      sourceRef: null,
      sourcePath: null,
      sourceVersion: manifest.sourceVersion,
      currentVersion: 1,
      pendingVersion: null,
      filesCount: manifest.files.length,
      bytes: manifest.totalBytes,
      enabled: false,
      modelInvocable: manifest.skill.modelInvocable,
      slashCommand: manifest.skill.slashCommand
        && !isReservedSkillSlashName(name),
      argumentHint: manifest.skill.argumentHint,
      allowScripts: false,
      status: 'broken',
      createdVia: 'app',
      createdByClientId: null,
      providerSkillId: null,
      providerSkillVersion: null,
      providerUploadedName: null,
      providerDeletedAt: null,
    })

    if (insertedId === null) {
      throw await createLimitError(db, manifest.userId)
    }

    skillId = insertedId
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      const existing = await findSkillByName(db, manifest.userId, name)

      throw createNameTakenError(name, manifest.stageId, existing?.id ?? '')
    }

    throw exception
  }

  try {
    await copyStagedBlobs({ bucket, manifest, contentOverrides, skillId })

    await db.batch([
      db.update(schema.skills)
        .set({ status: 'ready' })
        .where(and(
          eq(schema.skills.id, skillId),
          eq(schema.skills.userId, manifest.userId),
        )),
      ...buildVersionStatements({ db, manifest, skillId, version: 1 }),
    ] as unknown as [BatchItem<'sqlite'>])
  } catch (exception) {
    await discardUnfinishedSkill({
      db,
      bucket,
      userId: manifest.userId,
      skillId,
    })

    throw exception
  }

  return {
    kind: 'created',
    id: skillId,
    name,
    version: 1,
    enabled: false,
    status: 'ready',
    licenceClass: manifest.licence.class,
    filesCount: manifest.files.length,
  }
}

async function createLimitError(db: DbClient, userId: number) {
  const skillsCount = await countUserSkills(db, userId)

  return skillsCount >= SKILLS_PER_USER
    ? createError({
      message: 'Skill limit reached',
      status: 403,
      code: 'skills-limit',
      why: `An account can hold ${SKILLS_PER_USER} skills`,
      fix: 'Delete a skill you no longer use',
    })
    : createError({
      message: 'Skill storage is full',
      status: 413,
      code: 'skills-storage-limit',
      why: 'Your skills would use more than 50 MiB of storage',
      fix: 'Delete a skill or an older version you no longer use',
    })
}

/**
 * The skill row exists before its blobs, because the blob key carries the
 * skill id. A failed import removes the row, its rows and its blob prefix;
 * a failed cleanup leaves a `broken` disabled row and swept orphans.
 */
export async function discardUnfinishedSkill(input: {
  db: DbClient
  bucket: SkillStageBucket
  userId: number
  skillId: string
  notUpdatedAfter?: Date
}): Promise<boolean> {
  const { db, bucket, userId, skillId } = input

  try {
    const deleted = await db.delete(schema.skills)
      .where(and(
        eq(schema.skills.id, skillId),
        eq(schema.skills.userId, userId),
        eq(schema.skills.status, 'broken'),
        input.notUpdatedAfter
          ? lte(schema.skills.updatedAt, input.notUpdatedAfter)
          : undefined,
      ))
      .returning({ id: schema.skills.id })

    if (deleted.length === 0) {
      return false
    }

    await db.batch([
      db.delete(schema.skillFiles).where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.userId, userId),
      )),
      db.delete(schema.skillVersions).where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.userId, userId),
      )),
    ])
    await deleteSkillPrefix(skillPrefix(userId, skillId), bucket)

    return true
  } catch {
    return false
  }
}

async function findSkillByName(db: DbClient, userId: number, name: string) {
  const rows = await db.select({
    id: schema.skills.id,
    status: schema.skills.status,
    pendingVersion: schema.skills.pendingVersion,
    updatedAt: schema.skills.updatedAt,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, userId),
      eq(schema.skills.name, name),
    ))
    .limit(1)

  return rows[0] ?? null
}

/**
 * The row of an import that died between the insert and the batch (a killed
 * invocation) is `broken` with no version rows and would hold its name for
 * good. After a grace period no live commit can still own it, so a later
 * import of that name takes it over.
 */
async function reclaimAbandonedPlaceholder(input: {
  db: DbClient
  bucket: SkillStageBucket
  userId: number
  existing: NonNullable<Awaited<ReturnType<typeof findSkillByName>>>
  now: number
}): Promise<boolean> {
  const { db, existing } = input

  if (
    existing.status !== 'broken'
    || existing.pendingVersion !== null
    || input.now - existing.updatedAt.getTime() < ABANDONED_PLACEHOLDER_GRACE_MS
  ) {
    return false
  }

  const [version] = await db.select({ id: schema.skillVersions.id })
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, existing.id),
      eq(schema.skillVersions.userId, input.userId),
    ))
    .limit(1)

  if (version) {
    return false
  }

  return await discardUnfinishedSkill({
    db,
    bucket: input.bucket,
    userId: input.userId,
    skillId: existing.id,
    notUpdatedAfter: existing.updatedAt,
  })
}

/**
 * The blobs were written before the version rows existed, so a prune that
 * ran in between could have judged them unreferenced. Writing them again
 * now that the rows exist closes that window. Skipped when another import
 * has replaced this pending version meanwhile, and never fatal: the rows are
 * committed either way.
 */
async function reassertPendingBlobs(input: {
  db: DbClient
  bucket: SkillStageBucket
  manifest: SkillStageManifest
  contentOverrides: Map<string, Uint8Array>
  skillId: string
  version: number
}): Promise<void> {
  try {
    const [current] = await input.db.select({
      pendingVersion: schema.skills.pendingVersion,
    })
      .from(schema.skills)
      .where(and(
        eq(schema.skills.id, input.skillId),
        eq(schema.skills.userId, input.manifest.userId),
      ))
      .limit(1)

    if (current?.pendingVersion !== input.version) {
      return
    }

    await copyStagedBlobs({
      bucket: input.bucket,
      manifest: input.manifest,
      contentOverrides: input.contentOverrides,
      skillId: input.skillId,
    })
  } catch {
    return
  }
}

async function replaceAsUpdate(input: {
  db: DbClient
  bucket: SkillStageBucket
  prepared: PreparedImport
  skillId: string
}): Promise<CommitSkillImportResult> {
  const { db, bucket, skillId } = input
  const { manifest, contentOverrides } = input.prepared
  const [skill] = isDecodableSkillPublicId(skillId)
    ? await db.select({
      id: schema.skills.id,
      name: schema.skills.name,
      pendingVersion: schema.skills.pendingVersion,
    })
      .from(schema.skills)
      .where(and(
        eq(schema.skills.id, skillId),
        eq(schema.skills.userId, manifest.userId),
      ))
      .limit(1)
    : []

  if (!skill) {
    throw createError({
      message: 'Skill not found',
      status: 404,
      code: 'skill-not-found',
      why: 'The skill to update does not exist or is not yours',
      fix: 'Reload the skills list',
    })
  }

  if (skill.name !== manifest.skill.name) {
    throw createError({
      message: 'The skill to update has a different name',
      status: 400,
      code: 'invalid-request',
      why: `The import is named ${manifest.skill.name}, the skill is named ${
        skill.name
      }`,
      fix: 'Replace the skill with the same name, or import it as a new skill',
    })
  }

  const [latest] = await db.select({ version: schema.skillVersions.version })
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, manifest.userId),
    ))
    .orderBy(desc(schema.skillVersions.version))
    .limit(1)
  const version = (latest?.version ?? 0) + 1

  await copyStagedBlobs({ bucket, manifest, contentOverrides, skillId })

  const replacingStatements = skill.pendingVersion === null
    ? []
    : [
      db.delete(schema.skillFiles).where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.userId, manifest.userId),
        eq(schema.skillFiles.version, skill.pendingVersion),
      )),
      db.delete(schema.skillVersions).where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.userId, manifest.userId),
        eq(schema.skillVersions.version, skill.pendingVersion),
      )),
    ]

  try {
    await db.batch([
      ...replacingStatements,
      ...buildVersionStatements({ db, manifest, skillId, version }),
      db.update(schema.skills)
        .set({ pendingVersion: version })
        .where(and(
          eq(schema.skills.id, skillId),
          eq(schema.skills.userId, manifest.userId),
        )),
    ] as unknown as [BatchItem<'sqlite'>])
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      throw createError({
        message: 'This skill changed while you were importing',
        status: 409,
        code: 'pending-changed',
        why: 'Another save created the same version number',
        fix: 'Try the import again',
      })
    }

    throw exception
  }

  await reassertPendingBlobs({
    db,
    bucket,
    manifest,
    contentOverrides,
    skillId,
    version,
  })

  return {
    kind: 'pending',
    id: skillId,
    name: skill.name,
    version,
    pendingVersion: version,
    sha256: manifest.contentSha256,
    licenceClass: manifest.licence.class,
    filesCount: manifest.files.length,
  }
}

/**
 * Takes the stage before any work starts: the manifest is read, then
 * deleted, and the commit continues with its in-memory copy, so a second
 * commit that reads it afterwards finds nothing. KV is eventually consistent
 * and has no compare-and-delete, so two commits racing within the
 * propagation window can still both read the manifest; the unique name index
 * and the atomic limit insert keep that harmless (one skill, one of them
 * answers 409), and a replace-as-update would at worst write the same
 * pending version twice.
 */
async function claimSkillStage(
  kv: SkillStageKv,
  manifest: SkillStageManifest,
): Promise<void> {
  await kv.delete(skillStageKey(manifest.stageId))
}

/**
 * A commit that fails after claiming puts the manifest back with its
 * remaining lifetime, so the user can retry (a rename, another resolution)
 * without uploading again. Best effort.
 */
async function restoreSkillStage(
  kv: SkillStageKv,
  manifest: SkillStageManifest,
  now: number,
): Promise<void> {
  const remainingSeconds = Math.ceil((manifest.expiresAt - now) / 1000)

  if (remainingSeconds <= 0) {
    return
  }

  try {
    await kv.put(skillStageKey(manifest.stageId), JSON.stringify(manifest), {
      expirationTtl: Math.max(60, remainingSeconds),
    })
  } catch {
    return
  }
}

/**
 * Turns a staged import preview into a skill. Without `asUpdateOf` it
 * creates a new disabled skill with version 1; a name collision answers 409
 * and keeps the stage, so the user can retry with `asUpdateOf` (a persisted
 * pending version of the existing skill, replacing an older pending one) or
 * with a new `name`.
 */
export async function commitSkillImport(
  input: CommitSkillImportInput,
): Promise<CommitSkillImportResult> {
  const { db, bucket, kv, userId, logger } = input
  const manifest = await readSkillStage({
    kv,
    userId,
    stageId: input.stageId,
    now: input.now,
  })

  if (!manifest) {
    throw createStageNotFoundError()
  }

  assertAcknowledgements(manifest, input.licenceAcknowledged)

  if (input.asUpdateOf && input.name !== undefined) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      code: 'invalid-request',
      why: 'An update keeps the name of the skill it replaces',
      fix: 'Send either asUpdateOf or name, not both',
    })
  }

  const name = input.name ?? manifest.skill.name

  if (!isSkillNameValid(name)) {
    throw createSkillImportError(
      'name-invalid',
      'The skill name must use lowercase letters, digits and single hyphens, up to 64 characters',
    )
  }

  const [skillsCount, usageBytes] = await Promise.all([
    countUserSkills(db, userId),
    getUserSkillsUsageBytes(db, userId),
  ])

  assertLimits({
    skillsCount,
    usageBytes,
    incomingBytes: manifest.totalBytes,
    isNewSkill: !input.asUpdateOf,
  })

  let result: CommitSkillImportResult

  if (input.asUpdateOf) {
    await claimSkillStage(kv, manifest)

    try {
      result = await replaceAsUpdate({
        db,
        bucket,
        prepared: { manifest, contentOverrides: new Map() },
        skillId: input.asUpdateOf,
      })
    } catch (exception) {
      await restoreSkillStage(kv, manifest, input.now ?? Date.now())

      throw exception
    }
  } else {
    const existing = await findSkillByName(db, userId, name)

    if (
      existing
      && !await reclaimAbandonedPlaceholder({
        db,
        bucket,
        userId,
        existing,
        now: input.now ?? Date.now(),
      })
    ) {
      throw createNameTakenError(name, manifest.stageId, existing.id)
    }

    await claimSkillStage(kv, manifest)

    try {
      result = await createSkillFromStage({
        db,
        bucket,
        prepared: await prepareRenamedImport({ bucket, manifest, name }),
        name,
      })
    } catch (exception) {
      await restoreSkillStage(kv, manifest, input.now ?? Date.now())

      throw exception
    }
  }

  try {
    await deleteSkillStage({ kv, bucket, manifest })
  } catch {
    logger.set({
      attributes: { skills: { import: { stageCleanupFailed: true } } },
    })
  }

  logger.set({
    attributes: {
      skills: {
        import: {
          source: manifest.source,
          files: manifest.files.length,
          bytes: manifest.totalBytes,
          findings: manifest.findingCounts,
          licenceClass: manifest.licence.class,
          outcome: result.kind,
        },
      },
    },
  })

  return result
}
