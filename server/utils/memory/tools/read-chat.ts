import type { UIMessage } from 'ai'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createError } from 'evlog'
import { parsePersistedChatFailureNotice } from '#shared/utils/chat-failure-text'
import {
  READ_CHAT_CONTINUATION_PREFIX,
  READ_CHAT_MAX_CHARS,
  READ_CHAT_MESSAGE_MAX_CHARS,
  READ_CHAT_NEIGHBOR_MESSAGES,
  READ_CHAT_TRUNCATION_MARKER,
} from '~~/server/utils/memory/tools/constants'
import {
  buildChatTitle,
  neutralizeChatText,
  truncateText,
  wrapChatExcerpt,
} from '~~/server/utils/memory/tools/excerpt'

export interface ReadChatMessage {
  messageId?: string
  role: string
  date: string
  text: string
}

export interface ReadChatResult {
  chat: {
    chatId: string
    title: string
    url: string
  }
  messages: ReadChatMessage[]
  truncated: boolean
  nextAroundMessageId?: string
}

export interface ReadChatWindow {
  startIndex: number
  endIndex: number
}

const CHAT_NOT_FOUND_MESSAGE = 'Chat not found.'
const CURRENT_CHAT_MESSAGE = 'This is the current chat, which is already in '
  + 'your context.'

function buildChatNotFoundError() {
  return createError({
    message: CHAT_NOT_FOUND_MESSAGE,
    status: 404,
    why: 'No chat with this id is available in the user\'s chat history.',
    fix: 'Use a chatId returned by search_chats.',
  })
}

function buildCurrentChatError() {
  return createError({
    message: CURRENT_CHAT_MESSAGE,
    status: 404,
    why: 'read_chat only opens other chats.',
    fix: 'Answer from the conversation you already have.',
  })
}

function extractMessageText(parts: UIMessage['parts']): string {
  if (!Array.isArray(parts)) {
    return ''
  }

  const values: string[] = []

  for (const part of parts) {
    if (part.type !== 'text' || !part.text?.trim()) {
      continue
    }

    if (parsePersistedChatFailureNotice(part.text)) {
      continue
    }

    values.push(part.text.trim())
  }

  return neutralizeChatText(values.join('\n\n'))
}

function capMessageText(text: string): string {
  if (text.length <= READ_CHAT_MESSAGE_MAX_CHARS) {
    return text
  }

  return truncateText(text, READ_CHAT_MESSAGE_MAX_CHARS)
    + READ_CHAT_TRUNCATION_MARKER
}

function parseAroundMessageId(value: string | undefined): {
  messageId: string
  isContinuation: boolean
} | undefined {
  if (!value) {
    return undefined
  }

  if (value.startsWith(READ_CHAT_CONTINUATION_PREFIX)) {
    return {
      messageId: value.slice(READ_CHAT_CONTINUATION_PREFIX.length),
      isContinuation: true,
    }
  }

  return { messageId: value, isContinuation: false }
}

/**
 * Picks the contiguous run of messages that is returned: the anchor is
 * always included, then the window grows outward, alternating before and
 * after, while the total text length stays within `maxChars`. A side whose
 * next message does not fit is closed for good, because the window must
 * stay contiguous.
 */
export function selectReadChatWindow(
  messages: Array<{ text: string }>,
  anchorIndex: number,
  maxChars: number = READ_CHAT_MAX_CHARS,
): ReadChatWindow {
  if (messages.length === 0) {
    return { startIndex: 0, endIndex: 0 }
  }

  const safeAnchorIndex = Math.min(
    Math.max(anchorIndex, 0),
    messages.length - 1,
  )
  let startIndex = safeAnchorIndex
  let endIndex = safeAnchorIndex + 1
  let totalChars = messages[safeAnchorIndex]!.text.length
  let isBeforeOpen = true
  let isAfterOpen = true

  while (isBeforeOpen || isAfterOpen) {
    if (isBeforeOpen) {
      const previousLength = messages[startIndex - 1]?.text.length

      if (
        previousLength !== undefined
        && totalChars + previousLength <= maxChars
      ) {
        startIndex -= 1
        totalChars += previousLength
      } else {
        isBeforeOpen = false
      }
    }

    if (isAfterOpen) {
      const nextLength = messages[endIndex]?.text.length

      if (nextLength !== undefined && totalChars + nextLength <= maxChars) {
        endIndex += 1
        totalChars += nextLength
      } else {
        isAfterOpen = false
      }
    }
  }

  return { startIndex, endIndex }
}

