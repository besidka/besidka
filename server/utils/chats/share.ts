import type { H3Event } from 'h3'
import type { BatchItem } from 'drizzle-orm/batch'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  extractStorageKeyFromFileUrl,
  getOwnedFilesByStorageKeys,
} from '~~/server/utils/files/file-governance'

export const SHARE_FILE_TOKEN_TTL_SECONDS = 3600

const MAX_BATCH_QUERY_PARAMS = 90

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

export type ChatShareDuration
  = | 'hour'
    | 'day'
    | 'week'
    | 'month'
    | 'year'
    | 'never'

export interface ChatFileReference {
  fileId: string
  storageKey: string
}

const DURATION_HOURS: Record<Exclude<ChatShareDuration, 'never'>, number> = {
  hour: 1,
  day: 24,
  week: 168,
  month: 720,
  year: 8760,
}

const ACTIVE_SHARE_COLUMNS = {
  id: true,
  slug: true,
  chatId: true,
  revoked: true,
  expiresAt: true,
  indexable: true,
  showFiles: true,
  showMetadata: true,
  showAuthorAvatar: true,
  allowBranch: true,
} as const

export function durationToExpiresAt(
  duration: ChatShareDuration,
  now: Date = new Date(),
): Date | null {
  if (duration === 'never') {
    return null
  }

  const hours = DURATION_HOURS[duration]

  return new Date(now.getTime() + hours * 60 * 60 * 1000)
}

export async function resolveActiveShareBySlug(
  slug: string,
  event: H3Event = useEvent(),
) {
  const now = new Date()

  const share = await useDb().query.chatShares.findFirst({
    where: {
      slug,
      revoked: false,
      OR: [
        { expiresAt: { isNull: true } },
        { expiresAt: { gt: now } },
      ],
    },
    columns: ACTIVE_SHARE_COLUMNS,
  })

  useLogger(event).set({
    chatShareResolve: { slug, found: !!share },
  })

  return share ?? null
}

export async function getActiveShareForChat(
  chatId: string,
  event: H3Event = useEvent(),
) {
  const now = new Date()

  const share = await useDb().query.chatShares.findFirst({
    where: {
      chatId,
      revoked: false,
      OR: [
        { expiresAt: { isNull: true } },
        { expiresAt: { gt: now } },
      ],
    },
    columns: ACTIVE_SHARE_COLUMNS,
  })

  useLogger(event).set({
    chatShareLookup: { chatId, found: !!share },
  })

  return share ?? null
}

export async function enumerateChatFileIds(
  chatId: string,
  ownerUserId: number,
  event: H3Event = useEvent(),
): Promise<ChatFileReference[]> {
  const messages = await useDb().query.messages.findMany({
    where: { chatId },
    columns: {
      parts: true,
    },
  })

  const storageKeys = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'file' || part.url.startsWith('data:')) {
        continue
      }

      const storageKey = extractStorageKeyFromFileUrl(part.url)

      if (storageKey) {
        storageKeys.add(storageKey)
      }
    }
  }

  const ownedFiles = await getOwnedFilesByStorageKeysInChunks(
    ownerUserId,
    Array.from(storageKeys),
  )

  const references = Array.from(ownedFiles.values()).map((file) => {
    return {
      fileId: file.id,
      storageKey: file.storageKey,
    }
  })

  useLogger(event).set({
    chatShareFileEnumeration: {
      chatId,
      fileCount: references.length,
    },
  })

  return references
}

type OwnedFilesMap = Awaited<ReturnType<typeof getOwnedFilesByStorageKeys>>

async function getOwnedFilesByStorageKeysInChunks(
  ownerUserId: number,
  storageKeys: string[],
): Promise<OwnedFilesMap> {
  const chunks = chunkArray(storageKeys, MAX_BATCH_QUERY_PARAMS)

  if (chunks.length === 0) {
    return getOwnedFilesByStorageKeys(ownerUserId, [])
  }

  const merged: OwnedFilesMap = new Map()

  for (const chunk of chunks) {
    const chunkResult = await getOwnedFilesByStorageKeys(ownerUserId, chunk)

    for (const [storageKey, file] of chunkResult) {
      merged.set(storageKey, file)
    }
  }

  return merged
}

export async function syncChatShareFiles(
  chatShareId: string,
  chatId: string,
  ownerUserId: number,
  showFiles: boolean,
  event: H3Event = useEvent(),
): Promise<void> {
  const db = useDb()

  if (!showFiles) {
    await db.delete(schema.chatShareFiles)
      .where(eq(schema.chatShareFiles.chatShareId, chatShareId))

    useLogger(event).set({
      chatShareFileSync: {
        chatShareId,
        fileCount: 0,
      },
    })

    return
  }

  const fileReferences = await enumerateChatFileIds(
    chatId,
    ownerUserId,
    event,
  )

  const currentFileIds = new Set(
    fileReferences.map(reference => reference.fileId),
  )

  const existingGrants = await db.query.chatShareFiles.findMany({
    where: { chatShareId },
    columns: {
      fileId: true,
    },
  })

  const staleFileIds = existingGrants
    .map(grant => grant.fileId)
    .filter(fileId => !currentFileIds.has(fileId))

  for (const chunk of chunkArray(staleFileIds, MAX_BATCH_QUERY_PARAMS)) {
    await db.delete(schema.chatShareFiles)
      .where(and(
        eq(schema.chatShareFiles.chatShareId, chatShareId),
        inArray(schema.chatShareFiles.fileId, chunk),
      ))
  }

  useLogger(event).set({
    chatShareFileSync: {
      chatShareId,
      fileCount: fileReferences.length,
      staleFileCount: staleFileIds.length,
    },
  })

  if (fileReferences.length === 0) {
    return
  }

  const inserts = fileReferences.map((reference) => {
    return db
      .insert(schema.chatShareFiles)
      .values({
        chatShareId,
        fileId: reference.fileId,
      })
      .onConflictDoNothing()
  }) as unknown as [BatchItem<'sqlite'>]

  await db.batch(inserts)
}

export function buildChatSharedColumn(now: Date = new Date()) {
  const nowSeconds = Math.floor(now.getTime() / 1000)

  return sql<boolean>`
    exists (
      select 1 from ${schema.chatShares}
      where ${schema.chatShares.chatId} = ${schema.chats.id}
        and ${schema.chatShares.revoked} = 0
        and (
          ${schema.chatShares.expiresAt} is null
          or ${schema.chatShares.expiresAt} > ${nowSeconds}
        )
    )
  `.mapWith(Boolean)
}
