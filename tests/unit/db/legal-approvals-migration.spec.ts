import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = join(
  process.cwd(),
  '.drizzle/migrations/20261115103710_mute_vision/migration.sql',
)

describe('legal approvals migration', () => {
  it('only creates the three new tables and their indexes', () => {
    const statements = readFileSync(MIGRATION_PATH, 'utf-8')
      .split('--> statement-breakpoint')
      .map(statement => statement.trim())
      .filter(Boolean)

    expect(statements.map((statement) => {
      return statement.split('(')[0]?.trim()
    })).toEqual([
      'CREATE TABLE `legal_consent_version_approvals`',
      'CREATE TABLE `legal_notice_approvals`',
      'CREATE TABLE `legal_notice_email_optouts`',
      'CREATE UNIQUE INDEX `uq_legal_notice_approvals_active` ON `legal_notice_approvals`',
      'CREATE INDEX `idx_legal_notice_approvals_notice` ON `legal_notice_approvals`',
      'CREATE UNIQUE INDEX `uq_legal_notice_email_optouts_user` ON `legal_notice_email_optouts`',
    ])
  })

  it('adds no rows, no foreign keys and no table rebuild', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8')

    expect(sql).not.toMatch(
      /DROP TABLE|ALTER TABLE|__new_|INSERT|REFERENCES|DEFAULT|PRAGMA/i,
    )
  })
})
