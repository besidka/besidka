import { describe, expect, it } from 'vitest'
import {
  parseRangeHeader,
} from '../../../server/utils/landing/video'

describe('parseRangeHeader', () => {
  it('returns null when no header is provided', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull()
    expect(parseRangeHeader(undefined, 1000)).toBeNull()
    expect(parseRangeHeader('', 1000)).toBeNull()
  })

  it('returns offset 0 and length 500 for bytes=0-499', () => {
    const result = parseRangeHeader('bytes=0-499', 1000)

    expect(result).toEqual({ offset: 0, length: 500, end: 499 })
  })

  it('returns offset 500 to end for bytes=500-', () => {
    const result = parseRangeHeader('bytes=500-', 1000)

    expect(result).toEqual({ offset: 500, length: 500, end: 999 })
  })

  it('returns suffix range for bytes=-500', () => {
    const result = parseRangeHeader('bytes=-500', 1000)

    expect(result).toEqual({ offset: 500, length: 500, end: 999 })
  })

  it('returns suffix clamped to 0 when suffix exceeds file size', () => {
    const result = parseRangeHeader('bytes=-2000', 1000)

    expect(result).toEqual({ offset: 0, length: 1000, end: 999 })
  })

  it('returns invalid when start is greater than end', () => {
    expect(parseRangeHeader('bytes=500-100', 1000)).toBe('invalid')
  })

  it('returns invalid when start equals size', () => {
    expect(parseRangeHeader('bytes=1000-1000', 1000)).toBe('invalid')
  })

  it('returns invalid when end equals size', () => {
    expect(parseRangeHeader('bytes=0-1000', 1000)).toBe('invalid')
  })

  it('returns invalid for garbage input', () => {
    expect(parseRangeHeader('garbage', 1000)).toBe('invalid')
    expect(parseRangeHeader('bytes=abc', 1000)).toBe('invalid')
    expect(parseRangeHeader('bytes=', 1000)).toBe('invalid')
  })

  it('returns invalid for multi-range (not supported)', () => {
    const result = parseRangeHeader('bytes=0-99,200-299', 1000)

    expect(result).toBe('invalid')
  })

  it('returns invalid for suffix range with zero suffix', () => {
    expect(parseRangeHeader('bytes=-0', 1000)).toBe('invalid')
  })
})
