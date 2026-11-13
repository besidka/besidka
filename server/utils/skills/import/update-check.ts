import { and, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  SKILL_FINDINGS_MAX_TOTAL,
} from '#shared/utils/skills-policy'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import { diffSkillFiles } from '#shared/utils/skills/diff'
import {
  capSkillFindings,
  scanSkillText,
} from '#shared/utils/skills/findings'
import type { SkillFinding } from '#shared/utils/skills/findings'
import {
  parseSkillMarkdown,
  renameSkillMarkdown,
} from '#shared/utils/skills/frontmatter'
import {
  isGithubFullSha,
  isReservedGithubRef,
  parseGithubSkillUrl,
} from '#shared/utils/skills/github-url'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import {
  assertLimits,
  persistPendingVersion,
} from '~~/server/utils/skills/import/commit'
import type { PendingVersionPayload } from '~~/server/utils/skills/import/commit'
import { createSkillImportError } from '~~/server/utils/skills/import/errors'
import {
  createGithubClient,
  createGithubRefNotFoundError,
  resolveVerifiedGithubRef,
  throwGithubRefMissing,
} from '~~/server/utils/skills/import/github'
import { loadGithubSkill } from '~~/server/utils/skills/import/github-skill'
import type { GithubKv } from '~~/server/utils/skills/import/github'
import type { SkillStageBucket } from '~~/server/utils/skills/import/stage'
import { skillBlobKey } from '~~/server/utils/skills/storage'
import {
  countUserSkills,
  getUserSkillsUsageBytes,
} from '~~/server/utils/skills/usage'

type DbClient = ReturnType<typeof useDb>
type SkillRow = typeof schema.skills.$inferSelect
type VersionRow = typeof schema.skillVersions.$inferSelect

const UPSTREAM_ORIGINS: ReadonlySet<string> = new Set(['import', 'update'])
const LOCAL_EDIT_ORIGINS: ReadonlySet<string> = new Set([
  'editor',
  'template',
  'mcp',
  'rename',
  'restore',
])
const textEncoder = new TextEncoder()
const bomPreservingDecoder = new TextDecoder('utf-8', { ignoreBOM: true })
const textDecoder = new TextDecoder()

export interface GithubUpdateCheckInput {
  db: DbClient
  bucket: SkillStageBucket
  userId: number
  skillId: string
  kv?: GithubKv
  beforeNetwork?: () => Promise<void>
  logger: LoggerLike
  fetchImpl?: typeof fetch
}

export type GithubUpdateCheckResult
  = | {
    upToDate: true
    pinned: boolean
    contentUnchanged: boolean
    sourceVersion: string
    latestVersion: string | null
  }
  | ({ upToDate: false } & GithubUpdateReview)

export interface GithubUpdateReview {
  version: number
  sha256: string
  sourceVersion: string
  previousSourceVersion: string | null
  compareUrl: string | null
  reusedPending: boolean
  filesCount: number
  warnings: string[]
  diff: ReturnType<typeof diffSkillFiles>
  newFindings: SkillFinding[]
  findingCounts: {
    current: Record<string, number> | null
    pending: Record<string, number> | null
  }
  licence: {
    changed: boolean
    before: { class: string, fileSha256: string | null }
    after: { class: string, fileSha256: string | null }
  }
  localEdits: {
    warn: boolean
    versions: Array<{ version: number, origin: string }>
  }
}

function createSkillNotFoundError() {
  return createError({
    message: 'Skill not found',
    status: 404,
    code: 'skill-not-found',
    why: 'The skill does not exist or is not yours',
    fix: 'Reload the skills list',
  })
}

function createNotGithubSkillError() {
  return createError({
    message: 'This skill was not imported from GitHub',
    status: 400,
    code: 'not-a-github-skill',
    why: 'Only a skill imported from a GitHub link has an upstream to check',
    fix: 'Import the skill from its GitHub link again to follow updates',
  })
}

function createUpstreamMovedError(why: string) {
  return createError({
    message: 'The skill is no longer where it was imported from',
    status: 409,
    code: 'github-skill-missing',
    why,
    fix: 'Import the skill from its new location as a new skill',
  })
}

async function loadOwnedSkill(
  input: GithubUpdateCheckInput,
): Promise<SkillRow> {
  if (!isDecodableSkillPublicId(input.skillId)) {
    throw createSkillNotFoundError()
  }

  const [skill] = await input.db.select()
    .from(schema.skills)
    .where(and(
      eq(schema.skills.id, input.skillId),
      eq(schema.skills.userId, input.userId),
    ))
    .limit(1)

  if (!skill) {
    throw createSkillNotFoundError()
  }

  return skill
}

