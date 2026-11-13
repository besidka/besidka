import { createError } from 'evlog'
import type { SkillAnalysis } from '#shared/utils/skills/analyse'
import {
  SKILL_STAGE_TTL,
} from '#shared/utils/skills-policy'
import type {
  SkillFileKind,
  SkillLicenseClass,
} from '#shared/utils/skills-policy'
import {
  skillStagingUserPrefix,
} from '~~/server/utils/skills/storage'
import type { SkillBlobBucket } from '~~/server/utils/skills/storage'

export const SKILL_STAGE_KEY_PREFIX = 'skills:stage:'
export const SKILL_STAGE_ID_PATTERN = /^[a-f0-9]{32}$/

export type SkillImportSourceKind = 'zip' | 'text'

export interface SkillStageKv {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
}

export interface SkillStageBucket extends SkillBlobBucket {
  get: (key: string) => Promise<{
    arrayBuffer: () => Promise<ArrayBuffer>
  } | null>
}

export interface SkillStageFile {
  path: string
  bytes: number
  kind: SkillFileKind
  sha256: string
}

export interface SkillStageManifest {
  stageId: string
  userId: number
  source: SkillImportSourceKind
  sourceVersion: string
  fileName: string | null
  createdAt: number
  expiresAt: number
  skill: {
    name: string
    description: string
    license: string | null
    compatibility: string | null
    metadata: Record<string, string> | null
    allowedTools: string[] | null
    modelInvocable: boolean
    slashCommand: boolean
    argumentHint: string | null
  }
  licence: {
    class: Exclude<SkillLicenseClass, 'authored'>
    file: string | null
    sha256: string | null
    classifierVersion: number
  }
  files: SkillStageFile[]
  totalBytes: number
  contentSha256: string
  findingCounts: Record<string, number>
  warnings: string[]
}

export interface StagedFileContent {
  path: string
  bytes: Uint8Array
}

export function skillStageKey(stageId: string): string {
  return `${SKILL_STAGE_KEY_PREFIX}${stageId}`
}

export function skillStageFileKey(
  userId: number,
  stageId: string,
  sha256: string,
): string {
  return `${skillStagingUserPrefix(userId)}${stageId}/${sha256}`
}

export function createSkillStageId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

type ReadyAnalysis = Extract<SkillAnalysis, { ok: true }>

function buildManifest(input: {
  stageId: string
  userId: number
  source: SkillImportSourceKind
  sourceVersion: string
  fileName: string | null
  analysis: ReadyAnalysis
  now: number
}): SkillStageManifest {
  const { analysis } = input
  const licenceClass = analysis.licence.class

  if (licenceClass === 'restricted') {
    throw createError({
      message: 'A restricted skill cannot be staged',
      status: 500,
      why: 'The licence gate must reject restricted skills before staging',
      fix: 'Run the analysis and stop on a restricted licence',
    })
  }

  return {
    stageId: input.stageId,
    userId: input.userId,
    source: input.source,
    sourceVersion: input.sourceVersion,
    fileName: input.fileName,
    createdAt: input.now,
    expiresAt: input.now + SKILL_STAGE_TTL * 1000,
    skill: {
      name: analysis.skill.name,
      description: analysis.skill.description,
      license: analysis.skill.license,
      compatibility: analysis.skill.compatibility,
      metadata: analysis.skill.metadata,
      allowedTools: analysis.skill.allowedTools,
      modelInvocable: analysis.skill.defaults.modelInvocable,
      slashCommand: analysis.skill.defaults.slashCommand,
      argumentHint: analysis.skill.defaults.argumentHint,
    },
    licence: {
      class: licenceClass,
      file: analysis.licence.licenceFile,
      sha256: analysis.licence.licenceFileSha256,
      classifierVersion: analysis.licence.classifierVersion,
    },
    files: analysis.files.map((file) => {
      return {
        path: file.path,
        bytes: file.bytes,
        kind: file.kind,
        sha256: file.sha256,
      }
    }),
    totalBytes: analysis.totalBytes,
    contentSha256: analysis.contentSha256,
    findingCounts: analysis.findingCounts,
    warnings: analysis.warnings,
  }
}

