import { relations } from 'drizzle-orm'
import {
  sqliteTable, text, integer, uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'

export const keys = sqliteTable(
  'keys',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text({ enum: ['openai', 'anthropic', 'google'] }).notNull(),
    apiKey: text().notNull(),
    projectId: text().default(''),
  },
  table => [
    uniqueIndex('uq_key_user').on(table.id, table.userId),
    // @TODO: Currently we don't allow multiple keys
    // for the same user and provider.
    // Potentially we could allow this in the future
    // when workspaces are implemented.
    uniqueIndex('uq_key_user_provider').on(table.userId, table.provider),
  ],
)

export const keysRelations = relations(keys, ({ one }) => ({
  user: one(users, {
    fields: [keys.userId],
    references: [users.id],
  }),
}))
