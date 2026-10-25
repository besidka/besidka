import type { LoggerLike } from '~~/server/utils/files/logger'
import { sql } from 'drizzle-orm'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  SEARCH_CHATS_CANDIDATE_LIMIT,
  SEARCH_CHATS_DEFAULT_LIMIT,
  SEARCH_CHATS_MAX_RESULTS,
  SEARCH_CHATS_SNIPPET_TOKEN_COUNT,
} from '~~/server/utils/memory/tools/constants'
import {
  buildChatTitle,
  buildSnippetExcerpt,
} from '~~/server/utils/memory/tools/excerpt'
import { safeDecodePublicId } from '~~/server/utils/search/index-writer'
import {
  buildSearchMatchExpression,
  buildSearchOwnerTag,
} from '~~/server/utils/search/query'

export interface SearchChatsHit {
  chatId: string
  title: string
  url: string
  messageId?: string
  role: string
  date: string
  snippet: string
}

export interface SearchChatsResult {
  results: SearchChatsHit[]
}

interface SearchChatsCandidateRow {
  chatSlug: string
  chatTitle: string | null
  messageId: string | null
  role: string
  createdAt: number
  score: number
  snippet: string
}

function buildHitDate(createdAtSeconds: number): string {
  const date = new Date(Number(createdAtSeconds) * 1000)

  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function resolveLimit(limit: number | undefined): number {
  const requestedLimit = limit ?? SEARCH_CHATS_DEFAULT_LIMIT

  return Math.min(
    Math.max(Math.trunc(requestedLimit), 1),
    SEARCH_CHATS_MAX_RESULTS,
  )
}

async function queryCandidateRows(input: {
  db: ReturnType<typeof useDb>
  userId: number
  match: string
  currentChatRowId: number | null
  projectRowId: number | null
}): Promise<SearchChatsCandidateRow[]> {
  const ownerTag = buildSearchOwnerTag(input.userId)
  const excludeCurrentChat = input.currentChatRowId === null
    ? sql``
    : sql`and m.chat_id != ${input.currentChatRowId}`
  const restrictToProject = input.projectRowId === null
    ? sql``
    : sql`and c.project_id = ${input.projectRowId}`

  return await input.db.all<SearchChatsCandidateRow>(sql`
    select
      c.slug as chatSlug,
      c.title as chatTitle,
      m.public_id as messageId,
      m.role as role,
      m.created_at as createdAt,
      bm25(message_search, 0.0, 1.0, 0.4) as score,
      snippet(message_search, 1, ${SNIPPET_START}, ${SNIPPET_END}, ${'…'}, ${SEARCH_CHATS_SNIPPET_TOKEN_COUNT}) as snippet
    from message_search ms
    inner join messages m on m.id = ms.rowid
    inner join chats c on c.id = m.chat_id
    where message_search match ${input.match}
      and ms.owner = ${ownerTag}
      and c.user_id = ${input.userId}
      ${excludeCurrentChat}
      ${restrictToProject}
    order by score asc, ms.rowid desc
    limit ${SEARCH_CHATS_CANDIDATE_LIMIT}
  `)
}

function pickBestHitPerChat(
  rows: SearchChatsCandidateRow[],
  limit: number,
): SearchChatsHit[] {
  const bestRowByChat = new Map<string, SearchChatsCandidateRow>()

  for (const row of rows) {
    const existing = bestRowByChat.get(row.chatSlug)

    if (!existing || row.score < existing.score) {
      bestRowByChat.set(row.chatSlug, row)
    }
  }

  return [...bestRowByChat.values()]
    .sort((first, second) => first.score - second.score)
    .slice(0, limit)
    .map((row) => {
      return {
        chatId: row.chatSlug,
        title: buildChatTitle(row.chatTitle),
        url: `/chats/${row.chatSlug}`,
        ...(row.messageId ? { messageId: row.messageId } : {}),
        role: row.role,
        date: buildHitDate(row.createdAt),
        snippet: buildSnippetExcerpt(row.snippet),
      }
    })
}

/**
 * Searches the user's other chats over the `message_search` FTS5 table. The
 * strict AND expression runs first; only when it finds nothing is the same
 * query retried with OR, bm25-ranked. The current chat exclusion and the
 * optional project scope are joined inside the FTS query, before the
 * candidate LIMIT: filtering the candidates afterwards would give a small
 * project zero hits whenever other chats fill the candidate list. Never
 * throws: a failing query is logged and returns no results.
 */
export async function searchChats(input: {
  db: ReturnType<typeof useDb>
  userId: number
  query: string
  limit?: number
  currentChatId: string
  projectId?: string
  logger?: Pick<LoggerLike, 'set'>
}): Promise<SearchChatsResult> {
  const andExpression = buildSearchMatchExpression(input.query, input.userId)

  if (andExpression.match === null) {
    return { results: [] }
  }

  const projectRowId = input.projectId === undefined
    ? null
    : safeDecodePublicId(input.projectId)

  if (input.projectId !== undefined && projectRowId === null) {
    return { results: [] }
  }

  const limit = resolveLimit(input.limit)
  const currentChatRowId = safeDecodePublicId(input.currentChatId)
  const orExpression = buildSearchMatchExpression(
    input.query,
    input.userId,
    { operator: 'or' },
  )
  const attempts: Array<{ operator: 'and' | 'or', match: string | null }> = [
    { operator: 'and', match: andExpression.match },
  ]

  if (andExpression.tokens.length > 1) {
    attempts.push({ operator: 'or', match: orExpression.match })
  }

  let lastOperator: 'and' | 'or' = 'and'

  try {
    for (const { operator, match } of attempts) {
      if (match === null) {
        continue
      }

      lastOperator = operator

      const rows = await queryCandidateRows({
        db: input.db,
        userId: input.userId,
        match,
        currentChatRowId,
        projectRowId,
      })

      if (rows.length > 0) {
        const results = pickBestHitPerChat(rows, limit)

        input.logger?.set({
          attributes: {
            chatSearch: {
              stage: 'search-chats',
              operator,
              hits: results.length,
            },
          },
        })

        return { results }
      }
    }
  } catch (exception) {
    input.logger?.set({
      attributes: {
        chatSearch: {
          stage: 'search-chats',
          action: 'query-failed',
          error: exceptionMessage(exception),
        },
      },
    })

    return { results: [] }
  }

  input.logger?.set({
    attributes: {
      chatSearch: {
        stage: 'search-chats',
        operator: lastOperator,
        hits: 0,
      },
    },
  })

  return { results: [] }
}
