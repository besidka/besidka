import { describe, expect, it } from 'vitest'
import {
  softStemUkrainianWord,
  stemUkrainianWord,
} from '../../../../server/utils/search/ukrainian-stemmer'

describe('stemUkrainianWord', () => {
  it('bridges the г->з velar mutation', () => {
    expect(stemUkrainianWord('книга')).toBe('кни')
    expect(stemUkrainianWord('книзі')).toBe('кни')
    expect(stemUkrainianWord('книгу')).toBe('кни')
  })

  it('does not bridge the к->ц velar mutation (length guard)', () => {
    expect(stemUkrainianWord('рука')).toBe('рук')
    expect(stemUkrainianWord('руці')).toBe('руц')
  })

  it('bridges plain declension', () => {
    const expectedStem = 'школ'

    expect(stemUkrainianWord('школа')).toBe(expectedStem)
    expect(stemUkrainianWord('школи')).toBe(expectedStem)
    expect(stemUkrainianWord('школі')).toBe(expectedStem)
    expect(stemUkrainianWord('школу')).toBe(expectedStem)
    expect(stemUkrainianWord('школою')).toBe(expectedStem)
  })

  it('does not bridge verb stem alternation', () => {
    expect(stemUkrainianWord('писати')).toBe('пис')
    expect(stemUkrainianWord('пишу')).toBe('пиш')
  })

  it('does not bridge prefix-prepended aspect pairs (permanent limit)', () => {
    expect(stemUkrainianWord('писати')).toBe('пис')
    expect(stemUkrainianWord('написати')).toBe('напи')
    expect(stemUkrainianWord('робити')).toBe('роб')
    expect(stemUkrainianWord('зробити')).toBe('зроб')
  })

  it('locks in the documented regression set', () => {
    expect(stemUkrainianWord('місто')).toBe('міст')
    expect(stemUkrainianWord('місті')).toBe('міст')
    expect(stemUkrainianWord('міста')).toBe('міст')

    expect(stemUkrainianWord('вода')).toBe('вод')
    expect(stemUkrainianWord('воді')).toBe('вод')
    expect(stemUkrainianWord('води')).toBe('вод')

    expect(stemUkrainianWord('робота')).toBe('робо')
    expect(stemUkrainianWord('роботи')).toBe('робо')

    expect(stemUkrainianWord('проєкт')).toBe('проєк')
    expect(stemUkrainianWord('проєкту')).toBe('проєк')
    expect(stemUkrainianWord('проєкти')).toBe('проєк')

    expect(stemUkrainianWord('податок')).toBe('подат')
    expect(stemUkrainianWord('податки')).toBe('подат')
    expect(stemUkrainianWord('податку')).toBe('подат')

    expect(stemUkrainianWord('нога')).toBe('ног')
    expect(stemUkrainianWord('нозі')).toBe('ноз')

    expect(stemUkrainianWord('програма')).toBe('програм')
    expect(stemUkrainianWord('програму')).toBe('програм')
    expect(stemUkrainianWord('програми')).toBe('прогр')

    expect(stemUkrainianWord('час')).toBe('час')
    expect(stemUkrainianWord('часи')).toBe('ча')

    expect(stemUkrainianWord('день')).toBe('ден')
    expect(stemUkrainianWord('дня')).toBe('дня')
    expect(stemUkrainianWord('дні')).toBe('дні')
  })

  it('leaves Latin words unchanged apart from case', () => {
    expect(stemUkrainianWord('hello')).toBe('hello')
    expect(stemUkrainianWord('running')).toBe('running')
    expect(stemUkrainianWord('TypeScript')).toBe('typescript')
    expect(stemUkrainianWord('database')).toBe('database')
  })
})

describe('softStemUkrainianWord derivational regex statelessness', () => {
  it('does not alternate true/false across repeated calls (upstream /g bug)', () => {
    const results = Array.from({ length: 5 }, () => {
      return softStemUkrainianWord('веселость')
    })

    expect(new Set(results).size).toBe(1)
    expect(results.every(result => result === results[0])).toBe(true)
  })
})
