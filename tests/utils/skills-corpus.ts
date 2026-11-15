import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { scanSkillFileSet } from '#shared/utils/skills/file-set-findings'
import { scanSkillText } from '#shared/utils/skills/findings'
import type { SkillFinding } from '#shared/utils/skills/findings'
import { SKILL_ALLOWED_EXTENSIONS } from '#shared/utils/skills/path'

const UNCAPPED_FINDINGS_PER_FILE = 1_000_000

export interface CorpusFile {
  path: string
  text: string
}

export interface CorpusSkill {
  name: string
  files: CorpusFile[]
}

export interface CorpusFinding extends SkillFinding {
  skill: string
  location: string
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).sort().flatMap((entry) => {
    const path = join(directory, entry)

    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

function readExtension(path: string): string {
  return path.split('.').pop() ?? ''
}

export function readSkillFolders(root: string): CorpusSkill[] {
  return readdirSync(root).sort().filter((entry) => {
    return statSync(join(root, entry)).isDirectory()
  }).map((name) => {
    const base = join(root, name)

    return {
      name,
      files: listFiles(base)
        .filter((path) => {
          return SKILL_ALLOWED_EXTENSIONS.has(readExtension(path))
        })
        .map((path) => {
          return { path: relative(base, path), text: readFileSync(path, 'utf8') }
        }),
    }
  })
}

/**
 * Every finding of one skill, with no cap on the list, so counts per rule are
 * exact: the text rules of each file plus the file-set rules.
 */
export function scanCorpusSkill(skill: CorpusSkill): CorpusFinding[] {
  const findings: SkillFinding[] = []

  for (const file of skill.files) {
    findings.push(
      ...scanSkillText(file.path, file.text, UNCAPPED_FINDINGS_PER_FILE),
    )
  }

  findings.push(...scanSkillFileSet({
    files: skill.files,
    name: skill.name,
    source: null,
    otherSkillNames: [],
  }))

  return findings.map((finding) => {
    return {
      ...finding,
      skill: skill.name,
      location: `${skill.name}/${finding.path}:${finding.line}`,
    }
  })
}

export function scanCorpus(skills: CorpusSkill[]): CorpusFinding[] {
  return skills.flatMap(scanCorpusSkill)
}

export function countByRule(
  findings: SkillFinding[],
  severity: SkillFinding['severity'],
): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const finding of findings) {
    if (finding.severity === severity) {
      counts[finding.rule] = (counts[finding.rule] ?? 0) + 1
    }
  }

  return counts
}
