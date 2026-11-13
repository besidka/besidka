import { sha256Hex } from '#shared/utils/knowledge-hash'
import {
  SKILL_FINDINGS_MAX_TOTAL,
  SKILL_MAX_SKILL_MD_BYTES,
} from '#shared/utils/skills-policy'
import type { SkillFileKind } from '#shared/utils/skills-policy'
import { parseSkillMarkdown } from '#shared/utils/skills/frontmatter'
import type { SkillFrontmatter } from '#shared/utils/skills/frontmatter'
import { scanSkillText, summariseSkillFindings } from '#shared/utils/skills/findings'
import type { SkillFinding } from '#shared/utils/skills/findings'
import { classifySkillLicence } from '#shared/utils/skills/licence'
import type { SkillLicenceResult } from '#shared/utils/skills/licence'
import {
  SKILL_MD_FILE_NAME,
  getSkillFileKind,
} from '#shared/utils/skills/path'

export interface SkillAnalysisInputFile {
  path: string
  bytes: Uint8Array
  text: string
}

export interface SkillAnalysisFile {
  path: string
  bytes: number
  kind: SkillFileKind
  sha256: string
}

export type SkillAnalysisErrorCode
  = | 'skill-md-missing'
    | 'skill-md-too-large'
    | 'licence-restricted'
    | 'frontmatter-missing'
    | 'frontmatter-unterminated'
    | 'frontmatter-too-large'
    | 'frontmatter-invalid'
    | 'name-missing'
    | 'name-invalid'
    | 'description-missing'

export type SkillAnalysis
  = | {
    ok: true
    skill: SkillFrontmatter
    files: SkillAnalysisFile[]
    skillMd: string
    findings: SkillFinding[]
    findingCounts: Record<string, number>
    warnings: string[]
    licence: SkillLicenceResult
    totalBytes: number
    contentSha256: string
  }
  | {
    ok: false
    code: SkillAnalysisErrorCode
    message: string
    licence?: SkillLicenceResult
  }

export interface SkillAnalysisInput {
  files: SkillAnalysisInputFile[]
  folderName: string | null
  fallbackLicenceFiles?: Array<{ path: string, text: string }>
}

/**
 * The canonical hash of a file set: sorted `path`, NUL, blob hash, newline.
 * Equal content gives an equal hash whatever the archive order was.
 */
export async function hashSkillFileSet(
  files: Array<{ path: string, sha256: string }>,
): Promise<string> {
  const lines = [...files]
    .sort((left, right) => {
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    })
    .map((file) => {
      return `${file.path}\u0000${file.sha256}\n`
    })

  return await sha256Hex(lines.join(''))
}

/**
 * Everything an import needs to know about an already extracted file set,
 * shared by the browser worker and the server so both read a skill the same
 * way. The licence gate runs here, so a restricted skill never gets past
 * the preview.
 */
export async function analyseSkillFiles(
  input: SkillAnalysisInput,
): Promise<SkillAnalysis> {
  const skillMdFile = input.files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })

  if (!skillMdFile) {
    return {
      ok: false,
      code: 'skill-md-missing',
      message: 'No SKILL.md found in the skill',
    }
  }

  if (skillMdFile.bytes.byteLength > SKILL_MAX_SKILL_MD_BYTES) {
    return {
      ok: false,
      code: 'skill-md-too-large',
      message: 'SKILL.md is over 256 KiB',
    }
  }

  const parsed = parseSkillMarkdown(skillMdFile.text)

  if (!parsed.ok) {
    return { ok: false, code: parsed.code, message: parsed.message }
  }

  const warnings = [...parsed.warnings]

  if (input.folderName && input.folderName !== parsed.frontmatter.name) {
    warnings.push(
      `The folder name "${input.folderName}" differs from the skill name "${parsed.frontmatter.name}"; the name in SKILL.md is used`,
    )
  }

  const licence = await classifySkillLicence({
    files: input.files,
    fallbackFiles: input.fallbackLicenceFiles,
    licenseField: parsed.frontmatter.license,
  })

  if (licence.class === 'restricted') {
    return {
      ok: false,
      code: 'licence-restricted',
      message: licence.text,
      licence,
    }
  }

  warnings.push(...licence.warnings)

  const files: SkillAnalysisFile[] = []
  const findings: SkillFinding[] = []
  let totalBytes = 0

  for (const file of input.files) {
    files.push({
      path: file.path,
      bytes: file.bytes.byteLength,
      kind: getSkillFileKind(file.path),
      sha256: await sha256Hex(file.bytes as BufferSource),
    })
    totalBytes += file.bytes.byteLength
    findings.push(...scanSkillText(file.path, file.text))
  }

  if (findings.length > SKILL_FINDINGS_MAX_TOTAL) {
    warnings.push(
      `Showing the first ${SKILL_FINDINGS_MAX_TOTAL} of ${findings.length} findings`,
    )
  }

  return {
    ok: true,
    skill: parsed.frontmatter,
    files,
    skillMd: skillMdFile.text,
    findings: findings.slice(0, SKILL_FINDINGS_MAX_TOTAL),
    findingCounts: summariseSkillFindings(findings),
    warnings,
    licence,
    totalBytes,
    contentSha256: await hashSkillFileSet(files),
  }
}
