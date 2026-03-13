import { relations } from 'drizzle-orm'
import {
  sqliteTable, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { chats } from './chats'

export const projects = sqliteTable(
  'projects',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    instructions: text(),
    memory: text(),
    memoryStatus: text({
      enum: ['idle', 'stale', 'refreshing', 'ready', 'failed', 'unavailable'],
    })
      .notNull()
      .default('idle'),
    memoryUpdatedAt: integer({ mode: 'timestamp' }),
    memoryDirtyAt: integer({ mode: 'timestamp' }),
    memoryProvider: text(),
    memoryModel: text(),
    memoryError: text(),
    pinnedAt: integer({ mode: 'timestamp' }),
    archivedAt: integer({ mode: 'timestamp' }),
    activityAt: integer({ mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('uq_project_user').on(table.id, table.userId),
    index('idx_projects_activity_at').on(table.activityAt),
  ],
)

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  chats: many(chats),
}))
