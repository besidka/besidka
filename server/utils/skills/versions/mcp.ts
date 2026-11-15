import type { BatchItem } from 'drizzle-orm/batch'
import { and, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import { analyzeSkillFiles } from '#shared/utils/skills/analyze'
import type { SkillAnalysisInputFile } from '#shared/utils/skills/analyze'
import type { SkillChange } from '#shared/utils/skills/edit'
import { scanSkillText } from '#shared/utils/skills/findings'
import type { SkillFinding } from '#shared/utils/skills/findings'
import {
  parseSkillMarkdown,
  renameSkillMarkdown,
} from '#shared/utils/skills/frontmatter'
import { hasHiddenCharacter } from '#shared/utils/skills/hidden-characters'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { validateSkillEditPath } from '#shared/utils/skills/edit'
import {
  SKILL_ARGUMENT_HINT_MAX,
  SKILL_MCP_FILES_MAX,
  SKILL_MCP_TOTAL_MAX_BYTES,
  SKILL_NAME_MAX,
  isReservedSkillSlashName,
  isSkillNameValid,
} from '#shared/utils/skills-policy'
import type { SkillLicenseClass } from '#shared/utils/skills-policy'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  assertLimits,
  createLimitError,
  discardUnfinishedSkill,
  findSkillByName,
  insertSkillWithinLimits,
  reclaimAbandonedPlaceholder,
} from '~~/server/utils/skills/import/commit'
import { createSkillImportError } from '~~/server/utils/skills/import/errors'
import { createSkillSourceVersion } from '~~/server/utils/skills/import/zip'
import { putSkillBlob } from '~~/server/utils/skills/storage'
import {
  findUniqueViolation,
  isUniqueViolation,
} from '~~/server/utils/skills/unique-violation'
import { countUserSkills } from '~~/server/utils/skills/usage'
import { applySkillChanges } from '~~/server/utils/skills/versions/apply'
import type { WorkingSkillFile } from '~~/server/utils/skills/versions/apply'
import {
  createSkillEditError,
  createStaleBaseError,
} from '~~/server/utils/skills/versions/errors'
import { prepareSkillVersion } from '~~/server/utils/skills/versions/prepare'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
  readBlobText,
} from '~~/server/utils/skills/versions/read'
import {
  computeFindingCounts,
  saveSkillChanges,
} from '~~/server/utils/skills/versions/save'
import { getEffectiveUserFilePolicy } from '~~/server/utils/files/file-governance'
import { buildStorageFullError } from '~~/server/utils/storage/guard'
import {
  asBatch,
  buildGuardedVersionStatements,
  buildVersionStatements,
} from '~~/server/utils/skills/versions/statements'
import type { SkillWriteBucket } from '~~/server/utils/skills/versions/write'

type DbClient = ReturnType<typeof useDb>

const TEXT_WHITESPACE_CODES: ReadonlySet<number> = new Set([9, 10, 12, 13])
const ASCII_CONTROL_MAX_CODE = 31
const DELETE_CODE = 127
const C1_CONTROL_MAX_CODE = 159
const UPDATE_NOTE = 'Updated through a connected app'

export interface McpSkillFileInput {
  path: string
  content: string
}

export interface McpSkillFinding {
  type: string
  rule: string
  severity: string
  path: string
  line: number
}

export interface McpSkillFileDiff {
  added: string[]
  modified: string[]
  removed: string[]
}

export interface CreatedMcpSkill {
  id: string
  name: string
  version: number
  licenseClass: Exclude<SkillLicenseClass, 'authored'>
  filesCount: number
  bytes: number
  findings: McpSkillFinding[]
  warnings: string[]
}

export type StagedMcpSkillUpdate
  = | {
    unchanged: true
    id: string
    name: string
    version: number
  }
  | {
    unchanged: false
    id: string
    name: string
    baseVersion: number
    pendingVersion: number
    replacedPendingVersion: number | null
    sha256: string
    licenseClass: SkillLicenseClass
    filesCount: number
    bytes: number
    findings: McpSkillFinding[]
    diffSummary: McpSkillFileDiff
    warnings: string[]
  }

