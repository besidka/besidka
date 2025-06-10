import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { defaultSchema } from '../../utils/schema'
// import { publicId } from '../../utils/public-id'

// @TODO: Custom type doesn't work with auto-increment
// https://github.com/drizzle-team/drizzle-orm/issues/818#issuecomment-2960199129
const publicId = () => integer({ mode: 'number' })

export const users = sqliteTable('users', {
  ...defaultSchema,
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: 'boolean' }).notNull(),
  image: text(),
})

export const sessions = sqliteTable('sessions', {
  ...defaultSchema,
  userId: publicId()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer({ mode: 'timestamp' }).notNull(),
  token: text().notNull().unique(),
  userAgent: text(),
})

export const accounts = sqliteTable('accounts', {
  ...defaultSchema,
  accountId: publicId().notNull(),
  providerId: text().notNull(),
  userId: publicId()
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
  ...defaultSchema,
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: 'timestamp' }).notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
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
