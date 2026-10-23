import { describe, expect, it } from 'vitest'
import { parseRatePerThousandUsd } from '../../../app/utils/search-rate'

describe('parseRatePerThousandUsd', () => {
  it.each([
    ['4', 4],
    [7, 7],
    ['0.5', 0.5],
    ['12.5', 12.5],
  ] as const)('parses %s as %d', (value, expected) => {
    expect(parseRatePerThousandUsd(value)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    '0',
    0,
    '-3',
    -1,
    'abc',
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('returns undefined for %s', (value) => {
    expect(parseRatePerThousandUsd(value)).toBeUndefined()
  })
})
