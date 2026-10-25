import {
  knowledgeExtractors,
  knowledgeExtractStatuses,
  knowledgeItemKinds,
} from '#shared/utils/project-knowledge-policy'
import { sql } from 'drizzle-orm'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { users } from './auth'
import { projects } from './projects'
import { files } from './files'
import { defaultSchemaWithPublicId } from '../../utils/schema'

export const projectKnowledgeItems = snakeCase.table(
  'project_knowledge_items',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: integer({ mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text({ enum: knowledgeItemKinds }).notNull(),
    fileId: integer({ mode: 'number' })
      .references(() => files.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    relativePath: text(),
    folderId: text(),
    mediaType: text(),
    sizeBytes: integer({ mode: 'number' }),
    pageCount: integer({ mode: 'number' }),
    contentHash: text(),
    textBytes: integer({ mode: 'number' }).notNull(),
    latinChars: integer({ mode: 'number' }).notNull(),
    cyrillicChars: integer({ mode: 'number' }).notNull(),
    otherChars: integer({ mode: 'number' }).notNull(),
    extractStatus: text({ enum: knowledgeExtractStatuses }).notNull(),
    extractError: text(),
    extractor: text({ enum: knowledgeExtractors }).notNull(),
    sendAsNativePdf: integer({ mode: 'boolean' }),
    pinned: integer({ mode: 'boolean' }),
  },
  table => [
    uniqueIndex('uq_project_knowledge_items_project_hash')
      .on(table.projectId, table.contentHash)
      .where(sql`content_hash is not null`),
    uniqueIndex('uq_project_knowledge_items_project_file')
      .on(table.projectId, table.fileId)
      .where(sql`file_id is not null`),
    index('idx_project_knowledge_items_user_project')
      .on(table.userId, table.projectId),
    index('idx_project_knowledge_items_file').on(table.fileId),
  ],
)
