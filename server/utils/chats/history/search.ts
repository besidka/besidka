import { sql } from 'drizzle-orm'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { buildSearchMatchExpression, buildSearchOwnerTag } from '~~/server/utils/search/query'

export const SEARCH_CANDIDATE_MESSAGE_LIMIT = 200
export const MAX_SEARCH_RESULTS = 200
export const SNIPPET_TOKEN_COUNT = 12

export interface ContentSearchHit {
  chatId: string
  messageRowId: number
  score: number
  snippet: string
}

interface ContentSearchCandidateRow {
  chatId: number
  messageRowId: number
  score: number
  snippet: string
}

/**
 * Runs the FTS5 leg. Returns [] when the match expression is empty or on
 * any failure (best-effort — content search must never 500 the page).
 */
export async function findChatsMatchingMessageContent(input: {
  db: ReturnType<typeof useDb>
  userId: number
  search: string
  limit?: number
  logger?: { set: (fields: Record<string, unknown>) => void }
}): Promise<ContentSearchHit[]> {
  const { match } = buildSearchMatchExpression(input.search, input.userId)

  if (match === null) {
    return []
  }

  const ownerTag = buildSearchOwnerTag(input.userId)
  const limit = input.limit ?? SEARCH_CANDIDATE_MESSAGE_LIMIT

  try {
    const rows = await input.db.all<ContentSearchCandidateRow>(sql`
      select
        m.chat_id  as chatId,
        ms.rowid   as messageRowId,
        bm25(message_search, 0.0, 1.0, 0.4) as score,
        snippet(message_search, 1, ${SNIPPET_START}, ${SNIPPET_END}, ${'…'}, ${SNIPPET_TOKEN_COUNT}) as snippet
      from message_search ms
      inner join messages m on m.id = ms.rowid
      inner join chats c on c.id = m.chat_id
      where message_search match ${match}
        and ms.owner = ${ownerTag}
        and c.user_id = ${input.userId}
      order by score asc, ms.rowid desc
      limit ${limit}
    `)

    const bestByChat = new Map<number, {
      messageRowId: number
      score: number
      snippet: string
    }>()

    for (const row of rows) {
      const existing = bestByChat.get(row.chatId)

      if (!existing || row.score < existing.score) {
        bestByChat.set(row.chatId, {
          messageRowId: row.messageRowId,
          score: row.score,
          snippet: row.snippet,
        })
      }
    }

    return [...bestByChat.entries()].map(([chatId, hit]) => {
      return {
        chatId: encodePublicId(chatId),
        messageRowId: hit.messageRowId,
        score: hit.score,
        snippet: hit.snippet,
      }
    })
  } catch (exception) {
    input.logger?.set({
      messageSearchContent: {
        stage: 'find-chats-matching-message-content',
        action: 'query-failed',
        userId: input.userId,
      },
      attributes: {
        messageSearchContent: {
          error: exceptionMessage(exception),
        },
      },
    })

    return []
  }
}
