import {
  sqliteTable,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { defaultSchemaTimestamps } from '../../utils/schema'
import { users } from './auth'

export const userSettings = sqliteTable(
  'user_settings',
  {
    ...defaultSchemaTimestamps,
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reasoningExpanded: integer({ mode: 'boolean' })
      .notNull()
      .default(false),
    allowExternalLinks: integer({ mode: 'boolean' }),
  },
  table => [
    uniqueIndex('uq_user_settings_user').on(table.userId),
  ],
)

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}))
