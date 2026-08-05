import {
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchema } from '../../utils/schema'

export const twoFactors = snakeCase.table(
  'two_factors',
  {
    ...defaultSchema,
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: integer({ mode: 'boolean' }).$defaultFn(() => true),
    failedVerificationCount: integer({ mode: 'number' })
      .$defaultFn(() => 0),
    lockedUntil: integer({ mode: 'timestamp' }),
  },
  table => [index('idx_two_factors_user_id').on(table.userId)],
)
