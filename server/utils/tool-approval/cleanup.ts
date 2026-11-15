import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90

export interface PurgeUserToolApprovalsResult {
  besidkaToolPermissionsDeleted: number
  besidkaChatSettingsDeleted: number
  toolApprovalClaimsDeleted: number
}

export interface ToolApprovalChatCleanupResult {
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
 * Chats are deleted: their per-chat Besidka tool settings and approval claims
 * go with them. Neither table has a foreign key to `chats`, so nothing
 * cascades. Best effort, never throws: a leftover row only names a chat that
 * no longer exists.
 */
export async function cleanupToolApprovalsForDeletedChats(
  db: DbClient,
  input: { userId: number, chatIds: string[], logger: LoggerLike },
): Promise<ToolApprovalChatCleanupResult> {
  const result: ToolApprovalChatCleanupResult = { rowsDeleted: 0 }

  try {
    for (const chunk of chunkItems(
      [...new Set(input.chatIds)],
      MAX_BATCH_QUERY_PARAMS,
    )) {
      const settings = await db.delete(schema.besidkaChatSettings)
        .where(and(
          eq(schema.besidkaChatSettings.userId, input.userId),
          inArray(schema.besidkaChatSettings.chatPublicId, chunk),
        ))
        .returning({ id: schema.besidkaChatSettings.id })
      const claims = await db.delete(schema.toolApprovalClaims)
        .where(and(
          eq(schema.toolApprovalClaims.userId, input.userId),
          inArray(schema.toolApprovalClaims.chatPublicId, chunk),
        ))
        .returning({ id: schema.toolApprovalClaims.approvalId })

      result.rowsDeleted += settings.length + claims.length
    }
  } catch (exception) {
    input.logger.set({
      attributes: {
        toolApprovals: {
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
      attributes: { toolApprovals: { cleanup: { chatDelete: result } } },
    })
  }

  return result
}

/**
 * Account deletion. None of the tool approval tables has a foreign key to
 * `users`, so every user-keyed row is deleted explicitly. Errors are
 * rethrown so the account deletion aborts and stays retryable. The KV
 * records under `tool-approval:` hold no user index and expire by themselves
 * within 24 hours.
 */
export async function purgeUserToolApprovals(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
): Promise<PurgeUserToolApprovalsResult> {
  const permissions = await db.delete(schema.besidkaToolPermissions)
    .where(eq(schema.besidkaToolPermissions.userId, userId))
    .returning({ id: schema.besidkaToolPermissions.id })
  const chatSettings = await db.delete(schema.besidkaChatSettings)
    .where(eq(schema.besidkaChatSettings.userId, userId))
    .returning({ id: schema.besidkaChatSettings.id })
  const claims = await db.delete(schema.toolApprovalClaims)
    .where(eq(schema.toolApprovalClaims.userId, userId))
    .returning({ id: schema.toolApprovalClaims.approvalId })
  const result: PurgeUserToolApprovalsResult = {
    besidkaToolPermissionsDeleted: permissions.length,
    besidkaChatSettingsDeleted: chatSettings.length,
    toolApprovalClaimsDeleted: claims.length,
  }

  logger.set({ attributes: { toolApprovals: { cleanup: { purge: result } } } })

  return result
}
