import { describe, expect, it } from 'vitest'
import {
  stripModelCitationMarkers,
} from '../../../shared/utils/model-citation-markers'

describe('stripModelCitationMarkers', () => {
  it('removes line-range markers', () => {
    expect(stripModelCitationMarkers('Fact 【5†L1-L8】 here'))
      .toBe('Fact here')
  })

  it('removes source markers', () => {
    expect(stripModelCitationMarkers('Fact【3†source】 here'))
      .toBe('Fact here')
  })

  it('removes multi-digit markers', () => {
    expect(stripModelCitationMarkers('Done 【12†L4-L19】'))
      .toBe('Done')
  })

  it('drops the space left before punctuation', () => {
    expect(stripModelCitationMarkers('word 【1†L1】.')).toBe('word.')
    expect(stripModelCitationMarkers('word 【1†L1】, next'))
      .toBe('word, next')
  })

  it('removes adjacent markers as one run', () => {
    expect(stripModelCitationMarkers('word 【1†L1】【2†L2】.'))
      .toBe('word.')
    expect(stripModelCitationMarkers('word 【1†L1】 【2†L2】 next'))
      .toBe('word next')
  })

  it('does not glue words together', () => {
    expect(stripModelCitationMarkers('one 【1†L1】next'))
      .toBe('one next')
  })

  it('keeps markdown table structure intact', () => {
    const table = [
      '| name | value |',
      '| --- | --- |',
      '| a 【1†L2】 | b 【2†L3-L4】 |',
    ].join('\n')

    expect(stripModelCitationMarkers(table)).toBe([
      '| name | value |',
      '| --- | --- |',
      '| a | b |',
    ].join('\n'))
  })

  it('does not touch newlines', () => {
    expect(stripModelCitationMarkers('line one 【1†L1】\n\nline two'))
      .toBe('line one\n\nline two')
    expect(stripModelCitationMarkers('【1†L1】 start\nend'))
      .toBe('start\nend')
  })

  it('returns text without markers unchanged', () => {
    const text = 'Plain  text with  double spaces\n\n| a | b |'

    expect(stripModelCitationMarkers(text)).toBe(text)
  })

  it('returns unrelated unicode text unchanged', () => {
    const text = '【重要】 日本語のテキスト 【注】'

    expect(stripModelCitationMarkers(text)).toBe(text)
  })

  it('keeps unrelated daggers and brackets', () => {
    const text = 'Footnote † and 【note】 stay'

    expect(stripModelCitationMarkers(text)).toBe(text)
  })

  it('leaves an unterminated marker alone', () => {
    const text = 'Cut off 【5†L1'

    expect(stripModelCitationMarkers(text)).toBe(text)
  })

  it('leaves markers with overly long content alone', () => {
    const text = `Long 【${'a'.repeat(41)}†x】 marker`

    expect(stripModelCitationMarkers(text)).toBe(text)
  })

  it('does not match across a nested opening bracket', () => {
    const text = '【1【2†L1】'

    expect(stripModelCitationMarkers(text)).toBe('【1')
  })

  it('does not match across lines', () => {
    const text = '【5\n†L1】'

    expect(stripModelCitationMarkers(text)).toBe(text)
  })
})
