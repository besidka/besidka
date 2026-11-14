import { describe, expect, it } from 'vitest'
import {
  SKILL_STEP_PART_TYPE,
  getReasoningSkillStep,
  getSkillActivationStepModel,
  getSkillStepModel,
  getSkillStepTitle,
  isSkillStepPart,
} from '../../../app/utils/skill-step'

function part(overrides: Record<string, unknown>) {
  return {
    type: 'tool-activate_skill',
    toolCallId: 'call-1',
    ...overrides,
  }
}

describe('skill step model', () => {
  it('recognises only the activate_skill tool part', () => {
    expect(SKILL_STEP_PART_TYPE).toBe('tool-activate_skill')
    expect(isSkillStepPart(part({}))).toBe(true)
    expect(isSkillStepPart({ type: 'tool-read_skill_file' })).toBe(false)
    expect(isSkillStepPart({ type: 'data-skill-activation' })).toBe(false)
    expect(isSkillStepPart(null)).toBe(false)
    expect(isSkillStepPart('tool-activate_skill')).toBe(false)
  })

  it('is working while the call streams or runs, with the name from the input', () => {
    expect(getSkillStepModel(part({
      state: 'input-streaming',
      input: { name: 'writing-style' },
    }))).toEqual({ state: 'working', skillId: null, name: 'writing-style' })
    expect(getSkillStepModel(part({
      state: 'input-available',
      input: { name: 'writing-style' },
    }))).toMatchObject({ state: 'working' })
  })

  it('is ready with the id and name from the persisted output', () => {
    expect(getSkillStepModel(part({
      state: 'output-available',
      input: { name: 'writing-style' },
      output: { status: 'activated', skillId: 'skl1', name: 'writing-style' },
    }))).toEqual({ state: 'ready', skillId: 'skl1', name: 'writing-style' })
  })

  it('is ready for an already-active skill too', () => {
    expect(getSkillStepModel(part({
      state: 'output-available',
      output: { status: 'already-active', skillId: 'skl1', name: 'x' },
    }))).toMatchObject({ state: 'ready' })
  })

  it('fails on an error or on an output without a skill id', () => {
    expect(getSkillStepModel(part({
      state: 'output-error',
      input: { name: 'writing-style' },
    }))).toEqual({ state: 'failed', skillId: null, name: 'writing-style' })
    expect(getSkillStepModel(part({
      state: 'output-available',
      output: {},
    }))).toMatchObject({ state: 'failed' })
  })

  it('gives nothing for another part', () => {
    expect(getSkillStepModel({ type: 'text', text: 'hi' })).toBeNull()
  })
})

const activation = {
  type: 'data-skill-activation',
  data: { skillId: 'skl1', name: 'writing-style', version: 1 },
}

describe('skill step in the reasoning list', () => {
  it('titles the step by state', () => {
    expect(getSkillStepTitle({ state: 'working', skillId: null, name: 'x' }))
      .toBe('Reading skill · x')
    expect(getSkillStepTitle({ state: 'ready', skillId: 's', name: 'x' }))
      .toBe('Applied skill · x')
    expect(getSkillStepTitle({ state: 'failed', skillId: null, name: 'x' }))
      .toBe('Could not use skill · x')
    expect(getSkillStepTitle({ state: 'working', skillId: null, name: '' }))
      .toBe('Reading skill')
  })

  it('makes a step from a lone activation part (an attached Auto skill)', () => {
    expect(getSkillActivationStepModel([activation], 0)).toEqual({
      state: 'ready',
      skillId: 'skl1',
      name: 'writing-style',
    })
  })

  it('makes no second step when the call for that skill is in the message', () => {
    const call = part({
      state: 'output-available',
      output: { status: 'activated', skillId: 'skl1', name: 'writing-style' },
    })

    expect(getSkillActivationStepModel([call, activation], 1)).toBeNull()
    expect(getReasoningSkillStep([call, activation], 0))
      .toMatchObject({ state: 'ready' })
    expect(getReasoningSkillStep([call, activation], 1)).toBeNull()
  })

  it('still steps for an activation of a different skill', () => {
    const call = part({
      state: 'output-available',
      output: { status: 'activated', skillId: 'other', name: 'other' },
    })

    expect(getSkillActivationStepModel([call, activation], 1))
      .toMatchObject({ skillId: 'skl1' })
  })

  it('ignores an activation part without a skill id', () => {
    expect(getSkillActivationStepModel([
      { type: 'data-skill-activation', data: { name: 'x' } },
    ], 0)).toBeNull()
  })
})
