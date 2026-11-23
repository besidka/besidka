import { describe, expect, it } from 'vitest'
import {
  buildMirrorSegments,
  normalizeMirrorRanges,
} from '~/utils/composer-mirror-ranges'

describe('normalizeMirrorRanges', () => {
  it('returns nothing for no ranges', () => {
    expect(normalizeMirrorRanges(10, [])).toEqual([])
  })

  it('sorts ranges by position', () => {
    expect(normalizeMirrorRanges(10, [
      { start: 6, end: 8, kind: 'google-link' },
      { start: 1, end: 3, kind: 'command' },
    ])).toEqual([
      { start: 1, end: 3, kind: 'command' },
      { start: 6, end: 8, kind: 'google-link' },
    ])
  })

  it('clips a range that starts inside the one before it', () => {
    expect(normalizeMirrorRanges(10, [
      { start: 1, end: 5, kind: 'command' },
      { start: 3, end: 8, kind: 'google-link' },
    ])).toEqual([
      { start: 1, end: 5, kind: 'command' },
      { start: 5, end: 8, kind: 'google-link' },
    ])
  })

  it('drops a range that sits entirely inside the one before it', () => {
    expect(normalizeMirrorRanges(10, [
      { start: 1, end: 8, kind: 'command' },
      { start: 3, end: 5, kind: 'google-link' },
    ])).toEqual([{ start: 1, end: 8, kind: 'command' }])
  })

  it('clamps offsets into the text and drops what is left empty', () => {
    expect(normalizeMirrorRanges(5, [
      { start: -3, end: 2, kind: 'google-link' },
      { start: 4, end: 99, kind: 'google-link' },
      { start: 50, end: 99, kind: 'google-link' },
      { start: 3, end: 3, kind: 'google-link' },
      { start: 4, end: 1, kind: 'google-link' },
    ])).toEqual([
      { start: 0, end: 2, kind: 'google-link' },
      { start: 4, end: 5, kind: 'google-link' },
    ])
  })

  it('drops ranges that are not finite numbers and floors fractions', () => {
    expect(normalizeMirrorRanges(10, [
      { start: Number.NaN, end: 4, kind: 'command' },
      { start: 1, end: Number.POSITIVE_INFINITY, kind: 'command' },
      { start: 1.9, end: 3.2, kind: 'google-link' },
    ])).toEqual([{ start: 1, end: 3, kind: 'google-link' }])
  })

  it('does not change the ranges it was given', () => {
    const ranges = [
      { start: 6, end: 20, kind: 'google-link' as const },
      { start: 1, end: 3, kind: 'command' as const },
    ]

    normalizeMirrorRanges(10, ranges)

    expect(ranges).toEqual([
      { start: 6, end: 20, kind: 'google-link' },
      { start: 1, end: 3, kind: 'command' },
    ])
  })
})

describe('buildMirrorSegments', () => {
  it('is one plain segment with the filler for no ranges', () => {
    expect(buildMirrorSegments('hello', [])).toEqual([
      { start: 0, end: 5, text: 'hello ', kind: null },
    ])
  })

  it('is just the filler for an empty text', () => {
    expect(buildMirrorSegments('', [])).toEqual([
      { start: 0, end: 0, text: ' ', kind: null },
    ])
  })

  it('cuts the text at the ranges and keeps every character once', () => {
    const text = 'a\t/cmd\n\n b  https://x.test  c\n'
    const segments = buildMirrorSegments(text, [
      { start: 2, end: 6, kind: 'command' },
      { start: 11, end: 26, kind: 'google-link' },
    ])

    expect(segments.map((segment) => {
      return segment.kind
    })).toEqual([null, 'command', null, 'google-link', null])
    expect(segments.map((segment) => {
      return segment.text
    }).join('')).toBe(`${text} `)
  })

  it('puts the filler in its own plain segment after a range at the end',
    () => {
      expect(buildMirrorSegments('/c', [
        { start: 0, end: 2, kind: 'command' },
      ])).toEqual([
        { start: 0, end: 2, text: '/c', kind: 'command' },
        { start: 2, end: 2, text: ' ', kind: null },
      ])
    })

  it('joins back to the text for overlapping and out-of-range ranges', () => {
    const text = 'abcdefghij'
    const segments = buildMirrorSegments(text, [
      { start: 4, end: 8, kind: 'google-link' },
      { start: 2, end: 6, kind: 'command' },
      { start: 30, end: 40, kind: 'google-link' },
    ])

    expect(segments.map((segment) => {
      return segment.text
    }).join('')).toBe(`${text} `)
  })
})
