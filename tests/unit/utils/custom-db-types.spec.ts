import { sqliteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { authAccountId } from '../../../server/utils/custom-db-types'

const accountsTable = sqliteTable('accounts_fixture', {
  accountId: authAccountId().notNull(),
})

describe('authAccountId', () => {
  it('declares an integer column', () => {
    expect(accountsTable.accountId.getSQLType()).toBe('integer')
  })

  it('reads an integer driver value back as a string', () => {
    expect(accountsTable.accountId.mapFromDriverValue(42)).toBe('42')
  })

  it('keeps a large Google subject id exact when the driver returns it as text', () => {
    const googleSubjectId = '1234567890123456789012'

    expect(
      accountsTable.accountId.mapFromDriverValue(googleSubjectId),
    ).toBe(googleSubjectId)
  })

  it('writes the string value to the driver unchanged', () => {
    expect(accountsTable.accountId.mapToDriverValue('42')).toBe('42')
  })
})
