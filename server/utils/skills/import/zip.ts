import { sha256Hex } from '#shared/utils/knowledge-hash'
import { extractSkillArchive } from '#shared/utils/skills/archive'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import { createSkillImportError } from '~~/server/utils/skills/import/errors'

const SOURCE_VERSION_HEX_LENGTH = 16

export interface ReadSkillArchiveResult {
  files: SkillArchiveFile[]
  folderName: string | null
  warnings: string[]
}

export async function createSkillSourceVersion(
  content: Uint8Array | string,
): Promise<string> {
  const hash = await sha256Hex(content as BufferSource | string)

  return `sha256-${hash.slice(0, SOURCE_VERSION_HEX_LENGTH)}`
}

/**
 * The server never trusts the browser worker: every upload is extracted
 * again here with the same shared rules, and a failure is a structured 4xx.
 */
export function readSkillArchive(bytes: Uint8Array): ReadSkillArchiveResult {
  const result = extractSkillArchive(bytes)

  if (!result.ok) {
    throw createSkillImportError(result.code, result.message, result.path)
  }

  return {
    files: result.files,
    folderName: result.folderName,
    warnings: result.warnings,
  }
}
