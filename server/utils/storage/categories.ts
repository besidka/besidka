import type { SQL } from 'drizzle-orm'
import type { StorageCategoryId } from '#shared/types/files.d'
import { and, eq, gt, like, notLike, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { userKnowledgeTextBytesSql } from '~~/server/utils/knowledge/quota'

export interface StorageCategoryDefinition {
  id: StorageCategoryId
  bytesSql: (userId: number) => SQL<number>
  countSql: (userId: number) => SQL<number>
}

function userFilesSql(
  userId: number,
  select: SQL,
  condition: SQL | undefined,
): SQL<number> {
  return sql<number>`(
    select ${select} from ${schema.files}
    where ${and(eq(schema.files.userId, userId), condition)}
  )`
}

function filesCategory(
  id: StorageCategoryId,
  condition: SQL | undefined,
): StorageCategoryDefinition {
  return {
    id,
    bytesSql: (userId) => {
      return userFilesSql(
        userId,
        sql`coalesce(sum(${schema.files.size}), 0)`,
        condition,
      )
    },
    countSql: (userId) => {
      return userFilesSql(userId, sql`count(*)`, condition)
    },
  }
}

const isGeneratedFile = eq(schema.files.source, 'assistant')
const isImage = like(schema.files.type, 'image/%')

const artifactsCategory: StorageCategoryDefinition = {
  id: 'artifacts',
  bytesSql: (userId) => {
    return sql<number>`(
      select coalesce(sum(${schema.artifacts.totalBytes}), 0)
      from ${schema.artifacts}
      where ${eq(schema.artifacts.userId, userId)}
    )`
  },
  countSql: (userId) => {
    return sql<number>`(
      select count(*) from ${schema.artifacts}
      where ${and(
        eq(schema.artifacts.userId, userId),
        gt(schema.artifacts.currentVersion, 0),
      )}
    )`
  },
}

const knowledgeCategory: StorageCategoryDefinition = {
  id: 'knowledge',
  bytesSql: userKnowledgeTextBytesSql,
  countSql: (userId) => {
    return sql<number>`(
      select count(*) from ${schema.projectKnowledgeItems}
      where ${eq(schema.projectKnowledgeItems.userId, userId)}
    )`
  },
}

/**
 * Every kind of data that counts against the one storage allowance. The
 * three file categories partition `files` by `source` and `type`, so their
 * sum equals the sum of `files.size`. A later feature (skills) adds one
 * entry here and one id to `StorageCategoryId`; the total, the quota guards
 * and the breakdown all derive from this list.
 */
export const STORAGE_CATEGORIES: readonly StorageCategoryDefinition[] = [
  filesCategory('aiImages', and(isGeneratedFile, isImage)),
  filesCategory('uploads', eq(schema.files.source, 'upload')),
  filesCategory('generatedFiles', and(isGeneratedFile, notLike(
    schema.files.type,
    'image/%',
  ))),
  artifactsCategory,
  knowledgeCategory,
]
