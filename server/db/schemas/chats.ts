import type { UIMessage } from 'ai'
import { relations, sql } from 'drizzle-orm'
import {
  sqliteTable, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { ulid } from 'ulid'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'
import { chatShares } from './chat-shares'
import { folders } from './folders'

export const chats = sqliteTable(
  'chats',
  {
    ...defaultSchemaWithPublicId,
    slug: text().notNull().unique().$defaultFn(() => ulid()),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().default(''),
    shared: integer({ mode: 'boolean' }),
    pinnedAt: integer({ mode: 'timestamp' }),
    folderId: publicId().references(() => folders.id, { onDelete: 'set null' }),
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

export const messages = sqliteTable(
  'messages',
  {
    ...defaultSchemaWithPublicId,
    chatId: publicId()
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: text({ enum: ['system', 'user', 'assistant'] }).notNull(),
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
  }, table => [
    uniqueIndex('uq_message_chat').on(table.id, table.chatId),
  ],
)

export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(users, {
    fields: [chats.userId],
    references: [users.id],
  }),
  messages: many(messages),
  shares: many(chatShares),
  folder: one(folders, {
    fields: [chats.folderId],
    references: [folders.id],
  }),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
}))
