import { desc, eq } from 'drizzle-orm'
import { SKILL_EDIT_MAX_FILE_BYTES } from '#shared/utils/skills-policy'
import { getSkillSourceGroup, isSkillLicenseRootFile } from '#shared/utils/skills/edit'
import * as schema from '~~/server/db/schema'
import {
  getSkillUpdateAvailable,
  readSkillUpdateState,
} from '~~/server/utils/skills/import/update-state'
import type {
  SkillUpdateAvailable,
  SkillUpdateKv,
} from '~~/server/utils/skills/import/update-state'
import {
  loadOwnedSkill,
  loadSkillVersions,
  loadVersionFiles,
} from '~~/server/utils/skills/versions/read'
import type {
  SkillFileRow,
  SkillRow,
  SkillVersionRow,
} from '~~/server/utils/skills/versions/read'

type DbClient = ReturnType<typeof useDb>

function readMetadataVersion(
  metadata: SkillRow['metadata'],
): string | null {
  const version = metadata?.version

  return typeof version === 'string' && version.trim() !== ''
    ? version.trim().slice(0, 64)
    : null
}

export function toSkillSummary(
  row: SkillRow,
  updateAvailable: SkillUpdateAvailable | null = null,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    modelInvocable: row.modelInvocable,
    command: row.slashName,
    slashCommand: row.slashName !== null,
    argumentHint: row.argumentHint,
    status: row.status,
    licenseClass: row.licenseClass,
    licenseField: row.licenseField,
    sourceKind: row.sourceKind,
    sourceUrl: row.sourceUrl,
    sourceRef: row.sourceRef,
    sourcePath: row.sourcePath,
    sourceVersion: row.sourceVersion,
    metadataVersion: readMetadataVersion(row.metadata),
    updateAvailable,
    currentVersion: row.currentVersion,
    pendingVersion: row.pendingVersion,
    filesCount: row.filesCount,
    bytes: row.bytes,
    allowScripts: row.allowScripts,
    createdVia: row.createdVia,
    createdByClientId: row.createdByClientId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function toVersionSummary(
  row: SkillVersionRow,
  skill: Pick<SkillRow, 'currentVersion' | 'pendingVersion'>,
) {
  return {
    version: row.version,
    origin: row.origin,
    note: row.note,
    sha256: row.sha256,
    filesCount: row.filesCount,
    bytes: row.bytes,
    licenseClass: row.licenseClass,
    findings: row.findings,
    sourceKind: row.sourceKind,
    sourceUrl: row.sourceUrl,
    sourceRef: row.sourceRef,
    sourcePath: row.sourcePath,
    sourceVersion: row.sourceVersion,
    createdByClientId: row.createdByClientId,
    createdAt: row.createdAt,
    isCurrent: row.version === skill.currentVersion,
    isPending: row.version === skill.pendingVersion,
  }
}

export function isLicenseLocked(licenseClass: string): boolean {
  return licenseClass === 'open' || licenseClass === 'custom'
}

export function toFileSummary(file: SkillFileRow, locksLicenseFiles: boolean) {
  return {
    path: file.path,
    bytes: file.bytes,
    kind: file.kind,
    sha256: file.blobSha256,
    editable: file.bytes <= SKILL_EDIT_MAX_FILE_BYTES
      && !(locksLicenseFiles && isSkillLicenseRootFile(file.path)),
  }
}

/**
 * The user's skills, newest edit first, with the counts the manager's source
 * filter shows (created, imported, from apps).
 */
export async function listUserSkills(
  db: DbClient,
  userId: number,
  kv?: SkillUpdateKv,
) {
  const rows = await db.select()
    .from(schema.skills)
    .where(eq(schema.skills.userId, userId))
    .orderBy(desc(schema.skills.updatedAt), desc(schema.skills.id))
  const sources = { all: rows.length, created: 0, imported: 0, apps: 0 }
  const updates = kv && rows.some((row) => {
    return row.sourceKind === 'github'
  })
    ? await readSkillUpdateState(kv, userId)
    : {}

  for (const row of rows) {
    sources[getSkillSourceGroup(row.sourceKind)] += 1
  }

  return {
    skills: rows.map((row) => {
      return toSkillSummary(row, getSkillUpdateAvailable(updates[row.id], row))
    }),
    counts: { sources },
  }
}

export async function getSkillDetail(
  db: DbClient,
  userId: number,
  skillId: string,
  kv?: SkillUpdateKv,
) {
  const skill = await loadOwnedSkill(db, userId, skillId)
  const updates = kv && skill.sourceKind === 'github'
    ? await readSkillUpdateState(kv, userId)
    : {}
  const [files, versions] = await Promise.all([
    loadVersionFiles(db, userId, skill.id, skill.currentVersion),
    loadSkillVersions(db, userId, skill.id),
  ])
  const locksLicenseFiles = isLicenseLocked(skill.licenseClass)
  const current = versions.find((row) => {
    return row.version === skill.currentVersion
  })
  const pending = versions.find((row) => {
    return row.version === skill.pendingVersion
  })

  return {
    ...toSkillSummary(skill, getSkillUpdateAvailable(updates[skill.id], skill)),
    license: {
      class: skill.licenseClass,
      field: skill.licenseField,
      fileSha256: skill.licenseFileSha256,
      filesLocked: locksLicenseFiles,
    },
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    allowedTools: skill.allowedTools,
    files: files.map((file) => {
      return toFileSummary(file, locksLicenseFiles)
    }),
    currentVersionInfo: current ? toVersionSummary(current, skill) : null,
    pendingVersionInfo: pending ? toVersionSummary(pending, skill) : null,
  }
}

export async function listSkillVersions(
  db: DbClient,
  userId: number,
  skillId: string,
) {
  const skill = await loadOwnedSkill(db, userId, skillId)
  const versions = await loadSkillVersions(db, userId, skill.id)

  return {
    current: skill.currentVersion,
    pending: skill.pendingVersion,
    versions: versions.map((row) => {
      return toVersionSummary(row, skill)
    }),
  }
}