async function readBlobText(
  input: GithubUpdateCheckInput,
  blobSha256: string,
): Promise<string> {
  const object = await input.bucket.get(
    skillBlobKey(input.userId, input.skillId, blobSha256),
  )

  if (!object) {
    throw createError({
      message: 'The files of this skill are missing',
      status: 409,
      code: 'files-missing',
      why: 'A stored file could not be read',
      fix: 'Import the skill again',
    })
  }

  return textDecoder.decode(await object.arrayBuffer())
}

async function loadVersionFiles(
  input: GithubUpdateCheckInput,
  version: number,
) {
  return await input.db.select()
    .from(schema.skillFiles)
    .where(and(
      eq(schema.skillFiles.skillId, input.skillId),
      eq(schema.skillFiles.userId, input.userId),
      eq(schema.skillFiles.version, version),
    ))
}

function findNewFindings(
  before: Map<string, string>,
  after: Map<string, string>,
): SkillFinding[] {
  const found: SkillFinding[] = []

  for (const [path, text] of after) {
    const previous = before.get(path)

    if (previous === text) {
      continue
    }

    const known = new Set((previous === undefined
      ? []
      : scanSkillText(path, previous)).map((finding) => {
      return `${finding.type}\u0000${finding.snippet}`
    }))

    for (const finding of scanSkillText(path, text)) {
      if (!known.has(`${finding.type}\u0000${finding.snippet}`)) {
        found.push(finding)
      }
    }
  }

  return capSkillFindings(found, SKILL_FINDINGS_MAX_TOTAL)
}

function readLocalEdits(
  versions: Array<Pick<VersionRow, 'version' | 'origin'>>,
  pendingVersion: number | null,
) {
  const settled = versions.filter((row) => {
    return row.version !== pendingVersion
  })
  const lastUpstream = Math.max(0, ...settled
    .filter((row) => {
      return UPSTREAM_ORIGINS.has(row.origin)
    })
    .map((row) => {
      return row.version
    }))
  const local = settled
    .filter((row) => {
      return row.version > lastUpstream && LOCAL_EDIT_ORIGINS.has(row.origin)
    })
    .sort((left, right) => {
      return left.version - right.version
    })
    .map((row) => {
      return { version: row.version, origin: row.origin }
    })

  return { warn: local.length > 0, versions: local, lastUpstream }
}

/**
 * Everything the review screen needs about a persisted pending version:
 * the per-file diff against the CURRENT version (not against the last
 * import, so local edits show up as what accepting would replace), findings
 * that are new in the changed files, any licence change, and the local-edit
 * warning. Read from D1 and R2 so a reused pending version gets the same
 * answer as a fresh one.
 */
async function buildReview(input: {
  context: GithubUpdateCheckInput
  skill: SkillRow
  pending: VersionRow
  versions: VersionRow[]
  warnings: string[]
  reusedPending: boolean
  knownTexts: Map<string, string>
}): Promise<GithubUpdateReview> {
  const { context, skill, pending } = input
  const currentRow = input.versions.find((row) => {
    return row.version === skill.currentVersion
  })
  const currentFiles = await loadVersionFiles(context, skill.currentVersion)
  const pendingFiles = await loadVersionFiles(context, pending.version)
  const currentBySha = new Map(currentFiles.map((file) => {
    return [file.path, file.blobSha256]
  }))
  const before = new Map<string, string>()
  const after = new Map<string, string>()

  for (const file of pendingFiles) {
    if (currentBySha.get(file.path) === file.blobSha256) {
      continue
    }

    after.set(
      file.path,
      input.knownTexts.get(file.blobSha256)
      ?? await readBlobText(context, file.blobSha256),
    )
  }

  const pendingBySha = new Map(pendingFiles.map((file) => {
    return [file.path, file.blobSha256]
  }))

  for (const file of currentFiles) {
    if (pendingBySha.get(file.path) === file.blobSha256) {
      continue
    }

    before.set(file.path, await readBlobText(context, file.blobSha256))
  }

  const allPaths = new Set([...currentBySha.keys(), ...pendingBySha.keys()])
  const unchangedFiles = allPaths.size - new Set([
    ...before.keys(),
    ...after.keys(),
  ]).size
  const localEdits = readLocalEdits(input.versions, pending.version)
  const hasCompareInputs = skill.sourceUrl
    && skill.sourceVersion
    && pending.sourceVersion
  const compareUrl = hasCompareInputs
    ? `${skill.sourceUrl}/compare/${skill.sourceVersion}...${
      pending.sourceVersion
    }`
    : null

  return {
    version: pending.version,
    sha256: pending.sha256,
    sourceVersion: pending.sourceVersion ?? '',
    previousSourceVersion: skill.sourceVersion,
    compareUrl,
    reusedPending: input.reusedPending,
    filesCount: pending.filesCount,
    warnings: input.warnings,
    diff: {
      ...diffSkillFiles(before, after),
      unchanged: unchangedFiles,
    },
    newFindings: findNewFindings(before, after),
    findingCounts: {
      current: currentRow?.findings ?? null,
      pending: pending.findings,
    },
    licence: {
      changed: skill.licenseClass !== pending.licenseClass
        || skill.licenseFileSha256 !== pending.licenseFileSha256,
      before: {
        class: skill.licenseClass,
        fileSha256: skill.licenseFileSha256,
      },
      after: {
        class: pending.licenseClass,
        fileSha256: pending.licenseFileSha256,
      },
    },
    localEdits: { warn: localEdits.warn, versions: localEdits.versions },
  }
}

