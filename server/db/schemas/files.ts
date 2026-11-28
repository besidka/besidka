import {
  snakeCase, text, integer, real, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { GOOGLE_EXTERNAL_SOURCES } from '#shared/utils/google-data-policy'
import { sql } from 'drizzle-orm'
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
    source: text({ enum: ['upload', 'assistant', 'connector'] })
      .notNull()
      .default('upload'),
    expiresAt: integer({ mode: 'timestamp' }),
    originMessageId: integer({ mode: 'number' })
      .references(() => messages.id, { onDelete: 'set null' }),
    originProvider: text(),
    originModel: text(),
    generationCost: real(),
    textStatus: text({
      enum: ['ready', 'empty', 'failed', 'too_large'],
    }),
    textBytes: integer({ mode: 'number' }),
    textVersion: integer({ mode: 'number' }),
    textOmittedMedia: integer({ mode: 'number' }),
    textOmittedCharts: integer({ mode: 'number' }),
    externalSource: text({ enum: GOOGLE_EXTERNAL_SOURCES }),
    externalId: text(),
    externalModifiedAt: integer({ mode: 'timestamp' }),
    driveCopyId: text(),
    googleDerivedAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_file_user').on(table.id, table.userId),
    uniqueIndex('uq_file_storageKey').on(table.storageKey),
    index('idx_files_expires_at').on(table.expiresAt),
    index('idx_files_user_id').on(table.userId),
    index('idx_files_user_external')
      .on(table.userId, table.externalSource, table.externalId)
      .where(sql`external_source IS NOT NULL`),
  ],
)
