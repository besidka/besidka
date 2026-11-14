import { and, desc, eq, sql } from 'drizzle-orm'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import { hashSkillFileSet } from '#shared/utils/skills/analyze'
import type { SkillAnalysis } from '#shared/utils/skills/analyze'
import { renameSkillMarkdown } from '#shared/utils/skills/frontmatter'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { formatGithubSourceVersion } from '#shared/utils/skills/release'
import type { SkillImportInstalled } from '#shared/types/skills.d'
import * as schema from '~~/server/db/schema'
import type { SkillImportProvenance } from '~~/server/utils/skills/import/stage'

type DbClient = ReturnType<typeof useDb>
type ReadyAnalysis = Extract<SkillAnalysis, { ok: true }>
type SkillRow = typeof schema.skills.$inferSelect

const textEncoder = new TextEncoder()

function isSameFolder(left: string | null, right: string | null): boolean {
  return (left ?? '') === (right ?? '')
}

async function findSameSourceSkills(
  db: DbClient,
  userId: number,
  provenance: SkillImportProvenance,
): Promise<SkillRow[]> {
  if (!provenance.url) {
    return []
  }

  const rows = await db.select()
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, userId),
      eq(schema.skills.sourceKind, 'github'),
      sql`lower(${schema.skills.sourceUrl}) = ${provenance.url.toLowerCase()}`,
    ))
    .orderBy(desc(schema.skills.updatedAt))

  return rows.filter((row) => {
    return isSameFolder(row.sourcePath, provenance.path)
  })
}

async function findSkillsByName(
  db: DbClient,
  userId: number,
  name: string,
): Promise<SkillRow[]> {
  return await db.select()
    .from(schema.skills)
    .where(and(
      eq(schema.skills.userId, userId),
      eq(schema.skills.name, name),
    ))
    .limit(1)
}

async function readCurrentContentSha(
  db: DbClient,
  userId: number,
  skill: SkillRow,
): Promise<string | null> {
  const [version] = await db.select({ sha256: schema.skillVersions.sha256 })
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skill.id),
      eq(schema.skillVersions.userId, userId),
      eq(schema.skillVersions.version, skill.currentVersion),
    ))
    .limit(1)

  return version?.sha256 ?? null
}

/**
 * The content hash the incoming files would have once installed under
 * `name`: an update keeps the local name, and the import hash covers the
 * `name:` line of `SKILL.md`, so a copy renamed on this account is compared
 * under its own name.
 */
async function hashUnderName(
  analysis: ReadyAnalysis,
  name: string,
): Promise<string> {
  if (name === analysis.skill.name) {
    return analysis.contentSha256
  }

  const renamed = renameSkillMarkdown(analysis.skillMd, name)

  if (renamed === null) {
    return analysis.contentSha256
  }

  const sha256 = await sha256Hex(textEncoder.encode(renamed))

  return await hashSkillFileSet(analysis.files.map((file) => {
    return file.path === SKILL_MD_FILE_NAME ? { ...file, sha256 } : file
  }))
}

/**
 * Looks up, before the review screen, whether this account already holds the
 * skill being imported: a GitHub import of the same repository and folder
 * (the repository compared case-insensitively, as GitHub does), otherwise a
 * skill with the same name. A row that has no current version row is the
 * placeholder of an import that died half way; it is never reported, because
 * the commit takes it over after its grace period.
 */
export async function findInstalledSkill(input: {
  db: DbClient
  userId: number
  analysis: ReadyAnalysis
  provenance?: SkillImportProvenance
}): Promise<SkillImportInstalled | null> {
  const { db, userId, analysis } = input
  const sameSource = input.provenance
    ? await findSameSourceSkills(db, userId, input.provenance)
    : []
  const sameName = await findSkillsByName(db, userId, analysis.skill.name)
  const candidates = [
    ...sameSource.map((skill) => {
      return { skill, kind: 'same-source' as const }
    }),
    ...sameName.map((skill) => {
      return { skill, kind: 'same-name' as const }
    }),
  ]

  for (const candidate of candidates) {
    const currentSha = await readCurrentContentSha(db, userId, candidate.skill)

    if (currentSha === null) {
      continue
    }

    const incomingSha = await hashUnderName(analysis, candidate.skill.name)

    return {
      kind: candidate.kind,
      skillId: candidate.skill.id,
      name: candidate.skill.name,
      sourceLabel: candidate.skill.sourceKind === 'github'
        ? formatGithubSourceVersion(candidate.skill)
        : null,
      isUpToDate: currentSha === incomingSha,
    }
  }

  return null
}
