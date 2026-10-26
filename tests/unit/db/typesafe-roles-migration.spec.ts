import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = join(
  process.cwd(),
  '.drizzle/migrations/20261026175532_typesafe_roles/migration.sql',
)

describe('typesafe_roles migration', () => {
  it('only adds one nullable column to user_settings', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8').trim()

    expect(sql).toBe('ALTER TABLE `user_settings` ADD `typesafe_roles` text;')
    expect(sql).not.toMatch(/DROP TABLE|__new_|DEFAULT|NOT NULL/i)
  })
})
