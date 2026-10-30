import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = join(
  process.cwd(),
  '.drizzle/migrations/20261030194122_project_memory_auto_update/migration.sql',
)

describe('project_memory_auto_update migration', () => {
  it('only adds two nullable columns to projects', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8').trim()

    expect(sql.split('--> statement-breakpoint').map(part => part.trim()))
      .toEqual([
        'ALTER TABLE `projects` ADD `memory_auto_update` text;',
        'ALTER TABLE `projects` ADD `memory_auto_update_enabled_at` integer;',
      ])
    expect(sql).not.toMatch(
      /DROP TABLE|__new_|INSERT INTO|\bDEFAULT\b|NOT NULL/i,
    )
  })
})
