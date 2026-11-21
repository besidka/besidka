import { isConnectorImageMediaType } from '#shared/utils/connectors-policy'
import { extractLocalFileStorageKey } from '#shared/utils/files'

export const CONNECTOR_IMAGE_PART_TYPE = 'data-connector-image'

const CHAT_MARKER_PREFIX = 'chat:'

/**
 * Connector image files have no chat column, so `files.origin_provider`
 * (unused by them otherwise) holds `chat:<chat public id>`: a chat deletion
 * finds every connector image of the chat with it, even one whose reply was
 * never stored. No reader of that column looks at `source = 'connector'`.
 */
export function toConnectorImageChatMarker(chatPublicId: string): string {
  return `${CHAT_MARKER_PREFIX}${chatPublicId}`
}

/**
 * Written by the server for each image a connector call returned that was
 * shown to the model and kept with the chat, so the connector step can show
 * it. `url` is the owner-only `/files/<storageKey>` link and `fileId` the
 * file's public id. The part is a weak reference: `deleted` is never stored,
 * the chat payload sets it when the file is gone. Private: shares and
 * branches drop it.
 */
export interface ConnectorImagePartData {
  toolCallId: string
  fileId: string
  url: string
  mediaType: string
  width: number
  height: number
  size: number
  name: string
  deleted?: boolean
}

export interface ConnectorImageDataPart {
  type: typeof CONNECTOR_IMAGE_PART_TYPE
  id: string
  data: ConnectorImagePartData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildConnectorImagePartId(
  toolCallId: string,
  index: number,
): string {
  return `connector-image-${toolCallId}-${index}`
}

export function isConnectorImageDataPart(
  part: unknown,
): part is ConnectorImageDataPart {
  if (
    !isRecord(part)
    || part.type !== CONNECTOR_IMAGE_PART_TYPE
    || !isRecord(part.data)
  ) {
    return false
  }

  const { data } = part

  return typeof data.toolCallId === 'string'
    && typeof data.fileId === 'string'
    && typeof data.url === 'string'
    && extractLocalFileStorageKey(data.url) !== null
    && typeof data.mediaType === 'string'
    && isConnectorImageMediaType(data.mediaType)
}

/**
 * The saved images of one connector call, in the order the call returned
 * them.
 */
export function getConnectorImagesForToolCall(
  parts: readonly unknown[],
  toolCallId: string | undefined,
): ConnectorImagePartData[] {
  if (!toolCallId) {
    return []
  }

  return parts.flatMap((part) => {
    return isConnectorImageDataPart(part)
      && part.data.toolCallId === toolCallId
      ? [part.data]
      : []
  })
}

/**
 * The saved images of every connector call of a message, keyed by tool call
 * id, read in one pass over the parts.
 */
export function getConnectorImagesByToolCallId(
  parts: readonly unknown[],
): Map<string, ConnectorImagePartData[]> {
  const imagesByToolCallId = new Map<string, ConnectorImagePartData[]>()

  for (const part of parts) {
    if (!isConnectorImageDataPart(part)) {
      continue
    }

    const images = imagesByToolCallId.get(part.data.toolCallId)

    if (images) {
      images.push(part.data)
    } else {
      imagesByToolCallId.set(part.data.toolCallId, [part.data])
    }
  }

  return imagesByToolCallId
}

/**
 * The public ids of every connector image file a message's parts point at.
 */
export function collectConnectorImageFileIds(
  parts: readonly unknown[],
): string[] {
  return [...new Set(parts.flatMap((part) => {
    return isConnectorImageDataPart(part) ? [part.data.fileId] : []
  }))]
}
