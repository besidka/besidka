import { describe, expect, it } from 'vitest'
import {
  buildCurrentDateInstruction,
} from '../../../../server/utils/ai/current-date-instruction'

describe('buildCurrentDateInstruction', () => {
  it('states the UTC calendar date of the given instant', () => {
    const instruction = buildCurrentDateInstruction(
      new Date('2026-10-05T23:59:59.999Z'),
    )

    expect(instruction).toContain('Today\'s date is 2026-10-05 (UTC).')
  })

  it('tells the model not to search for the current date', () => {
    const instruction = buildCurrentDateInstruction(new Date(0))

    expect(instruction).toContain('do not search for the current date')
  })
})
