import type { DocumentStats } from '#shared/utils/documents'
import {
  DOCUMENT_CREATED_VIA,
  DOCUMENT_FORMATS,
  DOCUMENT_RENDERED_BY,
  DOCUMENT_STATUSES,
} from '#shared/utils/documents'
import {
  snakeCase, text, integer, index,
} from 'drizzle-orm/sqlite-core'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const documents = snakeCase.table(
  'documents',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' }).notNull(),
    originChatId: publicId(),
    originMessageId: integer({ mode: 'number' }),
    originMessagePublicId: text(),
    format: text({ enum: DOCUMENT_FORMATS }).notNull(),
    title: text(),
    specR2Key: text('spec_r2_key'),
    specVersion: integer({ mode: 'number' }),
    specBytes: integer({ mode: 'number' }),
    stats: text({ mode: 'json' }).$type<DocumentStats>(),
    status: text({ enum: DOCUMENT_STATUSES }).notNull(),
    renderLeaseUntil: integer({ mode: 'timestamp' }),
    renderAttempts: integer({ mode: 'number' })
      .notNull()
      .$defaultFn(() => 0),
    fileId: publicId(),
    renderedBy: text({ enum: DOCUMENT_RENDERED_BY }),
    errorCode: text(),
    createdVia: text({ enum: DOCUMENT_CREATED_VIA }).notNull(),
    originProvider: text(),
    originModel: text(),
  },
  table => [
    index('idx_documents_user_updated').on(table.userId, table.updatedAt),
    index('idx_documents_chat').on(table.originChatId),
    index('idx_documents_file').on(table.fileId),
  ],
)
