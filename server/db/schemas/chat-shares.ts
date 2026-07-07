import {
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { ulid } from 'ulid'
import { chats } from './chats'
import { files } from './files'
import { defaultSchemaWithPublicId } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const chatShares = snakeCase.table(
  'chat_shares',
  {
    ...defaultSchemaWithPublicId,
    slug: text().$defaultFn(() => ulid()),
    chatId: publicId()
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    revoked: integer({ mode: 'boolean' })
      .notNull()
      .default(false),
    expiresAt: integer({ mode: 'timestamp' }),
    indexable: integer({ mode: 'boolean' })
      .notNull()
      .default(true),
    showFiles: integer({ mode: 'boolean' })
      .notNull()
      .default(true),
    showMetadata: integer({ mode: 'boolean' })
      .notNull()
      .default(true),
    showAuthorAvatar: integer({ mode: 'boolean' })
      .notNull()
      .default(true),
    allowBranch: integer({ mode: 'boolean' })
      .notNull()
      .default(true),
  },
  table => [
    uniqueIndex('uq_chat_share_chat').on(table.chatId, table.id),
    uniqueIndex('uq_chat_share_slug').on(table.slug),
    uniqueIndex('uq_chat_share_chat_id').on(table.chatId),
  ],
)

export const chatShareFiles = snakeCase.table(
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
