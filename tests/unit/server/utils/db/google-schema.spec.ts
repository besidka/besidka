import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { chats } from '~~/server/db/schemas/chats'
import { files } from '~~/server/db/schemas/files'
import { keys } from '~~/server/db/schemas/keys'
import { googleConnections } from '~~/server/db/schemas/google-connections'

const migrationsDirectory = new URL(
  '../../../../../.drizzle/migrations/',
  import.meta.url,
)

function columnsOf(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns
}

function readGoogleMigration(): string {
  const directory = readdirSync(migrationsDirectory).find((name) => {
    return readFileSync(
      new URL(`${name}/migration.sql`, migrationsDirectory),
      'utf8',
    ).includes('CREATE TABLE `google_connections`')
  })

  if (!directory) {
    throw new Error('google_connections migration not found')
  }

  return readFileSync(
    new URL(`${directory}/migration.sql`, migrationsDirectory),
    'utf8',
  )
}

describe('google schema', () => {
  it('keeps google_connections free of foreign keys', () => {
    const config = getTableConfig(googleConnections)

    expect(config.name).toBe('google_connections')
    expect(config.foreignKeys).toEqual([])
  })

  it('declares one connection per user and client mode', () => {
    const indexes = getTableConfig(googleConnections).indexes.map((index) => {
      return { name: index.config.name, unique: index.config.unique }
    })

    expect(indexes).toEqual([
      { name: 'uq_google_connections_user_mode', unique: true },
      { name: 'idx_google_connections_user', unique: false },
    ])
  })

  it('adds only nullable columns without defaults to existing tables', () => {
    const added = [
      [columnsOf(chats), ['googleDataAt']],
      [columnsOf(keys), ['paidTierConfirmedAt']],
      [
        columnsOf(files),
        ['externalSource', 'externalId', 'externalModifiedAt', 'driveCopyId'],
      ],
    ] as const

    for (const [columns, names] of added) {
      for (const name of names) {
        const column = columns.find((candidate) => {
          return candidate.name === name.replace(
            /[A-Z]/g,
            letter => `_${letter.toLowerCase()}`,
          )
        })

        expect(column, name).toBeDefined()
        expect(column?.notNull, name).toBe(false)
        expect(column?.hasDefault, name).toBe(false)
      }
    }
  })

  it('indexes the external files of a user by source', () => {
    const index = getTableConfig(files).indexes.find((candidate) => {
      return candidate.config.name === 'idx_files_user_external'
    })

    expect(index?.config.unique).toBe(false)
  })

  it('ships an additive migration only', () => {
    const statements = readGoogleMigration()
      .split('--> statement-breakpoint')
      .map(statement => statement.trim())
      .filter(Boolean)

    for (const statement of statements) {
      expect(statement).toMatch(
        /^(CREATE TABLE `google_connections`|ALTER TABLE `\w+` ADD `\w+` \w+;?|CREATE (UNIQUE )?INDEX )/,
      )
    }

    expect(readGoogleMigration()).not.toMatch(
      /DROP|__new_|PRAGMA|INSERT|RENAME/i,
    )
  })
})
