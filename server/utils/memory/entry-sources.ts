import { and, eq, inArray } from 'drizzle-orm'
import type { MemoryEntrySourceChat } from '#shared/types/memory-api.d'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'

type DbClient = ReturnType<typeof useDb>

function isDecodablePublicId(publicId: string): boolean {
  try {
    return Number.isInteger(decodePublicId(publicId))
  } catch {
    return false
  }
}

export async function resolveMemoryEntrySourceChats(options: {
  db: DbClient
  userId: number
  sourceChatIds: string[]
}): Promise<MemoryEntrySourceChat[]> {
  const requestedIds = [...new Set(options.sourceChatIds)]
    .slice(0, MEMORY_LIMITS.maxSourceChatIds)
    .filter(isDecodablePublicId)

  if (requestedIds.length === 0) {
    return []
  }

  const rows = await options.db
    .select({
      id: schema.chats.id,
      slug: schema.chats.slug,
      title: schema.chats.title,
    })
    .from(schema.chats)
    .where(and(
      eq(schema.chats.userId, options.userId),
      inArray(schema.chats.id, requestedIds),
    ))

  const chatsById = new Map(rows.map((row) => {
    return [row.id, {
      id: row.id,
      slug: row.slug,
      title: row.title ?? '',
    }]
  }))

  return requestedIds.flatMap((chatId) => {
    const chat = chatsById.get(chatId)

    return chat ? [chat] : []
  })
}
