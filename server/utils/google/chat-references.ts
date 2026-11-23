import { and, asc, eq, like, or } from 'drizzle-orm'
import { GOOGLE_DRIVE_FILE_ID_PATTERN } from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
  GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
  GOOGLE_DRIVE_FILE_REFERENCE_KIND,
  GOOGLE_DRIVE_FOLDER_REFERENCE_KIND,
  GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
  GOOGLE_DRIVE_MOVE_TOOL_NAME,
  GOOGLE_DRIVE_READ_FOUND_TOOL_NAME,
  GOOGLE_DRIVE_RENAME_TOOL_NAME,
  GOOGLE_DRIVE_ROOT_REFERENCE_KIND,
  GOOGLE_DRIVE_SEARCH_TOOL_NAME,
} from '#shared/utils/google-drive-tools'
import {
  GOOGLE_DRIVE_ROOT_ALIAS,
  GOOGLE_DRIVE_ROOT_TITLE,
  GOOGLE_DRIVE_WRITE_TOOL_SCOPES,
} from '#shared/utils/google-drive-write'
import {
  GOOGLE_BYO_TOOL_SCOPES,
  GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME,
  GOOGLE_GMAIL_ID_SHAPE,
  GOOGLE_GMAIL_READ_THREAD_TOOL_NAME,
  GOOGLE_GMAIL_SEARCH_TOOL_NAME,
  GOOGLE_GMAIL_THREAD_REFERENCE_KIND,
} from '#shared/utils/google-gmail-tools'
import { hasScopes } from '#shared/utils/google-scopes'
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
  kind?: string
  parentId?: string
}

interface ReferenceSource {
  toolName: string
  kinds: readonly string[]
  idShape: RegExp
}

const PARENT_ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/

const THREAD_SOURCE: ReferenceSource = {
  toolName: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
  kinds: [GOOGLE_GMAIL_THREAD_REFERENCE_KIND],
  idShape: GOOGLE_GMAIL_ID_SHAPE,
}

const FOUND_FILE_SOURCE: ReferenceSource = {
  toolName: GOOGLE_DRIVE_SEARCH_TOOL_NAME,
  kinds: [GOOGLE_DRIVE_FILE_REFERENCE_KIND],
  idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
}

const FOLDER_KINDS: readonly string[] = [
  GOOGLE_DRIVE_FOLDER_REFERENCE_KIND,
  GOOGLE_DRIVE_ROOT_REFERENCE_KIND,
]

const WRITABLE_KINDS: readonly string[] = [
  GOOGLE_DRIVE_FILE_REFERENCE_KIND,
  GOOGLE_DRIVE_FOLDER_REFERENCE_KIND,
]

const CHANGED_FOLDER_SOURCES: readonly ReferenceSource[] = [
  GOOGLE_DRIVE_RENAME_TOOL_NAME,
  GOOGLE_DRIVE_MOVE_TOOL_NAME,
].map((toolName) => {
  return {
    toolName,
    kinds: [GOOGLE_DRIVE_FOLDER_REFERENCE_KIND],
    idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
  }
})

const CHANGED_ITEM_SOURCES: readonly ReferenceSource[] = [
  GOOGLE_DRIVE_RENAME_TOOL_NAME,
  GOOGLE_DRIVE_MOVE_TOOL_NAME,
].map((toolName) => {
  return {
    toolName,
    kinds: WRITABLE_KINDS,
    idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
  }
})

const FOLDER_SOURCES: readonly ReferenceSource[] = [
  {
    toolName: GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
    kinds: FOLDER_KINDS,
    idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
  },
  {
    toolName: GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
    kinds: [GOOGLE_DRIVE_FOLDER_REFERENCE_KIND],
    idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
  },
  ...CHANGED_FOLDER_SOURCES,
]

