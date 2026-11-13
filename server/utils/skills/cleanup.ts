import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  deleteSkillPrefix,
  skillStagingUserPrefix,
  skillUserPrefix,
} from '~~/server/utils/skills/storage'
import type { SkillBlobBucket } from '~~/server/utils/skills/storage'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90

export interface PurgeUserSkillsResult {
  skillsDeleted: number
  skillVersionsDeleted: number
  skillFilesDeleted: number
  skillChatSettingsDeleted: number
  skillObjectsDeleted: number
  skillStagingObjectsDeleted: number
}

export interface SkillChatCleanupResult {
  rowsDeleted: number
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

/**
 * Chats are deleted: their per-chat skill choices go with them. The table
 * has no foreign key to `chats`, so nothing cascades. Best effort, never
 * throws: a leftover row only names a chat that no longer exists.
 */
export async function cleanupSkillsForDeletedChats(
  db: DbClient,
  input: { userId: number, chatIds: string[], logger: LoggerLike },
): Promise<SkillChatCleanupResult> {
  const result: SkillChatCleanupResult = { rowsDeleted: 0 }

  try {
    for (const chunk of chunkItems(
      [...new Set(input.chatIds)],
      MAX_BATCH_QUERY_PARAMS,
    )) {
      const rows = await db.delete(schema.skillChatSettings)
        .where(and(
          eq(schema.skillChatSettings.userId, input.userId),
          inArray(schema.skillChatSettings.chatPublicId, chunk),
        ))
        .returning({ id: schema.skillChatSettings.id })

      result.rowsDeleted += rows.length
    }
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: {
          cleanup: {
            chatDelete: {
              ...result,
              error: exceptionMessage(exception),
            },
          },
        },
      },
    })

    return result
  }

  if (result.rowsDeleted > 0) {
    input.logger.set({
      attributes: { skills: { cleanup: { chatDelete: result } } },
    })
  }

  return result
}

/**
 * Account deletion. None of the four skills tables has a foreign key to
 * `users`, so the rows are deleted explicitly: first the rows, then the R2
 * prefixes `user-skills/u<userId>/` and `skills-staging/u<userId>/`. A row
 * deleted before its blobs would leave unreachable objects behind if the R2
 * step then failed, but the retry of the account deletion lists the prefix
 * again, so the order loses nothing. Errors are rethrown so the account
 * deletion aborts and stays retryable.
 */
export async function purgeUserSkills(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
  bucket: SkillBlobBucket = useFileStorage(),
): Promise<PurgeUserSkillsResult> {
  const skillChatSettings = await db.delete(schema.skillChatSettings)
    .where(eq(schema.skillChatSettings.userId, userId))
    .returning({ id: schema.skillChatSettings.id })
  const skillFiles = await db.delete(schema.skillFiles)
    .where(eq(schema.skillFiles.userId, userId))
    .returning({ id: schema.skillFiles.id })
  const skillVersions = await db.delete(schema.skillVersions)
    .where(eq(schema.skillVersions.userId, userId))
    .returning({ id: schema.skillVersions.id })
  const skills = await db.delete(schema.skills)
    .where(eq(schema.skills.userId, userId))
    .returning({ id: schema.skills.id })
  const skillObjectsDeleted = await deleteSkillPrefix(
    skillUserPrefix(userId),
    bucket,
  )
  const skillStagingObjectsDeleted = await deleteSkillPrefix(
    skillStagingUserPrefix(userId),
    bucket,
  )
  const result: PurgeUserSkillsResult = {
    skillsDeleted: skills.length,
    skillVersionsDeleted: skillVersions.length,
    skillFilesDeleted: skillFiles.length,
    skillChatSettingsDeleted: skillChatSettings.length,
    skillObjectsDeleted,
    skillStagingObjectsDeleted,
  }

  logger.set({ attributes: { skills: { cleanup: { purge: result } } } })

  return result
}
