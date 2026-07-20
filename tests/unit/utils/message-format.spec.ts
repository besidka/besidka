import { describe, expect, it } from 'vitest'
import {
  formatMessageCost,
  formatMessageDateTime,
  formatTokenCount,
} from '../../../shared/utils/message-format'

describe('formatTokenCount', () => {
  it('renders an em-dash for undefined or null', () => {
    expect(formatTokenCount(undefined)).toBe('—')
    expect(formatTokenCount(null)).toBe('—')
  })

  it('renders a grouped token count', () => {
    expect(formatTokenCount(5240)).toBe('5,240')
  })

  it('renders zero as-is', () => {
    expect(formatTokenCount(0)).toBe('0')
  })
})

describe('formatMessageCost', () => {
  it('renders an em-dash for undefined or null', () => {
    expect(formatMessageCost(undefined)).toBe('—')
    expect(formatMessageCost(null)).toBe('—')
  })

  it('renders zero as $0.00', () => {
    expect(formatMessageCost(0)).toBe('$0.00')
  })

  it('renders sub hundredth-of-a-cent costs as a lower bound', () => {
    expect(formatMessageCost(0.00005)).toBe('< $0.0001')
  })

  it('renders below-cent costs with up to 6 decimals', () => {
    expect(formatMessageCost(0.005)).toBe('$0.005')
  })

  it('renders at-or-above-cent costs with 2 to 4 decimals', () => {
    expect(formatMessageCost(0.0131)).toBe('$0.0131')
  })

  it('pads whole-cent costs to 2 decimals', () => {
    expect(formatMessageCost(2.5)).toBe('$2.50')
  })

  it('prefixes an estimated cost with a tilde', () => {
    expect(formatMessageCost(2, true)).toBe('~$2.00')
  })

  it('does not prefix a non-estimated cost', () => {
    expect(formatMessageCost(2, false)).toBe('$2.00')
    expect(formatMessageCost(2)).toBe('$2.00')
  })

  it('prefixes the near-zero lower bound when estimated', () => {
    expect(formatMessageCost(0.00005, true)).toBe('~< $0.0001')
  })
})

describe('formatMessageDateTime', () => {
  it('renders empty parts for undefined or null', () => {
    expect(formatMessageDateTime(undefined)).toEqual({
      date: '',
      time: '',
    })
    expect(formatMessageDateTime(null)).toEqual({
      date: '',
      time: '',
    })
  })

  it('renders empty parts for an invalid date string', () => {
    expect(formatMessageDateTime('not-a-date')).toEqual({
      date: '',
      time: '',
    })
  })

  it('renders non-empty date and time parts for a valid value', () => {
    const result = formatMessageDateTime('2026-01-15T10:30:00.000Z')

    expect(result.date).toEqual(expect.any(String))
    expect(result.time).toEqual(expect.any(String))
    expect(result.date).not.toBe('')
    expect(result.time).not.toBe('')
  })
})