const WRITABLE_SOURCES: readonly ReferenceSource[] = [
  FOUND_FILE_SOURCE,
  {
    toolName: GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
    kinds: WRITABLE_KINDS,
    idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
  },
  {
    toolName: GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
    kinds: [GOOGLE_DRIVE_FOLDER_REFERENCE_KIND],
    idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
  },
  {
    toolName: GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
    kinds: [GOOGLE_DRIVE_FILE_REFERENCE_KIND],
    idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
  },
  ...CHANGED_ITEM_SOURCES,
]

const OUTPUT_FOLDER_SOURCE: ReferenceSource = {
  toolName: '',
  kinds: FOLDER_KINDS,
  idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
}

const OUTPUT_WRITABLE_SOURCE: ReferenceSource = {
  toolName: '',
  kinds: WRITABLE_KINDS,
  idShape: GOOGLE_DRIVE_FILE_ID_PATTERN,
}

const ROOT_ITEM: KnownGoogleItem = {
  id: GOOGLE_DRIVE_ROOT_ALIAS,
  date: null,
  title: GOOGLE_DRIVE_ROOT_TITLE,
  kind: GOOGLE_DRIVE_ROOT_REFERENCE_KIND,
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
      || typeof reference.kind !== 'string'
      || !source.kinds.includes(reference.kind)
      || typeof reference.id !== 'string'
      || !source.idShape.test(reference.id)
    ) {
      return []
    }

    const parentId = typeof reference.parentId === 'string'
      && PARENT_ID_SHAPE.test(reference.parentId)
      ? reference.parentId
      : null

    return [{
      id: reference.id,
      date: boundedText(reference.date, DATE_MAX_LENGTH),
      title: boundedText(reference.title, TITLE_MAX_LENGTH),
      kind: reference.kind,
      ...(parentId ? { parentId } : {}),
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
 * The Gmail threads and Drive items that a tool in this chat already
 * returned, which are the only ones the thread read, a reply draft, the
 * read of a found file and the Drive folder tools accept. A thread counts
 * only from a `google__gmail_search` result and a found file only from a
 * `google__drive_search` result (never from a picked, read, saved or listed
 * file, which share the `drive-file` kind). `folders` holds the folders a
 * `google__drive_list_folder`, `google__drive_create_folder`,
 * `google__drive_rename` or `google__drive_move` result named, plus My Drive
 * itself under the alias `root`; `writableItems` holds the files and folders
 * a search, a folder listing, a create (a file or a folder), a rename or a
 * move result named
 * (never a file Besidka's own Drive client picked or saved). The index
 * starts from the chat's stored parts, read in the order they were stored so
 * a later result (a rename's new title, a move's new parent) replaces an
 * earlier one, and the parts of the reply being resumed, and grows with every
 * call of this send, whose results are not in D1 yet. It holds ids, dates,
 * kinds, parent ids and the cleaned names only, never mail text.
 */
export interface GoogleReferenceIndex {
  threads: ReadonlyMap<string, KnownGoogleItem>
  foundFiles: ReadonlyMap<string, KnownGoogleItem>
  folders: ReadonlyMap<string, KnownGoogleItem>
  writableItems: ReadonlyMap<string, KnownGoogleItem>
  addThreads: (output: unknown) => void
  addFoundFiles: (output: unknown) => void
  addFolders: (output: unknown) => void
  addWritableItems: (output: unknown) => void
}

export function isDriveRootItem(item: KnownGoogleItem | undefined): boolean {
  return item?.kind === GOOGLE_DRIVE_ROOT_REFERENCE_KIND
}

export function createGoogleReferenceIndex(
  partLists: ReadonlyArray<unknown>,
): GoogleReferenceIndex {
  const threads = new Map<string, KnownGoogleItem>()
  const foundFiles = new Map<string, KnownGoogleItem>()
  const folders = new Map<string, KnownGoogleItem>([
    [ROOT_ITEM.id, ROOT_ITEM],
  ])
  const writableItems = new Map<string, KnownGoogleItem>()
  const add = (
    target: Map<string, KnownGoogleItem>,
    items: KnownGoogleItem[],
  ) => {
    for (const item of items) {
      target.set(item.id, isDriveRootItem(item)
        ? { ...item, title: GOOGLE_DRIVE_ROOT_TITLE }
        : item)
    }
  }

  for (const parts of partLists) {
    for (const part of Array.isArray(parts) ? parts : []) {
      add(threads, itemsOfParts([part], THREAD_SOURCE))
      add(foundFiles, itemsOfParts([part], FOUND_FILE_SOURCE))

      for (const source of FOLDER_SOURCES) {
        add(folders, itemsOfParts([part], source))
      }

      for (const source of WRITABLE_SOURCES) {
        add(writableItems, itemsOfParts([part], source))
      }
    }
  }

  return {
    threads,
    foundFiles,
    folders,
    writableItems,
    addThreads: (output) => {
      add(threads, itemsOfOutput(output, THREAD_SOURCE))
    },
    addFoundFiles: (output) => {
      add(foundFiles, itemsOfOutput(output, FOUND_FILE_SOURCE))
    },
    addFolders: (output) => {
      add(folders, itemsOfOutput(output, OUTPUT_FOLDER_SOURCE))
    },
    addWritableItems: (output) => {
      add(writableItems, itemsOfOutput(output, OUTPUT_WRITABLE_SOURCE))
    },
  }
}

const TOOLS_NEEDING_THE_INDEX: readonly string[] = [
  GOOGLE_GMAIL_READ_THREAD_TOOL_NAME,
  GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME,
  GOOGLE_DRIVE_READ_FOUND_TOOL_NAME,
]

/**
 * The reference index of one send, built once per send and shared by every
 * tool builder that needs it. The chat's stored search and folder parts are
 * read from D1 only when a tool that needs them is in scope for the stored
 * grant (the thread read, a reply draft, the read of a found file, or the
 * Drive folder tools), so a user without those tools costs no query.
 */
export async function buildGoogleReferenceIndex(input: {
  db: DbClient
  userId: number
  chatPublicId?: string
  priorParts?: readonly unknown[]
  grantedScopes: string | readonly string[]
  logger: LoggerLike
}): Promise<GoogleReferenceIndex> {
  const needsStoredParts = !!input.chatPublicId
    && (
      TOOLS_NEEDING_THE_INDEX.some((toolName) => {
        return hasScopes(input.grantedScopes, GOOGLE_BYO_TOOL_SCOPES[toolName]!)
      })
      || hasScopes(input.grantedScopes, GOOGLE_DRIVE_WRITE_TOOL_SCOPES)
    )
  const storedParts = needsStoredParts && input.chatPublicId
    ? await loadChatSearchParts({
      db: input.db,
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      logger: input.logger,
    })
    : []

  return createGoogleReferenceIndex([...storedParts, input.priorParts ?? []])
}

/**
 * Whether `list_folder` accepts a folder id: My Drive's alias, a folder the
 * chat already knows, or the parent id of any known item (so a search hit's
 * folder can be opened). Only the first two are ever valid destinations.
 */
export function isListableFolderId(
  index: GoogleReferenceIndex,
  id: string,
): boolean {
  if (index.folders.has(id)) {
    return true
  }

  for (const items of [index.foundFiles, index.writableItems]) {
    for (const item of items.values()) {
      if (item.parentId === id) {
        return true
      }
    }
  }

  return false
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
          like(
            schema.messages.parts,
            `%${GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME}%`,
          ),
          like(
            schema.messages.parts,
            `%${GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME}%`,
          ),
          like(
            schema.messages.parts,
            `%${GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME}%`,
          ),
          like(schema.messages.parts, `%${GOOGLE_DRIVE_RENAME_TOOL_NAME}%`),
          like(schema.messages.parts, `%${GOOGLE_DRIVE_MOVE_TOOL_NAME}%`),
        ),
      ))
      .orderBy(asc(schema.messages.id))

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
