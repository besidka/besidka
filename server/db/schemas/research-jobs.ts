import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { ResearchUsage } from '#shared/types/research.d'
import { sql } from 'drizzle-orm'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { chats } from './chats'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const researchJobs = snakeCase.table(
  'research_jobs',
  {
    ...defaultSchemaWithPublicId,
    chatId: publicId()
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: integer({ mode: 'number' }).notNull(),
    userMessageId: text().notNull(),
    provider: text({ enum: ['openai', 'google'] }).notNull(),
    level: text({ enum: ['quick', 'thorough'] }).notNull(),
    modelId: text().notNull(),
    providerJobId: text(),
    status: text({
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull(),
    error: text({ mode: 'json' }).$type<ChatErrorPayload>(),
    usage: text({ mode: 'json' }).$type<ResearchUsage>(),
    resultMessageId: text(),
    startedAt: integer({ mode: 'timestamp' }),
    completedAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_research_jobs_chat_active')
      .on(table.chatId)
      .where(sql`status in ('pending', 'running')`),
    index('idx_research_jobs_status_created')
      .on(table.status, table.createdAt),
    index('idx_research_jobs_user').on(table.userId),
  ],
)
