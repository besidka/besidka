import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = join(
  process.cwd(),
  '.drizzle/migrations/20261026214936_default_reasoning_level/migration.sql',
)

describe('default_reasoning_level migration', () => {
  it('only adds one nullable column to user_settings', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8').trim()

    expect(sql).toBe(
      'ALTER TABLE `user_settings` ADD `default_reasoning_level` text;',
    )
    expect(sql).not.toMatch(/DROP TABLE|__new_|\bDEFAULT\b|NOT NULL/i)
  })
})