export type RenamedMcpSkill
  = | { unchanged: true, id: string, name: string, version: number }
    | {
      unchanged: false
      id: string
      name: string
      previousName: string
      version: number
      warnings: string[]
    }

export function toMcpSkillFindings(
  findings: SkillFinding[],
): McpSkillFinding[] {
  return findings.map((finding) => {
    return {
      type: finding.type,
      rule: finding.rule,
      severity: finding.severity,
      path: finding.path,
      line: finding.line,
    }
  })
}

function createInvalidRequestError(message: string, why: string, fix: string) {
  return createError({
    message,
    status: 400,
    code: 'invalid-request',
    why,
    fix,
  })
}

function isBinaryLookingCode(code: number): boolean {
  return code <= ASCII_CONTROL_MAX_CODE && !TEXT_WHITESPACE_CODES.has(code)
}

function isControlCode(code: number): boolean {
  return code <= ASCII_CONTROL_MAX_CODE
    || (code >= DELETE_CODE && code <= C1_CONTROL_MAX_CODE)
}

function hasCharacterWhere(
  text: string,
  predicate: (code: number) => boolean,
): boolean {
  for (const character of text) {
    if (predicate(character.codePointAt(0)!)) {
      return true
    }
  }

  return false
}

/**
 * Skills hold text only. A NUL or another control character other than tab,
 * line feed, form feed or carriage return marks the content as binary, and
 * nothing is stored.
 */
export function assertMcpTextContent(
  content: string,
  index: number,
): void {
  if (hasCharacterWhere(content, isBinaryLookingCode)) {
    throw createSkillEditError('binary-content', {
      message: 'This file contains binary data',
      why: 'Skills hold text only',
      fix: 'Remove the binary data',
      data: { changeIndex: index },
    })
  }
}

export function assertMcpPayloadWithinLimit(totalBytes: number): void {
  if (totalBytes > SKILL_MCP_TOTAL_MAX_BYTES) {
    throw createSkillEditError('save-too-large', {
      message: 'This request is too large',
      why: `One request can carry at most ${
        SKILL_MCP_TOTAL_MAX_BYTES / 1024
      } KiB of file content`,
      fix: 'Send fewer or smaller files at a time',
    })
  }
}

export function assertMcpArgumentHint(argumentHint: string): void {
  if (
    argumentHint.length > SKILL_ARGUMENT_HINT_MAX
    || hasCharacterWhere(argumentHint, isControlCode)
    || hasHiddenCharacter(argumentHint)
  ) {
    throw createInvalidRequestError(
      'This argument hint cannot be used',
      `A hint is at most ${SKILL_ARGUMENT_HINT_MAX} characters without `
      + 'control or hidden characters',
      'Shorten the hint and remove special characters',
    )
  }
}

function prepareCreateFiles(
  files: McpSkillFileInput[],
): SkillAnalysisInputFile[] {
  if (files.length === 0 || files.length > SKILL_MCP_FILES_MAX) {
    throw createSkillEditError('too-many-files', {
      message: 'This skill has an unsupported number of files',
      why: `Send 1 to ${SKILL_MCP_FILES_MAX} files`,
      fix: 'Send SKILL.md and at most 49 other files',
    })
  }

  const encoder = new TextEncoder()
  const seenPaths = new Set<string>()
  const prepared: SkillAnalysisInputFile[] = []
  let totalBytes = 0

  for (const [index, file] of files.entries()) {
    const rejection = validateSkillEditPath(file.path)

    if (rejection) {
      throw createSkillEditError('invalid-path', {
        message: 'This file name cannot be used',
        why: rejection,
        fix: 'Use a plain relative path of text files, such as '
          + 'references/guide.md',
        data: { changeIndex: index },
      })
    }

    const lowerCasedPath = file.path.toLowerCase()

    if (seenPaths.has(lowerCasedPath)) {
      throw createSkillEditError('path-exists', {
        message: 'A file with this name exists',
        why: 'File names are compared without regard to upper and lower case',
        fix: 'Send each file once',
        data: { changeIndex: index },
      })
    }

    seenPaths.add(lowerCasedPath)
    assertMcpTextContent(file.content, index)

    const bytes = encoder.encode(file.content)

    totalBytes += bytes.byteLength
    prepared.push({ path: file.path, bytes, text: file.content })
  }

  assertMcpPayloadWithinLimit(totalBytes)

  return prepared
}

