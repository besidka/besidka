import { describe, expect, it } from 'vitest'
import { scanSkillText } from '#shared/utils/skills/findings'
import {
  ATTACK_PATTERNS,
  ATTACK_VARIANTS,
  buildAttackSkillMd,
} from '~~/tests/fixtures/skills/attack-patterns'
import type {
  AttackPattern,
  AttackVariant,
} from '~~/tests/fixtures/skills/attack-patterns'

const ENGLISH_ONLY_PHRASES
  = 'The phrase rules read English only; the same request in this wording matches none of them'
const MEDIUM_ONLY = 'Reaches Worth a look only, not Look closely'

const KNOWN_GAPS: Readonly<Record<string, string>> = {
  'registry-redirect:plain': MEDIUM_ONLY,
  'registry-redirect:corporate': MEDIUM_ONLY,
  'registry-redirect:ukrainian': MEDIUM_ONLY,
  'registry-redirect:polish': MEDIUM_ONLY,
  'document-pointer:plain': 'A pointer to another file is not a rule; only a missing file is a For your information highlight',
  'document-pointer:corporate': 'A pointer to another file is not a rule',
  'document-pointer:ukrainian': 'A pointer to another file is not a rule',
  'document-pointer:polish': 'A pointer to another file is not a rule',
  'secret-harvest:plain': MEDIUM_ONLY,
  'secret-harvest:corporate': ENGLISH_ONLY_PHRASES,
  'secret-harvest:ukrainian': ENGLISH_ONLY_PHRASES,
  'secret-harvest:polish': ENGLISH_ONLY_PHRASES,
  'injection-override:corporate': ENGLISH_ONLY_PHRASES,
  'injection-override:ukrainian': ENGLISH_ONLY_PHRASES,
  'injection-override:polish': ENGLISH_ONLY_PHRASES,
  'role-hijack:corporate': ENGLISH_ONLY_PHRASES,
  'role-hijack:ukrainian': ENGLISH_ONLY_PHRASES,
  'role-hijack:polish': ENGLISH_ONLY_PHRASES,
  'fake-role-tag:corporate': 'A bracketed label without a role tag is not matched',
  'concealment:corporate': ENGLISH_ONLY_PHRASES,
  'concealment:ukrainian': ENGLISH_ONLY_PHRASES,
  'concealment:polish': ENGLISH_ONLY_PHRASES,
  'description-injection:corporate': ENGLISH_ONLY_PHRASES,
  'description-injection:ukrainian': ENGLISH_ONLY_PHRASES,
  'description-injection:polish': ENGLISH_ONLY_PHRASES,
}

function countHigh(pattern: AttackPattern, variant: AttackVariant): number {
  return scanSkillText(
    'SKILL.md',
    buildAttackSkillMd(pattern, variant),
  ).filter((finding) => {
    return finding.severity === 'high'
  }).length
}

const cases = ATTACK_PATTERNS.flatMap((pattern) => {
  return ATTACK_VARIANTS.map((variant) => {
    return {
      key: `${pattern.id}:${variant}`,
      title: `${pattern.id} (${variant})`,
      pattern,
      variant,
    }
  })
})

const coveredCases = cases.filter((entry) => {
  return !(entry.key in KNOWN_GAPS)
})

const gapCases = cases.filter((entry) => {
  return entry.key in KNOWN_GAPS
})

describe('the synthetic attack patterns', () => {
  it('has a plain, corporate, Ukrainian and Polish wording for each', () => {
    for (const pattern of ATTACK_PATTERNS) {
      expect(Object.keys(pattern.variants).sort(), pattern.id).toEqual(
        [...ATTACK_VARIANTS].sort(),
      )
    }
  })

  it('keeps every known gap tied to a real pattern', () => {
    const keys = new Set(cases.map((entry) => {
      return entry.key
    }))

    expect(Object.keys(KNOWN_GAPS).filter((key) => {
      return !keys.has(key)
    })).toEqual([])
  })

  it('has a Look closely highlight for every pattern in at least one wording', () => {
    for (const pattern of ATTACK_PATTERNS) {
      const raisesHigh = ATTACK_VARIANTS.some((variant) => {
        return countHigh(pattern, variant) > 0
      })

      expect(
        raisesHigh || ATTACK_VARIANTS.every((variant) => {
          return `${pattern.id}:${variant}` in KNOWN_GAPS
        }),
        pattern.id,
      ).toBe(true)
    }
  })

  it.each(coveredCases.map((entry) => {
    return [entry.title, entry] as const
  }))('raises a Look closely highlight for %s', (_title, entry) => {
    expect(countHigh(entry.pattern, entry.variant)).toBeGreaterThan(0)
  })

  it.each(gapCases.map((entry) => {
    return [entry.title, entry] as const
  }))('still misses %s, a recorded gap', (_title, entry) => {
    expect(countHigh(entry.pattern, entry.variant)).toBe(0)
  })
})
