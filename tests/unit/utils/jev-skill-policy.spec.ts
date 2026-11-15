import { describe, expect, it } from 'vitest'
import {
  JEV_BACKGROUND_TIMEOUT_MS,
  JEV_INJECTION_SCREENING,
  JEV_SKILL_QUESTION_IDS,
  JEV_SKILL_SCREENING,
} from '#shared/utils/jev-policy'
import {
  SKILL_JEV_RULES,
  withoutSkillJevFindingCounts,
} from '#shared/utils/skills/jev-findings'
import { getSkillFindingExplanation } from '#shared/utils/skills/findings'

describe('JEV_SKILL_SCREENING', () => {
  it('holds the constants decided by the SS-7 eval', () => {
    expect(JEV_SKILL_SCREENING).toMatchObject({
      questionSetVersion: 2,
      maxChunkTokens: 2000,
      maxCallsPerScreen: 12,
      maxCallsPerStage: 48,
      maxConcurrentCalls: 3,
      timeoutMs: JEV_BACKGROUND_TIMEOUT_MS,
      flagAtOrAbove: {
        i2_attack: 0.4,
        k1_send_out: 0.5,
        k2_conceal: 0.7,
        k3_secrets: 0.2,
        k4_run_remote: 0.4,
      },
    })
  })

  it('asks the five questions, reusing the injection question for i2', () => {
    expect(JEV_SKILL_QUESTION_IDS).toEqual([
      'i2_attack',
      'k1_send_out',
      'k2_conceal',
      'k3_secrets',
      'k4_run_remote',
    ])
    expect(Object.keys(JEV_SKILL_SCREENING.questions))
      .toEqual([...JEV_SKILL_QUESTION_IDS])
    expect(JEV_SKILL_SCREENING.questions.i2_attack)
      .toBe(JEV_INJECTION_SCREENING.question)
  })

  it('names only the state key text in a question', () => {
    for (const question of Object.values(JEV_SKILL_SCREENING.questions)) {
      const quoted = [...question.instructions.matchAll(/`([^`]+)`/g)]
        .map(match => match[1])

      expect(quoted.length).toBeGreaterThan(0)
      expect(quoted.every(name => name === 'text'))
        .toBe(true)
      expect('criteria' in question).toBe(false)
      expect(question.instructions).not.toMatch(/\$\{|\{\{|\{[a-z_]+\}/)
    }
  })

  it('gives k1, k2 and k3 high, k4 and i2 medium', () => {
    expect(JEV_SKILL_SCREENING.severity).toEqual({
      i2_attack: 'medium',
      k1_send_out: 'high',
      k2_conceal: 'high',
      k3_secrets: 'high',
      k4_run_remote: 'medium',
    })
  })

  it('dropped the off-purpose question, so nothing reads the description', () => {
    expect(JEV_SKILL_QUESTION_IDS).not.toContain('k5_off_purpose')
    expect(JSON.stringify(JEV_SKILL_SCREENING)).not.toContain('description')
    expect(getSkillFindingExplanation('jev-off-purpose')).toBeNull()
  })

  it('has a plain explanation for every Jev rule', () => {
    for (const { rule } of Object.values(SKILL_JEV_RULES)) {
      expect(getSkillFindingExplanation(rule), rule).toBeTruthy()
    }
  })
})

describe('withoutSkillJevFindingCounts', () => {
  it('drops only the jev entries', () => {
    expect(withoutSkillJevFindingCounts({
      'rulesVersion': 3,
      'high': 2,
      'jev:marked': 4,
      'jev:unchecked': 1,
      'jev:questionSet': 1,
    })).toEqual({ rulesVersion: 3, high: 2 })
    expect(withoutSkillJevFindingCounts(null)).toEqual({})
  })
})
