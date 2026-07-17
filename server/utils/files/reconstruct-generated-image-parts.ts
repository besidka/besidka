import type { UIMessage } from 'ai'
import { extractLocalFileStorageKey } from '#shared/utils/files'
import {
  getOwnedGeneratedImageFilesByStorageKeys,
  type OwnedGeneratedImageFile,
} from '~~/server/utils/files/file-governance'

// Owner-chat use only. Never call this from the public shared-chat endpoint,
// and never call it after hideFileParts() there: it turns a redacted `file`
// placeholder back into a `tool-generate_image` part, which is not a `file`
// type and would bypass the showFiles:false redaction entirely.
export async function reconstructGeneratedImageParts<
  TMessage extends { parts: UIMessage['parts'] },
>(
  messages: TMessage[],
  userId: number,
): Promise<TMessage[]> {
  const storageKeys = collectFileStorageKeys(messages)
  const generatedFiles = await getOwnedGeneratedImageFilesByStorageKeys(
    userId,
    storageKeys,
  )

  if (generatedFiles.size === 0) {
    return messages
  }

  return messages.map((message) => {
    const rewrittenParts = message.parts.map((part) => {
      if (part.type !== 'file') {
        return part
      }

      const storageKey = extractLocalFileStorageKey(part.url)
      const generatedFile = storageKey
        ? generatedFiles.get(storageKey)
        : undefined

      if (!generatedFile) {
        return part
      }

      if (!hasOriginMetadata(generatedFile)) {
        return part
      }

      return buildGeneratedImageToolPart(generatedFile)
    })

    return {
      ...message,
      parts: rewrittenParts,
    }
  })
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

      const storageKey = extractLocalFileStorageKey(part.url)

      if (storageKey) {
        storageKeys.add(storageKey)
      }
    }
  }

  return Array.from(storageKeys)
}

function hasOriginMetadata(
  file: OwnedGeneratedImageFile,
): file is OwnedGeneratedImageFile & {
  originProvider: string
  originModel: string
} {
  return file.originProvider !== null && file.originModel !== null
}

function buildGeneratedImageToolPart(
  file: OwnedGeneratedImageFile & {
    originProvider: string
    originModel: string
  },
): UIMessage['parts'][number] {
  return {
    type: 'tool-generate_image',
    toolCallId: `reconstructed-${file.id}`,
    state: 'output-available',
    input: {},
    output: {
      status: 'ready',
      provider: file.originProvider,
      model: file.originModel,
      file: {
        id: file.id,
        storageKey: file.storageKey,
        name: file.name,
        size: file.size,
        type: file.type,
        source: 'assistant',
        url: `/files/${file.storageKey}`,
        downloadUrl: `/files/${file.storageKey}?download=1`,
      },
    },
  } as UIMessage['parts'][number]
}
