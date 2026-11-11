import { describe, expect, it } from 'vitest'
import {
  featureScheduleCreateSchema,
  scheduleChangeNeedsRolloutGate,
  toScheduleRulePatch,
  validateScheduleSteps,
} from '#shared/utils/features/schedule-schemas'

const now = new Date('2026-11-08T12:00:00Z')

function step(runAt: string, extra: Record<string, unknown> = {}) {
  return { runAt, enabled: true, ...extra }
}

describe('featureScheduleCreateSchema', () => {
  it('accepts a dated step with a rollout in basis points', () => {
    const result = featureScheduleCreateSchema.safeParse({
      steps: [{ runAt: '2026-12-26T10:00:00.000Z', rolloutBps: 2500 }],
    })

    expect(result.success).toBe(true)
  })

  it('refuses the admin role, unknown keys and an empty list', () => {
    expect(featureScheduleCreateSchema.safeParse({
      steps: [{ runAt: '2026-12-26T10:00:00Z', grantRoles: ['admin'] }],
    }).success).toBe(false)
    expect(featureScheduleCreateSchema.safeParse({
      steps: [{ runAt: '2026-12-26T10:00:00Z', stage: 'beta' }],
    }).success).toBe(false)
    expect(featureScheduleCreateSchema.safeParse({ steps: [] }).success)
      .toBe(false)
  })

  it('refuses a date without a timezone and a rollout over 100%', () => {
    expect(featureScheduleCreateSchema.safeParse({
      steps: [{ runAt: '2026-12-26T10:00:00', enabled: true }],
    }).success).toBe(false)
    expect(featureScheduleCreateSchema.safeParse({
      steps: [{ runAt: '2026-12-26T10:00:00Z', rolloutBps: 10001 }],
    }).success).toBe(false)
  })
})

describe('toScheduleRulePatch', () => {
  it('keeps admins in the allowed roles when testers are granted', () => {
    expect(toScheduleRulePatch({ grantRoles: ['tester'] })).toEqual({
      allowRoles: ['admin', 'tester'],
    })
  })

  it('only carries what the step changes', () => {
    expect(toScheduleRulePatch({ rolloutBps: 500 })).toEqual({
      rolloutBps: 500,
    })
  })
})

describe('scheduleChangeNeedsRolloutGate', () => {
  it('is true for a rollout above zero or variants only', () => {
    expect(scheduleChangeNeedsRolloutGate({ rolloutBps: 100 })).toBe(true)
    expect(scheduleChangeNeedsRolloutGate({
      variants: [{ key: 'a', weightBps: 10000 }],
    })).toBe(true)
    expect(scheduleChangeNeedsRolloutGate({ rolloutBps: 0 })).toBe(false)
    expect(scheduleChangeNeedsRolloutGate({})).toBe(false)
  })
})

describe('validateScheduleSteps', () => {
  it('accepts increasing future steps, a rollout before the gate included', () => {
    expect(validateScheduleSteps([
      step('2026-11-20T10:00:00Z', { rolloutBps: 1000 }),
      step('2026-12-26T10:00:00Z', { rolloutBps: 2500 }),
    ], { now, existingRunAtMs: [] })).toEqual([])
  })

  it('flags past, repeated and out-of-order steps', () => {
    const issues = validateScheduleSteps([
      step('2026-11-08T11:00:00Z'),
      step('2026-12-01T10:00:00Z'),
      step('2026-12-01T10:00:00Z'),
      step('2026-11-30T10:00:00Z'),
    ], { now, existingRunAtMs: [] })

    expect(issues.map((issue) => {
      return [issue.index, issue.code]
    })).toEqual([
      [0, 'past'],
      [2, 'duplicate_time'],
      [3, 'not_increasing'],
    ])
  })

  it('flags a time an open step of the flag already uses', () => {
    const taken = Date.parse('2026-12-01T10:00:00Z')

    expect(validateScheduleSteps(
      [step('2026-12-01T10:00:00Z')],
      { now, existingRunAtMs: [taken] },
    )).toEqual([expect.objectContaining({ code: 'duplicate_time' })])
  })

  it('flags a step more than two years ahead', () => {
    expect(validateScheduleSteps(
      [step('2029-01-01T10:00:00Z')],
      { now, existingRunAtMs: [] },
    )).toEqual([expect.objectContaining({ code: 'too_far' })])
  })

  it.each([15000, -500, 12.5, Number.NaN])(
    'flags a rollout of %s without throwing',
    (rolloutBps) => {
      expect(validateScheduleSteps(
        [step('2026-12-01T10:00:00Z', { rolloutBps })],
        { now, existingRunAtMs: [] },
      )).toEqual([expect.objectContaining({ code: 'invalid_rollout' })])
    },
  )

  it('flags a step that changes nothing', () => {
    expect(validateScheduleSteps(
      [{ runAt: '2026-12-01T10:00:00Z' }],
      { now, existingRunAtMs: [] },
    )).toEqual([expect.objectContaining({ code: 'empty_step' })])
  })
})
