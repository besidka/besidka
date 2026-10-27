import type { LoggerLike } from '~~/server/utils/files/logger'
import { sql } from 'drizzle-orm'
import { SNIPPET_END, SNIPPET_START } from '#shared/utils/search'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { rerankWithJev } from '~~/server/utils/jev/rerank'
import type { JevRerankModelResolver } from '~~/server/utils/jev/rerank'
import {
  SEARCH_CHATS_CANDIDATE_LIMIT,
  SEARCH_CHATS_DEFAULT_LIMIT,
  SEARCH_CHATS_MAX_RESULTS,
  SEARCH_CHATS_SNIPPET_TOKEN_COUNT,
} from '~~/server/utils/memory/tools/constants'
import {
  buildChatTitle,
  buildSnippetExcerpt,
  collapseWhitespace,
  neutralizeChatText,
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
  excludeForeignShareBranches: boolean
}): Promise<SearchChatsCandidateRow[]> {
  const ownerTag = buildSearchOwnerTag(input.userId)
  const excludeForeignShareBranches = input.excludeForeignShareBranches
    ? sql`and (
      c.branched_from_share_slug is null
      or exists (
        select 1
        from chat_shares s
        inner join chats source_chat on source_chat.id = s.chat_id
        where s.slug = c.branched_from_share_slug
          and source_chat.user_id = c.user_id
      )
    )`
    : sql``
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
      and c.memory_excluded is not 1
      ${excludeCurrentChat}
      ${restrictToProject}
      ${excludeForeignShareBranches}
    order by score asc, ms.rowid desc
    limit ${SEARCH_CHATS_CANDIDATE_LIMIT}
  `)
}

function pickBestRowPerChat(
  rows: SearchChatsCandidateRow[],
): SearchChatsCandidateRow[] {
  const bestRowByChat = new Map<string, SearchChatsCandidateRow>()

  for (const row of rows) {
    const existing = bestRowByChat.get(row.chatSlug)

    if (!existing || row.score < existing.score) {
      bestRowByChat.set(row.chatSlug, row)
    }
  }

  return [...bestRowByChat.values()]
    .sort((first, second) => first.score - second.score)
}

function toHit(row: SearchChatsCandidateRow): SearchChatsHit {
  return {
    chatId: row.chatSlug,
    title: buildChatTitle(row.chatTitle),
    url: `/chats/${row.chatSlug}`,
    ...(row.messageId ? { messageId: row.messageId } : {}),
    role: row.role,
    date: buildHitDate(row.createdAt),
    snippet: buildSnippetExcerpt(row.snippet),
  }
}

function buildRerankPassage(row: SearchChatsCandidateRow): string {
  return collapseWhitespace(neutralizeChatText(row.snippet))
}

async function pickBestHitPerChat(input: {
  rows: SearchChatsCandidateRow[]
  query: string
  limit: number
  resolveRerankModel?: JevRerankModelResolver
  logger?: Pick<LoggerLike, 'set'>
}): Promise<SearchChatsHit[]> {
  const rankedRows = pickBestRowPerChat(input.rows)
  const model = input.resolveRerankModel && rankedRows.length > 1
    ? await input.resolveRerankModel()
    : null
  const orderedRows = await rerankWithJev({
    model,
    query: input.query,
    candidates: rankedRows,
    passageOf: buildRerankPassage,
    keepAtLeast: input.limit,
    logger: input.logger,
  })

  return orderedRows.slice(0, input.limit).map(toHit)
}

/**
 * Searches the user's other chats over the `message_search` FTS5 table. The
 * strict AND expression runs first; only when it finds nothing is the same
 * query retried with OR, bm25-ranked. The current chat exclusion, chats
 * excluded from memory and the optional project scope are joined inside the
 * FTS query, before the
 * candidate LIMIT: filtering the candidates afterwards would give a small
 * project zero hits whenever other chats fill the candidate list. Never
 * throws: a failing query is logged and returns no results. With
 * `resolveRerankModel`, the best hit of each chat is re-ranked by TypeSafe
 * AI Jev before the final slice to `limit`; the relevance cut never leaves
 * fewer than `limit` hits, and any Jev failure keeps the BM25 order. With
 * `excludeForeignShareBranches` (past-chat pre-retrieval), chats branched
 * from another user's share are left out: their copied turns were written
 * by someone else and would be injected without the user asking. A branch
 * whose share no longer exists counts as foreign.
 */
export async function searchChats(input: {
  db: ReturnType<typeof useDb>
  userId: number
  query: string
  limit?: number
  currentChatId: string
  projectId?: string
  excludeForeignShareBranches?: boolean
  resolveRerankModel?: JevRerankModelResolver
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
        excludeForeignShareBranches: input.excludeForeignShareBranches === true,
      })

      if (rows.length > 0) {
        const results = await pickBestHitPerChat({
          rows,
          query: input.query,
          limit,
          resolveRerankModel: input.resolveRerankModel,
          logger: input.logger,
        })

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
