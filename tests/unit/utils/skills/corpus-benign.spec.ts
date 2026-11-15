import { describe, expect, it } from 'vitest'
import { SKILL_TEMPLATES } from '#shared/utils/skills/templates'
import {
  countByRule,
  readSkillFolders,
  scanCorpus,
  scanCorpusSkill,
} from '~~/tests/utils/skills-corpus'
import type { CorpusSkill } from '~~/tests/utils/skills-corpus'

const ANTHROPICS_FIXTURE = 'tests/fixtures/skills/anthropics'
const LOW_COUNT_TOLERANCE_RATIO = 0.1
const LOW_COUNT_TOLERANCE_MINIMUM = 3
const TOTAL_LOW_TOLERANCE_RATIO = 0.05

const EXPECTED_MEDIUM_FINDINGS: ReadonlySet<string> = new Set([
  'hidden-character algorithmic-art/SKILL.md:105',
  'exfiltration-send claude-api/curl/managed-agents.md:321',
  'url-script-link claude-api/python/claude-api/tool-use.md:510',
  'exfiltration-send claude-api/shared/admin-api.md:5',
  'shell-shell-c claude-api/shared/agent-design.md:28',
  'exfiltration-send claude-api/shared/cost-optimization.md:114',
  'concealment-soft claude-api/shared/evals/build-eval.md:227',
  'exfiltration-send claude-api/shared/live-sources.md:47',
  'exfiltration-send claude-api/shared/live-sources.md:71',
  'exfiltration-send claude-api/shared/live-sources.md:107',
  'secret-mention claude-api/shared/managed-agents-api-reference.md:162',
  'secret-mention claude-api/shared/managed-agents-onboarding-from-quickstart.md:69',
  'secret-mention claude-api/shared/managed-agents-onboarding.md:44',
  'shell-rm-recursive-force claude-api/shared/managed-agents-tools.md:144',
  'exfiltration-send claude-api/shared/preserved-thinking-migration/causes.md:62',
  'env-dump docx/scripts/office/soffice.py:28',
  'shell-rm-recursive-force mcp-builder/reference/node_mcp_server.md:543',
  'url-ip-address mcp-builder/reference/node_mcp_server_v2.md:683',
  'exfiltration-send mcp-builder/reference/node_mcp_server_v2.md:695',
  'env-dump pptx/scripts/office/soffice.py:28',
  'decode-call skill-creator/eval-viewer/viewer.html:832',
  'env-dump skill-creator/scripts/improve_description.py:33',
  'env-dump skill-creator/scripts/run_eval.py:83',
  'shell-rm-recursive-force web-artifacts-builder/scripts/bundle-artifact.sh:36',
  'hidden-character web-artifacts-builder/scripts/init-artifact.sh:81',
  'hidden-character web-artifacts-builder/scripts/init-artifact.sh:254',
  'env-dump xlsx/scripts/office/soffice.py:28',
])

const EXPECTED_LOW_COUNTS: Readonly<Record<string, number>> = {
  'url-plain-http': 277,
  'url': 354,
  'script-file': 73,
  'unreferenced-file': 70,
  'shell-curl': 81,
  'shell-eval': 196,
  'secret-api-key': 69,
  'injection-system-prompt': 61,
  'templated-url': 26,
  'shell-pip-install': 12,
  'shell-sudo': 2,
  'secret-env-file': 3,
  'url-ip-address': 9,
  'shell-pipe-to-shell': 3,
  'shell-npm-install': 10,
  'long-line': 10,
  'fetch-pipe-run': 1,
  'missing-reference': 37,
}

const BENIGN_SECURITY_PARAGRAPHS: ReadonlyArray<[string, string]> = [
  [
    'English',
    'Never paste a password into a chat. Rotate a key that was shared by mistake, and ask the security team before you change access rules.',
  ],
  [
    'Ukrainian',
    'Ніколи не вставляйте пароль у чат. Змініть ключ, яким поділилися помилково, і запитайте команду безпеки, перш ніж змінювати правила доступу.',
  ],
  [
    'Polish',
    'Nigdy nie wklejaj hasła do czatu. Zmień klucz, który został udostępniony przez pomyłkę, i zapytaj zespół bezpieczeństwa przed zmianą reguł dostępu.',
  ],
]

const anthropicsSkills = readSkillFolders(ANTHROPICS_FIXTURE)
const anthropicsFindings = scanCorpus(anthropicsSkills)

