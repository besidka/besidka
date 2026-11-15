import { and, desc, eq, inArray } from 'drizzle-orm'
import type { KVNamespace } from '@cloudflare/workers-types'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  deleteToolApprovalChatRecords,
  isWellFormedToolApprovalSubjectId,
} from '~~/server/utils/tool-approval/kv'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90
const PURGE_CHAT_INDEX_MAX_CHATS = 200

export interface PurgeUserToolApprovalsResult {
  besidkaToolPermissionsDeleted: number
  besidkaChatSettingsDeleted: number
  toolApprovalClaimsDeleted: number
}

export interface ToolApprovalChatCleanupResult {
  rowsDeleted: number
  kvKeysDeleted: number
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

async function deleteChatKvRecords(
  kv: KVNamespace,
  chatIds: string[],
): Promise<number> {
  let keysDeleted = 0

  for (const chatId of chatIds) {
    if (!isWellFormedToolApprovalSubjectId(chatId)) {
      continue
    }

    keysDeleted += (await deleteToolApprovalChatRecords(kv, chatId))
      .keysDeleted
  }

  return keysDeleted
}

/**
 * Chats are deleted: their per-chat Besidka tool settings and approval claims
 * go with them, and so do the approval records in KV that the per-chat index
 * `tool-approval:chat:<chatPublicId>` lists (pending, turn and result keys).
 * Neither table has a foreign key to `chats`, so nothing cascades. Best
 * effort, never throws: the D1 part and the KV part fail independently, and
 * a leftover row or key only names a chat that no longer exists. A key the
 * index lost (its bound, a write race) expires within 24 hours.
 */
export async function cleanupToolApprovalsForDeletedChats(
  db: DbClient,
  input: {
    userId: number
    chatIds: string[]
    logger: LoggerLike
    kv?: KVNamespace
  },
): Promise<ToolApprovalChatCleanupResult> {
  const result: ToolApprovalChatCleanupResult = {
    rowsDeleted: 0,
    kvKeysDeleted: 0,
  }
  const chatIds = [...new Set(input.chatIds)]
  const errors: string[] = []

  try {
    for (const chunk of chunkItems(chatIds, MAX_BATCH_QUERY_PARAMS)) {
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
    errors.push(exceptionMessage(exception))
  }

  if (chatIds.length > 0) {
    try {
      result.kvKeysDeleted = await deleteChatKvRecords(
        input.kv ?? useKV(),
        chatIds,
      )
    } catch (exception) {
      errors.push(exceptionMessage(exception))
    }
  }

  if (errors.length > 0) {
    input.logger.set({
      attributes: {
        toolApprovals: {
          cleanup: {
            chatDelete: { ...result, error: errors.join('; ') },
          },
        },
      },
    })

    return result
  }

  if (result.rowsDeleted > 0 || result.kvKeysDeleted > 0) {
    input.logger.set({
      attributes: { toolApprovals: { cleanup: { chatDelete: result } } },
    })
  }

  return result
}

/**
 * Account deletion. None of the tool approval tables has a foreign key to
 * `users`, so every user-keyed row is deleted explicitly. Errors are
 * rethrown so the account deletion aborts and stays retryable.
 *
 * The approval records in KV are deleted through the per-chat index of each
 * of the user's 200 most recently updated chats (the purge does not list
 * chats itself, so this selects their public ids; the `users` row and its
 * cascade are still there). A user with more chats than that, a key the
 * index lost to its bound or a write race, and a chat that was already
 * deleted keep their keys until the 24 hour TTL; the records name only ids
 * and tool inputs the user approved, and no row points back to the account.
 */
export async function purgeUserToolApprovals(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
  kv: KVNamespace = useKV(),
): Promise<PurgeUserToolApprovalsResult> {
  const recentChats = await db.select({ id: schema.chats.id })
    .from(schema.chats)
    .where(eq(schema.chats.userId, userId))
    .orderBy(desc(schema.chats.updatedAt))
    .limit(PURGE_CHAT_INDEX_MAX_CHATS)
  const kvKeysDeleted = await deleteChatKvRecords(
    kv,
    recentChats.map(chat => chat.id),
  )
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

  logger.set({
    attributes: {
      toolApprovals: { cleanup: { purge: { ...result, kvKeysDeleted } } },
    },
  })

  return result
}
