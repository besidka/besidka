import { describe, expect, it } from 'vitest'
import { getLegalNoticeById } from '#shared/utils/legal-notices'
import {
  computeFeatureRolloutGate,
  describeFeatureRolloutGate,
  FEATURES_ROLLOUT_NOTICE_ID,
  parseFeatureRolloutOverride,
} from '#shared/utils/features/rollout-gate'

describe('parseFeatureRolloutOverride', () => {
  it.each([
    [true, 'on'],
    ['on', 'on'],
    ['TRUE', 'on'],
    ['1', 'on'],
    [false, 'off'],
    ['off', 'off'],
    ['false', 'off'],
    ['0', 'off'],
    ['', 'auto'],
    [undefined, 'auto'],
    ['auto', 'auto'],
    ['maybe', 'auto'],
  ])('reads %j as %s', (value, expected) => {
    expect(parseFeatureRolloutOverride(value)).toBe(expected)
  })
})

describe('computeFeatureRolloutGate', () => {
  it('points at a notice that exists in the registry', () => {
    expect(getLegalNoticeById(FEATURES_ROLLOUT_NOTICE_ID)).toBeDefined()
  })

  it('stays closed until the notice takes effect', () => {
    const gate = computeFeatureRolloutGate(
      '',
      new Date('2026-12-18T23:59:59Z'),
    )

    expect(gate).toMatchObject({
      open: false,
      reason: 'notice_pending',
      effectiveAt: '2026-12-19',
    })
    expect(describeFeatureRolloutGate(gate)).toContain('2026-12-19')
  })

  it('opens on its own at the effective instant', () => {
    expect(computeFeatureRolloutGate(
      '',
      new Date('2026-12-19T00:00:00Z'),
    )).toMatchObject({ open: true, reason: 'notice_in_force' })
  })

  it('lets the environment force it open or closed', () => {
    const before = new Date('2026-11-08T00:00:00Z')
    const after = new Date('2027-01-01T00:00:00Z')

    expect(computeFeatureRolloutGate('on', before))
      .toMatchObject({ open: true, reason: 'override_on' })
    expect(computeFeatureRolloutGate('off', after))
      .toMatchObject({ open: false, reason: 'override_off' })
    expect(computeFeatureRolloutGate(false, after).open).toBe(false)
  })

  it('stays closed for a notice the registry does not know', () => {
    expect(computeFeatureRolloutGate(
      '',
      new Date('2030-01-01T00:00:00Z'),
      'no-such-notice',
    )).toMatchObject({ open: false, reason: 'notice_unknown' })
  })
})
