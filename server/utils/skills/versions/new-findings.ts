import { SKILL_FINDINGS_MAX_TOTAL } from '#shared/utils/skills-policy'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import {
  capSkillFindings,
  scanSkillText,
} from '#shared/utils/skills/findings'
import type { SkillFinding } from '#shared/utils/skills/findings'

const WHITESPACE_RUN_PATTERN = /\s+/g
const UPDATE_CHECK_MAX_FINDINGS_PER_FILE = 5000

async function buildFindingKeys(
  path: string,
  text: string,
): Promise<Array<{ finding: SkillFinding, key: string }>> {
  const lines = text.split('\n')
  const lineHashes = new Map<number, string>()
  const keyed: Array<{ finding: SkillFinding, key: string }> = []

  for (const finding of scanSkillText(
    path,
    text,
    UPDATE_CHECK_MAX_FINDINGS_PER_FILE,
  )) {
    let lineHash = lineHashes.get(finding.line)

    if (lineHash === undefined) {
      lineHash = await sha256Hex(
        (lines[finding.line - 1] ?? '')
          .replace(WHITESPACE_RUN_PATTERN, ' ')
          .trim(),
      )
      lineHashes.set(finding.line, lineHash)
    }

    keyed.push({ finding, key: `${finding.rule}\u0000${lineHash}` })
  }

  return keyed
}

/**
 * The findings of the changed files that the old text did not have. A
 * finding is known when the old text holds the same rule on a line with the
 * same whitespace-normalized content, and known findings are used up one by
 * one, so a second copy of a known line is new, and so is a line whose tail
 * changed after any length.
 */
export async function findNewFindings(
  before: Map<string, string>,
  after: Map<string, string>,
): Promise<SkillFinding[]> {
  const found: SkillFinding[] = []

  for (const [path, text] of after) {
    const previous = before.get(path)

    if (previous === text) {
      continue
    }

    const known = new Map<string, number>()

    if (previous !== undefined) {
      for (const { key } of await buildFindingKeys(path, previous)) {
        known.set(key, (known.get(key) ?? 0) + 1)
      }
    }

    for (const { finding, key } of await buildFindingKeys(path, text)) {
      const remaining = known.get(key) ?? 0

      if (remaining > 0) {
        known.set(key, remaining - 1)

        continue
      }

      found.push(finding)
    }
  }

  return capSkillFindings(found, SKILL_FINDINGS_MAX_TOTAL)
}
