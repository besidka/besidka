import { describe, expect, it } from 'vitest'
import { parseTimecodeToSeconds, toMarkerPoints } from '#shared/utils/video'

describe('parseTimecodeToSeconds', () => {
  it('parses m:ss', () => {
    expect(parseTimecodeToSeconds('0:12')).toBe(12)
    expect(parseTimecodeToSeconds('1:30')).toBe(90)
    expect(parseTimecodeToSeconds('2:05')).toBe(125)
  })

  it('parses mm:ss with leading zeroes', () => {
    expect(parseTimecodeToSeconds('00:09')).toBe(9)
    expect(parseTimecodeToSeconds('10:00')).toBe(600)
  })

  it('parses h:mm:ss', () => {
    expect(parseTimecodeToSeconds('1:00:00')).toBe(3600)
    expect(parseTimecodeToSeconds('1:02:03')).toBe(3723)
  })

  it('trims surrounding whitespace', () => {
    expect(parseTimecodeToSeconds('  0:30  ')).toBe(30)
  })

  it('returns null for malformed input', () => {
    expect(parseTimecodeToSeconds('12')).toBeNull()
    expect(parseTimecodeToSeconds('')).toBeNull()
    expect(parseTimecodeToSeconds('a:bb')).toBeNull()
    expect(parseTimecodeToSeconds('1:2:3:4')).toBeNull()
    expect(parseTimecodeToSeconds('-1:00')).toBeNull()
  })

  it('returns null when minutes or seconds exceed 59', () => {
    expect(parseTimecodeToSeconds('0:60')).toBeNull()
    expect(parseTimecodeToSeconds('1:99')).toBeNull()
    expect(parseTimecodeToSeconds('1:60:00')).toBeNull()
  })

  it('rejects non-integer segments Number() would coerce', () => {
    expect(parseTimecodeToSeconds('1:')).toBeNull()
    expect(parseTimecodeToSeconds(':30')).toBeNull()
    expect(parseTimecodeToSeconds('1.5:30')).toBeNull()
    expect(parseTimecodeToSeconds('1e1:00')).toBeNull()
    expect(parseTimecodeToSeconds('0x1:30')).toBeNull()
    expect(parseTimecodeToSeconds('Infinity:30')).toBeNull()
  })
})

describe('toMarkerPoints', () => {
  it('returns an empty array for nullish or empty input', () => {
    expect(toMarkerPoints(undefined)).toEqual([])
    expect(toMarkerPoints(null)).toEqual([])
    expect(toMarkerPoints([])).toEqual([])
  })

  it('resolves timecodes to seconds and sorts by time', () => {
    const points = toMarkerPoints([
      { time: '0:08', label: 'Outro' },
      { time: '0:02', label: 'Intro' },
      { time: '0:05', label: 'Middle' },
    ])

    expect(points).toEqual([
      { time: 2, label: 'Intro' },
      { time: 5, label: 'Middle' },
      { time: 8, label: 'Outro' },
    ])
  })

  it('drops markers with invalid timecodes', () => {
    const points = toMarkerPoints([
      { time: '0:03', label: 'Valid' },
      { time: 'nope', label: 'Invalid' },
    ])

    expect(points).toEqual([{ time: 3, label: 'Valid' }])
  })
})
