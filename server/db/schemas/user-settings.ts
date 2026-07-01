import {
  snakeCase,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { defaultSchemaTimestamps } from '../../utils/schema'
import { users } from './auth'

export const userSettings = snakeCase.table(
  'user_settings',
  {
    ...defaultSchemaTimestamps,
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reasoningExpanded: integer({ mode: 'boolean' })
      .notNull()
      .default(false),
    reasoningAutoHide: integer({ mode: 'boolean' })
      .notNull()
      .default(true),
    allowExternalLinks: integer({ mode: 'boolean' }),
    notificationPromptState: integer({ mode: 'boolean' }),
  },
  table => [
    uniqueIndex('uq_user_settings_user').on(table.userId),
  ],
)
