import { relations } from 'drizzle-orm'
import {
  sqliteTable, integer, uniqueIndex, text,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'

export const storages = sqliteTable(
  'storages',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storage: integer({ mode: 'number' })
      .notNull()
      .default(20 * 1024 * 1024), // 20MB,
    tier: text({ enum: ['free', 'vip'] })
      .notNull()
      .default('free'),
    maxFilesPerMessage: integer({ mode: 'number' })
      .notNull()
      .default(10),
    maxMessageFilesBytes: integer({ mode: 'number' })
      .notNull()
      .default(1000 * 1024 * 1024), // 1GB
    fileRetentionDays: integer({ mode: 'number' })
      .default(30),
    imageTransformLimitTotal: integer({ mode: 'number' })
      .default(0),
    imageTransformUsedTotal: integer({ mode: 'number' })
      .notNull()
      .default(0),
  },
  table => [
    uniqueIndex('uq_storage_user').on(table.userId),
  ],
)

export const storagesRelations = relations(storages, ({ one }) => ({
  user: one(users, {
    fields: [storages.userId],
    references: [users.id],
  }),
}))
