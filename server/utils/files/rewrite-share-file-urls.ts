import type { FileUIPart, UIMessage } from 'ai'
import type { H3Event } from 'h3'
import { SHARE_FILE_TOKEN_TTL_SECONDS } from '~~/server/utils/chats/share'
import {
  extractStorageKeyFromFileUrl,
  getOwnedFilesByStorageKeys,
} from '~~/server/utils/files/file-governance'
import { createFileAccessToken } from '~~/server/utils/files/file-share-access'

export function stripFileParts<
  TMessage extends { parts: UIMessage['parts'] },
>(messages: TMessage[]): TMessage[] {
  return messages.map((message) => {
    return {
      ...message,
      parts: message.parts.filter((part) => {
        return part.type !== 'file'
      }),
    }
  })
}

export async function rewriteShareFileParts<
  TMessage extends { parts: UIMessage['parts'] },
>(
  messages: TMessage[],
  shareId: string,
  event: H3Event = useEvent(),
): Promise<TMessage[]> {
  const hasFileParts = messages.some((message) => {
    return message.parts.some((part) => {
      return part.type === 'file'
    })
  })

  const storageKeyToFileId = hasFileParts
    ? await buildGrantedStorageKeyToFileIdMap(shareId)
    : new Map<string, string>()
  const tokensByFileId = new Map<string, string>()
  const rewrittenMessages: TMessage[] = []

  for (const message of messages) {
    const rewrittenParts: UIMessage['parts'] = []

    for (const part of message.parts) {
      if (part.type !== 'file') {
        rewrittenParts.push(part)
        continue
      }

      const rewrittenPart = await rewriteFilePart(
        part,
        storageKeyToFileId,
        tokensByFileId,
        shareId,
        event,
      )

      if (rewrittenPart) {
        rewrittenParts.push(rewrittenPart)
      }
    }

    rewrittenMessages.push({
      ...message,
      parts: rewrittenParts,
    })
  }

  return rewrittenMessages
}

export async function rewriteBranchedChatFileParts<
  TMessage extends { parts: UIMessage['parts'] },
>(
  messages: TMessage[],
  ownerUserId: number,
  shareId: string | null,
  event: H3Event = useEvent(),
): Promise<TMessage[]> {
  const storageKeys = collectFileStorageKeys(messages)

  if (storageKeys.length === 0) {
    return messages
  }

  const ownedFiles = await getOwnedFilesByStorageKeys(ownerUserId, storageKeys)
  const grantedStorageKeyToFileId = shareId
    ? await buildGrantedStorageKeyToFileIdMap(shareId)
    : new Map<string, string>()
  const tokensByFileId = new Map<string, string>()
  const rewrittenMessages: TMessage[] = []

  for (const message of messages) {
    const rewrittenParts: UIMessage['parts'] = []

    for (const part of message.parts) {
      if (part.type !== 'file') {
        rewrittenParts.push(part)
        continue
      }

      const storageKey = extractStorageKeyFromFileUrl(part.url)

      if (!storageKey || ownedFiles.has(storageKey)) {
        rewrittenParts.push(part)
        continue
      }

      const fileId = grantedStorageKeyToFileId.get(storageKey)

      if (fileId && shareId) {
        rewrittenParts.push(await tokenizeFilePart(
          part,
          fileId,
          tokensByFileId,
          shareId,
          event,
        ))
      }
    }

    rewrittenMessages.push({
      ...message,
      parts: rewrittenParts,
    })
  }

  return rewrittenMessages
}

function collectFileStorageKeys<
  TMessage extends { parts: UIMessage['parts'] },
>(messages: TMessage[]): string[] {
  const storageKeys = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'file') {
        continue
      }

      const storageKey = extractStorageKeyFromFileUrl(part.url)

      if (storageKey) {
        storageKeys.add(storageKey)
      }
    }
  }

  return Array.from(storageKeys)
}

async function rewriteFilePart(
  part: FileUIPart,
  storageKeyToFileId: Map<string, string>,
  tokensByFileId: Map<string, string>,
  shareId: string,
  event: H3Event,
): Promise<FileUIPart | null> {
  const storageKey = extractStorageKeyFromFileUrl(part.url)
  const fileId = storageKey
    ? storageKeyToFileId.get(storageKey)
    : undefined

  if (!fileId) {
    return null
  }

  return tokenizeFilePart(part, fileId, tokensByFileId, shareId, event)
}

async function tokenizeFilePart(
  part: FileUIPart,
  fileId: string,
  tokensByFileId: Map<string, string>,
  shareId: string,
  event: H3Event,
): Promise<FileUIPart> {
  const existingToken = tokensByFileId.get(fileId)
  const token = existingToken ?? await createFileAccessToken(
    {
      shareId,
      fileId,
      expiresInSeconds: SHARE_FILE_TOKEN_TTL_SECONDS,
    },
    event,
  )

  tokensByFileId.set(fileId, token)

  const separator = part.url.includes('?') ? '&' : '?'

  return {
    ...part,
    url: `${part.url}${separator}token=${token}`,
  }
}

async function buildGrantedStorageKeyToFileIdMap(
  shareId: string,
): Promise<Map<string, string>> {
  const grants = await useDb().query.chatShareFiles.findMany({
    where: { chatShareId: shareId },
    columns: {
      fileId: true,
    },
    with: {
      file: {
        columns: {
          storageKey: true,
        },
      },
    },
  })

  const storageKeyToFileId = new Map<string, string>()

  for (const grant of grants) {
    storageKeyToFileId.set(grant.file.storageKey, grant.fileId)
  }

  return storageKeyToFileId
}
