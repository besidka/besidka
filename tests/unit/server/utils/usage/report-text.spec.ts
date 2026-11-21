import { describe, expect, it } from 'vitest'
import {
  REPORT_WIDTH,
  fitReportLine,
  formatReportCount,
  formatReportDate,
  formatReportDateTime,
  formatReportSpan,
  reportRow,
  reportRule,
  toReportLabel,
} from '~~/server/utils/usage/report-text'

describe('report text', () => {
  it('right-aligns a value to the report width', () => {
    const row = reportRow('Input', '1,234', 2)

    expect(row).toHaveLength(REPORT_WIDTH)
    expect(row.startsWith('  Input')).toBe(true)
    expect(row.endsWith('1,234')).toBe(true)
  })

  it('keeps one space when a row cannot fit', () => {
    expect(reportRow('a'.repeat(38), '12345')).toBe(`${'a'.repeat(38)} 12345`)
  })

  it('draws a rule of the report width', () => {
    expect(reportRule()).toBe('-'.repeat(REPORT_WIDTH))
  })

  it('writes dates in UTC', () => {
    const date = new Date('2026-11-20T23:59:30.000Z')

    expect(formatReportDateTime(date)).toBe('2026-11-20 23:59')
    expect(formatReportDate(date)).toBe('2026-11-20')
  })

  it.each([
    [0, '<1m'],
    [59_000, '<1m'],
    [40 * 60_000, '40m'],
    [60 * 60_000, '1h'],
    [(5 * 60 + 12) * 60_000, '5h 12m'],
    [24 * 60 * 60_000, '1d'],
    [(3 * 24 + 4) * 60 * 60_000, '3d 4h'],
    [-5, '<1m'],
  ])('formats a span of %d ms as %s', (milliseconds, expected) => {
    expect(formatReportSpan(milliseconds)).toBe(expected)
  })

  it('groups thousands', () => {
    expect(formatReportCount(1234567)).toBe('1,234,567')
    expect(formatReportCount(2.6)).toBe('3')
  })

  it('makes a label a single line without control or direction marks', () => {
    expect(toReportLabel('a\nb\r\nc\td')).toBe('a b c d')
    expect(toReportLabel('x\u2028y\u2029z')).toBe('x y z')
    expect(toReportLabel('gpt\u202Etxt.exe')).toBe('gpt txt.exe')
    expect(toReportLabel('  \u0007 ')).toBe('')
  })

  it('cuts a label to one report line without a line break', () => {
    const line = fitReportLine(`model\n\`\`\`\n${'x'.repeat(60)}`)

    expect(line).not.toContain('\n')
    expect(line.length).toBeLessThanOrEqual(REPORT_WIDTH)
    expect(fitReportLine('short')).toBe('short')
  })
})
