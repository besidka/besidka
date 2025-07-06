import { relations, sql } from 'drizzle-orm'
import {
  sqliteTable, text, integer, uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { ulid } from 'ulid'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

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
  },
  table => [
    uniqueIndex('uq_chat_user').on(table.id, table.userId),
    uniqueIndex('uq_chat_slug').on(table.id, table.slug),
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
    content: text().notNull(),
    tools: text({ mode: 'json' })
      .notNull()
      .$type<Array<'web_search'>>()
      .default(sql`'[]'`),
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
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
}))
