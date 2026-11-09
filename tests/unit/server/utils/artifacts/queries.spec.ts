import { Column, SQL, is } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const { summarySelection } = await import('~~/server/utils/artifacts/queries')

function resultColumnName(field: unknown): string | null {
  if (is(field, Column)) {
    return field.name
  }

  if (is(field, SQL.Aliased)) {
    return field.fieldAlias
  }

  return null
}

describe('artifact list selection', () => {
  it('has unique result column names', () => {
    const names = Object.values(summarySelection(new Date()))
      .map(resultColumnName)
      .filter((name): name is string => name !== null)

    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
  })

  it('aliases the chat title away from the artifact title column', () => {
    const selection = summarySelection(new Date())

    expect(resultColumnName(selection.title)).toBe('title')
    expect(resultColumnName(selection.originChatTitle))
      .toBe('origin_chat_title')
  })
})
