import { relations } from 'drizzle-orm'
import {
  sqliteTable, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { chatShareFiles } from './chat-shares'
import { messages } from './chats'

export const files = sqliteTable(
  'files',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storageKey: text().notNull().unique(),
    name: text().notNull(),
    size: integer({ mode: 'number' }).notNull(),
    type: text().notNull(),
    source: text({ enum: ['upload', 'assistant'] })
      .notNull()
      .default('upload'),
    expiresAt: integer({ mode: 'timestamp' }),
    originMessageId: integer({ mode: 'number' })
      .references(() => messages.id, { onDelete: 'set null' }),
    originProvider: text(),
  },
  table => [
    uniqueIndex('uq_file_user').on(table.id, table.userId),
    uniqueIndex('uq_file_storageKey').on(table.storageKey),
    index('idx_files_expires_at').on(table.expiresAt),
  ],
)

export const filesRelations = relations(files, ({ one, many }) => ({
  user: one(users, {
    fields: [files.userId],
    references: [users.id],
  }),
  originMessage: one(messages, {
    fields: [files.originMessageId],
    references: [messages.id],
  }),
  shares: many(chatShareFiles),
}))
