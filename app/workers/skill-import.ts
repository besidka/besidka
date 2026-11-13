import type {
  SkillImportWorkerRequest,
  SkillImportWorkerResponse,
  SkillImportWorkerResult,
} from '~/types/skill-import.d'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import { extractSkillArchive } from '#shared/utils/skills/archive'
import {
  SKILL_MAX_FILES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_RATIO,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_MAX_UPLOAD_BYTES,
  SKILL_RATIO_MIN_BYTES,
} from '#shared/utils/skills-policy'
import { readZipSummary } from '~/utils/knowledge-zip'

interface SkillImportWorkerScope {
  onmessage: ((event: MessageEvent<SkillImportWorkerRequest>) => void) | null
  postMessage: (response: SkillImportWorkerResponse) => void
}

function failure(
  code: string,
  message: string,
): Extract<SkillImportWorkerResult, { ok: false }> {
  return { ok: false, code, message }
}

/**
 * The cheap checks first, on the central directory alone: an archive whose
 * declared sizes cannot be trusted (zip64, unreadable) or that is plainly too
 * big is refused before anything is inflated. The directory count includes
 * folders and macOS noise, so it only has a loose ceiling here; the exact
 * file limit is applied by the shared extractor.
 */
function preCheckArchive(bytes: Uint8Array): SkillImportWorkerResult | null {
  if (bytes.byteLength > SKILL_MAX_UPLOAD_BYTES) {
    return failure('archive-too-large', 'The archive is larger than 5 MiB')
  }

  const summary = readZipSummary(bytes)

  if (!summary) {
    return failure(
      'archive-invalid',
      'The archive is unreadable or uses zip64, which is not supported',
    )
  }

  if (summary.entries > SKILL_MAX_FILES * 5) {
    return failure('archive-too-many-entries', 'The archive has too many entries')
  }

  if (summary.uncompressedBytes > SKILL_MAX_TOTAL_BYTES) {
    return failure(
      'archive-total-too-large',
      'The skill is over 5 MiB uncompressed',
    )
  }

  if (summary.largestEntryBytes > SKILL_MAX_FILE_BYTES) {
    return failure('archive-entry-too-large', 'A file is over 1 MiB')
  }

  if (
    summary.uncompressedBytes > SKILL_RATIO_MIN_BYTES
    && summary.uncompressedBytes / Math.max(bytes.byteLength, 1)
    > SKILL_MAX_RATIO
  ) {
    return failure(
      'archive-ratio',
      `The archive expands more than ${SKILL_MAX_RATIO}:1`,
    )
  }

  return null
}

/**
 * Browser-side pre-check and preview of a skill archive. The server runs the
 * same shared rules again on the uploaded original and never trusts this
 * result; this only saves a round trip and gives instant feedback. Never
 * throws: every failure is a result with a code.
 */
export async function inspectSkillArchiveBytes(
  { bytes }: { name: string, bytes: ArrayBuffer },
): Promise<SkillImportWorkerResult> {
  const archiveBytes = new Uint8Array(bytes)
  const preCheck = preCheckArchive(archiveBytes)

  if (preCheck) {
    return preCheck
  }

  try {
    const archive = extractSkillArchive(archiveBytes)

    if (!archive.ok) {
      return {
        ok: false,
        code: archive.code,
        message: archive.message,
        ...(archive.path === undefined ? {} : { path: archive.path }),
      }
    }

    const analysis = await analyseSkillFiles({
      files: archive.files,
      folderName: archive.folderName,
    })

    if (!analysis.ok) {
      return failure(analysis.code, analysis.message)
    }

    return {
      ok: true,
      summary: {
        name: analysis.skill.name,
        description: analysis.skill.description,
        licenceClass: analysis.licence.class,
        licenceText: analysis.licence.text,
        files: analysis.files.map((file) => {
          return { path: file.path, bytes: file.bytes, kind: file.kind }
        }),
        totalBytes: analysis.totalBytes,
        findings: analysis.findings,
        findingCounts: analysis.findingCounts,
        warnings: [...archive.warnings, ...analysis.warnings],
      },
    }
  } catch {
    return failure('archive-corrupt', 'The archive could not be read')
  }
}

export async function handleSkillImportWorkerRequest(
  request: SkillImportWorkerRequest,
): Promise<SkillImportWorkerResponse> {
  const result = await inspectSkillArchiveBytes({
    name: request.name,
    bytes: request.bytes,
  })

  return { id: request.id, ...result }
}

function isDedicatedWorkerScope(scope: object): boolean {
  const workerScopeConstructor = (globalThis as {
    WorkerGlobalScope?: new () => object
  }).WorkerGlobalScope

  return typeof workerScopeConstructor !== 'undefined'
    && scope instanceof workerScopeConstructor
}

const workerScope = globalThis as unknown as SkillImportWorkerScope

if (isDedicatedWorkerScope(workerScope)) {
  workerScope.onmessage = async (event) => {
    workerScope.postMessage(await handleSkillImportWorkerRequest(event.data))
  }
}