function createNameTakenError(): ReturnType<typeof createSkillEditError> {
  return createSkillEditError('name-taken', {
    message: 'A skill with this name exists',
    why: 'Skill names are unique per account',
    fix: 'Pick another name',
  })
}

/**
 * Creates a skill for a connected app. It goes through the same file rules,
 * license classifier and content scanner as an import, then is saved
 * switched off with status `needs-review` and class never `authored`, so
 * the user reviews it before anything can use it. The skill row exists
 * before its blobs (the blob key carries the id) and a failure removes it.
 */
export async function createSkillForMcpClient(input: {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  clientId: string
  files: McpSkillFileInput[]
  argumentHint?: string
  beforeWrite?: () => Promise<void>
  logger: LoggerLike
}): Promise<CreatedMcpSkill> {
  const { db, bucket, userId } = input
  const files = prepareCreateFiles(input.files)

  if (input.argumentHint !== undefined) {
    assertMcpArgumentHint(input.argumentHint)
  }

  const analysis = await analyzeSkillFiles({ files, folderName: null })

  if (!analysis.ok) {
    throw createSkillImportError(analysis.code, analysis.message)
  }

  if (analysis.license.class === 'restricted') {
    throw createSkillImportError('license-restricted', analysis.license.text)
  }

  const name = analysis.skill.name
  const existing = await findSkillByName(db, userId, name)

  if (
    existing
    && !await reclaimAbandonedPlaceholder({
      db,
      bucket,
      userId,
      existing,
      now: Date.now(),
    })
  ) {
    throw createNameTakenError()
  }

  await assertLimits({
    db,
    userId,
    skillsCount: await countUserSkills(db, userId),
    incomingBytes: analysis.totalBytes,
    isNewSkill: true,
  })

  await input.beforeWrite?.()

  const sourceVersion = await createSkillSourceVersion(analysis.contentSha256)
  const now = new Date()
  const licenseClass = analysis.license.class
  let skillId: string | null

  try {
    skillId = await insertSkillWithinLimits(db, {
      createdAt: now,
      updatedAt: now,
      userId,
      name,
      description: analysis.skill.description,
      licenseField: analysis.skill.license,
      licenseClass,
      licenseFileSha256: analysis.license.licenseFileSha256,
      licenseClassifierVersion: analysis.license.classifierVersion,
      compatibility: analysis.skill.compatibility,
      metadata: analysis.skill.metadata,
      allowedTools: analysis.skill.allowedTools,
      sourceKind: 'mcp',
      sourceUrl: null,
      sourceRef: null,
      sourcePath: null,
      sourceVersion,
      currentVersion: 1,
      pendingVersion: null,
      filesCount: analysis.files.length,
      bytes: analysis.totalBytes,
      enabled: false,
      modelInvocable: false,
      slashCommand: false,
      slashName: null,
      argumentHint: input.argumentHint
        ?? analysis.skill.defaults.argumentHint,
      allowScripts: false,
      status: 'broken',
      createdVia: 'mcp',
      createdByClientId: input.clientId,
      providerSkillId: null,
      providerSkillVersion: null,
      providerUploadedName: null,
      providerDeletedAt: null,
    })
  } catch (exception) {
    const violation = findUniqueViolation(exception)

    if (violation) {
      throw createNameTakenError()
    }

    throw exception
  }

  if (skillId === null) {
    throw await createLimitError(db, userId)
  }

  const createdSkillId = skillId

  try {
    const storedShas = new Set<string>()

    for (const file of files) {
      const stored = await putSkillBlob({
        bucket,
        userId,
        skillId: createdSkillId,
        content: file.bytes,
      })

      storedShas.add(stored.sha256)
    }

    await db.batch([
      db.update(schema.skills)
        .set({ status: 'needs-review' })
        .where(and(
          eq(schema.skills.id, createdSkillId),
          eq(schema.skills.userId, userId),
        )),
      ...buildVersionStatements(db, {
        skillId: createdSkillId,
        userId,
        version: 1,
        origin: 'mcp',
        createdByClientId: input.clientId,
        sourceKind: 'mcp',
        sourceVersion,
        sha256: analysis.contentSha256,
        filesCount: analysis.files.length,
        bytes: analysis.totalBytes,
        licenseClass,
        licenseFileSha256: analysis.license.licenseFileSha256,
        findings: analysis.findingCounts,
      }, analysis.files.map((file) => {
        return {
          path: file.path,
          blobSha256: file.sha256,
          bytes: file.bytes,
          kind: file.kind,
        }
      })),
    ] as unknown as [BatchItem<'sqlite'>])
  } catch (exception) {
    await discardUnfinishedSkill({
      db,
      bucket,
      userId,
      skillId: createdSkillId,
    })

    throw exception
  }

  await invalidateStorageCache(userId, input.logger)

  return {
    id: createdSkillId,
    name,
    version: 1,
    licenseClass,
    filesCount: analysis.files.length,
    bytes: analysis.totalBytes,
    findings: toMcpSkillFindings(analysis.findings),
    warnings: analysis.warnings,
  }
}