async function loadVersions(input: GithubUpdateCheckInput) {
  return await input.db.select()
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, input.skillId),
      eq(schema.skillVersions.userId, input.userId),
    ))
}

async function keepLocalName(
  file: { path: string, bytes: Uint8Array, text: string },
  localName: string,
): Promise<{ file: typeof file, warning: string | null }> {
  const parsed = parseSkillMarkdown(file.text)

  if (!parsed.ok || parsed.frontmatter.name === localName) {
    return { file, warning: null }
  }

  const renamed = renameSkillMarkdown(
    bomPreservingDecoder.decode(file.bytes),
    localName,
  )

  if (renamed === null) {
    throw createUpstreamMovedError(
      `The upstream skill is now named ${parsed.frontmatter.name}`,
    )
  }

  return {
    file: { ...file, bytes: textEncoder.encode(renamed), text: renamed },
    warning: `Upstream renamed this skill to ${
      parsed.frontmatter.name
    }; the local name ${localName} was kept`,
  }
}

/**
 * Checks a GitHub skill for a newer commit and, when there is one, stores it
 * as a persisted pending version (origin `update`) for the user to review.
 * The skill keeps running on its current version and stays as enabled as it
 * was; only accepting the pending version changes that. One REST call
 * resolves the ref again, one archive download follows only when the commit
 * moved, and a pinned commit has nothing to check.
 */
