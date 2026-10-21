import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'
import {
  containsLikeEscaped,
  escapeLikePattern,
  getLikeCaseVariants,
} from '../../../../../server/utils/db/like'

const dialect = drizzle(new Database(':memory:')).dialect

function matches(title: string, search: string) {
  const database = new Database(':memory:')

  database.exec('create table items (title text)')
  database.prepare('insert into items (title) values (?)').run(title)

  const query = dialect.sqlToQuery(
    sql`select title from items where ${containsLikeEscaped(sql`title`, search)}`,
  )
  const rows = database.prepare(query.sql).all(...query.params)

  database.close()

  return rows.length > 0
}

describe('getLikeCaseVariants', () => {
  it('returns a single variant for values without letters', () => {
    expect(getLikeCaseVariants('123')).toEqual(['123'])
  })

  it('dedupes ASCII variants', () => {
    expect(getLikeCaseVariants('alpha')).toEqual([
      'alpha',
      'ALPHA',
      'Alpha',
    ])
    expect(getLikeCaseVariants('A')).toEqual(['A', 'a'])
  })

  it('includes lower, upper and capitalized Cyrillic variants', () => {
    const variants = getLikeCaseVariants('ножі')

    expect(variants).toContain('ножі')
    expect(variants).toContain('Ножі')
    expect(variants).toContain('НОЖІ')
  })

  it('trims the value before building variants', () => {
    expect(getLikeCaseVariants('  ножі ')).toContain('Ножі')
  })

  it('keeps the as-typed variant', () => {
    expect(getLikeCaseVariants('aLpHa')).toContain('aLpHa')
  })
})

describe('containsLikeEscaped', () => {
  it('escapes wildcard characters in every variant', () => {
    const query = dialect.sqlToQuery(
      sql`${containsLikeEscaped(sql`title`, '50%_x')}`,
    )

    expect(query.params).toEqual(['%50\\%\\_x%', '%50\\%\\_X%'])
    expect(escapeLikePattern('50%_x')).toBe('50\\%\\_x')
  })

  it('emits a single like when there is one variant', () => {
    const query = dialect.sqlToQuery(
      sql`${containsLikeEscaped(sql`title`, '123')}`,
    )

    expect(query.params).toEqual(['%123%'])
    expect(query.sql).not.toContain(' or ')
  })

  it('finds Cyrillic titles regardless of case', () => {
    expect(matches('Ножі', 'ножі')).toBe(true)
    expect(matches('Вибір автівки в Польщі', 'вибір')).toBe(true)
    expect(matches('Вибір автівки в Польщі', 'польщі')).toBe(true)
    expect(matches('Іспанія', 'іспанія')).toBe(true)
    expect(matches('ножі', 'НОЖІ')).toBe(true)
    expect(matches('Ножі', 'кіт')).toBe(false)
  })

  it('treats wildcards literally', () => {
    expect(matches('100% done', '100%')).toBe(true)
    expect(matches('1000 done', '100%')).toBe(false)
    expect(matches('a_b', 'a_b')).toBe(true)
    expect(matches('axb', 'a_b')).toBe(false)
  })

  it('matches single-character searches', () => {
    expect(matches('Ножі', 'н')).toBe(true)
    expect(matches('Alpha', 'a')).toBe(true)
  })
})