function summarizeFileChanges(
  baseFiles: WorkingSkillFile[],
  nextFiles: WorkingSkillFile[],
): McpSkillFileDiff {
  const baseShaByPath = new Map(baseFiles.map((file) => {
    return [file.path, file.blobSha256]
  }))
  const nextPaths = new Set(nextFiles.map((file) => {
    return file.path
  }))
  const added: string[] = []
  const modified: string[] = []

  for (const file of nextFiles) {
    const baseSha = baseShaByPath.get(file.path)

    if (baseSha === undefined) {
      added.push(file.path)
    } else if (baseSha !== file.blobSha256) {
      modified.push(file.path)
    }
  }

  const removed = baseFiles
    .map((file) => {
      return file.path
    })
    .filter((path) => {
      return !nextPaths.has(path)
    })

  return { added, modified, removed }
}

function createUseRenameSkillError() {
  return createInvalidRequestError(
    'Use rename_skill to change the name',
    'update_skill cannot change the name in SKILL.md',
    'Keep the name line of SKILL.md as it is, or call rename_skill',
  )
}

function assertSkillNotBroken(skill: { status: string }): void {
  if (skill.status === 'broken') {
    throw createSkillEditError('skill-broken', {
      message: 'This skill cannot be changed',
      why: 'Its files are missing, or its license is not allowed',
      fix: 'Restore an earlier version in Besidka, or delete the skill',
    })
  }
}

function createPendingChangedError() {
  return createError({
    message: 'This skill changed while the update was saved',
    status: 409,
    code: 'pending-changed',
    why: 'A newer version or another pending update was saved first',
    fix: 'Read the skill again and repeat the update',
  })
}

/**
 * One guarded batch: the new version, its files and the pending pointer are
 * written only while the skill is still at `baseVersion` and its pointer
 * still holds the update this call replaces (or none). The old pending rows
 * are deleted last, and only while the pointer holds the new version, so a
 * lost race changes nothing and answers 409.
 */
