import type { ModelMessage } from 'ai'

const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/

export function resolveDataUrlsInModelMessages(
  messages: ModelMessage[],
): ModelMessage[] {
  for (const message of messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      continue
    }

    for (const part of message.content) {
      if (
        part.type !== 'file'
        || typeof part.data !== 'string'
        || !part.data.startsWith('data:')
      ) {
        continue
      }

      const match = part.data.match(DATA_URL_REGEX)

      if (!match) {
        continue
      }

      const [, mediaType, base64Content] = match

      if (!base64Content) {
        continue
      }

      part.data = base64ToUint8Array(base64Content)

      if (mediaType && !part.mediaType) {
        part.mediaType = mediaType
      }
    }
  }

  return messages
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
