import { relations } from 'drizzle-orm'
import {
  integer,
  sqliteTable,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { chats } from './chats'
import { files } from './files'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const chatShares = sqliteTable(
  'chat_shares',
  {
    ...defaultSchemaWithPublicId,
    chatId: publicId()
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    revoked: integer({ mode: 'boolean' })
      .notNull()
      .default(false),
    expiresAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_chat_share_chat').on(table.chatId, table.id),
  ],
)

export const chatShareFiles = sqliteTable(
  'chat_share_files',
  {
    ...defaultSchemaWithPublicId,
    chatShareId: publicId()
      .notNull()
      .references(() => chatShares.id, { onDelete: 'cascade' }),
    fileId: publicId()
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
  },
  table => [
    uniqueIndex('uq_chat_share_file').on(table.chatShareId, table.fileId),
  ],
)

export const chatSharesRelations = relations(chatShares, ({ one, many }) => ({
  chat: one(chats, {
    fields: [chatShares.chatId],
    references: [chats.id],
  }),
  files: many(chatShareFiles),
}))

export const chatShareFilesRelations = relations(chatShareFiles, ({ one }) => ({
  share: one(chatShares, {
    fields: [chatShareFiles.chatShareId],
    references: [chatShares.id],
  }),
  file: one(files, {
    fields: [chatShareFiles.fileId],
    references: [files.id],
  }),
}))