interface ReadChatMessageRow {
  id: string
  publicId: string | null
  role: string
  parts: UIMessage['parts']
  createdAt: Date
}

interface ReadChatCandidate extends ReadChatMessage {
  rowId: string
}

interface ReadChatRowWindow {
  beforeRows: ReadChatMessageRow[]
  afterRows: ReadChatMessageRow[]
  hasMoreBeforeFetched: boolean
  hasMoreAfterFetched: boolean
}

const MESSAGE_COLUMNS = {
  id: true,
  publicId: true,
  role: true,
  parts: true,
  createdAt: true,
} as const

function toWrappedCandidates(rows: ReadChatMessageRow[]): ReadChatCandidate[] {
  const candidates: ReadChatCandidate[] = []

  for (const row of rows) {
    const text = capMessageText(extractMessageText(row.parts))

    if (text.length === 0) {
      continue
    }

    candidates.push({
      rowId: row.id,
      ...(row.publicId ? { messageId: row.publicId } : {}),
      role: row.role,
      date: row.createdAt.toISOString(),
      text: wrapChatExcerpt(text),
    })
  }

  return candidates
}

function toReadChatMessage(candidate: ReadChatCandidate): ReadChatMessage {
  return {
    ...(candidate.messageId ? { messageId: candidate.messageId } : {}),
    role: candidate.role,
    date: candidate.date,
    text: candidate.text,
  }
}

async function loadRowsAroundAnchor(
  db: ReturnType<typeof useDb>,
  chatRowId: string,
  anchorRowId: string,
): Promise<ReadChatRowWindow> {
  const descendingRows = await db.query.messages.findMany({
    where: { chatId: chatRowId, id: { lte: anchorRowId } },
    columns: MESSAGE_COLUMNS,
    orderBy: { id: 'desc' },
    limit: READ_CHAT_NEIGHBOR_MESSAGES + 2,
  })
  const ascendingRows = await db.query.messages.findMany({
    where: { chatId: chatRowId, id: { gt: anchorRowId } },
    columns: MESSAGE_COLUMNS,
    orderBy: { id: 'asc' },
    limit: READ_CHAT_NEIGHBOR_MESSAGES + 1,
  })

  return {
    beforeRows: descendingRows
      .slice(0, READ_CHAT_NEIGHBOR_MESSAGES + 1)
      .reverse(),
    afterRows: ascendingRows.slice(0, READ_CHAT_NEIGHBOR_MESSAGES),
    hasMoreBeforeFetched: descendingRows.length
      > READ_CHAT_NEIGHBOR_MESSAGES + 1,
    hasMoreAfterFetched: ascendingRows.length > READ_CHAT_NEIGHBOR_MESSAGES,
  }
}

async function loadRowsForward(
  db: ReturnType<typeof useDb>,
  chatRowId: string,
  startRowId?: string,
): Promise<ReadChatRowWindow> {
  const startRowCount = READ_CHAT_NEIGHBOR_MESSAGES * 2
  const startRows = await db.query.messages.findMany({
    where: startRowId === undefined
      ? { chatId: chatRowId }
      : { chatId: chatRowId, id: { gte: startRowId } },
    columns: MESSAGE_COLUMNS,
    orderBy: { id: 'asc' },
    limit: startRowCount + 1,
  })
  const earlierRow = startRowId === undefined
    ? undefined
    : await db.query.messages.findFirst({
      where: { chatId: chatRowId, id: { lt: startRowId } },
      columns: { id: true },
    })

  return {
    beforeRows: [],
    afterRows: startRows.slice(0, startRowCount),
    hasMoreBeforeFetched: earlierRow !== undefined,
    hasMoreAfterFetched: startRows.length > startRowCount,
  }
}

/**
 * Finds the cursor for the next call: the first message after the returned
 * window that carries a `publicId`. Messages already loaded are checked
 * first; when none of them qualifies, the database is asked for the next
 * row past everything loaded, which also steps over legacy rows without a
 * `publicId`.
 */
