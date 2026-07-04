import {
  snakeCase,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core'

export const consentReceipts = snakeCase.table(
  'consent_receipts',
  {
    id: text().primaryKey(),
    createdAt: text().notNull(),
    revision: integer().notNull(),
    granted: text({ mode: 'json' }).$type<string[]>().notNull(),
    denied: text({ mode: 'json' }).$type<string[]>().notNull(),
    changed: text({ mode: 'json' }).$type<string[]>().notNull(),
    decision: text().notNull(),
    consistent: integer({ mode: 'boolean' }).notNull().default(false),
    country: text(),
  },
  table => [
    index('idx_consent_receipts_created_at').on(table.createdAt),
  ],
)
