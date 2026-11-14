import { describe, expect, it } from 'vitest'
import {
  SKILL_MODES,
  getSkillMode,
  getSkillModeColumns,
  isSkillCommandKind,
  isSkillMode,
  isSkillSkillKind,
  isSkillSlashBlocked,
} from '../../../../shared/utils/skills/mode'

describe('skill invocation modes', () => {
  it('lists the three modes', () => {
    expect(SKILL_MODES).toEqual(['off', 'auto', 'ask'])
    expect(isSkillMode('auto')).toBe(true)
    expect(isSkillMode('manual')).toBe(false)
  })

  it('reads the mode from the columns', () => {
    expect(getSkillMode({
      enabled: false,
      modelInvocable: true,
      slashCommand: true,
    })).toBe('off')
    expect(getSkillMode({
      enabled: true,
      modelInvocable: true,
      slashCommand: true,
    })).toBe('auto')
    expect(getSkillMode({
      enabled: true,
      modelInvocable: false,
      slashCommand: true,
    })).toBe('ask')
  })

  it('sets the three columns from a mode', () => {
    expect(getSkillModeColumns('auto', 'writing-style')).toEqual({
      enabled: true,
      modelInvocable: true,
      slashCommand: true,
    })
    expect(getSkillModeColumns('ask', 'writing-style')).toEqual({
      enabled: true,
      modelInvocable: false,
      slashCommand: true,
    })
  })

  it('touches only enabled when the mode is Off', () => {
    expect(getSkillModeColumns('off', 'writing-style')).toEqual({
      enabled: false,
    })
  })

  it('keeps /name off for a reserved name instead of failing', () => {
    expect(getSkillModeColumns('auto', 'memory')).toEqual({
      enabled: true,
      modelInvocable: true,
      slashCommand: false,
    })
    expect(isSkillSlashBlocked({
      name: 'memory',
      enabled: true,
      modelInvocable: true,
      slashCommand: false,
    })).toBe(true)
    expect(isSkillSlashBlocked({
      name: 'memory',
      enabled: false,
      modelInvocable: true,
      slashCommand: false,
    })).toBe(false)
    expect(isSkillSlashBlocked({
      name: 'writing-style',
      enabled: true,
      modelInvocable: true,
      slashCommand: true,
    })).toBe(false)
  })

  it('classes Auto as a skill and Only when I ask as a command', () => {
    expect(isSkillSkillKind({ modelInvocable: true, slashCommand: true }))
      .toBe(true)
    expect(isSkillCommandKind({ modelInvocable: true, slashCommand: true }))
      .toBe(false)
    expect(isSkillCommandKind({ modelInvocable: false, slashCommand: true }))
      .toBe(true)
    expect(isSkillSkillKind({ modelInvocable: false, slashCommand: true }))
      .toBe(false)
  })
})
