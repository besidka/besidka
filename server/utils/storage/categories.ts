import type { SQL } from 'drizzle-orm'
import type { StorageCategoryId } from '#shared/types/files.d'
import {
  and,
  eq,
  gt,
  isNotNull,
  isNull,
  like,
  notLike,
  sql,
} from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { userKnowledgeTextBytesSql } from '~~/server/utils/knowledge/quota'
import {
  userSkillsBytesSql,
  userSkillsCountSql,
} from '~~/server/utils/skills/usage'

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

const skillsCategory: StorageCategoryDefinition = {
  id: 'skills',
  bytesSql: userSkillsBytesSql,
  countSql: userSkillsCountSql,
}

/**
 * Every kind of data that counts against the one storage allowance. The
 * four file categories partition `files` by `source` and `type`, so their
 * sum equals the sum of `files.size`. A new feature adds one entry here and
 * one id to `StorageCategoryId`; the total, the quota guards and the
 * breakdown all derive from this list.
 */
export const STORAGE_CATEGORIES: readonly StorageCategoryDefinition[] = [
  filesCategory('aiImages', and(isGeneratedFile, isImage)),
  filesCategory('uploads', and(
    eq(schema.files.source, 'upload'),
    isNull(schema.files.externalSource),
  )),
  filesCategory('googleDrive', and(
    eq(schema.files.source, 'upload'),
    isNotNull(schema.files.externalSource),
  )),
  filesCategory('generatedFiles', and(isGeneratedFile, notLike(
    schema.files.type,
    'image/%',
  ))),
  filesCategory('connectorImages', eq(schema.files.source, 'connector')),
  artifactsCategory,
  knowledgeCategory,
  skillsCategory,
]
