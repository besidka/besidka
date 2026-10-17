import {
  integer,
  primaryKey,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core'
import type { ActivationEventName } from '#shared/types/analytics.d'
import { users } from './auth'
import { defaultSchemaCreatedAtOnly } from '../../utils/schema'

export const userAttribution = snakeCase.table(
  'user_attribution',
  {
    userId: integer({ mode: 'number' })
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    utmSource: text(),
    utmMedium: text(),
    utmCampaign: text(),
    utmContent: text(),
    ...defaultSchemaCreatedAtOnly,
  },
)

export const userActivationEvents = snakeCase.table(
  'user_activation_events',
  {
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text().$type<ActivationEventName>().notNull(),
    provider: text(),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    primaryKey({ columns: [table.userId, table.event] }),
  ],
)
