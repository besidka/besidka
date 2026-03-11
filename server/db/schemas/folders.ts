import { relations } from 'drizzle-orm'
import {
  sqliteTable, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { chats } from './chats'

export const folders = sqliteTable(
  'folders',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    pinnedAt: integer({ mode: 'timestamp' }),
    archivedAt: integer({ mode: 'timestamp' }),
    activityAt: integer({ mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('uq_folder_user').on(table.id, table.userId),
    index('idx_folders_activity_at').on(table.activityAt),
  ],
)

export const foldersRelations = relations(folders, ({ one, many }) => ({
  user: one(users, {
    fields: [folders.userId],
    references: [users.id],
  }),
  chats: many(chats),
}))