export async function checkGithubSkillUpdate(
  input: GithubUpdateCheckInput,
): Promise<GithubUpdateCheckResult> {
  const skill = await loadOwnedSkill(input)
  const parsedUrl = skill.sourceUrl
    ? parseGithubSkillUrl(skill.sourceUrl)
    : null

  if (
    skill.sourceKind !== 'github'
    || !parsedUrl?.ok
    || !skill.sourceRef
    || !skill.sourceVersion
  ) {
    throw createNotGithubSkillError()
  }

  if (isGithubFullSha(skill.sourceRef)) {
    return {
      upToDate: true,
      pinned: true,
      contentUnchanged: false,
      sourceVersion: skill.sourceVersion,
      latestVersion: null,
    }
  }

  if (isReservedGithubRef(skill.sourceRef)) {
    throw createGithubRefNotFoundError()
  }

  const repository = {
    owner: parsedUrl.value.owner,
    repo: parsedUrl.value.repo,
  }
  const client = createGithubClient({
    fetchImpl: input.fetchImpl,
    logger: input.logger,
    kv: input.kv,
  })

  await input.beforeNetwork?.()

  const lookup = await resolveVerifiedGithubRef(client, {
    ...repository,
    ref: skill.sourceRef,
  })

  if (!lookup.found) {
    return await throwGithubRefMissing(client, repository)
  }

  if (lookup.sha === skill.sourceVersion) {
    return {
      upToDate: true,
      pinned: false,
      contentUnchanged: false,
      sourceVersion: skill.sourceVersion,
      latestVersion: lookup.sha,
    }
  }

  const versions = await loadVersions(input)
  const existingPending = skill.pendingVersion === null
    ? null
    : versions.find((row) => {
      return row.version === skill.pendingVersion
    }) ?? null

  if (existingPending && existingPending.origin !== 'update') {
    throw createError({
      message: 'Review or reject the pending version first',
      status: 409,
      code: 'pending-exists',
      why: 'The skill already has a pending version that did not come from an '
        + 'update check, and a check would replace it',
      fix: 'Review or reject the pending version, then check for updates again',
    })
  }

  if (existingPending && existingPending.sourceVersion === lookup.sha) {
    return {
      upToDate: false,
      ...await buildReview({
        context: input,
        skill,
        pending: existingPending,
        versions,
        warnings: [],
        reusedPending: true,
        knownTexts: new Map(),
      }),
    }
  }

  let loaded: Awaited<ReturnType<typeof loadGithubSkill>>

  try {
    loaded = await loadGithubSkill(client, {
      ...repository,
      sha: lookup.sha,
      path: skill.sourcePath,
    })
  } catch (exception) {
    if ((exception as { code?: string }).code === 'archive-missing-skill-md') {
      throw createUpstreamMovedError(
        'The folder the skill was imported from no longer holds a SKILL.md',
      )
    }

    throw exception
  }

  if (loaded.kind === 'pick' || loaded.skillPath !== skill.sourcePath) {
    throw createUpstreamMovedError(
      'The folder the skill was imported from no longer holds it at that path',
    )
  }

  const warnings = [...loaded.warnings]
  const files: SkillArchiveFile[] = []

  for (const file of loaded.files) {
    if (file.path !== SKILL_MD_FILE_NAME) {
      files.push(file)

      continue
    }

    const kept = await keepLocalName(file, skill.name)

    files.push(kept.file)

    if (kept.warning) {
      warnings.push(kept.warning)
    }
  }

  const analysis = await analyseSkillFiles({
    files,
    folderName: loaded.folderName,
  })

  if (!analysis.ok) {
    throw createSkillImportError(analysis.code, analysis.message)
  }

  warnings.push(...analysis.warnings)

  const knownContent = versions
    .filter((row) => {
      return row.version === skill.currentVersion
        || (
          row.version !== skill.pendingVersion
          && UPSTREAM_ORIGINS.has(row.origin)
        )
    })
    .map((row) => {
      return row.sha256
    })

  if (knownContent.includes(analysis.contentSha256)) {
    return {
      upToDate: true,
      pinned: false,
      contentUnchanged: true,
      sourceVersion: skill.sourceVersion,
      latestVersion: lookup.sha,
    }
  }

  assertLimits({
    skillsCount: await countUserSkills(input.db, input.userId),
    usageBytes: await getUserSkillsUsageBytes(input.db, input.userId),
    incomingBytes: analysis.totalBytes,
    isNewSkill: false,
  })

  const contentOverrides = new Map<string, Uint8Array>()
  const knownTexts = new Map<string, string>()

  for (const analysed of analysis.files) {
    const file = files.find((candidate) => {
      return candidate.path === analysed.path
    })!

    contentOverrides.set(analysed.sha256, file.bytes)
    knownTexts.set(analysed.sha256, file.text)
  }

  const payload: PendingVersionPayload = {
    userId: input.userId,
    source: 'github',
    sourceVersion: lookup.sha,
    sourceUrl: skill.sourceUrl,
    sourceRef: skill.sourceRef,
    sourcePath: skill.sourcePath,
    licence: {
      class: analysis.licence.class,
      file: analysis.licence.licenceFile,
      sha256: analysis.licence.licenceFileSha256,
      classifierVersion: analysis.licence.classifierVersion,
    },
    files: analysis.files,
    totalBytes: analysis.totalBytes,
    contentSha256: analysis.contentSha256,
    findingCounts: analysis.findingCounts,
  }
  const { version } = await persistPendingVersion({
    db: input.db,
    bucket: input.bucket,
    manifest: payload,
    contentOverrides,
    skillId: input.skillId,
    pendingVersion: skill.pendingVersion,
    origin: 'update',
  })
  const refreshed = await loadVersions(input)
  const pending = refreshed.find((row) => {
    return row.version === version
  })

  if (!pending) {
    throw createError({
      message: 'This skill changed while you were checking',
      status: 409,
      code: 'pending-changed',
      why: 'The pending version could not be read back',
      fix: 'Check for updates again',
    })
  }

  input.logger.set({
    attributes: {
      skills: {
        update: {
          operation: 'check',
          source: 'github',
          version,
          files: analysis.files.length,
        },
      },
    },
  })

  return {
    upToDate: false,
    ...await buildReview({
      context: input,
      skill,
      pending,
      versions: refreshed,
      warnings,
      reusedPending: false,
      knownTexts,
    }),
  }
}
