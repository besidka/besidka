import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { defaultSchemaTimestamps } from '../../utils/schema'

export const imageTransformUsageMonthly = sqliteTable(
  'image_transform_usage_monthly',
  {
    ...defaultSchemaTimestamps,
    monthKey: text().notNull().primaryKey(),
    transformsUsed: integer({ mode: 'number' })
      .notNull()
      .default(0),
    transformsLimit: integer({ mode: 'number' })
      .notNull()
      .default(1000),
  },
)
