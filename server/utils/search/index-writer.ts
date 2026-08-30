import type { UIMessage } from 'ai'
import { sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { buildSearchOwnerTag } from '~~/server/utils/search/query'
import { extractMessageSearchText } from '~~/server/utils/search/text'
import { buildStemmedSearchText } from '~~/server/utils/search/tokens'

/** 4 bound params per row; 20 * 4 = 80, under D1's ~100 ceiling.
 *  Mirrors MAX_BATCH_QUERY_PARAMS = 90 in server/utils/chats/share.ts. */
export const SEARCH_INDEX_ROWS_PER_STATEMENT = 20
export const SEARCH_DELETE_IDS_PER_STATEMENT = 90

export interface SearchIndexableMessage {
  id: string
  parts: UIMessage['parts']
}

export interface SearchIndexLogger {
  set: (fields: Record<string, unknown>) => void
}

interface SearchIndexRow {
  rowid: number
  owner: string
  body: string
  bodyStem: string
}

function safeDecodePublicId(publicId: string): number | null {
  try {
    const decoded = decodePublicId(publicId)

    return Number.isFinite(decoded) && decoded > 0 ? decoded : null
  } catch {
    return null
  }
}

/**
 * Best-effort. NEVER throws. Returns counts for logging only.
 */
export async function indexMessagesForSearch(input: {
  db: ReturnType<typeof useDb>
  userId: number
  messages: SearchIndexableMessage[]
  logger?: SearchIndexLogger
  stage?: string
}): Promise<{ indexedCount: number, failedCount: number }> {
  let indexedCount = 0
  let failedCount = 0

  try {
    const owner = buildSearchOwnerTag(input.userId)
    const rows: SearchIndexRow[] = []

    for (const message of input.messages) {
      const rowid = safeDecodePublicId(message.id)

      if (rowid === null) {
        continue
      }

      const body = extractMessageSearchText(message.parts)
      const bodyStem = buildStemmedSearchText(body)

      rows.push({
        rowid, owner, body, bodyStem,
      })
    }

    for (
      let offset = 0;
      offset < rows.length;
      offset += SEARCH_INDEX_ROWS_PER_STATEMENT
    ) {
      const chunk = rows.slice(
        offset,
        offset + SEARCH_INDEX_ROWS_PER_STATEMENT,
      )

      try {
        await input.db.run(sql`
          insert or replace into message_search(rowid, owner, body, body_stem)
          values ${sql.join(
            chunk.map((row) => {
              return sql`(${row.rowid}, ${row.owner}, ${row.body}, ${row.bodyStem})`
            }),
            sql`, `,
          )}
        `)

        indexedCount += chunk.length
      } catch (exception) {
        failedCount += chunk.length
        input.logger?.set({
          messageSearchIndex: {
            stage: input.stage || 'index-messages',
            action: 'insert-failed',
            chunkSize: chunk.length,
            userId: input.userId,
          },
          attributes: {
            messageSearchIndex: {
              error: exceptionMessage(exception),
            },
          },
        })
      }
    }
  } catch (exception) {
    failedCount += input.messages.length - indexedCount - failedCount
    input.logger?.set({
      messageSearchIndex: {
        stage: input.stage || 'index-messages',
        action: 'index-failed',
        userId: input.userId,
      },
      attributes: {
        messageSearchIndex: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return { indexedCount, failedCount }
}

/**
 * Best-effort. NEVER throws. MUST be called BEFORE the chats rows are
 * deleted, because the cascade removes the messages rows this resolves.
 *
 * `chatIds` are decoded to raw integers before binding: a raw `sql`
 * template interpolates a Column as its identifier, not through the
 * `publicId` custom type's `toDriver`, so hashid strings would otherwise
 * bind as literal text and match nothing. This is the single most common
 * bug source in this feature.
 */
export async function removeChatsFromSearchIndex(input: {
  db: ReturnType<typeof useDb>
  userId: number
  chatIds: string[]
  logger?: SearchIndexLogger
  stage?: string
}): Promise<{ deletedCount: number, failed: boolean }> {
  let deletedCount = 0
  let failed = false

  try {
    const decodedChatIds = input.chatIds
      .map(safeDecodePublicId)
      .filter((chatId): chatId is number => chatId !== null)

    for (
      let offset = 0;
      offset < decodedChatIds.length;
      offset += SEARCH_DELETE_IDS_PER_STATEMENT
    ) {
      const chunk = decodedChatIds.slice(
        offset,
        offset + SEARCH_DELETE_IDS_PER_STATEMENT,
      )

      try {
        await input.db.run(sql`
          delete from message_search
          where rowid in (
            select ${schema.messages.id} from ${schema.messages}
            inner join ${schema.chats} on ${schema.chats.id} = ${schema.messages.chatId}
            where ${schema.chats.userId} = ${input.userId}
              and ${schema.messages.chatId} in ${chunk}
          )
        `)

        deletedCount += chunk.length
      } catch (exception) {
        failed = true
        input.logger?.set({
          messageSearchIndex: {
            stage: input.stage || 'remove-chats',
            action: 'delete-failed',
            chunkSize: chunk.length,
            userId: input.userId,
          },
          attributes: {
            messageSearchIndex: {
              error: exceptionMessage(exception),
            },
          },
        })
      }
    }
  } catch (exception) {
    failed = true
    input.logger?.set({
      messageSearchIndex: {
        stage: input.stage || 'remove-chats',
        action: 'remove-chats-failed',
        userId: input.userId,
      },
      attributes: {
        messageSearchIndex: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return { deletedCount, failed }
}

/** Best-effort. NEVER throws. Used by the sweeper's GC pass. */
export async function removeMessageRowsFromSearchIndex(input: {
  db: ReturnType<typeof useDb>
  messageRowIds: number[]
  logger?: SearchIndexLogger
}): Promise<{ deletedCount: number, failed: boolean }> {
  let deletedCount = 0
  let failed = false

  try {
    for (
      let offset = 0;
      offset < input.messageRowIds.length;
      offset += SEARCH_DELETE_IDS_PER_STATEMENT
    ) {
      const chunk = input.messageRowIds.slice(
        offset,
        offset + SEARCH_DELETE_IDS_PER_STATEMENT,
      )

      try {
        await input.db.run(sql`
          delete from message_search where rowid in ${chunk}
        `)

        deletedCount += chunk.length
      } catch (exception) {
        failed = true
        input.logger?.set({
          messageSearchIndex: {
            stage: 'sweeper-gc',
            action: 'delete-failed',
            chunkSize: chunk.length,
          },
          attributes: {
            messageSearchIndex: {
              error: exceptionMessage(exception),
            },
          },
        })
      }
    }
  } catch (exception) {
    failed = true
    input.logger?.set({
      messageSearchIndex: {
        stage: 'sweeper-gc',
        action: 'gc-failed',
      },
      attributes: {
        messageSearchIndex: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return { deletedCount, failed }
}
