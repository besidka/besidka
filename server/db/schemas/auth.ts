import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { defaultSchemaTimestamps } from '../../utils/schema'
import { chats } from './chats'
import { keys } from './keys'
import { files } from './files'
import { storages } from './storages'

export const users = sqliteTable('users', {
  ...defaultSchemaTimestamps,
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: 'boolean' }).notNull(),
  image: text(),
  lastLoginMethod: text(),
})

export const sessions = sqliteTable('sessions', {
  ...defaultSchemaTimestamps,
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer({ mode: 'number' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer({ mode: 'timestamp' }).notNull(),
  token: text().notNull().unique(),
  userAgent: text(),
})

export const accounts = sqliteTable('accounts', {
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
})

export const verifications = sqliteTable('verifications', {
  ...defaultSchemaTimestamps,
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: 'timestamp' }).notNull(),
})

export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  chats: many(chats),
  chat: one(chats, {
    fields: [users.id],
    references: [chats.userId],
  }),
  keys: many(keys),
  key: one(keys, {
    fields: [users.id],
    references: [keys.userId],
  }),
  files: many(files),
  file: one(files, {
    fields: [users.id],
    references: [files.userId],
  }),
  storage: one(storages, {
    fields: [users.id],
    references: [storages.userId],
  }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}))
