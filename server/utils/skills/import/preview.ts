import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { getRequestHeader } from 'nuxt/server'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import { SKILL_MAX_UPLOAD_BYTES } from '#shared/utils/skills-policy'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createSkillImportError } from '~~/server/utils/skills/import/errors'
import { stageSkillImport } from '~~/server/utils/skills/import/stage'
import type {
  SkillImportProvenance,
  SkillImportSourceKind,
  SkillStageBucket,
  SkillStageKv,
} from '~~/server/utils/skills/import/stage'

const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const ARCHIVE_FILE_NAME_PATTERN = /\.(?:zip|skill)$/i

export interface SkillUpload {
  bytes: Uint8Array
  fileName: string
}

/**
 * Reads the multipart `file` field of the import upload. The size is checked
 * on the header first so an oversized body is refused before it is buffered.
 */
export async function readSkillUpload(
  event: RequestEvent,
): Promise<SkillUpload> {
  const contentLength = Number(getRequestHeader(event, 'content-length'))

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw createError({
      message: 'Missing Content-Length',
      status: 411,
      why: 'The upload did not declare its size',
      fix: 'Upload the archive as multipart form data',
    })
  }

  if (contentLength > SKILL_MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw createSkillImportError(
      'archive-too-large',
      'The archive is larger than 5 MiB',
    )
  }

  let form: FormData

  try {
    form = await event.req.formData()
  } catch {
    throw createError({
      message: 'Invalid upload',
      status: 400,
      why: 'The request body is not valid multipart form data',
      fix: 'Send the archive in a form field named "file"',
    })
  }

  const file = form.get('file')

  if (!(file instanceof Blob)) {
    throw createError({
      message: 'Missing file',
      status: 400,
      why: 'The form has no "file" field',
      fix: 'Send the archive in a form field named "file"',
    })
  }

  const fileName = (file as File).name ?? ''

  if (!ARCHIVE_FILE_NAME_PATTERN.test(fileName)) {
    throw createError({
      message: 'Unsupported file type',
      status: 400,
      why: 'Only .zip and .skill archives can be imported',
      fix: 'Choose a .zip or .skill file',
    })
  }

  if (file.size > SKILL_MAX_UPLOAD_BYTES) {
    throw createSkillImportError(
      'archive-too-large',
      'The archive is larger than 5 MiB',
    )
  }

  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: fileName.slice(0, 255),
  }
}

/**
 * Analyses an extracted skill, applies the licence gate, stages it for one
 * hour and returns what the review screen needs. A restricted licence stops
 * here, so it is never staged.
 */
export async function createSkillImportPreview(input: {
  kv: SkillStageKv
  bucket: SkillStageBucket
  userId: number
  source: SkillImportSourceKind
  sourceVersion: string
  provenance?: SkillImportProvenance
  fileName: string | null
  files: SkillArchiveFile[]
  folderName: string | null
  archiveWarnings: string[]
  logger: LoggerLike
}) {
  const analysis = await analyseSkillFiles({
    files: input.files,
    folderName: input.folderName,
  })

  if (!analysis.ok) {
    input.logger.set({
      attributes: {
        skills: {
          import: {
            source: input.source,
            rejected: analysis.code,
            licenceClass: analysis.licence?.class ?? null,
          },
        },
      },
    })

    throw createSkillImportError(analysis.code, analysis.message)
  }

  const manifest = await stageSkillImport({
    kv: input.kv,
    bucket: input.bucket,
    userId: input.userId,
    source: input.source,
    sourceVersion: input.sourceVersion,
    provenance: input.provenance,
    fileName: input.fileName,
    analysis,
    files: input.files,
  })
  const warnings = [...input.archiveWarnings, ...analysis.warnings]

  input.logger.set({
    attributes: {
      skills: {
        import: {
          source: input.source,
          files: manifest.files.length,
          bytes: manifest.totalBytes,
          findings: manifest.findingCounts,
          licenceClass: manifest.licence.class,
          stage: 'preview',
        },
      },
    },
  })

  return {
    stageId: manifest.stageId,
    source: manifest.source,
    sourceVersion: manifest.sourceVersion,
    sourceUrl: manifest.sourceUrl ?? null,
    sourceRef: manifest.sourceRef ?? null,
    sourcePath: manifest.sourcePath ?? null,
    expiresAt: manifest.expiresAt,
    skill: {
      name: analysis.skill.name,
      description: analysis.skill.description,
      license: analysis.skill.license,
      compatibility: analysis.skill.compatibility,
      metadata: analysis.skill.metadata,
      allowedTools: analysis.skill.allowedTools,
      modelInvocable: analysis.skill.defaults.modelInvocable,
      argumentHint: analysis.skill.defaults.argumentHint,
    },
    files: manifest.files.map((file) => {
      return { path: file.path, bytes: file.bytes, kind: file.kind }
    }),
    skillMd: analysis.skillMd,
    findings: analysis.findings,
    findingCounts: analysis.findingCounts,
    warnings,
    licence: {
      class: analysis.licence.class,
      text: analysis.licence.text,
      matched: analysis.licence.matched,
      file: analysis.licence.licenceFile,
      spdx: analysis.licence.spdx,
      licenceText: analysis.licence.licenceText,
      licenseField: analysis.licence.licenseField,
    },
    requiresLicenceAcknowledgement: manifest.licence.class === 'none'
      || manifest.licence.class === 'custom',
  }
}
