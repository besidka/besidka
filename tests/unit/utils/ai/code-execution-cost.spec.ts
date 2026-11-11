import { describe, expect, it } from 'vitest'
import {
  describeCodeExecutionUsage,
  getCodeExecutionCost,
  resolveCodeExecutionRates,
} from '~~/server/utils/ai/code-execution-cost'

const rates = resolveCodeExecutionRates({
  openaiCodeInterpreterCostPerSessionUsd: '0.03',
  anthropicCodeExecutionCostPerHourUsd: '0.05',
  anthropicCodeExecutionFreeHoursPerMonth: '1550',
})

function usage(
  provider: 'anthropic' | 'openai' | 'google',
  overrides: Record<string, number> = {},
) {
  return {
    provider,
    calls: 1,
    containers: 1,
    files: 0,
    bytes: 0,
    skipped: 0,
    ...overrides,
  }
}

describe('resolveCodeExecutionRates', () => {
  it('parses the configured rates and ignores empty or bad values', () => {
    expect(rates).toEqual({
      openaiPerSessionUsd: 0.03,
      anthropicPerHourUsd: 0.05,
      anthropicFreeHoursPerMonth: 1550,
    })
    expect(resolveCodeExecutionRates({
      openaiCodeInterpreterCostPerSessionUsd: '',
      anthropicCodeExecutionCostPerHourUsd: 'free',
    })).toEqual({
      openaiPerSessionUsd: undefined,
      anthropicPerHourUsd: undefined,
      anthropicFreeHoursPerMonth: undefined,
    })
  })
})

describe('getCodeExecutionCost', () => {
  it('charges OpenAI one session per container', () => {
    expect(getCodeExecutionCost(usage('openai', { containers: 2 }), rates))
      .toBeCloseTo(0.06)
    expect(getCodeExecutionCost(usage('openai', { containers: 0 }), rates))
      .toBeCloseTo(0.03)
  })

  it('has no OpenAI cost without a configured rate', () => {
    expect(getCodeExecutionCost(usage('openai'), resolveCodeExecutionRates({})))
      .toBeNull()
  })

  it('never guesses an Anthropic cost: the free hours belong to the organisation', () => {
    expect(getCodeExecutionCost(usage('anthropic'), rates)).toBeNull()
  })

  it('adds nothing for Gemini beyond tokens', () => {
    expect(getCodeExecutionCost(usage('google'), rates)).toBe(0)
  })

  it('has no cost when the tool was never called', () => {
    expect(getCodeExecutionCost(usage('openai', { calls: 0 }), rates))
      .toBeNull()
  })
})

describe('describeCodeExecutionUsage', () => {
  it('always records the count and only records a cost it can compute', () => {
    expect(describeCodeExecutionUsage(
      usage('anthropic', { files: 2, bytes: 100 }),
      rates,
    )).toEqual({
      provider: 'anthropic',
      calls: 1,
      containers: 1,
      files: 2,
      bytes: 100,
      skipped: 0,
    })
    expect(describeCodeExecutionUsage(usage('openai'), rates)).toMatchObject({
      cost: 0.03,
    })
  })
})
