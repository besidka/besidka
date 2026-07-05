import type { FileUIPart, UIMessage } from 'ai'
import type { H3Event } from 'h3'
import { SHARE_FILE_TOKEN_TTL_SECONDS } from '~~/server/utils/chats/share'
import { extractStorageKeyFromFileUrl } from '~~/server/utils/files/file-governance'
import { createFileAccessToken } from '~~/server/utils/files/file-share-access'

export async function rewriteShareFileParts<
  TMessage extends { parts: UIMessage['parts'] },
>(
  messages: TMessage[],
  shareId: string,
  event: H3Event = useEvent(),
): Promise<TMessage[]> {
  const storageKeyToFileId = await buildStorageKeyToFileIdMap(messages)
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

async function buildStorageKeyToFileIdMap<
  TMessage extends { parts: UIMessage['parts'] },
>(messages: TMessage[]): Promise<Map<string, string>> {
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

  if (storageKeys.size === 0) {
    return new Map()
  }

  const files = await useDb().query.files.findMany({
    where: {
      storageKey: { in: Array.from(storageKeys) },
    },
    columns: {
      id: true,
      storageKey: true,
    },
  })

  const storageKeyToFileId = new Map<string, string>()

  for (const file of files) {
    storageKeyToFileId.set(file.storageKey, file.id)
  }

  return storageKeyToFileId
}
