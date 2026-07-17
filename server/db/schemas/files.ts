import {
  snakeCase, text, integer, real, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { messages } from './chats'

export const files = snakeCase.table(
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
    originModel: text(),
    generationCost: real(),
  },
  table => [
    uniqueIndex('uq_file_user').on(table.id, table.userId),
    uniqueIndex('uq_file_storageKey').on(table.storageKey),
    index('idx_files_expires_at').on(table.expiresAt),
  ],
)
