import { describe, expect, it } from 'vitest'
import {
  SKILL_MODES,
  SKILL_MODE_DESCRIPTIONS,
  getSkillMode,
  getSkillModeColumns,
  isSkillMode,
} from '../../../../shared/utils/skills/mode'

describe('skill invocation modes', () => {
  it('lists the three modes', () => {
    expect(SKILL_MODES).toEqual(['off', 'auto', 'ask'])
    expect(isSkillMode('auto')).toBe(true)
    expect(isSkillMode('manual')).toBe(false)
  })

  it('reads the mode from the columns', () => {
    expect(getSkillMode({ enabled: false, modelInvocable: true }))
      .toBe('off')
    expect(getSkillMode({ enabled: true, modelInvocable: true }))
      .toBe('auto')
    expect(getSkillMode({ enabled: true, modelInvocable: false }))
      .toBe('ask')
  })

  it('sets the columns from a mode without reading a name or command', () => {
    expect(getSkillModeColumns('auto')).toEqual({
      enabled: true,
      modelInvocable: true,
    })
    expect(getSkillModeColumns('ask')).toEqual({
      enabled: true,
      modelInvocable: false,
    })
  })

  it('touches only enabled when the mode is Off', () => {
    expect(getSkillModeColumns('off')).toEqual({ enabled: false })
  })

  it('describes each mode independently of the command', () => {
    expect(SKILL_MODE_DESCRIPTIONS.auto).toBe(
      'The model uses it when the description matches. You can also '
      + 'attach it yourself.',
    )
    expect(SKILL_MODE_DESCRIPTIONS.ask).toBe(
      'Runs only when you attach it from the + menu or type its command.',
    )
  })
})