/**
 * Stages an import preview: the manifest in KV and the files in R2, both
 * gone after an hour. Files are keyed by content hash, never by their path,
 * so nothing the user chose reaches an R2 key. Sequential on purpose (a
 * Worker holds six connections).
 */
export async function stageSkillImport(input: {
  kv: SkillStageKv
  bucket: SkillStageBucket
  userId: number
  source: SkillImportSourceKind
  sourceVersion: string
  fileName: string | null
  analysis: ReadyAnalysis
  files: StagedFileContent[]
  now?: number
}): Promise<SkillStageManifest> {
  const stageId = createSkillStageId()
  const manifest = buildManifest({
    stageId,
    userId: input.userId,
    source: input.source,
    sourceVersion: input.sourceVersion,
    fileName: input.fileName,
    analysis: input.analysis,
    now: input.now ?? Date.now(),
  })
  const stagedShas = new Set<string>()

  for (const file of manifest.files) {
    if (stagedShas.has(file.sha256)) {
      continue
    }

    stagedShas.add(file.sha256)

    const content = input.files.find((candidate) => {
      return candidate.path === file.path
    })

    await input.bucket.put(
      skillStageFileKey(input.userId, stageId, file.sha256),
      content!.bytes,
      { httpMetadata: { contentType: 'text/plain; charset=utf-8' } },
    )
  }

  await input.kv.put(skillStageKey(stageId), JSON.stringify(manifest), {
    expirationTtl: SKILL_STAGE_TTL,
  })

  return manifest
}

export function createStageNotFoundError() {
  return createError({
    message: 'This import has expired',
    status: 404,
    code: 'stage-not-found',
    why: 'The staged import was not found, belongs to another account, or '
      + 'is older than one hour',
    fix: 'Upload the skill again',
  })
}

/**
 * Null when the stage is missing, expired or belongs to another user, so a
 * caller cannot tell a foreign stage from an absent one.
 */
export async function readSkillStage(input: {
  kv: SkillStageKv
  userId: number
  stageId: string
  now?: number
}): Promise<SkillStageManifest | null> {
  if (!SKILL_STAGE_ID_PATTERN.test(input.stageId)) {
    return null
  }

  const raw = await input.kv.get(skillStageKey(input.stageId))

  if (!raw) {
    return null
  }

  let manifest: SkillStageManifest

  try {
    manifest = JSON.parse(raw) as SkillStageManifest
  } catch {
    return null
  }

  if (
    manifest.userId !== input.userId
    || manifest.stageId !== input.stageId
    || manifest.expiresAt <= (input.now ?? Date.now())
  ) {
    return null
  }

  return manifest
}

export async function readStagedFile(input: {
  bucket: SkillStageBucket
  manifest: SkillStageManifest
  sha256: string
}): Promise<Uint8Array | null> {
  const object = await input.bucket.get(skillStageFileKey(
    input.manifest.userId,
    input.manifest.stageId,
    input.sha256,
  ))

  if (!object) {
    return null
  }

  return new Uint8Array(await object.arrayBuffer())
}

/**
 * Removes the manifest first, so a half-finished delete can no longer be
 * committed, then the staged objects in one batch. A leftover object is
 * swept after an hour.
 */
export async function deleteSkillStage(input: {
  kv: SkillStageKv
  bucket: SkillStageBucket
  manifest: SkillStageManifest
}): Promise<void> {
  const { manifest } = input

  await input.kv.delete(skillStageKey(manifest.stageId))

  const keys = [...new Set(manifest.files.map((file) => {
    return file.sha256
  }))].map((sha256) => {
    return skillStageFileKey(manifest.userId, manifest.stageId, sha256)
  })

  if (keys.length > 0) {
    await input.bucket.delete(keys)
  }
}
