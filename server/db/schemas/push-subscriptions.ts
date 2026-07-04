import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchema } from '../../utils/schema'

export const pushSubscriptions = snakeCase.table(
  'push_subscriptions',
  {
    ...defaultSchema,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text().notNull(),
    p256dhKey: text().notNull(),
    authKey: text().notNull(),
  },
  table => [
    uniqueIndex('uq_push_subscriptions_endpoint').on(table.endpoint),
    index('idx_push_subscriptions_user_id').on(table.userId),
  ],
)
