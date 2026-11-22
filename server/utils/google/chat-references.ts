import { and, eq, like, or } from 'drizzle-orm'
import { GOOGLE_DRIVE_FILE_ID_PATTERN } from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_FILE_REFERENCE_KIND,
  GOOGLE_DRIVE_SEARCH_TOOL_NAME,
} from '#shared/utils/google-drive-tools'
import {
  GOOGLE_GMAIL_ID_SHAPE,
  GOOGLE_GMAIL_SEARCH_TOOL_NAME,
  GOOGLE_GMAIL_THREAD_REFERENCE_KIND,
} from '#shared/utils/google-gmail-tools'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const DATE_MAX_LENGTH = 64
const TITLE_MAX_LENGTH = 300
const TOOL_PART_PREFIX = 'tool-'
const OUTPUT_STATE = 'output-available'

export interface KnownGoogleItem {
  id: string
  date: string | null
  title: string | null
}

interface ReferenceSource {
  toolName: string
  kind: string
  idShape: RegExp
}

const THREAD_SOURCE: ReferenceSource = {
  toolName: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
  kind: GOOGLE_GMAIL_THREAD_REFERENCE_KIND,
  idShape: GOOGLE_GMAIL_ID_SHAPE,
}

const FOUND_FILE_SOURCE: ReferenceSource = {
  toolName: GOOGLE_DRIVE_SEARCH_TOOL_NAME,
  kind: GOOGLE_DRIVE_FILE_REFERENCE_KIND,
  idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolNameOf(part: Record<string, unknown>): string | null {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : null
  }

  return typeof part.type === 'string' && part.type.startsWith(TOOL_PART_PREFIX)
    ? part.type.slice(TOOL_PART_PREFIX.length)
    : null
}

function boundedText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value && value.length <= maxLength
    ? value
    : null
}

function itemsOfOutput(
  output: unknown,
  source: ReferenceSource,
): KnownGoogleItem[] {
  const references = isRecord(output) ? output.references : undefined

  if (!Array.isArray(references)) {
    return []
  }

  return references.flatMap((reference: unknown): KnownGoogleItem[] => {
    if (
      !isRecord(reference)
      || reference.kind !== source.kind
      || typeof reference.id !== 'string'
      || !source.idShape.test(reference.id)
    ) {
      return []
    }

    return [{
      id: reference.id,
      date: boundedText(reference.date, DATE_MAX_LENGTH),
      title: boundedText(reference.title, TITLE_MAX_LENGTH),
    }]
  })
}

function itemsOfParts(
  parts: unknown,
  source: ReferenceSource,
): KnownGoogleItem[] {
  if (!Array.isArray(parts)) {
    return []
  }

  return parts.flatMap((part: unknown) => {
    return isRecord(part)
      && part.state === OUTPUT_STATE
      && toolNameOf(part)?.toLowerCase() === source.toolName
      ? itemsOfOutput(part.output, source)
      : []
  })
}

/**
 * The Gmail threads and Drive files that a search in this chat already
 * returned, which are the only ones the thread read, a reply draft and the
 * read of a found file accept. A thread counts only from a
 * `google__gmail_search` result and a file only from a
 * `google__drive_search` result (never from a picked, read or saved file,
 * which share the `drive-file` kind). The index starts from the chat's
 * stored parts and the parts of the reply being resumed, and grows with
 * every search of this send, whose results are not in D1 yet. It holds ids,
 * dates and the cleaned file names only, never mail text.
 */
export interface GoogleReferenceIndex {
  threads: ReadonlyMap<string, KnownGoogleItem>
  foundFiles: ReadonlyMap<string, KnownGoogleItem>
  addThreads: (output: unknown) => void
  addFoundFiles: (output: unknown) => void
}

export function createGoogleReferenceIndex(
  partLists: ReadonlyArray<unknown>,
): GoogleReferenceIndex {
  const threads = new Map<string, KnownGoogleItem>()
  const foundFiles = new Map<string, KnownGoogleItem>()
  const add = (
    target: Map<string, KnownGoogleItem>,
    items: KnownGoogleItem[],
  ) => {
    for (const item of items) {
      target.set(item.id, item)
    }
  }

  for (const parts of partLists) {
    add(threads, itemsOfParts(parts, THREAD_SOURCE))
    add(foundFiles, itemsOfParts(parts, FOUND_FILE_SOURCE))
  }

  return {
    threads,
    foundFiles,
    addThreads: (output) => {
      add(threads, itemsOfOutput(output, THREAD_SOURCE))
    },
    addFoundFiles: (output) => {
      add(foundFiles, itemsOfOutput(output, FOUND_FILE_SOURCE))
    },
  }
}

/**
 * The stored parts of the messages of one of the user's chats that hold a
 * Gmail or Drive search result: one query, joined to the chat so another
 * user's chat id yields nothing, and filtered by the tool name so other
 * messages are never loaded. A failure is logged and yields no parts, so
 * every id is then refused (the safe direction).
 */
export async function loadChatSearchParts(input: {
  db: DbClient
  userId: number
  chatPublicId: string
  logger: LoggerLike
}): Promise<unknown[]> {
  try {
    const rows = await input.db
      .select({ parts: schema.messages.parts })
      .from(schema.messages)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
      .where(and(
        eq(schema.chats.id, input.chatPublicId),
        eq(schema.chats.userId, input.userId),
        or(
          like(schema.messages.parts, `%${GOOGLE_GMAIL_SEARCH_TOOL_NAME}%`),
          like(schema.messages.parts, `%${GOOGLE_DRIVE_SEARCH_TOOL_NAME}%`),
        ),
      ))

    return rows.map(row => row.parts)
  } catch (exception) {
    input.logger.set({
      attributes: {
        googleByoTools: {
          chatReferencesRead: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })

    return []
  }
}
