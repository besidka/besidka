import { desc, eq } from 'drizzle-orm'
import { SKILL_EDIT_MAX_FILE_BYTES } from '#shared/utils/skills-policy'
import { getSkillSourceGroup, isSkillLicenceRootFile } from '#shared/utils/skills/edit'
import * as schema from '~~/server/db/schema'
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

export function toSkillSummary(row: SkillRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    modelInvocable: row.modelInvocable,
    slashCommand: row.slashCommand,
    argumentHint: row.argumentHint,
    status: row.status,
    licenseClass: row.licenseClass,
    licenseField: row.licenseField,
    sourceKind: row.sourceKind,
    sourceUrl: row.sourceUrl,
    sourceRef: row.sourceRef,
    sourcePath: row.sourcePath,
    sourceVersion: row.sourceVersion,
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

export function isLicenceLocked(licenseClass: string): boolean {
  return licenseClass === 'open' || licenseClass === 'custom'
}

export function toFileSummary(file: SkillFileRow, locksLicenceFiles: boolean) {
  return {
    path: file.path,
    bytes: file.bytes,
    kind: file.kind,
    sha256: file.blobSha256,
    editable: file.bytes <= SKILL_EDIT_MAX_FILE_BYTES
      && !(locksLicenceFiles && isSkillLicenceRootFile(file.path)),
  }
}

/**
 * The user's skills, newest edit first, with the counts the manager's filter
 * rows show: by source group (created, imported, from apps) and by kind. A
 * skill that is both a skill and a command counts in both kinds.
 */
export async function listUserSkills(db: DbClient, userId: number) {
  const rows = await db.select()
    .from(schema.skills)
    .where(eq(schema.skills.userId, userId))
    .orderBy(desc(schema.skills.updatedAt), desc(schema.skills.id))
  const sources = { all: rows.length, created: 0, imported: 0, apps: 0 }
  const kinds = { all: rows.length, skills: 0, commands: 0 }

  for (const row of rows) {
    sources[getSkillSourceGroup(row.sourceKind)] += 1

    if (row.slashCommand) {
      kinds.commands += 1
    }

    if (row.modelInvocable || !row.slashCommand) {
      kinds.skills += 1
    }
  }

  return {
    skills: rows.map(toSkillSummary),
    counts: { sources, kinds },
  }
}

export async function getSkillDetail(
  db: DbClient,
  userId: number,
  skillId: string,
) {
  const skill = await loadOwnedSkill(db, userId, skillId)
  const [files, versions] = await Promise.all([
    loadVersionFiles(db, userId, skill.id, skill.currentVersion),
    loadSkillVersions(db, userId, skill.id),
  ])
  const locksLicenceFiles = isLicenceLocked(skill.licenseClass)
  const current = versions.find((row) => {
    return row.version === skill.currentVersion
  })
  const pending = versions.find((row) => {
    return row.version === skill.pendingVersion
  })

  return {
    ...toSkillSummary(skill),
    licence: {
      class: skill.licenseClass,
      field: skill.licenseField,
      fileSha256: skill.licenseFileSha256,
      filesLocked: locksLicenceFiles,
    },
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    allowedTools: skill.allowedTools,
    files: files.map((file) => {
      return toFileSummary(file, locksLicenceFiles)
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