async function persistMcpPendingVersion(input: {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  clientId: string
  skillId: string
  baseVersion: number
  replacedPendingVersion: number | null
  files: WorkingSkillFile[]
  blobs: Map<string, Uint8Array>
  incomingBytes: number
  prepared: Awaited<ReturnType<typeof prepareSkillVersion>>
  findingCounts: Record<string, number>
  sourceVersion: string
}): Promise<number> {
  const { db, bucket, userId, skillId } = input
  const [latest] = await db.select({ version: schema.skillVersions.version })
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
    ))
    .orderBy(desc(schema.skillVersions.version))
    .limit(1)
  const version = (latest?.version ?? 0) + 1
  const maxStorageBytes = input.incomingBytes > 0
    ? (await getEffectiveUserFilePolicy(userId, db)).maxStorageBytes
    : 0

  for (const bytes of input.blobs.values()) {
    await putSkillBlob({ bucket, userId, skillId, content: bytes })
  }

  const guardedStatements = buildGuardedVersionStatements({
    db,
    userId,
    skillId,
    baseVersion: input.baseVersion,
    expectedPendingVersion: input.replacedPendingVersion,
    maxStorageBytes,
    incomingBytes: input.incomingBytes,
    record: {
      skillId,
      userId,
      version,
      origin: 'mcp',
      createdByClientId: input.clientId,
      sourceKind: 'mcp',
      sourceVersion: input.sourceVersion,
      sha256: input.prepared.sha256,
      filesCount: input.files.length,
      bytes: input.prepared.totalBytes,
      licenseClass: input.prepared.license.class,
      licenseFileSha256: input.prepared.license.licenseFileSha256,
      findings: input.findingCounts,
      note: UPDATE_NOTE,
    },
    files: input.files.map((file) => {
      return {
        path: file.path,
        blobSha256: file.blobSha256,
        bytes: file.bytes,
        kind: file.kind,
      }
    }),
    skillSet: {
      pendingVersion: version,
      enabled: false,
      status: 'needs-review',
    },
  })
  const pointerMovedHere = sql`exists (
    select 1 from ${schema.skills}
    where ${and(
      eq(schema.skills.id, skillId),
      eq(schema.skills.userId, userId),
      eq(schema.skills.pendingVersion, version),
    )}
  )`
  const replacingStatements = input.replacedPendingVersion === null
    ? []
    : [
      db.delete(schema.skillFiles).where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.userId, userId),
        eq(schema.skillFiles.version, input.replacedPendingVersion),
        pointerMovedHere,
      )),
      db.delete(schema.skillVersions).where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.userId, userId),
        eq(schema.skillVersions.version, input.replacedPendingVersion),
        pointerMovedHere,
      )),
    ]
  let results: unknown[]

  try {
    results = await db.batch(
      asBatch([...guardedStatements, ...replacingStatements]),
    ) as unknown[]
  } catch (exception) {
    if (isUniqueViolation(exception)) {
      throw createPendingChangedError()
    }

    throw exception
  }

  const claimed = results[guardedStatements.length - 1]

  if (Array.isArray(claimed) && claimed.length > 0) {
    return version
  }

  const fresh = await loadOwnedSkill(db, userId, skillId)

  if (
    fresh.currentVersion !== input.baseVersion
    || fresh.pendingVersion !== input.replacedPendingVersion
  ) {
    throw createPendingChangedError()
  }

  throw await buildStorageFullError(userId, db)
}

/**
 * Stages a connected app's changes to a skill as a persisted pending version
 * (docs/skills.md section 3.4) and switches the skill off with status
 * `needs-review`, in the same batch as the pending pointer. The current
 * version stays as it is until the user accepts the update in the app.
 * License and notice files are protected whatever the license class, and a
 * changed `name` is refused.
 */
