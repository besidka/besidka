import { integer, snakeCase, text } from 'drizzle-orm/sqlite-core'
import { defaultSchemaTimestamps } from '../../utils/schema'

export const imageGenerationLocks = snakeCase.table(
  'image_generation_locks',
  {
    ...defaultSchemaTimestamps,
    userId: integer({ mode: 'number' }).primaryKey(),
    token: text().notNull(),
    expiresAt: integer({ mode: 'timestamp' }).notNull(),
  },
)