function toleranceFor(expected: number): number {
  return Math.max(
    LOW_COUNT_TOLERANCE_MINIMUM,
    Math.ceil(expected * LOW_COUNT_TOLERANCE_RATIO),
  )
}

describe('the anthropics/skills fixture', () => {
  it('holds the 18 licensed skill folders of the pinned commit', () => {
    expect(anthropicsSkills).toHaveLength(18)
    expect(
      anthropicsSkills.reduce((total, skill) => {
        return total + skill.files.length
      }, 0),
    ).toBe(258)
  })

  it('keeps an Apache license file in every skill folder', () => {
    for (const skill of anthropicsSkills) {
      const license = skill.files.find((file) => {
        return file.path === 'LICENSE.txt'
      })

      expect(license?.text, skill.name).toContain('Apache License')
    }
  })

  it('has no high finding', () => {
    const high = anthropicsFindings.filter((finding) => {
      return finding.severity === 'high'
    })

    expect(high.map((finding) => {
      return `${finding.rule} ${finding.location}`
    })).toEqual([])
  })

  it('has only the medium findings measured at the pinned commit', () => {
    const medium = anthropicsFindings.filter((finding) => {
      return finding.severity === 'medium'
    }).map((finding) => {
      return `${finding.rule} ${finding.location}`
    })

    expect(medium.filter((entry) => {
      return !EXPECTED_MEDIUM_FINDINGS.has(entry)
    })).toEqual([])
    expect(medium.length).toBeLessThanOrEqual(
      EXPECTED_MEDIUM_FINDINGS.size,
    )
  })

  it('keeps every measured medium finding in place', () => {
    const medium = new Set(anthropicsFindings.filter((finding) => {
      return finding.severity === 'medium'
    }).map((finding) => {
      return `${finding.rule} ${finding.location}`
    }))

    expect([...EXPECTED_MEDIUM_FINDINGS].filter((entry) => {
      return !medium.has(entry)
    })).toEqual([])
  })

  it('keeps the count of each low rule near the measured one', () => {
    const counts = countByRule(anthropicsFindings, 'low')

    for (const [rule, expected] of Object.entries(EXPECTED_LOW_COUNTS)) {
      const actual = counts[rule] ?? 0

      expect(
        Math.abs(actual - expected),
        `${rule}: ${actual} against ${expected}`,
      ).toBeLessThanOrEqual(toleranceFor(expected))
    }
  })

  it('has no low rule that was not measured', () => {
    const unknownRules = Object.keys(
      countByRule(anthropicsFindings, 'low'),
    ).filter((rule) => {
      return !(rule in EXPECTED_LOW_COUNTS)
    })

    expect(unknownRules).toEqual([])
  })

  it('keeps the total of low findings near the measured one', () => {
    const expectedTotal = Object.values(EXPECTED_LOW_COUNTS).reduce(
      (total, count) => total + count,
      0,
    )
    const actualTotal = anthropicsFindings.filter((finding) => {
      return finding.severity === 'low'
    }).length

    expect(
      Math.abs(actualTotal - expectedTotal) / expectedTotal,
    ).toBeLessThanOrEqual(TOTAL_LOW_TOLERANCE_RATIO)
  })
})

describe('the Besidka templates', () => {
  const templateSkills: CorpusSkill[] = SKILL_TEMPLATES.map((template) => {
    return {
      name: template.name,
      files: template.files.map((file) => {
        return { path: file.path, text: file.content }
      }),
    }
  })

  it.each(templateSkills.map((skill) => {
    return [skill.name, skill] as const
  }))('has no high or medium finding in %s', (_name, skill) => {
    const findings = scanCorpusSkill(skill).filter((finding) => {
      return finding.severity !== 'low'
    })

    expect(findings.map((finding) => {
      return `${finding.rule} ${finding.location}`
    })).toEqual([])
  })
})

describe('benign text about security in three languages', () => {
  it.each(BENIGN_SECURITY_PARAGRAPHS)(
    'raises no Look closely highlight in %s',
    (_language, paragraph) => {
      const findings = scanCorpusSkill({
        name: 'security-notes',
        files: [{
          path: 'SKILL.md',
          text: `---\nname: security-notes\ndescription: Notes about handling secrets.\n---\n\n${paragraph}\n`,
        }],
      }).filter((finding) => {
        return finding.severity === 'high'
      })

      expect(findings).toEqual([])
    },
  )
})