async function findNextMessageId(input: {
  db: ReturnType<typeof useDb>
  chatRowId: string
  messagesAfterWindow: ReadChatCandidate[]
  lastLoadedRowId: string | undefined
}): Promise<string | undefined> {
  const loadedMessageId = input.messagesAfterWindow
    .find(message => message.messageId)?.messageId

  if (loadedMessageId || input.lastLoadedRowId === undefined) {
    return loadedMessageId
  }

  const nextRow = await input.db.query.messages.findFirst({
    where: {
      chatId: input.chatRowId,
      id: { gt: input.lastLoadedRowId },
      publicId: { isNotNull: true },
    },
    columns: { publicId: true },
    orderBy: { id: 'asc' },
  })

  return nextRow?.publicId ?? undefined
}

/**
 * Reads a window of messages from one of the user's other chats. Ownership
 * is the `{ slug, userId }` lookup, and a chat that does not exist, belongs
 * to someone else, sits outside the active project scope, or is excluded
 * from memory all produce the identical 404, so the tool is no existence
 * oracle. The anchor message is
 * resolved by `publicId` AND the verified chat id, so a message id from any
 * other chat falls back to the start of the chat. Only text parts are read,
 * whitespace is kept intact (code blocks matter), and the window is bounded
 * by `READ_CHAT_MAX_CHARS`.
 *
 * A plain `aroundMessageId` centres the window on that message. The
 * `nextAroundMessageId` returned for further reading is prefixed with
 * `READ_CHAT_CONTINUATION_PREFIX` and points at the first message after the
 * window; a call anchored on such a cursor starts the window at that
 * message and grows only forward, so consecutive calls never repeat a
 * message.
 */
export async function readChat(input: {
  db: ReturnType<typeof useDb>
  userId: number
  chatId: string
  aroundMessageId?: string
  currentChatId: string
  projectId?: string
  logger?: Pick<LoggerLike, 'set'>
}): Promise<ReadChatResult> {
  const chat = await input.db.query.chats.findFirst({
    where: { slug: input.chatId, userId: input.userId },
    columns: {
      id: true,
      slug: true,
      title: true,
      projectId: true,
      memoryExcluded: true,
    },
  })

  if (!chat || chat.memoryExcluded) {
    throw buildChatNotFoundError()
  }

  if (input.projectId !== undefined && chat.projectId !== input.projectId) {
    throw buildChatNotFoundError()
  }

  if (chat.id === input.currentChatId) {
    throw buildCurrentChatError()
  }

  const requestedAnchor = parseAroundMessageId(input.aroundMessageId)
  const anchor = requestedAnchor
    ? await input.db.query.messages.findFirst({
      where: { publicId: requestedAnchor.messageId, chatId: chat.id },
      columns: { id: true },
    })
    : undefined
  let rowWindow: ReadChatRowWindow

  if (!anchor) {
    rowWindow = await loadRowsForward(input.db, chat.id)
  } else if (requestedAnchor?.isContinuation) {
    rowWindow = await loadRowsForward(input.db, chat.id, anchor.id)
  } else {
    rowWindow = await loadRowsAroundAnchor(input.db, chat.id, anchor.id)
  }

  const beforeCandidates = toWrappedCandidates(rowWindow.beforeRows)
  const candidates = [
    ...beforeCandidates,
    ...toWrappedCandidates(rowWindow.afterRows),
  ]
  const { startIndex, endIndex } = selectReadChatWindow(
    candidates,
    Math.max(beforeCandidates.length - 1, 0),
    READ_CHAT_MAX_CHARS,
  )
  const windowMessages = candidates.slice(startIndex, endIndex)
  const hasMoreBefore = startIndex > 0 || rowWindow.hasMoreBeforeFetched
  const hasMoreAfter = endIndex < candidates.length
    || rowWindow.hasMoreAfterFetched
  const isTruncated = hasMoreBefore || hasMoreAfter
  const nextMessageId = hasMoreAfter
    ? await findNextMessageId({
      db: input.db,
      chatRowId: chat.id,
      messagesAfterWindow: candidates.slice(endIndex),
      lastLoadedRowId: rowWindow.afterRows.at(-1)?.id,
    })
    : undefined

  input.logger?.set({
    attributes: {
      chatSearch: {
        stage: 'read-chat',
        messages: windowMessages.length,
        truncated: isTruncated,
      },
    },
  })

  return {
    chat: {
      chatId: chat.slug,
      title: buildChatTitle(chat.title),
      url: `/chats/${chat.slug}`,
    },
    messages: windowMessages.map(toReadChatMessage),
    truncated: isTruncated,
    ...(nextMessageId
      ? {
        nextAroundMessageId:
          `${READ_CHAT_CONTINUATION_PREFIX}${nextMessageId}`,
      }
      : {}),
  }
}