export async function stageSkillUpdateForMcpClient(input: {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  clientId: string
  skillId: string
  baseVersion: number
  changes: SkillChange[]
  beforeWrite?: () => Promise<void>
  logger: LoggerLike
}): Promise<StagedMcpSkillUpdate> {
  const { db, bucket, userId, skillId } = input
  const skill = await loadOwnedSkill(db, userId, skillId)

  if (skill.currentVersion !== input.baseVersion) {
    throw createStaleBaseError()
  }

  assertSkillNotBroken(skill)

  if (skill.status === 'needs-review' && skill.pendingVersion === null) {
    throw createSkillEditError('needs-review', {
      message: 'This skill has not been reviewed yet',
      why: 'It was saved switched off by a connected app and the user has '
        + 'not switched it on since',
      fix: 'Ask the user to review the skill in Besidka first, then update '
        + 'it',
    })
  }

  let payloadBytes = 0
  const encoder = new TextEncoder()

  for (const [index, change] of input.changes.entries()) {
    if (change.op === 'put') {
      assertMcpTextContent(change.content, index)
      payloadBytes += encoder.encode(change.content).byteLength
    }
  }

  assertMcpPayloadWithinLimit(payloadBytes)

  const baseRows = await loadVersionFiles(
    db,
    userId,
    skillId,
    skill.currentVersion,
  )
  const baseFiles: WorkingSkillFile[] = baseRows.map((row) => {
    return {
      path: row.path,
      blobSha256: row.blobSha256,
      bytes: row.bytes,
      kind: row.kind,
    }
  })
  const applied = await applySkillChanges({
    baseFiles,
    changes: input.changes,
    locksLicenseFiles: true,
  })
  const heldTexts = new Map<string, string>()
  const blobs = new Map<string, Uint8Array>()

  for (const [sha, content] of applied.puts) {
    heldTexts.set(sha, content.text)
    blobs.set(sha, content.bytes)
  }

  const skillMdFile = applied.files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })
  const skillMdText = skillMdFile
    ? heldTexts.get(skillMdFile.blobSha256)
    : undefined

  if (skillMdText !== undefined) {
    const parsed = parseSkillMarkdown(skillMdText)

    if (parsed.ok && parsed.frontmatter.name !== skill.name) {
      throw createUseRenameSkillError()
    }
  }

  const prepared = await prepareSkillVersion({
    db,
    bucket,
    userId,
    skill,
    files: applied.files,
    heldTexts,
  })

  if (prepared.renamed) {
    throw createUseRenameSkillError()
  }

  if (prepared.license.class === 'restricted') {
    throw createSkillEditError('license-restricted', {
      message: 'This skill cannot be saved',
      why: prepared.license.text,
      fix: 'Remove the license file or replace it with one that allows '
        + 'copying',
    })
  }

  const baseRow = await loadVersionRow(
    db,
    userId,
    skillId,
    skill.currentVersion,
  )

  if (baseRow && baseRow.sha256 === prepared.sha256) {
    return {
      unchanged: true,
      id: skillId,
      name: skill.name,
      version: skill.currentVersion,
    }
  }

  const baseShas = new Set(baseFiles.map((file) => {
    return file.blobSha256
  }))
  let incomingBytes = 0

  for (const [sha, bytes] of blobs) {
    if (!baseShas.has(sha)) {
      incomingBytes += bytes.byteLength
    }
  }

  await assertLimits({
    db,
    userId,
    skillsCount: 0,
    incomingBytes,
    isNewSkill: false,
  })

  const findingCounts = await computeFindingCounts({
    bucket,
    userId,
    skillId,
    baseCounts: baseRow?.findings ?? null,
    baseFiles,
    nextFiles: applied.files,
    heldTexts,
  })
  const findings: SkillFinding[] = []

  for (const file of applied.files) {
    const text = heldTexts.get(file.blobSha256)

    if (text !== undefined) {
      findings.push(...scanSkillText(file.path, text))
    }
  }

  await input.beforeWrite?.()

  const version = await persistMcpPendingVersion({
    db,
    bucket,
    userId,
    clientId: input.clientId,
    skillId,
    baseVersion: input.baseVersion,
    replacedPendingVersion: skill.pendingVersion,
    files: applied.files,
    blobs,
    incomingBytes,
    prepared,
    findingCounts,
    sourceVersion: await createSkillSourceVersion(prepared.sha256),
  })

  await invalidateStorageCache(userId, input.logger)

  return {
    unchanged: false,
    id: skillId,
    name: skill.name,
    baseVersion: input.baseVersion,
    pendingVersion: version,
    replacedPendingVersion: skill.pendingVersion,
    sha256: prepared.sha256,
    licenseClass: prepared.license.class,
    filesCount: applied.files.length,
    bytes: prepared.totalBytes,
    findings: toMcpSkillFindings(findings),
    diffSummary: summarizeFileChanges(baseFiles, applied.files),
    warnings: prepared.warnings,
  }
}

