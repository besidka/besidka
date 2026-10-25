import type { BatchItem } from 'drizzle-orm/batch'
import { and, eq, inArray, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export const MEMORY_DETACH_STATEMENTS_PER_BATCH = 50
export const MEMORY_DETACH_DELETE_IDS_PER_STATEMENT = 50

export interface MemoryChatDeletionLogger {
  set: (fields: Record<string, unknown>) => void
}

export interface DetachChatsFromMemoryResult {
  deleted: number
  detached: number
}

/**
 * Removes deleted chats from memory provenance. An `extraction` entry whose
 * only remaining source would be the deleted chats is deleted, every other
 * entry that cites a deleted chat just drops the id and keeps its edit time.
 * `user`, `tool` and `import` entries are never deleted, and entries with an
 * empty `sourceChatIds` are never touched. Must run before the chats rows are
 * deleted and must not swallow errors, so a failed cascade aborts the delete.
 */
export async function detachChatsFromMemory(input: {
  db: DbClient
  userId: number
  chatIds: string[]
  logger?: MemoryChatDeletionLogger
}): Promise<DetachChatsFromMemoryResult> {
  const deletedChatIds = new Set(input.chatIds)

  if (deletedChatIds.size === 0) {
    return { deleted: 0, detached: 0 }
  }

  const entries = await input.db
    .select({
      id: schema.memoryEntries.id,
      origin: schema.memoryEntries.origin,
      sourceChatIds: schema.memoryEntries.sourceChatIds,
      updatedAt: schema.memoryEntries.updatedAt,
    })
    .from(schema.memoryEntries)
    .where(and(
      eq(schema.memoryEntries.userId, input.userId),
      sql`json_array_length(${schema.memoryEntries.sourceChatIds}) > 0`,
    ))

  const orphanedEntryIds: string[] = []
  const statements: unknown[] = []

  for (const entry of entries) {
    const remainingChatIds = entry.sourceChatIds.filter((chatId) => {
      return !deletedChatIds.has(chatId)
    })

    if (remainingChatIds.length === entry.sourceChatIds.length) {
      continue
    }

    if (remainingChatIds.length === 0 && entry.origin === 'extraction') {
      orphanedEntryIds.push(entry.id)

      continue
    }

    statements.push(
      input.db
        .update(schema.memoryEntries)
        .set({
          sourceChatIds: remainingChatIds,
          updatedAt: entry.updatedAt,
        })
        .where(and(
          eq(schema.memoryEntries.id, entry.id),
          eq(schema.memoryEntries.userId, input.userId),
        )),
    )
  }

  const detached = statements.length

  for (
    let offset = 0;
    offset < orphanedEntryIds.length;
    offset += MEMORY_DETACH_DELETE_IDS_PER_STATEMENT
  ) {
    statements.push(
      input.db
        .delete(schema.memoryEntries)
        .where(and(
          inArray(
            schema.memoryEntries.id,
            orphanedEntryIds.slice(
              offset,
              offset + MEMORY_DETACH_DELETE_IDS_PER_STATEMENT,
            ),
          ),
          eq(schema.memoryEntries.userId, input.userId),
        )),
    )
  }

  for (
    let offset = 0;
    offset < statements.length;
    offset += MEMORY_DETACH_STATEMENTS_PER_BATCH
  ) {
    await input.db.batch(
      statements.slice(
        offset,
        offset + MEMORY_DETACH_STATEMENTS_PER_BATCH,
      ) as unknown as [BatchItem<'sqlite'>],
    )
  }

  const result = { deleted: orphanedEntryIds.length, detached }

  input.logger?.set({
    attributes: {
      memoryChatDeletion: result,
    },
  })

  return result
}
