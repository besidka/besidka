import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchema } from '../../utils/schema'

export type LegalNoticeDeliveryStatus
  = | 'sending'
    | 'sent'
    | 'failed'
    | 'skipped'

export const legalNoticeDeliveries = snakeCase.table(
  'legal_notice_deliveries',
  {
    ...defaultSchema,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noticeId: text().notNull(),
    status: text().$type<LegalNoticeDeliveryStatus>().notNull(),
    attempts: integer({ mode: 'number' }).notNull(),
    lastErrorCode: text(),
    messageId: text(),
    sentAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_legal_notice_deliveries_user_notice')
      .on(table.userId, table.noticeId),
    index('idx_legal_notice_deliveries_notice_status')
      .on(table.noticeId, table.status),
  ],
)
