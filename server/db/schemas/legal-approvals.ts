import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import {
  defaultSchema,
  defaultSchemaCreatedAtOnly,
  defaultSchemaIdOnly,
} from '../../utils/schema'

export const LEGAL_NOTICE_OPT_OUT_SOURCES = [
  'admin',
] as const

export type LegalNoticeOptOutSource
  = typeof LEGAL_NOTICE_OPT_OUT_SOURCES[number]

export const legalNoticeApprovals = snakeCase.table(
  'legal_notice_approvals',
  {
    ...defaultSchema,
    noticeId: text().notNull(),
    noticeHash: text().notNull(),
    recipientEstimate: integer({ mode: 'number' }).notNull(),
    approvedBy: integer({ mode: 'number' }),
    approvedAt: integer({ mode: 'timestamp' }).notNull(),
    withdrawnBy: integer({ mode: 'number' }),
    withdrawnAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_legal_notice_approvals_active')
      .on(table.noticeId)
      .where(sql`withdrawn_at is null`),
    index('idx_legal_notice_approvals_notice')
      .on(table.noticeId, table.approvedAt),
  ],
)

export const legalConsentVersionApprovals = snakeCase.table(
  'legal_consent_version_approvals',
  {
    ...defaultSchemaIdOnly,
    version: text().notNull(),
    consentTextSha256: text().notNull(),
    approvedBy: integer({ mode: 'number' }),
    approvedAt: integer({ mode: 'timestamp' }).notNull(),
    ...defaultSchemaCreatedAtOnly,
  },
)

export const legalNoticeEmailOptOuts = snakeCase.table(
  'legal_notice_email_optouts',
  {
    ...defaultSchemaIdOnly,
    userId: integer({ mode: 'number' }).notNull(),
    source: text({ enum: LEGAL_NOTICE_OPT_OUT_SOURCES }).notNull(),
    createdBy: integer({ mode: 'number' }),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    uniqueIndex('uq_legal_notice_email_optouts_user').on(table.userId),
  ],
)
