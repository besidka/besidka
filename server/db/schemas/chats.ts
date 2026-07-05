import type { UIMessage } from 'ai'
import type { MessageUsage } from '#shared/types/message-usage.d'
import { persistedMessageRoles } from '#shared/utils/chat-message-role'
import { sql } from 'drizzle-orm'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { ulid } from 'ulid'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'
import { projects } from './projects'

export const chats = snakeCase.table(
  'chats',
  {
    ...defaultSchemaWithPublicId,
    slug: text().notNull().unique().$defaultFn(() => ulid()),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().default(''),
    shared: integer({ mode: 'boolean' }),
    branchedFromShareSlug: text(),
    pinnedAt: integer({ mode: 'timestamp' }),
    projectId: publicId().references(() => projects.id, { onDelete: 'set null' }),
    projectMemorySummary: text(),
    projectMemorySummaryUpdatedAt: integer({ mode: 'timestamp' }),
    activityAt: integer({ mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('uq_chat_user').on(table.id, table.userId),
    uniqueIndex('uq_chat_slug').on(table.id, table.slug),
    index('idx_chats_activity_at').on(table.activityAt),
  ],
)

export const messages = snakeCase.table(
  'messages',
  {
    ...defaultSchemaWithPublicId,
    chatId: publicId()
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: text({ enum: persistedMessageRoles }).notNull(),
    parts: text({ mode: 'json' })
      .notNull()
      .$type<UIMessage['parts']>()
      .default(sql`'[]'`),
    tools: text({ mode: 'json' })
      .notNull()
      .$type<Array<'web_search'>>()
      .default(sql`'[]'`),
    reasoning: text({ enum: ['off', 'low', 'medium', 'high'] })
      .notNull()
      .default('off'),
    usage: text({ mode: 'json' }).$type<MessageUsage>(),
    publicId: text('public_id').unique().$defaultFn(() => ulid()),
  }, table => [
    uniqueIndex('uq_message_chat').on(table.id, table.chatId),
  ],
)
