import type { UIMessage } from 'ai'
import { sql } from 'drizzle-orm'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  indexMessagesForSearch,
  removeMessageRowsFromSearchIndex,
  type SearchIndexLogger,
} from '~~/server/utils/search/index-writer'
import { extractMessageSearchText } from '~~/server/utils/search/text'

const SEARCH_INDEX_SWEEP_CURSOR_KEY = 'search-index:sweep-cursor'

export interface MessageSearchSweepResult {
  backfilledCount: number
  emptyBodyBackfilledCount: number
  garbageCollectedCount: number
  hasMore: boolean
  runtimeMs: number
  nextCursor: number
}

interface BackfillRow {
  messageId: number
  chatId: number
  parts: unknown
  userId: number
}

interface GarbageCollectRow {
  messageId: number
}

export async function sweepMessageSearchIndex(input: {
  batchSize: number
  maxRuntimeMs: number
  logger: SearchIndexLogger
  db?: ReturnType<typeof useDb>
}): Promise<MessageSearchSweepResult> {
  const startedAt = Date.now()
  const batchSize = Math.max(input.batchSize, 1)
  const maxRuntimeMs = Math.max(input.maxRuntimeMs, 1000)
  const db = input.db || useDb()

  let backfilledCount = 0
  let emptyBodyBackfilledCount = 0
  let garbageCollectedCount = 0
  let hasMore = false
  let nextCursor = 0

  try {
    const cursor = await readSweepCursor(input.logger)

    // Anti-join against messages that have NO index row yet — new
    // messages whose write failed, plus the initial historical backfill.
    // This never re-processes an already-indexed message, so a future
    // stemmer change would need a deliberate one-time re-index of
    // existing `body_stem` values; it does not happen automatically here.
    const backfillRows = await db.all<BackfillRow>(sql`
      select
        m.id       as messageId,
        m.chat_id  as chatId,
        m.parts    as parts,
        c.user_id  as userId
      from messages m
      inner join chats c on c.id = m.chat_id
      left join message_search ms on ms.rowid = m.id
      where ms.rowid is null and m.id > ${cursor}
      order by m.id asc
      limit ${batchSize}
    `)

    const rowsByUserId = new Map<number, BackfillRow[]>()

    for (const row of backfillRows) {
      const userRows = rowsByUserId.get(row.userId) || []

      userRows.push(row)
      rowsByUserId.set(row.userId, userRows)
    }

    let timedOut = false

    for (const [userId, userRows] of rowsByUserId) {
      if (Date.now() - startedAt >= maxRuntimeMs) {
        hasMore = true
        timedOut = true

        break
      }

      const parsedMessages = userRows.map((row) => {
        return {
          id: encodePublicId(row.messageId),
          parts: parseBackfillMessageParts(row.parts),
        }
      })

      const result = await indexMessagesForSearch({
        db,
        userId,
        messages: parsedMessages,
        logger: input.logger,
        stage: 'sweeper-backfill',
      })

      backfilledCount += result.indexedCount
      emptyBodyBackfilledCount += parsedMessages.filter((message) => {
        return !extractMessageSearchText(message.parts)
      }).length
    }

    // A timed-out pass must NOT advance the cursor past rows it never
    // attempted: doing so would permanently skip them until the cursor
    // happens to reset to 0 on a later short page. Keeping the cursor
    // unchanged re-fetches the same window next time, which is idempotent
    // because the backfill anti-join re-selects only still-unindexed rows.
    if (timedOut) {
      nextCursor = cursor
    } else {
      const highestMessageId = backfillRows.reduce((highest, row) => {
        return row.messageId > highest ? row.messageId : highest
      }, cursor)

      nextCursor = backfillRows.length < batchSize ? 0 : highestMessageId
    }

    hasMore = hasMore || backfillRows.length === batchSize

    await writeSweepCursor(nextCursor, input.logger)

    if (Date.now() - startedAt < maxRuntimeMs) {
      const garbageRows = await db.all<GarbageCollectRow>(sql`
        select ms.rowid as messageId
        from message_search ms
        left join messages m on m.id = ms.rowid
        where m.id is null
        limit ${batchSize}
      `)

      if (garbageRows.length) {
        const result = await removeMessageRowsFromSearchIndex({
          db,
          messageRowIds: garbageRows.map(row => row.messageId),
          logger: input.logger,
        })

        garbageCollectedCount = result.deletedCount
        hasMore = hasMore || garbageRows.length === batchSize
      }
    }
  } catch (exception) {
    input.logger.set({
      messageSearchSweep: {
        phase: 'sweep-run',
      },
      attributes: {
        messageSearchSweep: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return {
    backfilledCount,
    emptyBodyBackfilledCount,
    garbageCollectedCount,
    hasMore,
    runtimeMs: Date.now() - startedAt,
    nextCursor,
  }
}

/**
 * `db.all(sql\`...\`)` returns the raw driver value for a `mode: 'json'`
 * text column instead of running it through Drizzle's decoder, so `parts`
 * arrives here as a JSON string rather than an already-parsed array.
 */
function parseBackfillMessageParts(parts: unknown): UIMessage['parts'] {
  if (Array.isArray(parts)) {
    return parts as UIMessage['parts']
  }

  if (typeof parts !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(parts)

    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function readSweepCursor(logger: SearchIndexLogger): Promise<number> {
  try {
    const cursorValue = await useKV().get(SEARCH_INDEX_SWEEP_CURSOR_KEY)
    const cursor = Number(cursorValue)

    return Number.isFinite(cursor) && cursor >= 0 ? cursor : 0
  } catch (exception) {
    logger.set({
      messageSearchSweep: {
        phase: 'cursor-read',
      },
      attributes: {
        messageSearchSweep: {
          error: exceptionMessage(exception),
        },
      },
    })

    return 0
  }
}

async function writeSweepCursor(
  cursor: number,
  logger: SearchIndexLogger,
): Promise<void> {
  try {
    await useKV().put(SEARCH_INDEX_SWEEP_CURSOR_KEY, String(cursor))
  } catch (exception) {
    logger.set({
      messageSearchSweep: {
        phase: 'cursor-write',
      },
      attributes: {
        messageSearchSweep: {
          error: exceptionMessage(exception),
        },
      },
    })
  }
}