/**
 * Renames a skill for a connected app: only the `name:` line of SKILL.md
 * changes, as a new version of origin `rename`. The same guarded batch
 * switches the skill off and sets `needs-review`, because an agent could
 * otherwise give a skill a name the user relies on. The command is a
 * separate setting and is not touched.
 */
export async function renameSkillForMcpClient(input: {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  clientId: string
  skillId: string
  name: string
  beforeWrite?: () => Promise<void>
  logger: LoggerLike
}): Promise<RenamedMcpSkill> {
  const { db, bucket, userId, skillId, name } = input

  if (name.length > SKILL_NAME_MAX || !isSkillNameValid(name)) {
    throw createInvalidRequestError(
      'This name cannot be used',
      'Use lowercase letters, digits and single hyphens, up to 64 characters',
      'Pick another name, such as review-pr',
    )
  }

  if (isReservedSkillSlashName(name)) {
    throw createSkillEditError('reserved-name', {
      message: `/${name} is reserved by Besidka`,
      why: 'This name belongs to a built-in Besidka command',
      fix: 'Pick another name',
    })
  }

  const skill = await loadOwnedSkill(db, userId, skillId)

  assertSkillNotBroken(skill)

  if (skill.pendingVersion !== null) {
    throw createSkillEditError('pending-version', {
      message: 'This skill has an update waiting for review',
      why: 'A rename now would leave the waiting update with the old name',
      fix: 'Ask the user to accept or reject the update in Besidka first',
    })
  }

  if (skill.name === name) {
    return {
      unchanged: true,
      id: skillId,
      name: skill.name,
      version: skill.currentVersion,
    }
  }

  const baseRows = await loadVersionFiles(
    db,
    userId,
    skillId,
    skill.currentVersion,
  )
  const skillMdRow = baseRows.find((row) => {
    return row.path === SKILL_MD_FILE_NAME
  })

  if (!skillMdRow) {
    throw createSkillEditError('skill-md-required', {
      message: 'A skill needs a SKILL.md',
      why: 'The version has no SKILL.md at its root',
      fix: 'Restore an earlier version in Besidka',
    })
  }

  const renamedText = renameSkillMarkdown(
    await readBlobText({
      bucket,
      userId,
      skillId,
      blobSha256: skillMdRow.blobSha256,
    }),
    name,
  )

  if (renamedText === null) {
    throw createSkillEditError('frontmatter-invalid', {
      message: 'The name in SKILL.md cannot be rewritten',
      why: 'SKILL.md has no name line in its frontmatter',
      fix: 'Add a name line to SKILL.md in Besidka, then rename again',
    })
  }

  await input.beforeWrite?.()

  const saved = await saveSkillChanges({
    db,
    bucket,
    userId,
    skillId,
    baseVersion: skill.currentVersion,
    changes: [{ op: 'put', path: SKILL_MD_FILE_NAME, content: renamedText }],
    note: `Renamed from ${skill.name}`,
    createdByClientId: input.clientId,
    skillSetExtra: { enabled: false, status: 'needs-review' },
    logger: input.logger,
  })

  if (saved.unchanged) {
    return {
      unchanged: true,
      id: skillId,
      name: skill.name,
      version: saved.version,
    }
  }

  const warnings = [`/${skill.name} no longer works as the name of this skill.`]

  if (skill.slashName !== null) {
    warnings.push(`Its command /${skill.slashName} is unchanged.`)
  }

  return {
    unchanged: false,
    id: skillId,
    name,
    previousName: skill.name,
    version: saved.version,
    warnings,
  }
}
