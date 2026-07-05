import type { H3Event } from 'h3'
import type { BatchItem } from 'drizzle-orm/batch'
import { eq, sql } from 'drizzle-orm'
import { useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  extractStorageKeyFromFileUrl,
  getOwnedFilesByStorageKeys,
} from '~~/server/utils/files/file-governance'

export const SHARE_FILE_TOKEN_TTL_SECONDS = 3600

export type ChatShareDuration
  = | 'day'
    | 'week'
    | 'month'
    | 'year'
    | 'never'

export interface ChatFileReference {
  fileId: string
  storageKey: string
}

const DURATION_DAYS: Record<Exclude<ChatShareDuration, 'never'>, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
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

  const days = DURATION_DAYS[duration]

  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
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

  const ownedFiles = await getOwnedFilesByStorageKeys(
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

  useLogger(event).set({
    chatShareFileSync: {
      chatShareId,
      fileCount: fileReferences.length,
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
