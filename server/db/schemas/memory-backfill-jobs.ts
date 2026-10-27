import { sql } from 'drizzle-orm'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const memoryBackfillStatuses = [
  'running',
  'completed',
  'cancelled',
  'failed',
] as const

export const memoryBackfillModelSources = [
  'setting',
  'chat',
  'fallback',
] as const

export const memoryBackfillFailureReasons = [
  'model-unavailable',
  'spend-limit',
  'too-many-failures',
  'consecutive-failures',
] as const

export const memoryBackfillJobs = snakeCase.table(
  'memory_backfill_jobs',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text({ enum: memoryBackfillStatuses }).notNull(),
    finishedAt: integer({ mode: 'timestamp' }),
    totalChats: integer({ mode: 'number' }).notNull(),
    processedChats: integer({ mode: 'number' }).notNull(),
    createdEntries: integer({ mode: 'number' }).notNull(),
    updatedEntries: integer({ mode: 'number' }).notNull(),
    skippedChats: integer({ mode: 'number' }).notNull(),
    failedChats: integer({ mode: 'number' }).notNull(),
    consecutiveFailures: integer({ mode: 'number' }).notNull(),
    inputTokens: integer({ mode: 'number' }).notNull(),
    outputTokens: integer({ mode: 'number' }).notNull(),
    failureReason: text({ enum: memoryBackfillFailureReasons }),
    dropped: text({ mode: 'json' }).$type<Record<string, number>>(),
    modelSource: text({ enum: memoryBackfillModelSources }),
    modelProviderId: text(),
    modelGatewayId: text(),
    modelId: text(),
    estimate: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    createdBefore: integer({ mode: 'timestamp' }).notNull(),
    cursorActivityAt: integer({ mode: 'timestamp' }),
    cursorChatId: publicId(),
    retriedChatId: publicId(),
    chatAttempts: integer({ mode: 'number' }).notNull(),
    leaseUntil: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_memory_backfill_jobs_user_running')
      .on(table.userId)
      .where(sql`status = 'running'`),
    index('idx_memory_backfill_jobs_user_created')
      .on(table.userId, table.createdAt),
  ],
)
