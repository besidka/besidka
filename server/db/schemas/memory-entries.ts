import {
  memoryCategories,
  memoryOrigins,
  memorySensitiveCategories,
  memorySensitivities,
} from '#shared/utils/memory-policy'
import { sql } from 'drizzle-orm'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { projects } from './projects'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const memoryEntries = snakeCase.table(
  'memory_entries',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: publicId()
      .references(() => projects.id, { onDelete: 'cascade' }),
    category: text({ enum: memoryCategories }).notNull(),
    slug: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    body: text().notNull(),
    sensitivity: text({ enum: memorySensitivities }).notNull(),
    sensitiveCategory: text({ enum: memorySensitiveCategories }),
    origin: text({ enum: memoryOrigins }).notNull(),
    sourceChatIds: text({ mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    sourceMessageId: text(),
    lastUsedAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_memory_entries_account_slug')
      .on(table.userId, table.category, table.slug)
      .where(sql`project_id is null`),
    uniqueIndex('uq_memory_entries_project_slug')
      .on(table.userId, table.projectId, table.category, table.slug)
      .where(sql`project_id is not null`),
    index('idx_memory_entries_user_project')
      .on(table.userId, table.projectId),
    index('idx_memory_entries_user_sensitivity')
      .on(table.userId, table.sensitivity),
  ],
)
