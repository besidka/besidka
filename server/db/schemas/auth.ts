import {
  snakeCase,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core'
import { defaultSchemaTimestamps } from '../../utils/schema'

export const users = snakeCase.table('users', {
  ...defaultSchemaTimestamps,
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: 'boolean' }).notNull(),
  image: text(),
  lastLoginMethod: text(),
})

export const sessions = snakeCase.table(
  'sessions',
  {
    ...defaultSchemaTimestamps,
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer({ mode: 'timestamp' }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
  },
  table => [index('sessions_userId_idx').on(table.userId)],
)

export const accounts = snakeCase.table(
  'accounts',
  {
    ...defaultSchemaTimestamps,
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    accountId: integer({ mode: 'number' }).notNull(),
    providerId: text().notNull(),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: integer({ mode: 'timestamp' }),
    refreshTokenExpiresAt: integer({ mode: 'timestamp' }),
    scope: text(),
    password: text(),
  },
  table => [index('accounts_userId_idx').on(table.userId)],
)

export const verifications = snakeCase.table(
  'verifications',
  {
    ...defaultSchemaTimestamps,
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: integer({ mode: 'timestamp' }).notNull(),
  },
  table => [index('verifications_identifier_idx').on(table.identifier)],
)
