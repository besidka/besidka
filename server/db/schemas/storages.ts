import {
  snakeCase, integer, uniqueIndex, text,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'

export const storages = snakeCase.table(
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
